const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SyncDatabase } = require("./database.cjs");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-memory-test-"));
  const db = new SyncDatabase(path.join(dir, "memory.sqlite3"));
  return { db, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("memory entries persist and can be edited, disabled and deleted", () => {
  const f = fixture();
  try {
    const saved = f.db.save_memory({ memory: { title: "Profile", content: "The user prefers concise explanations.", source: "import:test.md" } });
    assert.equal(saved.enabled, true);
    assert.equal(f.db.list_memories().length, 1);
    assert.match(f.db.list_memory_context()[0].content, /concise explanations/);
    const edited = f.db.save_memory({ memoryId: saved.id, memory: { title: "Updated profile", content: "The user prefers detailed explanations.", source: "manual", enabled: true } });
    assert.equal(edited.title, "Updated profile");
    assert.match(f.db.list_memory_context()[0].content, /detailed explanations/);
    f.db.set_memory_enabled({ memoryId: saved.id, enabled: false });
    assert.equal(f.db.list_memory_context().length, 0);
    f.db.delete_memory({ memoryId: saved.id });
    assert.equal(f.db.list_memories().length, 0);
  } finally { f.close(); }
});

test("memory context only includes enabled entries and respects its character budget", () => {
  const f = fixture();
  try {
    f.db.save_memory({ memory: { title: "Newest", content: "A".repeat(8000), source: "test" } });
    f.db.save_memory({ memory: { title: "Disabled", content: "SHOULD NOT APPEAR", enabled: false, source: "test" } });
    const context = f.db.list_memory_context({ maxCharacters: 2048 });
    assert.equal(context.length, 1);
    assert.ok(context[0].content.length < 2048);
    assert.equal(context[0].truncated, true);
    assert.equal(context[0].content.includes("SHOULD NOT APPEAR"), false);
  } finally { f.close(); }
});

test("memory content is limited to one MiB", () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.db.save_memory({ memory: { title: "Too large", content: "x".repeat(1024 * 1024 + 1) } }),
      /1 MiB/
    );
  } finally { f.close(); }
});
