const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "src", "services", "nativeBridge.ts"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

test("every renderer IPC command has exactly one Electron main-process handler", () => {
  const commands = [...new Set([...bridge.matchAll(/invoke(?:<[^>]+>)?\(\s*"([^"]+)"/g)].map(match => match[1]))].sort();
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
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /new Tray/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /require\s*\(\s*["']node:/);
});
