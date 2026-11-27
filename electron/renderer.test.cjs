const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

test("the desktop renderer is plain HTML, CSS and ordered classic JavaScript", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
  assert.match(html, /renderer\/app\.js/);
  assert.match(html, /src\/styles\.css/);
  assert.match(html, /<script defer src="\.\/renderer\/api\.js"><\/script>/);
  assert.match(html, /<script defer src="\.\/renderer\/shared\.js"><\/script>/);
  assert.doesNotMatch(html, /type="module"|vite|tsx|src\/main/);
  assert.doesNotMatch(app, /react|createRoot|jsx|vite|^import |^export /im);
  for (const page of ["chat","history","models","workspace","tasks","library","runtime","settings","preview"]) {
    const code = fs.readFileSync(path.join(root, "renderer", "pages", page + ".js"), "utf8");
    assert.doesNotMatch(code, /^import |^export /m, page + " page must be a classic script");
  }
});

test("renderer API uses only the narrow preload bridge for native commands", () => {
  const api = fs.readFileSync(path.join(root, "renderer", "api.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");
  assert.match(api, /window\.syncAI/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("syncAI"/);
  assert.doesNotMatch(api, /node:|child_process|fs\.readFile/);
});

test("chat learning requires explicit evidence and does not turn greetings into titles", () => {
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  assert.match(chat, /function isLowSignalLearningMessage/);
  assert.match(chat, /if \(!raw \|\| isLowSignalLearningMessage\(raw\)\) return null/);
  assert.match(chat, /const hasGenericAutoTitle =/);
  assert.match(chat, /if \(hasGenericAutoTitle\)/);
  assert.match(chat, /const title = buildChatTitle\(body\)/);
  assert.match(chat, /EVIDENCE_IDS/);
  assert.match(chat, /sourceMessages:\s*selectedSources\.map/);
  assert.match(chat, /for \(const sourceMessage of selectedSources\)/);
  assert.match(chat, /if \(oldScroll == null \|\| wasNearBottom\) scrollTranscript\(\)/);
});

test("Quick Ask overlay has its own secure document and renderer entrypoint", () => {
  const html = fs.readFileSync(path.join(root, "quick-ask.html"), "utf8");
  const quickAsk = fs.readFileSync(path.join(root, "renderer", "quick-ask.js"), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /renderer\/api\.js/);
  assert.match(html, /renderer\/quick-ask\.js/);
  assert.match(quickAsk, /api\.quickAskPrepare\(\)/);
  assert.match(quickAsk, /api\.quickAskSubmit\(/);
  assert.match(quickAsk, /api\.quickAskStop\(\)/);
});

test("background Memory and summary maintenance never inserts notices or re-renders the transcript", () => {
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  const shellCss = fs.readFileSync(path.join(root, "src", "shell.css"), "utf8");
  const memoryStart = chat.indexOf("async function learnFromConversation(chat)");
  const summaryStart = chat.indexOf("async function maybeUpdateConversationSummary(chat)");
  const queueStart = chat.indexOf("async function processQueue()");
  assert.ok(memoryStart >= 0 && summaryStart > memoryStart && queueStart > summaryStart);
  assert.doesNotMatch(chat.slice(memoryStart, summaryStart), /render\(\)/);
  assert.doesNotMatch(chat.slice(summaryStart, queueStart), /render\(\)/);
  assert.doesNotMatch(chat, /No durable user information was found in the recent messages/);
  assert.doesNotMatch(chat, /Sync is refreshing its saved memory/);
  assert.match(shellCss, /\.shell-chat-notice\s*\{[^}]*position:\s*absolute/s);
});

test("small-talk lead-ins do not pollute conversation titles or durable Memory evidence", () => {
  const chat = fs.readFileSync(path.join(root, "renderer", "pages", "chat.js"), "utf8");
  assert.match(chat, /function stripSmallTalkLeadIn/);
  assert.match(chat, /doing \)\?\(\?:good/);
  assert.match(chat, /routineUtilityQuestion/);
  assert.match(chat, /what time is it/);
  assert.match(chat, /const raw = stripSmallTalkLeadIn/);
});

