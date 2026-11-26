const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const iconAssetDirectory = app.isPackaged
  ? path.join(process.resourcesPath, "assets")
  : path.join(__dirname, "..", "assets");
const appIconPath = path.join(iconAssetDirectory, "sync.ico");
const trayIconPath = path.join(iconAssetDirectory, "sync-tray.png");
if (process.platform === "win32") {
  app.setAppUserModelId("com.syncnullverox.syncai");
}
const { SyncDatabase } = require("./database.cjs");
const { FileOperationManager } = require("./file-operation-manager.cjs");
const { readGgufMetadata, estimatePeakBytes } = require("./gguf.cjs");

const isDevelopment = process.argv.slice(1).some(arg => arg === "." || arg === "./") || process.env.SYNC_AI_DEV === "1";
const startupLogPath = path.join(os.tmpdir(), "sync-ai-desktop-startup.log");
function logStartup(message) {
  try {
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\r\n`, "utf8");
  } catch {}
}
try {
  fs.writeFileSync(startupLogPath, `[${new Date().toISOString()}] Electron main process module loaded.\r\n`, "utf8");
} catch {}
process.on("uncaughtException", error => logStartup("Uncaught exception: " + (error?.stack || error)));
process.on("unhandledRejection", error => logStartup("Unhandled rejection: " + (error?.stack || error)));

let splashAvailable = true;
let mainWindow = null;
let tray = null;
let database = null;
let actionManager = null;
let waitingForActionShutdown = false;
let isQuitting = false;
let inferenceWorker = null;
let memoryJobProcess = null;
let pendingLoad = null;
let activeGeneration = null;
const generationQueue = [];
let forceStoppingGeneration = false;
let expectedWorkerExit = false;
let runtimeState = {
  isLoading: false, isLoaded: false, isGenerating: false,
  loadingModelId: null, loadedModelId: null, loadedModelName: null, loadedAt: null,
  estimatedMemoryBytes: null, contextLength: null, batchSize: null,
  memoryLimitBytes: null, workerWorkingSetBytes: null, workerPrivateBytes: null,
  hardLimitSupported: false, lastErrorCode: null, lastError: null
};

function getInferenceOptions() {
  const raw = database.get_setting({ key: "inference_context" });
  let saved = {};
  if (raw != null) {
    try { saved = JSON.parse(raw); }
    catch { throw new Error("Saved inference context settings are invalid JSON. Open Runtime and save them again."); }
  }
  const contextLength = Number(saved.contextLength ?? 2048);
  const batchSize = Number(saved.batchSize ?? 128);
  if (!Number.isInteger(contextLength) || contextLength < 512 || contextLength > 32768) throw new Error("Context length must be between 512 and 32,768 tokens.");
  if (!Number.isInteger(batchSize) || batchSize < 16 || batchSize > 2048) throw new Error("Batch size must be between 16 and 2,048 tokens.");
  return { contextLength, batchSize: Math.min(batchSize, contextLength) };
}
function generationSummary(job, includeText = false) {
  return {
    generationId: job.generationId, chatId: job.chatId, userMessageId: job.userMessageId,
    purpose: job.purpose, state: job === activeGeneration ? "generating" : "queued",
    startedAt: job.startedAt, queuedAt: job.queuedAt,
    ...(includeText ? { text: job.text } : {})
  };
}
const runtimeStatus = () => ({
  ...runtimeState,
  workerPid: inferenceWorker?.pid ?? null,
  isForceStoppingGeneration: forceStoppingGeneration,
  activeGeneration: activeGeneration ? generationSummary(activeGeneration, true) : null,
  queuedGenerations: generationQueue.map(job => generationSummary(job)),
  queuedGenerationCount: generationQueue.length,
  backend: runtimeState.isLoaded ? "llama.cpp · CPU · isolated utility process" : "llama.cpp · CPU · worker idle"
});

function sendGenerationEvent(event) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("sync:generation-event", event);
  }
}

function sendActionEvent(event) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("sync:action-event", event);
  }
}

function generationFailureResult(job, error, status = "error") {
  const cancelled = status === "cancelled";
  return { text: job.text || "", diagnostics: {
    generationId: job.generationId, modelId: runtimeState.loadedModelId, modelLabel: runtimeState.loadedModelName,
    backend: "llama.cpp", backendVersion: "node-llama-cpp 3.22.3", status,
    promptTokens: null, generatedTokens: null, promptEvalMs: null, generationMs: null, tokensPerSecond: null,
    contextSize: runtimeState.contextLength, maxContextSize: runtimeState.contextLength, batchSize: runtimeState.batchSize,
    temperature: 0.7, stopReason: cancelled ? "cancelled" : null,
    errorCode: cancelled ? null : "worker_operation_failed",
    errorMessage: cancelled ? null : (error instanceof Error ? error.message : String(error)),
    startedAt: job.startedAt || job.queuedAt, finishedAt: new Date().toISOString()
  }};
}
function settleActiveGeneration(job, result, continueQueue = true) {
  if (!job || activeGeneration !== job) return;
  activeGeneration = null;
  runtimeState.isGenerating = false;
  const diagnostics = result?.diagnostics || {};
  if (diagnostics.status === "error") {
    runtimeState.lastErrorCode = diagnostics.errorCode || "worker_operation_failed";
    runtimeState.lastError = diagnostics.errorMessage || "The inference worker could not complete the response.";
  } else if (diagnostics.status === "completed" || diagnostics.status === "cancelled") {
    runtimeState.lastErrorCode = null; runtimeState.lastError = null;
  }
  if (typeof result?.text === "string") job.text = result.text;
  const event = diagnostics.status === "error" ? "failed" : diagnostics.status === "cancelled" ? "cancelled" : "finished";
  sendGenerationEvent({ ...generationSummary(job), event, text: job.text, diagnostics });
  job.resolve(result);
  if (continueQueue) startNextGeneration();
}
function startNextGeneration() {
  if (activeGeneration || forceStoppingGeneration || generationQueue.length === 0) return;
  if (!inferenceWorker || !runtimeState.isLoaded) {
    const failure = new Error("The inference worker is unavailable; queued generations could not start.");
    for (const job of generationQueue.splice(0)) {
      sendGenerationEvent({ ...generationSummary(job), event: "failed", text: job.text });
      job.resolve(generationFailureResult(job, failure));
    }
    return;
  }
  const job = generationQueue.shift();
  job.startedAt = new Date().toISOString();
  activeGeneration = job; runtimeState.isGenerating = true;
  sendGenerationEvent({ ...generationSummary(job), event: "started", text: job.text });
  try { inferenceWorker.postMessage({ type: "GENERATE", data: { prompt: job.prompt, generationId: job.generationId } }); }
  catch (error) { settleActiveGeneration(job, generationFailureResult(job, error)); }
}
function enqueueGeneration({ prompt, generationId, chatId = null, userMessageId = null, purpose = "chat" }) {
  if (activeGeneration?.generationId === generationId || generationQueue.some(job => job.generationId === generationId)) throw new Error("A generation with this ID is already active or queued.");
  if (generationQueue.length >= 64) throw new Error("The local generation queue is full. Wait for a response to finish before adding more messages.");
  return new Promise((resolve, reject) => {
    const job = {
      prompt, generationId, chatId: typeof chatId === "string" ? chatId : null,
      userMessageId: typeof userMessageId === "string" ? userMessageId : null,
      purpose: purpose === "memory" ? "memory" : "chat", queuedAt: new Date().toISOString(),
      startedAt: null, text: "", resolve, reject
    };
    generationQueue.push(job);
    if (activeGeneration) sendGenerationEvent({ ...generationSummary(job), event: "queued", text: "" });
    startNextGeneration();
  });
}
function failAllGenerations(error) {
  const message = error instanceof Error ? error.message : String(error);
  const active = activeGeneration; activeGeneration = null; runtimeState.isGenerating = false;
  if (active) {
    sendGenerationEvent({ ...generationSummary(active), event: "failed", text: active.text });
    active.reject(new Error(message));
  }
  for (const job of generationQueue.splice(0)) {
    sendGenerationEvent({ ...generationSummary(job), event: "failed", text: job.text });
    job.reject(new Error(message));
  }
}
function resetRuntimeAfterWorkerExit() {
  runtimeState.isLoading = false; runtimeState.isLoaded = false; runtimeState.isGenerating = false;
  runtimeState.loadingModelId = null; runtimeState.loadedModelId = null; runtimeState.loadedModelName = null;
  runtimeState.loadedAt = null; runtimeState.estimatedMemoryBytes = null; runtimeState.contextLength = null; runtimeState.batchSize = null;
  runtimeState.workerWorkingSetBytes = null; runtimeState.workerPrivateBytes = null;
  runtimeState.memoryLimitBytes = null; runtimeState.hardLimitSupported = false;
}

function handleInferenceMessage(worker, event) {
  if (worker !== inferenceWorker) return;
  const message = event?.data ?? event;
  if (!message || typeof message.type !== "string") return;
  switch (message.type) {
    case "MODEL_LOADED":
      runtimeState.isLoading = false;
      runtimeState.isLoaded = true;
      runtimeState.loadedModelId = message.model.modelId;
      runtimeState.loadedModelName = message.model.modelName;
      runtimeState.loadedAt = message.model.loadedAt;
      runtimeState.contextLength = message.model.contextLength;
      runtimeState.batchSize = message.model.batchSize;
      runtimeState.lastError = null;
      runtimeState.lastErrorCode = null;
      if (pendingLoad) { pendingLoad.resolve(runtimeStatus()); pendingLoad = null; }
      break;
    case "LOAD_ERROR":
      runtimeState.isLoading = false;
      runtimeState.lastErrorCode = "model_load_failed";
      runtimeState.lastError = String(message.error || "The inference worker could not load the selected model.");
      if (pendingLoad) { pendingLoad.reject(new Error(runtimeState.lastError)); pendingLoad = null; }
      break;
    case "GENERATION_EVENT": {
      if (message.event) {
        const event = message.event, job = activeGeneration;
        if (job && event.generationId === job.generationId) {
          if (event.event === "token" && typeof event.token === "string") job.text = (job.text + event.token).slice(-512 * 1024);
          sendGenerationEvent({ ...event, ...generationSummary(job), text: job.text });
        } else sendGenerationEvent(event);
      }
      break;
    }
    case "GENERATION_RESULT":
      if (activeGeneration && activeGeneration.generationId === message.generationId) {
        settleActiveGeneration(activeGeneration, message.result || generationFailureResult(activeGeneration, "The worker returned an empty generation result."));
      }
      break;
    case "RUNTIME_ERROR": {
      const workerError = String(message.error || "The inference worker reported an error.");
      if (pendingLoad) { pendingLoad.reject(new Error(workerError)); pendingLoad = null; }
      const job = activeGeneration && (!message.generationId || activeGeneration.generationId === message.generationId) ? activeGeneration : null;
      if (job) settleActiveGeneration(job, generationFailureResult(job, workerError));
      else { runtimeState.lastErrorCode = "worker_operation_failed"; runtimeState.lastError = workerError; }
      break;
    }
    case "STOPPED":
      break;
  }
}

function attachWindowsJob(workerPid, memoryLimitBytes) {
  if (process.platform !== "win32") return Promise.resolve(false);
  const scriptPath = !isDevelopment
    ? path.join(process.resourcesPath, "electron", "inference-memory-job.ps1")
    : path.join(__dirname, "inference-memory-job.ps1");
  if (!fs.existsSync(scriptPath)) return Promise.reject(new Error("The Windows inference memory-guard script is missing."));
  const helper = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath, "-WorkerPid", String(workerPid), "-LimitBytes", String(memoryLimitBytes ?? 0)
  ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  memoryJobProcess = helper;

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { helper.kill(); } catch {}
        reject(new Error("Timed out while assigning the inference worker to its Windows Job Object."));
      }
    }, 15000);

    helper.stdout.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "READY" && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(true);
        } else if (line.startsWith("METRICS\t")) {
          const parts = line.split("\t");
          const workingSet = Number(parts[1]);
          const privateBytes = Number(parts[2]);
          if (Number.isFinite(workingSet)) runtimeState.workerWorkingSetBytes = workingSet;
          if (Number.isFinite(privateBytes)) runtimeState.workerPrivateBytes = privateBytes;
        } else if (line.startsWith("ERROR: ") && !settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(line.slice(7)));
        }
      }
    });
    helper.stderr.on("data", chunk => {
      const detail = chunk.toString("utf8").trim();
      if (detail) console.error("[inference-memory-job]", detail);
    });
    helper.once("error", error => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Could not start the Windows inference memory guard: " + error.message));
      }
    });
    helper.once("exit", code => {
      if (memoryJobProcess === helper) memoryJobProcess = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Windows inference memory guard exited before attaching (code " + code + ")."));
      }
    });
  });
}

function savedMemoryLimitBytes() {
  const raw = database.get_setting({ key: "ram_limiter" });
  let config = { enabled: false, limitGb: 1 };
  if (raw != null) {
    try { config = JSON.parse(raw); }
    catch { throw new Error("Saved RAM limiter settings are invalid JSON. Open Settings and save them again."); }
  }
  if (typeof config.enabled !== "boolean" || !Number.isFinite(config.limitGb) || config.limitGb < 1 || config.limitGb > 1024) {
    throw new Error("Saved RAM limiter settings are outside the supported range.");
  }
  if (!config.enabled) return null;
  if (process.platform !== "win32") {
    throw new Error("A hard worker memory ceiling is currently supported only on Windows.");
  }
  return Math.floor(config.limitGb * 1024 ** 3);
}

async function startInferenceWorker(memoryLimitBytes) {
  const workerPath = path.join(__dirname, "inference-worker.mjs");
  const worker = utilityProcess.fork(workerPath, [], { stdio: ["ignore", "pipe", "pipe", "pipe"] });
  inferenceWorker = worker;
  worker.on("message", event => handleInferenceMessage(worker, event));
  worker.stderr?.on("data", chunk => {
    const detail = chunk.toString("utf8").trim();
    if (detail) console.error("[inference-worker]", detail);
  });
  worker.once("exit", code => {
    if (worker !== inferenceWorker) return;
    inferenceWorker = null;
    const unexpected = !expectedWorkerExit && !isQuitting;
    if (unexpected) {
      const message = runtimeState.memoryLimitBytes
        ? "The isolated inference worker exited while a hard memory ceiling was configured. The Sync AI interface remains available."
        : "The isolated inference worker exited unexpectedly. The Sync AI interface remains available.";
      runtimeState.lastErrorCode = "worker_exited";
      runtimeState.lastError = message + " Exit code: " + code + ".";
      if (pendingLoad) { pendingLoad.reject(new Error(runtimeState.lastError)); pendingLoad = null; }
    }
    if (!expectedWorkerExit && (activeGeneration || generationQueue.length)) failAllGenerations(new Error(runtimeState.lastError || "The inference worker exited before generation completed."));
    resetRuntimeAfterWorkerExit();
  });

  if (process.platform === "win32") {
    // Electron UtilityProcess.pid is populated only after the child emits "spawn".
    // Waiting here prevents PowerShell from receiving the literal string "undefined".
    const workerPid = await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        worker.removeListener("spawn", onSpawn);
        worker.removeListener("error", onError);
        worker.removeListener("exit", onExitBeforeSpawn);
      };
      const finish = (error, pid) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(pid);
      };
      const onSpawn = () => {
        const pid = worker.pid;
        if (!Number.isInteger(pid) || pid <= 0) {
          finish(new Error("The inference worker spawned without a valid process ID."));
          return;
        }
        finish(null, pid);
      };
      const onError = error => finish(new Error("Could not start the inference worker: " + error.message));
      const onExitBeforeSpawn = code => finish(new Error("The inference worker exited before spawning (code " + code + ")."));
      worker.once("spawn", onSpawn);
      worker.once("error", onError);
      worker.once("exit", onExitBeforeSpawn);
      // Cover the unlikely case that spawn completed just before listeners were attached.
      if (Number.isInteger(worker.pid) && worker.pid > 0) onSpawn();
    });
    const guarded = await attachWindowsJob(workerPid, memoryLimitBytes);
    runtimeState.hardLimitSupported = guarded;
  }
  return worker;
}

async function stopInferenceWorker() {
  const worker = inferenceWorker;
  if (!worker) { failAllGenerations(new Error("The inference worker was stopped.")); return; }
  failAllGenerations(new Error("The inference worker is shutting down."));
  expectedWorkerExit = true;
  const exited = new Promise(resolve => worker.once("exit", resolve));
  try { worker.postMessage({ type: "SHUTDOWN" }); } catch {}
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (inferenceWorker === worker) {
    try { worker.kill(); } catch {}
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]);
  }
  if (memoryJobProcess && !memoryJobProcess.killed) {
    try { memoryJobProcess.stdin.write("STOP\n"); } catch {}
  }
  inferenceWorker = null;
  expectedWorkerExit = false;
  runtimeState = {
    isLoading: false, isLoaded: false, isGenerating: false,
    loadingModelId: null, loadedModelId: null, loadedModelName: null, loadedAt: null,
    estimatedMemoryBytes: null, contextLength: null, batchSize: null,
    memoryLimitBytes: null, workerWorkingSetBytes: null, workerPrivateBytes: null,
    hardLimitSupported: false, lastErrorCode: null, lastError: null
  };
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) { size += chunk.length; hash.update(chunk); }
  return { sha256: hash.digest("hex"), sizeBytes: size };
}

async function inspectPickedFile(filePath, maxBytes = 512 * 1024 * 1024) {
  const resolved = await fsp.realpath(filePath);
  const stat = await fsp.stat(resolved);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Selected item is empty or is not a regular file.");
  if (stat.size > maxBytes) throw new Error("Selected file exceeds the 512 MiB File Library limit.");
  const { sha256, sizeBytes } = await hashFile(resolved);
  const fileName = path.basename(resolved);
  return { filePath: resolved, fileName, extension: path.extname(fileName).slice(1).toLowerCase() || null, sizeBytes, sha256 };
}

async function importGguf() {
  const picked = await dialog.showOpenDialog(mainWindow, { title: "Register a GGUF model", properties: ["openFile"], filters: [{ name: "GGUF model", extensions: ["gguf"] }] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = await fsp.realpath(picked.filePaths[0]);
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size < 24) throw new Error("Selected file is too small to contain a GGUF header.");
  const metadata = readGgufMetadata(filePath);
  const info = await hashFile(filePath);
  const fileName = path.basename(filePath);
  const name = metadata.modelName || path.basename(fileName, path.extname(fileName)).replace(/[._-]+/g, " ").trim() || "GGUF model";
  return database.register_model({
    filePath, fileName, sizeBytes: info.sizeBytes, sha256: info.sha256, name,
    architecture: metadata.architecture, quantization: metadata.quantization
  });
}

async function importLibraryFile() {
  const picked = await dialog.showOpenDialog(mainWindow, { title: "Add a file to Sync AI File Library", properties: ["openFile"] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const info = await inspectPickedFile(picked.filePaths[0]);
  return database.register_library_file(info);
}

function extractImportedMemory(raw, extension) {
  const source = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("The selected memory file is empty.");
  if (!["json", "jsonl"].includes(extension)) return source.slice(0, 1024 * 1024);

  let parsed;
  try {
    parsed = extension === "jsonl"
      ? source.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
      : JSON.parse(source);
  } catch {
    if (extension === "jsonl") throw new Error("The selected JSONL file contains an invalid JSON line.");
    return source.slice(0, 1024 * 1024);
  }

  const preferred = /^(memories?|memory_summary|user_memory|user_profile|profile|facts?|preferences?|instructions?|summary|content|text|description|bio|about|user_context)$/i;
  const extracted = [];
  const seen = new Set();
  const visit = (value, key = "", inherited = false, depth = 0) => {
    if (depth > 24 || extracted.join("\n").length >= 1024 * 1024) return;
    const selected = inherited || preferred.test(key);
    if (typeof value === "string") {
      const clean = value.trim();
      if (selected && clean && !seen.has(clean)) { seen.add(clean); extracted.push(clean); }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, selected, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        if (selected || preferred.test(childKey)) visit(child, childKey, selected, depth + 1);
      }
    }
  };
  visit(parsed);
  const result = extracted.length ? extracted.join("\n\n") : JSON.stringify(parsed, null, 2);
  if (!result.trim()) throw new Error("No readable memory content was found in this file.");
  return result.slice(0, 1024 * 1024);
}

async function importMemoryFile() {
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "Import memory for Sync AI",
    properties: ["openFile"],
    filters: [{ name: "Memory files", extensions: ["txt", "md", "markdown", "json", "jsonl"] }]
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const filePath = await fsp.realpath(picked.filePaths[0]);
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("The selected memory file is empty or invalid.");
  if (stat.size > 2 * 1024 * 1024) throw new Error("Memory import files must be 2 MiB or smaller.");
  const raw = await fsp.readFile(filePath, "utf8");
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const content = extractImportedMemory(raw, extension);
  const title = path.basename(filePath, path.extname(filePath)).replace(/[._-]+/g, " ").trim().slice(0, 160) || "Imported memory";
  return database.save_memory({
    memory: { title, content, source: "Imported from " + path.basename(filePath), enabled: true }
  });
}

async function relinkLibraryFile({ fileId }) {
  const picked = await dialog.showOpenDialog(mainWindow, { title: "Relink File Library entry", properties: ["openFile"] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const info = await inspectPickedFile(picked.filePaths[0]);
  return database.relink_library_file({ fileId, ...info });
}

async function forceStopGeneration() {
  if (forceStoppingGeneration) throw new Error("A force-stop recovery is already in progress.");
  const modelId = runtimeState.loadedModelId;
  if (!modelId || !inferenceWorker) throw new Error("No loaded inference worker is available to restart.");
  const model = database.list_models().find(item => item.id === modelId && item.isAvailable);
  if (!model) throw new Error("The loaded model file is no longer available. Re-register it before recovering the worker.");
  const memoryLimitBytes = savedMemoryLimitBytes(), inference = getInferenceOptions();
  forceStoppingGeneration = true;
  const active = activeGeneration;
  if (active) settleActiveGeneration(active, generationFailureResult(active, null, "cancelled"), false);
  runtimeState.isGenerating = false;

  const oldWorker = inferenceWorker, exited = new Promise(resolve => oldWorker.once("exit", resolve));
  expectedWorkerExit = true;
  try { oldWorker.kill(); } catch {}
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (inferenceWorker === oldWorker) inferenceWorker = null;
  if (memoryJobProcess && !memoryJobProcess.killed) {
    try { memoryJobProcess.stdin.write("STOP\n"); } catch {}
    try { memoryJobProcess.kill(); } catch {}
    memoryJobProcess = null;
  }
  expectedWorkerExit = false;
  resetRuntimeAfterWorkerExit();

  try {
    runtimeState.isLoading = true; runtimeState.loadingModelId = modelId; runtimeState.memoryLimitBytes = memoryLimitBytes;
    const worker = await startInferenceWorker(memoryLimitBytes);
    runtimeState.estimatedMemoryBytes = estimatePeakBytes(readGgufMetadata(model.filePath), model.sizeBytes);
    const loadedPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (pendingLoad) { pendingLoad = null; reject(new Error("The inference worker did not reload the model within 180 seconds.")); }
      }, 180000);
      pendingLoad = { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } };
    });
    worker.postMessage({ type: "LOAD_MODEL", data: { modelId, modelName: model.name, modelPath: model.filePath, memoryLimitBytes, ...inference } });
    await loadedPromise;
    runtimeState.loadingModelId = null; runtimeState.lastErrorCode = null; runtimeState.lastError = null;
    forceStoppingGeneration = false;
    startNextGeneration();
    return runtimeStatus();
  } catch (error) {
    runtimeState.isLoading = false; runtimeState.isLoaded = false; runtimeState.loadingModelId = null;
    runtimeState.lastErrorCode = "force_stop_recovery_failed";
    runtimeState.lastError = error instanceof Error ? error.message : String(error);
    failAllGenerations(new Error(runtimeState.lastError));
    forceStoppingGeneration = false;
    throw error;
  }
}

const handlers = {
  get_app_info: () => ({ appName: "Sync AI Desktop", version: app.getVersion(), operatingSystem: process.platform, architecture: process.arch }),
  consume_startup_splash: () => { const show = splashAvailable; splashAvailable = false; return show; },
  get_host_ram_info: () => ({ totalBytes: os.totalmem(), availableBytes: os.freemem() }),
  list_chats: args => database.list_chats(args),
  create_chat: args => database.create_chat(args),
  get_chat: args => database.get_chat(args),
  rename_chat: args => database.rename_chat(args),
  delete_chat: args => database.delete_chat(args),
  append_message: args => database.append_message(args),
  append_assistant_message_after: args => database.append_assistant_message_after(args),
  update_message_diagnostics: args => database.update_message_diagnostics(args),
  export_chat_backup: () => database.export_chat_backup(),
  export_chat: args => database.export_chat(args),
  list_chat_folders: () => database.list_chat_folders(),
  create_chat_folder: args => database.create_chat_folder(args),
  rename_chat_folder: args => database.rename_chat_folder(args),
  delete_chat_folder: args => database.delete_chat_folder(args),
  update_chat_metadata: args => database.update_chat_metadata(args),
  move_chat_to_top: args => database.move_chat_to_top(args),
  edit_user_message: args => database.edit_user_message(args),
  import_chat_backup: args => database.import_chat_backup(args),
  get_setting: args => database.get_setting(args),
  set_setting: args => database.set_setting(args),
  list_memories: () => database.list_memories(),
  list_memory_context: () => {
    const raw = database.get_setting({ key: "memory_context_tokens" });
    let tokenBudget = 256;
    try { if (raw != null) tokenBudget = Number(JSON.parse(raw)); } catch {}
    if (!Number.isFinite(tokenBudget)) tokenBudget = 256;
    tokenBudget = Math.min(512, Math.max(128, Math.round(tokenBudget)));
    return database.list_memory_context({ maxCharacters: tokenBudget * 4 });
  },
  save_memory: args => database.save_memory(args),
  set_memory_enabled: args => database.set_memory_enabled(args),
  delete_memory: args => database.delete_memory(args),
  import_memory_file: () => importMemoryFile(),
  list_models: () => database.list_models(),
  import_gguf: () => importGguf(),
  set_default_model: ({ modelId }) => {
    const model = database.list_models().find(item => item.id === modelId);
    if (!model) throw new Error("Model was not found in the local registry.");
    if (!model.isAvailable) throw new Error("The original GGUF file is missing. Re-register it from its current location.");
    readGgufMetadata(model.filePath);
    return database.set_default_model({ modelId });
  },
  remove_model: ({ modelId }) => {
    if (runtimeState.loadedModelId === modelId || runtimeState.loadingModelId === modelId) {
      throw new Error("Unload this model before removing it from the local registry.");
    }
    return database.remove_model({ modelId });
  },
  get_runtime_status: () => runtimeStatus(),
  estimate_model_resources: ({ modelId }) => {
    const model = database.list_models().find(item => item.id === modelId);
    if (!model) throw new Error("Model was not found in the local registry.");
    if (!model.isAvailable) throw new Error("The original GGUF file is missing. Re-register it from its current location.");
    const metadata = readGgufMetadata(model.filePath);
    const saved = database.get_setting({ key: "ram_limiter" });
    let config = { enabled: false, limitGb: 1 };
    if (saved != null) {
      try { config = JSON.parse(saved); } catch { throw new Error("Saved RAM limiter settings are invalid JSON. Open Settings and save them again."); }
      if (typeof config.enabled !== "boolean" || !Number.isFinite(config.limitGb) || config.limitGb < 1 || config.limitGb > 1024) throw new Error("Saved RAM limiter settings are outside the supported range.");
    }
    const modelSizeBytes = model.sizeBytes;
    const estimatedPeakBytes = estimatePeakBytes(metadata, modelSizeBytes);
    const inference = getInferenceOptions();
    return {
      modelSizeBytes, estimatedPeakBytes, availableRamBytes: os.freemem(),
      configuredLimitBytes: config.enabled ? Math.floor(config.limitGb * 1024 ** 3) : null,
      contextLength: inference.contextLength, batchSize: inference.batchSize,
      estimateKind: "GGUF metadata-based informational estimate. The Windows Job Object enforces the configured worker private-memory ceiling."
    };
  },
  load_model: async ({ modelId }) => {
    if (runtimeState.isLoaded || runtimeState.isLoading || inferenceWorker) {
      throw new Error("Unload the current inference worker before loading another model.");
    }
    const model = database.list_models().find(item => item.id === modelId);
    if (!model) throw new Error("Model was not found in the local registry.");
    if (!model.isAvailable) throw new Error("The original GGUF file is missing. Re-register it from its current location.");
    const metadata = readGgufMetadata(model.filePath);
    const memoryLimitBytes = savedMemoryLimitBytes();
    const inference = getInferenceOptions();
    runtimeState.isLoading = true;
    runtimeState.loadingModelId = modelId;
    runtimeState.memoryLimitBytes = memoryLimitBytes;
    runtimeState.lastError = null;
    runtimeState.lastErrorCode = null;
    try {
      const worker = await startInferenceWorker(memoryLimitBytes);
      runtimeState.estimatedMemoryBytes = estimatePeakBytes(metadata, model.sizeBytes);
      const loadedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (pendingLoad) {
            pendingLoad = null;
            reject(new Error("The inference worker did not finish loading the model within 180 seconds."));
          }
        }, 180000);
        pendingLoad = {
          resolve: value => { clearTimeout(timeout); resolve(value); },
          reject: error => { clearTimeout(timeout); reject(error); }
        };
      });
      worker.postMessage({
        type: "LOAD_MODEL",
        data: {
          modelId, modelName: model.name, modelPath: model.filePath,
          memoryLimitBytes, contextLength: inference.contextLength, batchSize: inference.batchSize
        }
      });
      await loadedPromise;
      runtimeState.loadingModelId = null;
      return runtimeStatus();
    } catch (error) {
      runtimeState.isLoading = false;
      runtimeState.loadingModelId = null;
      runtimeState.lastErrorCode = "model_load_failed";
      runtimeState.lastError = error instanceof Error ? error.message : String(error);
      await stopInferenceWorker();
      runtimeState.lastErrorCode = "model_load_failed";
      runtimeState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  },
  unload_model: async () => {
    if (runtimeState.isGenerating) throw new Error("Stop the active response before unloading the model.");
    await stopInferenceWorker();
    return runtimeStatus();
  },
  generate_chat: ({ prompt, generationId, chatId = null, userMessageId = null, purpose = "chat" }) => {
    if (!inferenceWorker || !runtimeState.isLoaded) throw new Error("No local GGUF model is loaded. Load a model from Local models first.");
    if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 512 * 1024) throw new Error("The conversation prompt is empty or exceeds the 512 KiB limit.");
    if (typeof generationId !== "string" || !generationId.trim() || generationId.length > 128) throw new Error("Generation ID is invalid.");
    return enqueueGeneration({ prompt, generationId, chatId, userMessageId, purpose });
  },
  cancel_generation: ({ generationId }) => {
    const index = generationQueue.findIndex(job => job.generationId === generationId);
    if (index >= 0) {
      const [job] = generationQueue.splice(index, 1);
      const result = generationFailureResult(job, null, "cancelled");
      sendGenerationEvent({ ...generationSummary(job), event: "cancelled", text: job.text });
      job.resolve(result);
      return { cancelRequested: true, queued: true };
    }
    if (!inferenceWorker || !runtimeState.isGenerating || activeGeneration?.generationId !== generationId) throw new Error("That generation is no longer active.");
    inferenceWorker.postMessage({ type: "CANCEL_GENERATION", generationId });
    return { cancelRequested: true, queued: false };
  },
  force_stop_generation: () => forceStopGeneration(),
  list_workspace_artifacts: args => database.list_workspace_artifacts(args),
  get_workspace_artifact: args => database.get_workspace_artifact(args),
  create_workspace_artifact: args => database.save_workspace_artifact(args),
  update_workspace_artifact: args => database.save_workspace_artifact({ ...args, artifactId: args.artifactId }),
  delete_workspace_artifact: args => database.delete_workspace_artifact(args),
  list_workspace_context: () => database.list_workspace_context(),
  list_tasks: args => database.list_tasks(args),
  create_task: args => database.save_task(args),
  update_task: args => database.save_task({ ...args, taskId: args.taskId }),
  delete_task: args => database.delete_task(args),
  list_notes: args => database.list_notes(args),
  get_note: args => database.get_note(args),
  create_note: args => database.save_note(args),
  update_note: args => database.save_note({ ...args, noteId: args.noteId }),
  delete_note: args => database.delete_note(args),
  list_library_files: () => database.list_library_files(),
  import_library_file: () => importLibraryFile(),
  relink_library_file: args => relinkLibraryFile(args),
  remove_library_file: args => database.remove_library_file(args),
  get_action_status: () => actionManager.getStatus(),
  list_tool_actions: ({ limit = 100 } = {}) => actionManager.listHistory(limit),
  prepare_file_operation: async ({ operation, folderName = "" } = {}) => {
    if (!["copy", "move", "rename", "delete", "create-folder"].includes(operation)) {
      throw new Error("Unsupported file operation.");
    }
    if (operation === "create-folder") {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: "Choose where to create the folder",
        properties: ["openDirectory"]
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      return actionManager.prepareFileOperation({ operation, parentPath: picked.filePaths[0], folderName });
    }

    const pickedSource = await dialog.showOpenDialog(mainWindow, {
      title: operation === "delete" ? "Choose a file to remove safely" : "Choose a source file",
      properties: ["openFile"]
    });
    if (pickedSource.canceled || !pickedSource.filePaths[0]) return null;
    const sourcePath = pickedSource.filePaths[0];
    if (operation === "delete") return actionManager.prepareFileRemoval(sourcePath);

    let destinationPath;
    if (operation === "move") {
      const pickedFolder = await dialog.showOpenDialog(mainWindow, {
        title: "Choose the destination folder",
        properties: ["openDirectory"]
      });
      if (pickedFolder.canceled || !pickedFolder.filePaths[0]) return null;
      destinationPath = path.join(pickedFolder.filePaths[0], path.basename(sourcePath));
    } else {
      const defaultName = operation === "copy"
        ? "Copy of " + path.basename(sourcePath)
        : path.parse(sourcePath).name + " renamed" + path.extname(sourcePath);
      const destination = await dialog.showSaveDialog(mainWindow, {
        title: operation === "copy" ? "Choose where to save the copy" : "Choose the new file name",
        defaultPath: path.join(path.dirname(sourcePath), defaultName),
        buttonLabel: operation === "copy" ? "Choose copy destination" : "Rename file"
      });
      if (destination.canceled || !destination.filePath) return null;
      destinationPath = destination.filePath;
    }
    return actionManager.prepareFileOperation({ operation, sourcePath, destinationPath });
  },
  approve_file_action: ({ actionId }) => actionManager.approveFileOperation(actionId),
  cancel_file_action: ({ actionId }) => actionManager.cancelFileRemoval(actionId),
  stop_active_action: () => actionManager.stopActiveAction(),
  undo_tool_action: ({ actionId }) => actionManager.undoAction(actionId)
};

function registerIpc() {
  ipcMain.on("sync:renderer-ready", event => {
    const senderUrl = event.senderFrame?.url || "";
    const trustedFileUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
    if (senderUrl !== trustedFileUrl) return;
    logStartup("Renderer signalled readiness after loading its native modules.");
    console.log("[Sync AI] Renderer ready.");
    if (process.env.SYNC_AI_STARTUP_SMOKE === "1") setTimeout(() => app.quit(), 250);
  });
  ipcMain.handle("sync:invoke", async (event, command, args = {}) => {
    const senderUrl = event.senderFrame?.url || "";
    const trustedFileUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
    const allowed = senderUrl === trustedFileUrl;
    if (!allowed) throw new Error("Rejected IPC request from an untrusted renderer.");
    if (typeof command !== "string" || !Object.prototype.hasOwnProperty.call(handlers, command)) {
      throw new Error("Unsupported desktop command.");
    }
    if (args == null || typeof args !== "object" || Array.isArray(args)) throw new Error("Command arguments must be an object.");
    return handlers[command](args);
  });
}

async function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { await createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createTray() {
  if (tray) return;
  let icon = nativeImage.createFromPath(trayIconPath);
  if (icon.isEmpty()) {
    logStartup("Tray PNG could not be loaded; trying the multi-size Windows icon.");
    icon = nativeImage.createFromPath(appIconPath);
  }
  if (icon.isEmpty()) {
    logStartup("Sync artwork could not be loaded for the tray; falling back to the executable icon.");
    try { icon = await app.getFileIcon(process.execPath, { size: "small" }); } catch {}
  }
  if (icon.isEmpty()) logStartup("WARNING: Electron returned an empty tray icon.");
  else logStartup("Loaded Sync tray artwork from " + (icon.isEmpty() ? "fallback" : trayIconPath));
  tray = new Tray(icon);
  tray.setToolTip("Sync AI Desktop");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Sync AI", click: () => void restoreMainWindow() },
    { label: "Hide Sync AI", click: () => mainWindow?.hide() },
    { type: "separator" },
    { label: "Exit Sync AI", click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on("click", () => void restoreMainWindow());
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  let windowIcon = nativeImage.createFromPath(appIconPath);
  if (windowIcon.isEmpty()) {
    logStartup("Sync ICO could not be loaded at " + appIconPath + "; trying the executable icon.");
    try { windowIcon = await app.getFileIcon(process.execPath, { size: "large" }); } catch {}
  } else {
    const dimensions = windowIcon.getSize();
    logStartup("Loaded Sync taskbar/window icon from " + appIconPath + " (" + dimensions.width + "x" + dimensions.height + ").");
  }
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 680,
    backgroundColor: "#090a12", show: false,
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const appHtmlPath = path.join(__dirname, "..", "index.html");
  const trustedFileUrl = pathToFileURL(appHtmlPath).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const trusted = targetUrl === trustedFileUrl;
    if (!trusted) event.preventDefault();
  });
  mainWindow.on("close", event => {
    if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame) logStartup(`Renderer failed to load (code=${code}, description=${description}, url=${failedUrl}).`);
  });
  await mainWindow.loadFile(appHtmlPath);
  logStartup(`Renderer document loaded from ${appHtmlPath}.`);
  return mainWindow;
}

// Single-instance locking is intentionally disabled during active development and testing.

app.on("will-quit", () => logStartup("Electron emitted will-quit."));
app.on("quit", (_event, exitCode) => logStartup(`Electron emitted quit (code=${exitCode}).`));
logStartup("Single-instance locking is disabled. Registering app.whenReady handler.");
app.whenReady().then(async () => {
    // Sync AI uses its own in-app navigation; hide Electron's default application menu.
    Menu.setApplicationMenu(null);
    logStartup(`Electron ready (development=${isDevelopment}, packaged=${app.isPackaged}, platform=${process.platform}, arch=${process.arch}).`);
    try {
      const dataDir = app.getPath("userData");
      logStartup(`Using user data directory: ${dataDir}`);
      await fsp.mkdir(dataDir, { recursive: true });
      const resolvedDataDir = await fsp.realpath(dataDir);
      const databasePath = path.join(resolvedDataDir, "sync-ai-desktop.sqlite3");
      database = new SyncDatabase(databasePath);
      logStartup("SQLite database initialized.");
      actionManager = new FileOperationManager({
        database,
        recoveryDir: path.join(resolvedDataDir, "recovery-vault"),
        protectedPaths: [resolvedDataDir],
        onChange: sendActionEvent
      });
      const recoveredActions = await actionManager.recoverInterrupted();
      if (recoveredActions.length) logStartup("Recovered " + recoveredActions.length + " interrupted tool action(s) before opening the window.");
      registerIpc();
      await createWindow();
      logStartup("Main window creation completed.");
      await createTray();
      logStartup("System tray initialized.");
      app.on("activate", () => { void restoreMainWindow(); });
    } catch (error) {
      const detail = error instanceof Error ? error.stack || error.message : String(error);
      logStartup(`Startup failed: ${detail}`);
      dialog.showErrorBox("Sync AI Desktop could not start", error instanceof Error ? error.message : String(error));
      app.quit();
    }
}).catch(error => {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    logStartup(`Electron ready handler rejected: ${detail}`);
    dialog.showErrorBox("Sync AI Desktop could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  });

app.on("before-quit", event => {
  isQuitting = true;
  if (waitingForActionShutdown) {
    event.preventDefault();
    return;
  }
  if (actionManager?.getStatus().isRunning) {
    event.preventDefault();
    waitingForActionShutdown = true;
    logStartup("Stopping and rolling back the active tool action before exit.");
    void actionManager.stopActiveAction().catch(error => {
      logStartup("Action shutdown recovery reported: " + (error instanceof Error ? error.message : String(error)));
    }).finally(() => {
      waitingForActionShutdown = false;
      app.quit();
    });
    return;
  }
  logStartup("Application is quitting.");
  try { inferenceWorker?.kill(); } catch {}
  try { memoryJobProcess?.stdin.write("STOP\n"); } catch {}
  try { database?.close(); } catch {}
});
app.on("window-all-closed", () => {
  // Keep the process alive while the tray icon is available.
});
