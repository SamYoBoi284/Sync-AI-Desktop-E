const path = require("node:path");
const { app, utilityProcess } = require("electron");

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

app.whenReady().then(() => {
  worker = utilityProcess.fork(
    path.join(__dirname, "inference-runtime-smoke-worker.mjs"),
    [],
    { stdio: ["ignore", "pipe", "pipe", "pipe"] }
  );
  worker.stderr?.on("data", chunk => console.error(chunk.toString()));
  worker.on("message", event => {
    const message = event?.data ?? event;
    if (message?.type === "SMOKE_PASS") finish(0, "Prebuilt llama.cpp CPU runtime loaded successfully inside Electron UtilityProcess.");
    else if (message?.type === "SMOKE_FAIL") finish(1, message.error || "Native inference runtime smoke test failed.");
  });
  worker.once("exit", code => {
    if (!completed) finish(1, "Inference runtime smoke worker exited before reporting a result. Exit code: " + code);
  });
}).catch(error => finish(1, error instanceof Error ? error.stack || error.message : String(error)));
