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


test("Memory, Notes, Workspace and conversation summaries remain separate context sources", () => {
  const database = fs.readFileSync(path.join(__dirname, "database.cjs"), "utf8");
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  assert.match(database, /list_memory_context\(\{maxCharacters=12000,query=""\}/);
  assert.match(database, /list_note_context\(\{query="",maxCharacters=16384\}/);
  assert.match(database, /list_workspace_context\(\{query="",maxCharacters=32768\}/);
  assert.match(main, /list_note_context:/);
  assert.match(bridge, /listNoteContext: \(query = ""\)/);
  assert.match(chat, /api\.listMemoryContext\(retrievalQuery\)/);
  assert.match(chat, /api\.listNoteContext\(retrievalQuery\)/);
  assert.match(chat, /api\.listWorkspaceContext\(retrievalQuery\)/);
  assert.match(chat, /api\.getConversationSummary\(job\.chatId\)/);
  assert.match(chat, /RELEVANT USER NOTES/);
  assert.match(chat, /SELECTED WORKSPACE MATERIAL/);
  assert.match(chat, /OLDER CONVERSATION SUMMARY/);
  assert.match(chat, /Number\(m\.position\) > cursor \|\| m\.id === latestMessageId/);
});


test("Memory learning review modes have persistent candidate storage and explicit approval", () => {
  const database = fs.readFileSync(path.join(__dirname, "database.cjs"), "utf8");
  const memoryPage = fs.readFileSync(path.join(root, "renderer", "pages", "memory.js"), "utf8");
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  assert.match(database, /if\(v<9\).*memory_candidates/s);
  assert.match(database, /create_memory_candidate\(/);
  assert.match(database, /review_memory_candidate\(/);
  assert.match(database, /status IN \('pending','approved','rejected'\)/);
  assert.match(main, /create_memory_candidate:/);
  assert.match(main, /review_memory_candidate:/);
  assert.match(bridge, /createMemoryCandidate:/);
  assert.match(bridge, /reviewMemoryCandidate:/);
  assert.match(memoryPage, /memory_learning_mode/);
  assert.match(memoryPage, /value="review"/);
  assert.match(memoryPage, /approve-candidate/);
  assert.match(memoryPage, /reject-candidate/);
  assert.match(chat, /mode === "review"/);
  assert.match(chat, /api\.createMemoryCandidate\(/);
  assert.match(memoryPage, /api\.reviewMemoryCandidate/);
});

test("overall prompt budgeting is bounded and leaves recent transcript context intact", () => {
  const memoryPage = fs.readFileSync(path.join(root, "renderer", "pages", "memory.js"), "utf8");
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  assert.match(main, /get_context_policy:/);
  assert.match(main, /set_context_budget_percent:/);
  assert.match(main, /estimatedCharBudget/);
  assert.match(bridge, /getContextPolicy:/);
  assert.match(bridge, /setContextBudgetPercent:/);
  assert.match(memoryPage, /contextBudgetPercent/);
  assert.match(chat, /maxPromptCharacters/);
  assert.match(chat, /fitPromptText\(transcriptText[\s\S]*true\)/);
  assert.match(chat, /api\.getContextPolicy\(\)/);
  assert.match(main, /outputReserveTokens/);
});

test("older conversation summaries are incrementally generated without summarizing the newest eight messages", () => {
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  assert.match(chat, /maybeUpdateConversationSummary/);
  assert.match(chat, /const recentKeep = 8/);
  assert.match(chat, /throughMessages = messages\.slice\(0, -recentKeep\)/);
  assert.match(chat, /position\) > cursor/);
  assert.match(chat, /purpose: "summary"/);
  assert.match(chat, /saveConversationSummary\(chat\.id, updated\.slice\(0, 2200\), target\.position/);
  assert.match(chat, /conversation_summary_auto/);
});
