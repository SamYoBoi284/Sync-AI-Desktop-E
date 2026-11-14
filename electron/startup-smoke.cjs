const { spawn } = require("node:child_process");
const path = require("node:path");
const electronBinary = require("electron");

if (typeof electronBinary !== "string" || !electronBinary.trim()) {
  throw new Error("The Electron executable could not be resolved from node_modules.");
}

const child = spawn(electronBinary, ["--disable-gpu", "--disable-software-rasterizer", "."], {
  cwd: path.join(__dirname, ".."),
  windowsHide: true,
  env: { ...process.env, SYNC_AI_STARTUP_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
let settled = false;
const collect = chunk => { output += chunk.toString("utf8"); };
child.stdout.on("data", collect);
child.stderr.on("data", collect);
const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  child.kill();
  console.error(output);
  console.error("Electron startup smoke test timed out before renderer readiness.");
  process.exitCode = 1;
}, 45000);
child.once("error", error => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (code === 0 && output.includes("[Sync AI] Renderer ready.")) {
    console.log("Electron main process, preload bridge, direct HTML load, and vanilla renderer startup passed.");
  } else {
    console.error(output);
    console.error("Electron startup smoke test failed (exit code " + code + ", signal " + signal + ").");
    process.exitCode = 1;
  }
});
