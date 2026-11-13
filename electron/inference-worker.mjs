import os from "node:os";
import fs from "node:fs";
import { getLlama, LlamaCompletion } from "node-llama-cpp";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Inference utility process did not receive its parent message port.");

let llama = null;
let model = null;
let context = null;
let completion = null;
let activeGeneration = null;
let loaded = null;

function send(type, data = {}) { parentPort.postMessage({ type, ...data }); }
async function disposeModel() {
  try { completion?.dispose(); } catch {}
  completion = null;
  try { await context?.dispose(); } catch {}
  context = null;
  try { await model?.dispose(); } catch {}
  model = null;
  loaded = null;
}

async function loadModel(data) {
  if (model) throw new Error("An inference model is already loaded in this worker.");
  if (typeof data.modelPath !== "string" || !data.modelPath.trim()) throw new Error("A valid GGUF model path is required.");
  const stat = fs.statSync(data.modelPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("The selected GGUF model is not a regular file.");
  const memoryLimitBytes = Number.isSafeInteger(data.memoryLimitBytes) && data.memoryLimitBytes > 0 ? data.memoryLimitBytes : null;
  const contextLength = Math.max(512, Math.min(32768, Number(data.contextLength) || 2048));
  const batchSize = Math.max(16, Math.min(2048, Number(data.batchSize) || 128));
  llama = await getLlama({
    gpu: false, maxThreads: Math.max(1, Math.min(4, os.cpus().length)),
    logLevel: "error", build: "never", skipDownload: true
  });
  await llama.setRamCap(memoryLimitBytes);
  model = await llama.loadModel({ modelPath: data.modelPath, gpuLayers: 0, useMmap: false });
  context = await model.createContext({ contextSize: contextLength, batchSize });
  completion = new LlamaCompletion({ contextSequence: context.getSequence() });
  loaded = {
    modelId: data.modelId, modelName: data.modelName, loadedAt: new Date().toISOString(),
    modelSizeBytes: stat.size, contextLength: context.contextSize, batchSize,
    workerRssBytes: process.memoryUsage().rss, workerPid: process.pid
  };
  send("MODEL_LOADED", { model: loaded });
}

async function generate(data) {
  if (!completion || !loaded) throw new Error("No GGUF model is loaded in the inference worker.");
  if (activeGeneration) throw new Error("Another generation is already running.");
  if (typeof data.prompt !== "string" || !data.prompt.trim() || Buffer.byteLength(data.prompt) > 512 * 1024) {
    throw new Error("The prompt is empty or exceeds the 512 KiB worker limit.");
  }
  if (typeof data.generationId !== "string" || !data.generationId.trim() || data.generationId.length > 128) {
    throw new Error("Generation ID is invalid.");
  }
  const generationId = data.generationId;
  const controller = new AbortController();
  const startedAt = new Date().toISOString();
  const clock = process.hrtime.bigint();
  const promptTokens = model.tokenize(data.prompt, true).length;
  let generatedTokens = 0;
  let promptEvalMs = null;
  activeGeneration = { generationId, controller };
  let output = "";
  try {
    const result = await completion.generateCompletionWithMeta(data.prompt, {
      maxTokens: 512,
      temperature: 0.7,
      signal: controller.signal,
      stopOnAbortSignal: true,
      onToken(tokens) {
        generatedTokens += tokens.length;
      },
      onTextChunk(chunk) {
        if (!chunk) return;
        if (promptEvalMs == null) {
          promptEvalMs = Number(process.hrtime.bigint() - clock) / 1e6;
        }
        output += chunk;
        send("GENERATION_EVENT", { event: { event: "token", generationId, token: chunk } });
      }
    });
    const totalMs = Number(process.hrtime.bigint() - clock) / 1e6;
    const generationMs = Math.max(0, totalMs - (promptEvalMs ?? 0));
    const tokensPerSecond = generationMs > 0 ? generatedTokens / (generationMs / 1000) : null;
    const cancelled = result.metadata.stopReason === "abort";
    const diagnostics = {
      generationId, modelId: loaded.modelId, modelLabel: loaded.modelName,
      backend: "llama.cpp", backendVersion: "node-llama-cpp 3.22.3",
      status: cancelled ? "cancelled" : "completed",
      promptTokens, generatedTokens, promptEvalMs, generationMs, tokensPerSecond,
      contextSize: context.contextSize, maxContextSize: loaded.contextLength, temperature: 0.7,
      stopReason: result.metadata.stopReason, errorCode: null, errorMessage: null,
      startedAt, finishedAt: new Date().toISOString()
    };
    send("GENERATION_RESULT", { generationId, result: { text: result.response, diagnostics } });
  } catch (error) {
    const totalMs = Number(process.hrtime.bigint() - clock) / 1e6;
    const generationMs = Math.max(0, totalMs - (promptEvalMs ?? 0));
    const tokensPerSecond = generationMs > 0 ? generatedTokens / (generationMs / 1000) : null;
    const cancelled = controller.signal.aborted;
    const message = error instanceof Error ? error.message : String(error);
    send("GENERATION_RESULT", {
      generationId,
      result: {
        text: output,
        diagnostics: {
          generationId, modelId: loaded?.modelId ?? null, modelLabel: loaded?.modelName ?? null,
          backend: "llama.cpp", backendVersion: "node-llama-cpp 3.22.3",
          status: cancelled ? "cancelled" : "error",
          promptTokens, generatedTokens, promptEvalMs, generationMs, tokensPerSecond,
          contextSize: context?.contextSize ?? null, maxContextSize: loaded?.contextLength ?? null,
          stopReason: cancelled ? "cancelled" : null, errorCode: cancelled ? null : "generation_failed",
          errorMessage: cancelled ? null : message, startedAt, finishedAt: new Date().toISOString()
        }
      }
    });
  } finally { activeGeneration = null; }
}

async function shutdown() {
  if (activeGeneration) activeGeneration.controller.abort();
  await disposeModel();
  try { await llama?.dispose(); } catch {}
  llama = null;
  send("STOPPED");
  setImmediate(() => process.exit(0));
}

parentPort.on("message", async event => {
  const message = event?.data ?? event;
  if (!message || typeof message.type !== "string") return;
  try {
    switch (message.type) {
      case "LOAD_MODEL": await loadModel(message.data ?? {}); break;
      case "GENERATE": await generate(message.data ?? {}); break;
      case "CANCEL_GENERATION":
        if (activeGeneration && activeGeneration.generationId === message.generationId) activeGeneration.controller.abort();
        break;
      case "SHUTDOWN": await shutdown(); break;
      default: send("RUNTIME_ERROR", { error: "Unsupported inference-worker command." });
    }
  } catch (error) {
    send(message.type === "LOAD_MODEL" ? "LOAD_ERROR" : "RUNTIME_ERROR", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
