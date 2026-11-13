const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readGgufMetadata, estimatePeakBytes } = require("./gguf.cjs");

function str(value) {
  const data = Buffer.from(value, "utf8");
  const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(data.length));
  return Buffer.concat([size, data]);
}
function u32(key, value) {
  const type = Buffer.alloc(4); type.writeUInt32LE(4);
  const data = Buffer.alloc(4); data.writeUInt32LE(value);
  return Buffer.concat([str(key), type, data]);
}
function stringValue(key, value) {
  const type = Buffer.alloc(4); type.writeUInt32LE(8);
  return Buffer.concat([str(key), type, str(value)]);
}
function fixture() {
  const header = Buffer.alloc(24);
  header.write("GGUF", 0, "ascii");
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(1n, 8);
  header.writeBigUInt64LE(10n, 16);
  return Buffer.concat([
    header,
    stringValue("general.architecture", "llama"),
    stringValue("general.name", "Test model"),
    u32("general.file_type", 15),
    u32("llama.block_count", 32),
    u32("llama.attention.head_count", 32),
    u32("llama.attention.head_count_kv", 8),
    u32("llama.embedding_length", 4096),
    u32("llama.attention.key_length", 128),
    u32("llama.attention.value_length", 128),
    u32("llama.context_length", 4096)
  ]);
}

test("reads bounded GGUF metadata without loading tensor payloads", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sync-gguf-")), "sample.gguf");
  fs.writeFileSync(file, fixture());
  try {
    const meta = readGgufMetadata(file);
    assert.equal(meta.architecture, "llama");
    assert.equal(meta.modelName, "Test model");
    assert.equal(meta.quantization, "Q4_K_M");
    assert.equal(meta.layerCount, 32);
    assert.equal(meta.kvHeads, 8);
    assert.ok(estimatePeakBytes(meta, 2 * 1024 ** 3) > 2 * 1024 ** 3);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("rejects non-GGUF and unsupported GGUF versions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-gguf-invalid-"));
  const bad = path.join(dir, "bad.gguf");
  fs.writeFileSync(bad, Buffer.alloc(32));
  assert.throws(() => readGgufMetadata(bad), /magic header/);
  const version = path.join(dir, "version.gguf");
  const data = fixture();
  data.writeUInt32LE(9, 4);
  fs.writeFileSync(version, data);
  assert.throws(() => readGgufMetadata(version), /version 9/);
  fs.rmSync(dir, { recursive: true, force: true });
});
