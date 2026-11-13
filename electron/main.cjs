const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { SyncDatabase } = require("./database.cjs");
const { readGgufMetadata, estimatePeakBytes } = require("./gguf.cjs");

let splashAvailable = true;
let mainWindow = null;
let tray = null;
let database = null;
let isQuitting = false;
let inferenceWorker = null;
let memoryJobProcess = null;
let pendingLoad = null;
let pendingGeneration = null;
let expectedWorkerExit = false;
let runtimeState = {
  isLoading: false, isLoaded: false, isGenerating: false,
  loadingModelId: null, loadedModelId: null, loadedModelName: null, loadedAt: null,
  estimatedMemoryBytes: null, contextLength: null, batchSize: null,
  memoryLimitBytes: null, workerWorkingSetBytes: null, workerPrivateBytes: null,
  hardLimitSupported: false, lastErrorCode: null, lastError: null
};

const runtimeStatus = () => ({
  ...runtimeState,
  workerPid: inferenceWorker?.pid ?? null,
  backend: runtimeState.isLoaded ? "llama.cpp · CPU · isolated utility process" : "llama.cpp · CPU · worker idle"
});

function sendGenerationEvent(event) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("sync:generation-event", event);
  }
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
    case "GENERATION_EVENT":
      if (message.event) sendGenerationEvent(message.event);
      break;
    case "GENERATION_RESULT":
      runtimeState.isGenerating = false;
      if (pendingGeneration && pendingGeneration.generationId === message.generationId) {
        pendingGeneration.resolve(message.result);
        pendingGeneration = null;
      }
      break;
    case "RUNTIME_ERROR":
      runtimeState.lastErrorCode = "worker_operation_failed";
      runtimeState.lastError = String(message.error || "The inference worker reported an error.");
      if (pendingLoad) { pendingLoad.reject(new Error(runtimeState.lastError)); pendingLoad = null; }
      break;
    case "STOPPED":
      break;
  }
}

function attachWindowsJob(workerPid, memoryLimitBytes) {
  if (process.platform !== "win32") return Promise.resolve(false);
  const scriptPath = app.isPackaged
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
  const worker = utilityProcess.fork(workerPath, [], { stdio: "pipe" });
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
      if (pendingGeneration) { pendingGeneration.reject(new Error(runtimeState.lastError)); pendingGeneration = null; }
    }
    runtimeState.isLoading = false;
    runtimeState.isLoaded = false;
    runtimeState.isGenerating = false;
    runtimeState.loadingModelId = null;
    runtimeState.loadedModelId = null;
    runtimeState.loadedModelName = null;
    runtimeState.loadedAt = null;
    runtimeState.estimatedMemoryBytes = null;
    runtimeState.contextLength = null;
    runtimeState.batchSize = null;
    runtimeState.workerWorkingSetBytes = null;
    runtimeState.workerPrivateBytes = null;
    runtimeState.memoryLimitBytes = null;
    runtimeState.hardLimitSupported = false;
  });

  if (process.platform === "win32") {
    const guarded = await attachWindowsJob(worker.pid, memoryLimitBytes);
    runtimeState.hardLimitSupported = guarded;
  }
  return worker;
}

async function stopInferenceWorker() {
  const worker = inferenceWorker;
  if (!worker) return;
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

async function relinkLibraryFile({ fileId }) {
  const picked = await dialog.showOpenDialog(mainWindow, { title: "Relink File Library entry", properties: ["openFile"] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const info = await inspectPickedFile(picked.filePaths[0]);
  return database.relink_library_file({ fileId, ...info });
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
  import_chat_backup: args => database.import_chat_backup(args),
  get_setting: args => database.get_setting(args),
  set_setting: args => database.set_setting(args),
  list_models: () => database.list_models(),
  import_gguf: () => importGguf(),
  set_default_model: ({ modelId }) => {
    const model = database.list_models().find(item => item.id === modelId);
    if (!model) throw new Error("Model was not found in the local registry.");
    if (!model.isAvailable) throw new Error("The original GGUF file is missing. Re-register it from its current location.");
    readGgufMetadata(model.filePath);
    return database.set_default_model({ modelId });
  },
  remove_model: args => database.remove_model(args),
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
    return {
      modelSizeBytes, estimatedPeakBytes, availableRamBytes: os.freemem(),
      configuredLimitBytes: config.enabled ? Math.floor(config.limitGb * 1024 ** 3) : null,
      contextLength: 2048, batchSize: 128,
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
    runtimeState.isLoading = true;
    runtimeState.loadingModelId = modelId;
    runtimeState.memoryLimitBytes = memoryLimitBytes;
    runtimeState.lastError = null;
    runtimeState.lastErrorCode = null;
    try {
      const worker = await startInferenceWorker(memoryLimitBytes);
      runtimeState.estimatedMemoryBytes = estimatePeakBytes(metadata, model.sizeBytes);
      const loadedPromise = new Promise((resolve, reject) => {
        pendingLoad = { resolve, reject };
        setTimeout(() => {
          if (pendingLoad) {
            pendingLoad = null;
            reject(new Error("The inference worker did not finish loading the model within 180 seconds."));
          }
        }, 180000);
      });
      worker.postMessage({
        type: "LOAD_MODEL",
        data: {
          modelId, modelName: model.name, modelPath: model.filePath,
          memoryLimitBytes, contextLength: 2048, batchSize: 128
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
  generate_chat: ({ prompt, generationId }) => {
    if (!inferenceWorker || !runtimeState.isLoaded) throw new Error("No local GGUF model is loaded. Load a model from Local models first.");
    if (runtimeState.isGenerating) throw new Error("A generation is already active. Queue this message in the chat interface.");
    if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 512 * 1024) {
      throw new Error("The conversation prompt is empty or exceeds the 512 KiB limit.");
    }
    if (typeof generationId !== "string" || !generationId.trim() || generationId.length > 128) {
      throw new Error("Generation ID is invalid.");
    }
    runtimeState.isGenerating = true;
    return new Promise((resolve, reject) => {
      pendingGeneration = { generationId, resolve, reject };
      inferenceWorker.postMessage({ type: "GENERATE", data: { prompt, generationId } });
    });
  },
  cancel_generation: ({ generationId }) => {
    if (!inferenceWorker || !runtimeState.isGenerating || pendingGeneration?.generationId !== generationId) {
      throw new Error("That generation is no longer active.");
    }
    inferenceWorker.postMessage({ type: "CANCEL_GENERATION", generationId });
  },
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
  remove_library_file: args => database.remove_library_file(args)
};

function registerIpc() {
  ipcMain.handle("sync:invoke", async (event, command, args = {}) => {
    const senderUrl = event.senderFrame?.url || "";
    const allowed = app.isPackaged ? senderUrl.startsWith("file://") : senderUrl.startsWith("http://127.0.0.1:5173/");
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
  let icon = nativeImage.createEmpty();
  try { icon = await app.getFileIcon(process.execPath, { size: "small" }); } catch {}
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
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 680,
    backgroundColor: "#090a12", show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const trustedFileUrl = pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const trusted = app.isPackaged ? targetUrl === trustedFileUrl : targetUrl.startsWith("http://127.0.0.1:5173/");
    if (!trusted) event.preventDefault();
  });
  mainWindow.on("close", event => {
    if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  if (!app.isPackaged) await mainWindow.loadURL("http://127.0.0.1:5173");
  else await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return mainWindow;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { void restoreMainWindow(); });
  app.whenReady().then(async () => {
    try {
      const dataDir = app.getPath("userData");
      await fsp.mkdir(dataDir, { recursive: true });
      database = new SyncDatabase(path.join(dataDir, "sync-ai-desktop.sqlite3"));
      registerIpc();
      await createTray();
      await createWindow();
      app.on("activate", () => { void restoreMainWindow(); });
    } catch (error) {
      dialog.showErrorBox("Sync AI Desktop could not start", error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });
  app.on("before-quit", () => {
    isQuitting = true;
    try { inferenceWorker?.kill(); } catch {}
    try { memoryJobProcess?.stdin.write("STOP\n"); } catch {}
    try { database?.close(); } catch {}
  });
  app.on("window-all-closed", () => {
    // Keep the process alive while the tray icon is available.
  });
}
