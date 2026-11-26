const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "renderer", "api.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

test("every renderer IPC command has exactly one Electron main-process handler", () => {
  const commands = [...new Set([...bridge.matchAll(/invoke\(\s*"([^"]+)"/g)].map(match => match[1]))].sort();
  const handlerSection = main.match(/const handlers = \{([\s\S]*?)\n\};/);
  assert.ok(handlerSection, "Electron command handler allowlist must exist");
  const handlers = [...handlerSection[1].matchAll(/^\s{2}([A-Za-z0-9_]+)\s*:/gm)].map(match => match[1]).sort();
  assert.deepEqual(handlers, commands, "renderer command names and main-process allowlist must match exactly");
});

test("Electron renderer isolation and navigation protections remain enabled", () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.match(main, /pathToFileURL\(path\.join\(__dirname, "\.\.", "index\.html"\)\)/);
  assert.match(main, /await mainWindow\.loadFile\(appHtmlPath\)/);
  assert.doesNotMatch(main, /127\.0\.0\.1:5173|dist\\\/index\.html/);
  assert.match(main, /sync-ai-desktop-startup\.log/);
  assert.match(main, /new Tray/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.match(preload, /rendererReady/);
  assert.doesNotMatch(preload, /require\s*\(\s*["']node:/);
});

test("the native inference runtime and Windows process memory guard are wired in", () => {
  const worker = fs.readFileSync(path.join(__dirname, "inference-worker.mjs"), "utf8");
  const job = fs.readFileSync(path.join(__dirname, "inference-memory-job.ps1"), "utf8");
  assert.match(main, /utilityProcess\.fork\(workerPath/);
  assert.match(main, /attachWindowsJob\(worker\.pid, memoryLimitBytes\)/);
  assert.match(main, /type: "LOAD_MODEL"/);
  assert.match(main, /type: "GENERATE"/);
  assert.match(main, /type: "CANCEL_GENERATION"/);
  assert.match(worker, /from "node-llama-cpp"/);
  assert.match(worker, /new LlamaCompletion/);
  assert.match(worker, /setRamCap\(memoryLimitBytes\)/);
  assert.match(worker, /generateCompletionWithMeta/);
  assert.match(job, /JOB_OBJECT_LIMIT_PROCESS_MEMORY/);
  assert.match(job, /AssignProcessToJobObject/);
  assert.match(job, /GetProcessMemoryInfo/);
  assert.match(job, /PROCESS_SYNCHRONIZE/);
});

test("inference worker releases each chat sequence and reports failed generation IDs", () => {
  const worker = fs.readFileSync(path.join(__dirname, "inference-worker.mjs"), "utf8");
  assert.match(worker, /session\.dispose\(\{\s*disposeSequence:\s*true\s*\}\)/);
  assert.match(worker, /context\.sequencesLeft\s*<=\s*0/);
  assert.match(worker, /message\.data\?\.generationId/);
  assert.match(main, /function settleActiveGeneration\(/);
  assert.match(main, /function enqueueGeneration\(/);
  assert.match(main, /force_stop_generation:/);
  assert.match(main, /queuedGenerations: generationQueue\.map/);
});
test("Runtime exposes context/batch controls and worker force-stop recovery", () => {
  const runtimePage = fs.readFileSync(path.join(root, "renderer", "pages", "runtime.js"), "utf8");
  assert.match(runtimePage, /runtimeContext/);
  assert.match(runtimePage, /runtimeBatch/);
  assert.match(runtimePage, /forceStopGeneration/);
  assert.match(main, /getInferenceOptions\(\)/);
  assert.match(main, /contextLength: inference\.contextLength, batchSize: inference\.batchSize/);
});
test("chat generation survives navigation and shows an animated state", () => {
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  assert.match(chat, /runtime\.activeGeneration/);
  assert.match(chat, /runtime\.queuedGenerations/);
  assert.match(chat, /while \(queue\.length\)/);
  assert.match(chat, /shell-chat-streaming-dots/);
  assert.match(styles, /@keyframes syncChatDot/);
  assert.match(styles, /::-webkit-scrollbar-thumb/);
});

test("chat-management IPC methods are wired through the renderer bridge", () => {
  assert.match(main, /edit_user_message:/);
  assert.match(main, /update_chat_metadata:/);
  assert.match(main, /list_chat_folders:/);
  assert.match(main, /export_chat:/);
  assert.match(bridge, /editUserMessage:/);
  assert.match(bridge, /updateChatMetadata:/);
  assert.match(bridge, /listChatFolders:/);
});

test("chat-management IPC handlers and renderer bridge expose persistent actions", () => {
  assert.match(main, /edit_user_message:/);
  assert.match(main, /update_chat_metadata:/);
  assert.match(main, /list_chat_folders:/);
  assert.match(main, /export_chat:/);
  assert.match(bridge, /editUserMessage:/);
  assert.match(bridge, /updateChatMetadata:/);
  assert.match(bridge, /listChatFolders:/);
});
test("archive and folders routes replace the System section in sidebar", () => {
  const shared = fs.readFileSync(path.join(root, "renderer", "shared.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.doesNotMatch(shared, /heading: "SYSTEM"/);
  assert.match(shared, /id: "archive"/);
  assert.match(shared, /id: "folders"/);
  assert.match(html, /renderer\/pages\/folders\.js/);
});
