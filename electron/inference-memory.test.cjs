const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

test("Windows Job Object enforces the inference worker private-memory ceiling", {
  skip: process.platform !== "win32",
  timeout: 45000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sync-inference-job-"));
  const fixture = path.join(directory, "allocate.cjs");
  fs.writeFileSync(fixture, "const chunks = [];\nconst chunkSize = 4 * 1024 * 1024;\nfunction allocate() {\n  const block = Buffer.allocUnsafe(chunkSize);\n  for (let offset = 0; offset < block.length; offset += 4096) block[offset] = 0x5a;\n  chunks.push(block);\n  setTimeout(allocate, 100);\n}\nallocate();\n", "utf8");

  const script = path.join(__dirname, "inference-memory-job.ps1");
  const limitBytes = 192 * 1024 * 1024;
  const worker = spawn(process.execPath, [fixture], { windowsHide: true, stdio: "ignore" });
  const guard = spawn("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", script, "-WorkerPid", String(worker.pid), "-LimitBytes", String(limitBytes)
  ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

  let guardOutput = "";
  let guardError = "";
  guard.stdout.on("data", chunk => { guardOutput += chunk.toString("utf8"); });
  guard.stderr.on("data", chunk => { guardError += chunk.toString("utf8"); });

  try {
    const [workerCode, workerSignal] = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Memory-limited worker was not terminated within 40 seconds.")), 40000);
      worker.once("error", error => { clearTimeout(timeout); reject(error); });
      worker.once("exit", (code, signal) => { clearTimeout(timeout); resolve([code, signal]); });
    });
    const guardCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { guard.kill(); reject(new Error("Windows Job Object monitor did not exit.")); }, 10000);
      guard.once("error", error => { clearTimeout(timeout); reject(error); });
      guard.once("exit", code => { clearTimeout(timeout); resolve(code); });
    });

    assert.match(guardOutput, /READY/, "the worker must be assigned to its Job Object before memory stress begins");
    assert.match(guardOutput, /METRICS\\t\\d+\\t\\d+/, "the helper must report working set and private committed memory");
    assert.equal(guardCode, 0, guardError || "Job Object monitor must exit cleanly");
    assert.ok(workerCode !== 0 || workerSignal !== null, "Windows should terminate the worker when it exceeds its private-memory cap");
  } finally {
    try { worker.kill(); } catch {}
    try { guard.stdin.write("STOP\\n"); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
