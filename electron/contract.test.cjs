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
