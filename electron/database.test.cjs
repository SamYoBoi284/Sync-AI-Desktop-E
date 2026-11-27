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


test("upgrades a populated version-7 database through version 9 without losing user data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-v7-upgrade-"));
  const file = path.join(dir, "legacy-v7.sqlite3");
  let db = new SyncDatabase(file);
  try {
    const chat = db.create_chat({ title: "Legacy conversation" });
    db.append_message({ chatId: chat.id, message: { role: "user", body: "Preserve this transcript." } });
    const memory = db.save_memory({ memory: {
      title: "Legacy memory", content: "Preserve this saved memory.", source: "manual", enabled: false
    } });
    const note = db.save_note({ note: {
      title: "Legacy note", content: "Preserve this note.", pinned: true, includeInContext: false
    } });

    // Reconstruct the schema shape immediately before migration v8.
    db.db.exec("DROP INDEX idx_memories_rank;");
    db.db.exec("DROP INDEX idx_memory_candidates_status_created;");
    db.db.exec("DROP TABLE memory_candidates;");
    db.db.exec("DROP TABLE conversation_summaries;");
    db.db.exec("DROP TABLE memory_sources;");
    db.db.exec("ALTER TABLE memories DROP COLUMN pinned;");
    db.db.exec("ALTER TABLE memories DROP COLUMN importance;");
    db.db.exec("ALTER TABLE memories DROP COLUMN category;");
    db.db.prepare("DELETE FROM schema_migrations WHERE version>7").run();
    db.close();

    db = new SyncDatabase(file);
    const migratedMemory = db.get_memory({ memoryId: memory.id });
    assert.equal(migratedMemory.title, "Legacy memory");
    assert.equal(migratedMemory.content, "Preserve this saved memory.");
    assert.equal(migratedMemory.source, "manual");
    assert.equal(migratedMemory.enabled, false);
    assert.equal(migratedMemory.category, "general");
    assert.equal(migratedMemory.importance, 3);
    assert.equal(migratedMemory.pinned, false);
    assert.equal(db.get_chat({ chatId: chat.id }).messages[0].body, "Preserve this transcript.");
    assert.equal(db.get_note({ noteId: note.id }).content, "Preserve this note.");
    assert.equal(Number(db.db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v), 9);
    assert.deepEqual(db.get_conversation_summary({ chatId: chat.id }), null);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("retrieves Memory by lexical relevance while keeping pinned context available", () => withDb(db => {
  const unrelated = db.save_memory({ memory: {
    title: "Cooking", content: "Enjoys experimenting with bread recipes.",
    category: "interests", importance: 3
  } });
  const relevant = db.save_memory({ memory: {
    title: "Gaming preferences", content: "Enjoys Rocket League and Sideswipe.",
    category: "interests", importance: 3
  } });
  const pinned = db.save_memory({ memory: {
    title: "Important background", content: "Prefers lightweight software.",
    category: "preferences", importance: 4, pinned: true
  } });
  const selected = db.list_memory_context({ query: "Rocket League", maxCharacters: 12000 });
  assert.equal(selected[0].id, relevant.id);
  assert.ok(selected[0].relevanceScore > 0);
  assert.ok(selected.some(item => item.id === pinned.id));
  assert.ok(!selected.some(item => item.id === unrelated.id));
}));

test("retrieves opted-in Notes independently from Workspace artifacts", () => withDb(db => {
  const note = db.save_note({ note: {
    title: "Laptop upgrade", content: "Compare 512 GB SSD options.",
    pinned: true, includeInContext: true
  } });
  db.save_note({ note: {
    title: "Private note", content: "Do not include this in prompts.",
    pinned: false, includeInContext: false
  } });
  const artifact = db.save_workspace_artifact({ artifact: {
    title: "SSD research", kind: "document", content: "SATA SSD compatibility notes.",
    includeInContext: true
  } });
  db.save_workspace_artifact({ artifact: {
    title: "Unselected artifact", kind: "document", content: "Not selected for chat context.",
    includeInContext: false
  } });

  const notes = db.list_note_context({ query: "512 GB SSD" });
  const workspace = db.list_workspace_context({ query: "SATA SSD" });
  assert.deepEqual(notes.map(item => item.id), [note.id]);
  assert.equal(notes[0].relevanceScore > 0, true);
  assert.deepEqual(workspace.map(item => item.id), [artifact.id]);
  assert.equal(workspace[0].relevanceScore > 0, true);
  assert.ok(!workspace.some(item => item.kind === "note"));
  assert.ok(!notes.some(item => item.kind === "document"));
}));

test("empty retrieval queries preserve all enabled or opted-in context without cross-source mixing", () => withDb(db => {
  const memory = db.save_memory({ memory: { title: "General", content: "General user context." } });
  const note = db.save_note({ note: {
    title: "Saved note", content: "Reference details.", includeInContext: true
  } });
  const artifact = db.save_workspace_artifact({ artifact: {
    title: "Workspace report", kind: "report", content: "Project findings.", includeInContext: true
  } });
  assert.deepEqual(db.list_memory_context({ query: "" }).map(item => item.id), [memory.id]);
  assert.deepEqual(db.list_note_context({ query: "" }).map(item => item.id), [note.id]);
  assert.deepEqual(db.list_workspace_context({ query: "" }).map(item => item.id), [artifact.id]);
}));


test("creates persistent memory candidates with source-message snapshots without saving them as Memory", () => withDb(db => {
  const chat = db.create_chat({ title: "Work preferences" });
  const source = db.append_message({ chatId: chat.id, message: { role: "user", body: "I prefer concise shift handovers." } });
  const candidate = db.create_memory_candidate({
    title: "Learned profile",
    content: "Prefers concise shift handovers.",
    sourceChatId: chat.id,
    sourceMessages: [{ messageId: source.id, excerpt: "I prefer concise shift handovers." }]
  });
  assert.equal(candidate.status, "pending");
  assert.equal(candidate.sourceChatTitle, "Work preferences");
  assert.equal(candidate.sourceMessages.length, 1);
  assert.equal(db.list_memory_candidates({ status: "pending" }).length, 1);
  assert.equal(db.list_memories().length, 0);
}));

test("approves a learning candidate into the learned profile and records its source provenance", () => withDb(db => {
  const chat = db.create_chat({ title: "Stable preferences" });
  const source = db.append_message({ chatId: chat.id, message: { role: "user", body: "I prefer lightweight applications." } });
  const existing = db.save_memory({ memory: {
    title: "Learned profile", content: "Older profile.", source: "Auto-learned from conversations",
    category: "profile", importance: 4, pinned: true
  } });
  const candidate = db.create_memory_candidate({
    content: "Prefers lightweight applications.",
    sourceChatId: chat.id,
    sourceMessages: [{ messageId: source.id, excerpt: "I prefer lightweight applications." }]
  });
  const result = db.review_memory_candidate({ candidateId: candidate.id, decision: "approve" });
  assert.equal(result.candidate.status, "approved");
  assert.equal(result.memory.id, existing.id);
  assert.equal(result.memory.content, "Prefers lightweight applications.");
  assert.equal(result.memory.importance, 4);
  assert.equal(result.memory.pinned, true);
  assert.equal(result.memory.sources.length, 1);
  assert.equal(result.memory.sources[0].chatTitle, "Stable preferences");
  assert.throws(() => db.review_memory_candidate({ candidateId: candidate.id, decision: "approve" }), /already been reviewed/);
}));

test("rejecting a learning candidate leaves the saved learned profile untouched", () => withDb(db => {
  const existing = db.save_memory({ memory: {
    title: "Learned profile", content: "Keep this profile.", source: "Auto-learned from conversations"
  } });
  const candidate = db.create_memory_candidate({ content: "A proposed replacement." });
  const result = db.review_memory_candidate({ candidateId: candidate.id, decision: "reject" });
  assert.equal(result.candidate.status, "rejected");
  assert.equal(result.memory, null);
  assert.equal(db.get_memory({ memoryId: existing.id }).content, "Keep this profile.");
}));

test("candidate source snapshots survive deletion of the originating conversation", () => withDb(db => {
  const chat = db.create_chat({ title: "Old conversation" });
  const source = db.append_message({ chatId: chat.id, message: { role: "user", body: "Original user statement." } });
  const candidate = db.create_memory_candidate({
    content: "A learned detail.",
    sourceChatId: chat.id,
    sourceMessages: [{ messageId: source.id, excerpt: "Original user statement." }]
  });
  db.delete_chat({ chatId: chat.id });
  const stored = db.get_memory_candidate({ candidateId: candidate.id });
  assert.equal(stored.sourceChatId, null);
  assert.equal(stored.sourceChatTitle, "Old conversation");
  assert.match(stored.sourceMessages[0].excerpt, /Original user statement/);
}));

test("memory candidate queue validates states and caps pending suggestions", () => withDb(db => {
  const candidate = db.create_memory_candidate({ content: "One suggestion." });
  assert.throws(() => db.list_memory_candidates({ status: "unknown" }), /Invalid candidate status/);
  assert.throws(() => db.review_memory_candidate({ candidateId: candidate.id, decision: "delete" }), /decision/);
  assert.throws(() => db.delete_memory_candidate({ candidateId: candidate.id }), /pending candidate/);
  db.review_memory_candidate({ candidateId: candidate.id, decision: "reject" });
  db.delete_memory_candidate({ candidateId: candidate.id });
  assert.equal(db.list_memory_candidates({ status: "all" }).length, 0);
}));
