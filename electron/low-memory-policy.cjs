const GIB = 1024 ** 3;

const DEFAULT_LOW_MEMORY_PREFERENCES = Object.freeze({ enabled: false });

function normalizeLowMemoryPreferences(value) {
  if (value == null) return { ...DEFAULT_LOW_MEMORY_PREFERENCES };
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean") {
    throw new Error("Low-Memory preferences must contain an enabled boolean.");
  }
  return { enabled: value.enabled };
}

function getLowMemoryRecommendation(totalMemoryBytes) {
  const total = Number(totalMemoryBytes);
  if (!Number.isFinite(total) || total <= 0) throw new Error("A valid installed-memory capacity is required to calculate the Low-Memory profile.");
  if (total <= 4 * GIB) return { tier: "4 GB or less", maxContextLength: 1024, maxBatchSize: 32, description: "For devices with 4 GB RAM or less, cap context at 1,024 tokens and batch size at 32." };
  if (total <= 8 * GIB) return { tier: "More than 4 GB up to 8 GB", maxContextLength: 2048, maxBatchSize: 64, description: "For devices with up to 8 GB RAM, cap context at 2,048 tokens and batch size at 64." };
  if (total <= 16 * GIB) return { tier: "More than 8 GB up to 16 GB", maxContextLength: 4096, maxBatchSize: 128, description: "For devices with up to 16 GB RAM, cap context at 4,096 tokens and batch size at 128." };
  return { tier: "More than 16 GB", maxContextLength: 8192, maxBatchSize: 256, description: "For devices with more than 16 GB RAM, cap context at 8,192 tokens and batch size at 256." };
}

function applyLowMemoryPolicy(options, totalMemoryBytes, enabled) {
  const contextLength = Number(options?.contextLength);
  const batchSize = Number(options?.batchSize);
  if (!Number.isInteger(contextLength) || contextLength < 512 || contextLength > 32768) throw new Error("The requested context length is invalid.");
  if (!Number.isInteger(batchSize) || batchSize < 16 || batchSize > 2048) throw new Error("The requested batch size is invalid.");
  if (!enabled) return { contextLength, batchSize: Math.min(batchSize, contextLength), requestedContextLength: contextLength, requestedBatchSize: batchSize, lowMemoryMode: false, recommendation: null };
  const recommendation = getLowMemoryRecommendation(totalMemoryBytes);
  const effectiveContext = Math.max(512, Math.min(contextLength, recommendation.maxContextLength));
  const effectiveBatch = Math.max(16, Math.min(batchSize, recommendation.maxBatchSize, effectiveContext));
  return { contextLength: effectiveContext, batchSize: effectiveBatch, requestedContextLength: contextLength, requestedBatchSize: batchSize, lowMemoryMode: true, recommendation };
}

module.exports = { DEFAULT_LOW_MEMORY_PREFERENCES, normalizeLowMemoryPreferences, getLowMemoryRecommendation, applyLowMemoryPolicy };
