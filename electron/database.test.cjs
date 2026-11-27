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

test("supports archive, pin, folders, edit-from-turn and single-chat export", () => withDb(db => {
  const folder = db.create_chat_folder({ name: "Project Alpha" });
  const chat = db.create_chat({ title: "Conversation" });
  const first = db.append_message({ chatId: chat.id, message: { role: "user", body: "first draft" } });
  db.append_message({ chatId: chat.id, message: { role: "assistant", body: "old reply" } });
  db.append_message({ chatId: chat.id, message: { role: "user", body: "later turn" } });
  const edited = db.edit_user_message({ chatId: chat.id, messageId: first.id, body: "revised first turn" });
  assert.deepEqual(edited.messages.map(m => m.body), ["revised first turn"]);
  db.update_chat_metadata({ chatId: chat.id, pinned: true, folderId: folder.id });
  assert.equal(db.list_chats({ folderId: folder.id })[0].isPinned, true);
  db.update_chat_metadata({ chatId: chat.id, archived: true });
  assert.equal(db.list_chats().length, 0);
  assert.equal(db.list_chats({ includeArchived: true, archivedOnly: true }).length, 1);
  db.update_chat_metadata({ chatId: chat.id, archived: false });
  assert.equal(db.export_chat({ chatId: chat.id }).chats[0].messages[0].body, "revised first turn");
  db.delete_chat_folder({ folderId: folder.id });
  assert.equal(db.get_chat({ chatId: chat.id }).folderId, null);
}));


test("persists memory metadata and validates category, importance and pinning", () => withDb(db => {
  const memory = db.save_memory({ memory: {
    title: "Preferences", content: "Prefers lightweight software", source: "manual",
    enabled: true, category: "preferences", importance: 5, pinned: true
  } });
  assert.equal(memory.category, "preferences");
  assert.equal(memory.importance, 5);
  assert.equal(memory.pinned, true);
  assert.throws(() => db.save_memory({ memory: {
    title: "Invalid category", content: "x", category: "unknown"
  } }), /Invalid memory category/);
  assert.throws(() => db.save_memory({ memory: {
    title: "Invalid importance", content: "x", importance: 6
  } }), /importance/);
  const updated = db.save_memory({ memory: { title: "Preferences", content: "Prefers low-resource apps" }, memoryId: memory.id });
  assert.equal(updated.category, "preferences");
  assert.equal(updated.importance, 5);
  assert.equal(updated.pinned, true);
}));

test("records memory provenance separately and preserves source snapshots after chat deletion", () => withDb(db => {
  const chat = db.create_chat({ title: "Laptop preferences" });
  const source = db.append_message({ chatId: chat.id, message: { role: "user", body: "I prefer lightweight applications on my laptop." } });
  const memory = db.save_memory({ memory: { title: "Software preferences", content: "Prefers lightweight applications" } });
  db.add_memory_source({ memoryId: memory.id, chatId: chat.id, messageId: source.id });
  db.add_memory_source({ memoryId: memory.id, chatId: chat.id, messageId: source.id });
  const linked = db.get_memory({ memoryId: memory.id });
  assert.equal(linked.sources.length, 1);
  assert.equal(linked.sources[0].chatTitle, "Laptop preferences");
  assert.match(linked.sources[0].messageExcerpt, /lightweight applications/);
  db.delete_chat({ chatId: chat.id });
  const afterDelete = db.get_memory({ memoryId: memory.id }).sources[0];
  assert.equal(afterDelete.chatId, null);
  assert.equal(afterDelete.messageId, null);
  assert.equal(afterDelete.chatTitle, "Laptop preferences");
}));

test("stores conversation summaries and invalidates stale summaries after editing covered turns", () => withDb(db => {
  const chat = db.create_chat({ title: "Context compaction" });
  const first = db.append_message({ chatId: chat.id, message: { role: "user", body: "First detail" } });
  db.append_message({ chatId: chat.id, message: { role: "assistant", body: "First response" } });
  const summary = db.save_conversation_summary({
    chatId: chat.id, summary: "The user discussed the first detail.", throughPosition: 1
  });
  assert.equal(summary.throughPosition, 1);
  assert.equal(db.get_conversation_summary({ chatId: chat.id }).summary, summary.summary);
  db.edit_user_message({ chatId: chat.id, messageId: first.id, body: "Corrected first detail" });
  assert.equal(db.get_conversation_summary({ chatId: chat.id }), null);
}));

test("keeps summaries valid when new turns are appended after their summarized cursor", () => withDb(db => {
  const chat = db.create_chat({});
  const first = db.append_message({ chatId: chat.id, message: { role: "user", body: "Old turn" } });
  db.append_message({ chatId: chat.id, message: { role: "assistant", body: "Old reply" } });
  db.save_conversation_summary({ chatId: chat.id, summary: "Old turn summary", throughPosition: 1 });
  const next = db.append_message({ chatId: chat.id, message: { role: "user", body: "New turn" } });
  db.append_assistant_message_after({ chatId: chat.id, userMessageId: next.id, message: { role: "assistant", body: "New reply" } });
  assert.equal(db.get_conversation_summary({ chatId: chat.id }).summary, "Old turn summary");
}));


test("prioritizes pinned and important memories within the existing bounded context", () => withDb(db => {
  db.save_memory({ memory: {
    title: "Recent", content: "A newer but ordinary preference.", importance: 1, pinned: false
  } });
  const pinned = db.save_memory({ memory: {
    title: "Pinned", content: "An older high-priority preference.", importance: 2, pinned: true
  } });
  const selected = db.list_memory_context({ maxCharacters: 80 });
  assert.equal(selected[0].id, pinned.id);
  assert.equal(selected[0].pinned, true);
  assert.equal(selected[0].importance, 2);
}));

test("invalidates a conversation summary when a queued reply is inserted inside its covered history", () => withDb(db => {
  const chat = db.create_chat({});
  const first = db.append_message({ chatId: chat.id, message: { role: "user", body: "First user turn" } });
  db.append_message({ chatId: chat.id, message: { role: "user", body: "Second user turn" } });
  db.save_conversation_summary({ chatId: chat.id, summary: "Both user turns", throughPosition: 1 });
  db.append_assistant_message_after({
    chatId: chat.id, userMessageId: first.id,
    message: { role: "assistant", body: "Inserted historical response" }
  });
  assert.equal(db.get_conversation_summary({ chatId: chat.id }), null);
}));
