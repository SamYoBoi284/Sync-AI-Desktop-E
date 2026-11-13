import { getLlama } from "node-llama-cpp";

const parentPort = process.parentPort;
try {
  if (!parentPort) throw new Error("Utility process parent port is unavailable.");
  // dryRun verifies the shipped prebuilt CPU binary can be loaded in Electron
  // without initializing llama.cpp or loading a large model into memory.
  await getLlama({
    gpu: false,
    build: "never",
    skipDownload: true,
    dryRun: true,
    logLevel: "error",
    maxThreads: 1
  });
  parentPort.postMessage({ type: "SMOKE_PASS" });
  setImmediate(() => process.exit(0));
} catch (error) {
  parentPort?.postMessage({
    type: "SMOKE_FAIL",
    error: error instanceof Error ? error.stack || error.message : String(error)
  });
  setImmediate(() => process.exit(1));
}
