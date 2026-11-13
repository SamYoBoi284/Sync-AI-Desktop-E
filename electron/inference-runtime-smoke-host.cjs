const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, utilityProcess } = require("electron");
const { SyncDatabase } = require("./database.cjs");

let worker = null;
let completed = false;

function finish(code, message) {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);
  if (message) console.log(message);
  try { worker?.kill(); } catch {}
  app.exit(code);
}

const timeout = setTimeout(() => {
  finish(1, "Inference runtime smoke test timed out.");
}, 90000);

function verifyElectronSqliteRuntime() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sync-electron-sqlite-smoke-"));
  const databasePath = path.join(directory, "smoke.sqlite3");
  let database;
  try {
    database = new SyncDatabase(databasePath);
    const chat = database.create_chat({ title: "Electron SQLite smoke test" });
    database.append_message({ chatId: chat.id, message: { role: "user", body: "SQLite is alive inside Electron." } });
    const restored = database.get_chat({ chatId: chat.id });
    if (restored.messages.length !== 1 || restored.messages[0].body !== "SQLite is alive inside Electron.") {
      throw new Error("SQLite round-trip returned unexpected chat data.");
    }
  } finally {
    try { database?.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

app.whenReady().then(() => {
  verifyElectronSqliteRuntime();
  worker = utilityProcess.fork(
    path.join(__dirname, "inference-runtime-smoke-worker.mjs"),
    [],
    { stdio: ["ignore", "pipe", "pipe", "pipe"] }
  );
  worker.stderr?.on("data", chunk => console.error(chunk.toString()));
  worker.on("message", event => {
    const message = event?.data ?? event;
    if (message?.type === "SMOKE_PASS") {
      finish(0, "Electron SQLite and the prebuilt llama.cpp CPU runtime loaded successfully in the Electron main/utility processes.");
    } else if (message?.type === "SMOKE_FAIL") {
      finish(1, message.error || "Native inference runtime smoke test failed.");
    }
  });
  worker.once("exit", code => {
    if (!completed) finish(1, "Inference runtime smoke worker exited before reporting a result. Exit code: " + code);
  });
}).catch(error => finish(1, error instanceof Error ? error.stack || error.message : String(error)));
