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


test("upgrades a populated version-7 database through version 14 without losing user data", () => {
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
    db.db.exec("DROP TABLE IF EXISTS model_profiles;");
    db.db.exec("DROP TABLE IF EXISTS preference_observation_messages;");
    db.db.exec("DROP TABLE IF EXISTS topic_observation_messages;");
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
    assert.equal(Number(db.db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v), 14);
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

test("always includes the learned user profile for generic or unrelated new-chat queries", () => withDb(db => {
  const profile = db.save_memory({ memory: {
    title: "Learned profile",
    content: "* Name: Sam\\n* Prefers casual greetings",
    source: "Auto-learned from conversations",
    category: "profile",
    importance: 3,
    pinned: false
  } });
  db.save_memory({ memory: {
    title: "Unrelated cooking notes",
    content: "Enjoys baking sourdough and experimenting with spices.",
    source: "manual",
    category: "interests"
  } });
  const selected = db.list_memory_context({ query: "hey, how are you?", maxCharacters: 1024 });
  assert.equal(selected[0].id, profile.id);
  assert.match(selected[0].content, /Name: Sam/);
  assert.equal(selected.some(item => item.title === "Unrelated cooking notes"), false);
}));

test("recurring topic evidence detects interests across chats and ignores one-off subjects", () => withDb(db => {
  const chats = [1, 2, 3, 4].map(number => db.create_chat({ title: "Conversation " + number }));
  const add = (chatId, body) => db.append_message({ chatId, message: { role: "user", body } });
  const rocket1 = add(chats[0].id, "I've been playing Rocket League lately.");
  add(chats[0].id, "Trying to learn Rocket League aerials.");
  add(chats[0].id, "Good morning!");
  add(chats[1].id, "Rocket League ranked has been fun.");
  add(chats[1].id, "I keep coming back to Rocket League.");
  add(chats[1].id, "I played chess once this week.");
  add(chats[2].id, "I want to improve at Rocket League.");
  add(chats[2].id, "Another Rocket League session tonight.");
  add(chats[2].id, "Good morning!");
  add(chats[3].id, "Rocket League is still my favorite.");
  add(chats[3].id, "Good morning!");

  const evidence = db.get_recurring_topic_evidence();
  const rocketLeague = evidence.candidates.find(item => item.term === "rocket league");
  assert.ok(rocketLeague, "recurring subject should be found across chats");
  assert.ok(rocketLeague.conversationCount >= 3);
  assert.ok(rocketLeague.messageCount >= 4);
  assert.equal(evidence.candidates.some(item => item.term === "chess"), false, "one-off topics must not qualify");
  assert.equal(evidence.candidates.some(item => item.term === "good morning"), false, "routine greetings are not interests");

  const secondPass = db.get_recurring_topic_evidence();
  assert.deepEqual(secondPass, evidence, "re-indexing must not duplicate evidence");

  db.edit_user_message({ chatId: chats[0].id, messageId: rocket1.id, body: "Good morning!" });
  const afterEdit = db.get_recurring_topic_evidence();
  const updatedRocketLeague = afterEdit.candidates.find(item => item.term === "rocket league");
  assert.ok(updatedRocketLeague);
  assert.equal(updatedRocketLeague.messageCount, rocketLeague.messageCount - 2, "editing a turn also removes every later message in that conversation");
}));


test("schema v14 cleans legacy auto-learned noise and resets untrusted provenance", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-memory-cleanup-"));
  const file = path.join(dir, "memory.sqlite3");
  let db = new SyncDatabase(file);
  try {
    const chat = db.create_chat({ title: "Old learned profile source" });
    const source = db.append_message({ chatId: chat.id, message: { role: "user", body: "yo bro" } });
    const learned = db.save_memory({ memory: {
      title: "Learned profile",
      content: "* Name: Sam\n* Status: Doing good\n* Interests: Rocket League\n* Habits: Uses \"bro\" and \"yooo\" frequently\n* Other mentions cycling",
      source: "Auto-learned from conversations",
      category: "profile"
    } });
    const emptyLearned = db.save_memory({ memory: {
      title: "Empty learned profile", content: "* Status: Doing good\n* Habits: Uses bro frequently\n* Other mentions cycling",
      source: "Auto-learned from conversations", category: "profile"
    } });
    const pending = db.create_memory_candidate({
      title: "Learned profile",
      content: "* Name: Sam\n* Status: Doing good\n* Interests: Rocket League\n* Habits: Uses bro frequently",
      sourceChatId: chat.id,
      sourceMessages: [{ messageId: source.id, excerpt: "yo bro" }]
    });
    const emptyPending = db.create_memory_candidate({
      title: "Learned profile",
      content: "* Status: Doing good\n* Other mentions cycling",
      sourceChatId: chat.id,
      sourceMessages: [{ messageId: source.id, excerpt: "yo bro" }]
    });
    const manual = db.save_memory({ memory: {
      title: "Manual memory", content: "Keep its evidence.", source: "manual"
    } });
    db.add_memory_source({ memoryId: learned.id, chatId: chat.id, messageId: source.id });
    db.add_memory_source({ memoryId: emptyLearned.id, chatId: chat.id, messageId: source.id });
    db.add_memory_source({ memoryId: manual.id, chatId: chat.id, messageId: source.id });

    // Simulate an existing v13 profile created before the cleanup migration.
    db.db.prepare("DELETE FROM schema_migrations WHERE version>13").run();
    db.close();
    db = new SyncDatabase(file);

    const cleaned = db.get_memory({ memoryId: learned.id });
    assert.match(cleaned.content, /Name: Sam/);
    assert.match(cleaned.content, /Interests: Rocket League/);
    assert.doesNotMatch(cleaned.content, /Status:|Habits:|Other mentions/i);
    assert.equal(cleaned.sources.length, 0, "unverified legacy learned-profile sources are cleared");
    const reviewedLater = db.get_memory_candidate({ candidateId: pending.id });
    assert.match(reviewedLater.content, /Name: Sam/);
    assert.doesNotMatch(reviewedLater.content, /Status:|Habits:/);
    assert.equal(reviewedLater.sourceChatId, null);
    assert.deepEqual(reviewedLater.sourceMessages, []);
    assert.throws(() => db.get_memory_candidate({ candidateId: emptyPending.id }), /Memory candidate not found/);
    assert.throws(() => db.get_memory({ memoryId: emptyLearned.id }), /Memory entry not found/);
    assert.equal(db.get_memory({ memoryId: manual.id }).sources.length, 1, "manual Memory provenance remains intact");
    assert.equal(Number(db.db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v), 14);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("schema v13 clears stale topic observations so the filtered index is rebuilt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-topic-reindex-"));
  const file = path.join(dir, "topic.sqlite3");
  let db = new SyncDatabase(file);
  try {
    const chat = db.create_chat({ title: "Old indexed conversation" });
    const message = db.append_message({ chatId: chat.id, message: { role: "user", body: "yo bro" } });
    db.db.prepare("INSERT INTO topic_observation_messages(message_id,chat_id,terms_json,observed_at) VALUES(?,?,?,?)")
      .run(message.id, chat.id, JSON.stringify(["bro", "yooo"]), new Date().toISOString());

    // Simulate an existing v12 database carrying observations from the old tokenizer.
    db.db.prepare("DELETE FROM schema_migrations WHERE version>12").run();
    db.close();
    db = new SyncDatabase(file);

    assert.equal(Number(db.db.prepare("SELECT COUNT(*) n FROM topic_observation_messages").get().n), 0);
    const rebuilt = db.get_recurring_topic_evidence();
    assert.equal(rebuilt.candidates.length, 0);
    assert.equal(Number(db.db.prepare("SELECT COUNT(*) n FROM topic_observation_messages").get().n), 1);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recurring topic evidence ignores greeting, slang and routine status chatter", () => withDb(db => {
  const chats = [1, 2, 3].map(number => db.create_chat({ title: "Small talk " + number }));
  const messages = [
    [chats[0].id, ["yo bro", "yooo bro"]],
    [chats[1].id, ["hey dude", "im doing good wbu"]],
    [chats[2].id, ["how are you", "sup bro"]]
  ];
  for (const [chatId, bodies] of messages) {
    for (const body of bodies) db.append_message({ chatId, message: { role: "user", body } });
  }

  const evidence = db.get_recurring_topic_evidence();
  assert.equal(evidence.candidates.length, 0, "casual greetings and check-ins must not become recurring interests");
  assert.ok(evidence.indexedMessages >= 6);
}));

test("conversation summaries are omitted from unrelated topic prompts but retained for relevant and ambiguous follow-ups", () => withDb(db => {
  const chat = db.create_chat({ title: "Sync AI project" });
  db.append_message({ chatId: chat.id, message: { role: "user", body: "We are working on model profiles and memory retrieval." } });
  db.save_conversation_summary({
    chatId: chat.id,
    summary: "The user is building Sync AI Desktop and has been discussing model profiles, memory retrieval and prompt budgets.",
    throughPosition: 0
  });
  assert.equal(db.get_conversation_summary({ chatId: chat.id, query: "How do we adjust model profiles?" }).relevantForQuery, true);
  assert.equal(db.get_conversation_summary({ chatId: chat.id, query: "good morning" }).relevantForQuery, false);
  assert.equal(db.get_conversation_summary({ chatId: chat.id, query: "and then?" }).relevantForQuery, true);
  assert.equal(db.get_conversation_summary({ chatId: chat.id, query: "hey bro" }).relevantForQuery, false);
  assert.equal(db.get_conversation_summary({ chatId: chat.id, query: "Rocket League" }).relevantForQuery, false);
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

test("lists conversation summaries and retrieves relevant summaries without including the active chat", () => withDb(db => {
  const current = db.create_chat({ title: "Current troubleshooting" });
  db.append_message({ chatId: current.id, message: { role: "user", body: "Troubleshoot controller input." } });
  db.save_conversation_summary({ chatId: current.id, summary: "The current conversation is about controller input troubleshooting.", throughPosition: 0 });
  const related = db.create_chat({ title: "Rocket League controller setup" });
  db.append_message({ chatId: related.id, message: { role: "user", body: "Compare controller deadzones." } });
  db.save_conversation_summary({ chatId: related.id, summary: "Rocket League controller setup: adjusted deadzones and tested wired input.", throughPosition: 0 });
  const unrelated = db.create_chat({ title: "Meal planning" });
  db.append_message({ chatId: unrelated.id, message: { role: "user", body: "Plan weekly meals." } });
  db.save_conversation_summary({ chatId: unrelated.id, summary: "A weekly meal plan with vegetarian dinners.", throughPosition: 0 });
  const listed = db.list_conversation_summaries({ query: "Rocket League controller" });
  assert.equal(listed[0].chatId, related.id);
  assert.equal(listed[0].chatTitle, "Rocket League controller setup");
  assert.equal(listed[0].latestPosition, 0);
  const retrieved = db.list_conversation_summary_context({
    query: "Rocket League controller deadzones", currentChatId: current.id, limit: 4
  });
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].chatId, related.id);
  assert.match(retrieved[0].summary, /deadzones/);
  assert.ok(!retrieved.some(item => item.chatId === current.id || item.chatId === unrelated.id));
}));

test("persists validated per-model inference profiles and removes them with their model", () => withDb(db => {
  const registered = db.register_model({
    filePath: "/missing/test-model.gguf", fileName: "test-model.gguf", sizeBytes: 100,
    sha256: "a".repeat(64), name: "Test model"
  }).model;
  assert.equal(db.get_model_profile({ modelId: registered.id }), null);
  const saved = db.save_model_profile({ modelId: registered.id, profile: {
    contextLength: 4096, batchSize: 256, temperature: 0.65, maxOutputTokens: 384
  } });
  assert.equal(saved.contextLength, 4096);
  assert.equal(saved.batchSize, 256);
  assert.equal(saved.temperature, 0.65);
  assert.equal(saved.maxOutputTokens, 384);
  assert.throws(() => db.save_model_profile({ modelId: registered.id, profile: {
    contextLength: 512, batchSize: 1024, temperature: 0.7, maxOutputTokens: 128
  } }), /batch size/);
  db.remove_model({ modelId: registered.id });
  assert.equal(db.db.prepare("SELECT model_id FROM model_profiles WHERE model_id=?").get(registered.id), undefined);
}));
