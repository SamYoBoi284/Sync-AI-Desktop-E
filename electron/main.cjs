const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { SyncDatabase } = require("./database.cjs");
const { readGgufMetadata } = require("./gguf.cjs");

let splashAvailable = true;
let mainWindow = null;
let tray = null;
let database = null;
let isQuitting = false;
let generationState = { isGenerating: false, generationId: null, lastError: "Native GGUF inference has not yet been ported to Electron." };

const runtimeStatus = () => ({
  isLoading: false, isLoaded: false, isGenerating: generationState.isGenerating,
  loadingModelId: null, loadedModelId: null, loadedModelName: null, loadedAt: null,
  estimatedMemoryBytes: null, contextLength: null, batchSize: null,
  memoryLimitBytes: null, workerPid: null, workerWorkingSetBytes: null, workerPrivateBytes: null,
  hardLimitSupported: false, lastErrorCode: generationState.lastError ? "inference_not_ported" : null,
  lastError: generationState.lastError, backend: "Not connected · Electron port in progress"
});

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
    readGgufMetadata(model.filePath);
    const saved = database.get_setting({ key: "ram_limiter" });
    let config = { enabled: false, limitGb: 1 };
    if (saved != null) {
      try { config = JSON.parse(saved); } catch { throw new Error("Saved RAM limiter settings are invalid JSON. Open Settings and save them again."); }
      if (typeof config.enabled !== "boolean" || !Number.isFinite(config.limitGb) || config.limitGb < 1 || config.limitGb > 1024) throw new Error("Saved RAM limiter settings are outside the supported range.");
    }
    const modelSizeBytes = model.sizeBytes;
    const estimatedPeakBytes = modelSizeBytes + Math.floor(modelSizeBytes / 10) + 2048 * 64 * 1024 + 128 * 2 * 1024 * 1024 + 128 * 1024 * 1024;
    return { modelSizeBytes, estimatedPeakBytes, availableRamBytes: os.freemem(), configuredLimitBytes: config.enabled ? Math.floor(config.limitGb * 1024 ** 3) : null, contextLength: 2048, batchSize: 128, estimateKind: "Informational GGUF-size/session estimate only. No hard memory ceiling is active in the Electron edition." };
  },
  load_model: () => { throw new Error("GGUF model loading is not available yet. The isolated llama.cpp worker is still being ported."); },
  unload_model: () => runtimeStatus(),
  generate_chat: ({ generationId }) => { generationState = { isGenerating: false, generationId, lastError: "Native GGUF inference is not yet available in the Electron edition." }; throw new Error(generationState.lastError); },
  cancel_generation: () => { generationState.isGenerating = false; },
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
    try { database?.close(); } catch {}
  });
  app.on("window-all-closed", () => {
    // Keep the process alive while the tray icon is available.
  });
}
