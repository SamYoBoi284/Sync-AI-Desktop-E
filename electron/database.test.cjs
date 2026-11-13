const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SyncDatabase } = require("./database.cjs");

function withDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-test-"));
  const db = new SyncDatabase(path.join(dir, "test.sqlite3"));
  try { fn(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test("migrates the full schema and persists chats and messages", () => withDb(db => {
  const chat = db.create_chat({ title: "Test conversation" });
  const user = db.append_message({ chatId: chat.id, message: { role: "user", body: "hello" } });
  const assistant = db.append_message({ chatId: chat.id, message: { role: "assistant", body: "world", diagnostics: { status: "complete", generatedTokens: 1 } } });
  assert.equal(user.position, 0);
  assert.equal(assistant.position, 1);
  assert.equal(db.get_chat({ chatId: chat.id }).messages.length, 2);
  assert.equal(db.list_chats()[0].messageCount, 2);
}));

test("inserts queued assistant messages after their triggering user turn", () => withDb(db => {
  const chat = db.create_chat({});
  const first = db.append_message({ chatId: chat.id, message: { role: "user", body: "first" } });
  db.append_message({ chatId: chat.id, message: { role: "user", body: "second" } });
  db.append_assistant_message_after({ chatId: chat.id, userMessageId: first.id, message: { role: "assistant", body: "reply" } });
  assert.deepEqual(db.get_chat({ chatId: chat.id }).messages.map(m => m.body), ["first", "reply", "second"]);
}));

test("round-trips versioned chat backups and skips existing IDs", () => withDb(db => {
  const chat = db.create_chat({ title: "Backup me" });
  db.append_message({ chatId: chat.id, message: { role: "user", body: "saved" } });
  const backup = db.export_chat_backup();
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-import-"));
  const target = new SyncDatabase(path.join(targetDir, "import.sqlite3"));
  try {
    assert.deepEqual(target.import_chat_backup({ backup }), { importedChats: 1, skippedExistingChats: 0 });
    assert.deepEqual(target.import_chat_backup({ backup }), { importedChats: 0, skippedExistingChats: 1 });
    assert.equal(target.get_chat({ chatId: chat.id }).messages[0].body, "saved");
  } finally { target.close(); fs.rmSync(targetDir, { recursive: true, force: true }); }
}));

test("persists Workspace, Tasks, Notes and settings", () => withDb(db => {
  const artifact = db.save_workspace_artifact({ artifact: { title: "Draft", kind: "document", content: "text", includeInContext: true } });
  assert.equal(db.get_workspace_artifact({ artifactId: artifact.id }).content, "text");
  assert.equal(db.list_workspace_context()[0].title, "Draft");
  const task = db.save_task({ task: { title: "Build", details: "", status: "todo", priority: "high", dueDate: null } });
  assert.equal(db.list_tasks()[0].id, task.id);
  const note = db.save_note({ note: { title: "Remember", content: "local", pinned: true, includeInContext: true } });
  assert.equal(db.get_note({ noteId: note.id }).content, "local");
  db.set_setting({ key: "test", valueJson: JSON.stringify({ enabled: true }) });
  assert.deepEqual(JSON.parse(db.get_setting({ key: "test" })), { enabled: true });
}));

test("rejects invalid roles, malformed backups and invalid task states", () => withDb(db => {
  const chat = db.create_chat({});
  assert.throws(() => db.append_message({ chatId: chat.id, message: { role: "tool", body: "bad" } }));
  assert.throws(() => db.import_chat_backup({ backup: { format: "wrong", formatVersion: 1, chats: [] } }));
  assert.throws(() => db.save_task({ task: { title: "bad", details: "", status: "unknown", priority: "normal" } }));
}));
