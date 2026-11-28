const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLowMemoryPreferences, getLowMemoryRecommendation, applyLowMemoryPolicy } = require("./low-memory-policy.cjs");
const GIB = 1024 ** 3;

test("Low-Memory preferences default to disabled and validate persisted values", () => {
  assert.deepEqual(normalizeLowMemoryPreferences(null), { enabled: false });
  assert.deepEqual(normalizeLowMemoryPreferences({ enabled: true, ignored: "field" }), { enabled: true });
  assert.throws(() => normalizeLowMemoryPreferences({ enabled: "yes" }), /enabled boolean/);
  assert.throws(() => normalizeLowMemoryPreferences([]), /enabled boolean/);
});

test("Low-Memory recommendations adapt to installed RAM tiers", () => {
  assert.deepEqual([4, 8, 16, 32].map(gb => {
    const profile = getLowMemoryRecommendation(gb * GIB);
    return [profile.maxContextLength, profile.maxBatchSize];
  }), [[1024, 32], [2048, 64], [4096, 128], [8192, 256]]);
  assert.throws(() => getLowMemoryRecommendation(0), /valid installed-memory capacity/);
});

test("Low-Memory mode only reduces requested context and batch without mutating inputs", () => {
  const requested = { contextLength: 8192, batchSize: 512 };
  const result = applyLowMemoryPolicy(requested, 8 * GIB, true);
  assert.deepEqual(requested, { contextLength: 8192, batchSize: 512 });
  assert.equal(result.requestedContextLength, 8192);
  assert.equal(result.requestedBatchSize, 512);
  assert.equal(result.contextLength, 2048);
  assert.equal(result.batchSize, 64);
  assert.equal(result.lowMemoryMode, true);
});

test("Low-Memory mode preserves already-small per-model profiles", () => {
  const result = applyLowMemoryPolicy({ contextLength: 1024, batchSize: 32 }, 16 * GIB, true);
  assert.equal(result.contextLength, 1024);
  assert.equal(result.batchSize, 32);
});

test("disabled Low-Memory mode leaves the saved inference allocation unchanged", () => {
  const result = applyLowMemoryPolicy({ contextLength: 8192, batchSize: 512 }, 8 * GIB, false);
  assert.equal(result.contextLength, 8192);
  assert.equal(result.batchSize, 512);
  assert.equal(result.lowMemoryMode, false);
  assert.equal(result.recommendation, null);
});
