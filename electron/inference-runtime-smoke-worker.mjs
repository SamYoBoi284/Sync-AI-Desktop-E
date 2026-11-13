import { getLlama } from "node-llama-cpp";

const parentPort = process.parentPort;
try {
  if (!parentPort) throw new Error("Utility process parent port is unavailable.");
  // Initialize the shipped CPU backend, exercise its RAM-cap API, then clean
  //ly dispose it. This verifies the native addon works inside Electron
  //without downloading or loading a model file.
  const llama = await getLlama({
    gpu: false,
    build: "never",
    skipDownload: true,
    logLevel: "error",
    maxThreads: 1
  });
  await llama.setRamCap(256 * 1024 * 1024);
  const cap = llama.getRamCap();
  if (cap !== 256 * 1024 * 1024) throw new Error("llama.cpp RAM-cap API returned an unexpected value.");
  await llama.dispose();
  parentPort.postMessage({ type: "SMOKE_PASS" });
} catch (error) {
  parentPort?.postMessage({
    type: "SMOKE_FAIL",
    error: error instanceof Error ? error.stack || error.message : String(error)
  });
}
