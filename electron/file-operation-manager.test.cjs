const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SyncDatabase } = require("./database.cjs");
const { FileOperationManager } = require("./file-operation-manager.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-file-ops-"));
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(targetDir);
  const database = new SyncDatabase(path.join(root, "test.sqlite3"));
  const manager = new FileOperationManager({ database, recoveryDir: path.join(root, "recovery-vault"), protectedPaths: [path.join(root, "app-data")] });
  return { root, sourceDir, targetDir, database, manager, close() { database.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test("copy operation creates a verified destination and undo removes only that copy", async () => {
  const f = fixture();
  try {
    const source = path.join(f.sourceDir, "notes.txt");
    const destination = path.join(f.targetDir, "notes.txt");
    fs.writeFileSync(source, "copy me");
    const prepared = await f.manager.prepareFileOperation({ operation: "copy", sourcePath: source, destinationPath: destination });
    assert.equal(prepared.state, "awaiting-approval");
    const completed = await f.manager.approveFileOperation(prepared.id);
    assert.equal(completed.state, "completed");
    assert.equal(fs.readFileSync(destination, "utf8"), "copy me");
    const undone = await f.manager.undoAction(prepared.id);
    assert.equal(undone.state, "rolled-back");
    assert.equal(fs.existsSync(destination), false);
    assert.equal(fs.readFileSync(source, "utf8"), "copy me");
  } finally { f.close(); }
});

test("rename operation is reversible and refuses an occupied destination", async () => {
  const f = fixture();
  try {
    const source = path.join(f.sourceDir, "before.txt");
    const destination = path.join(f.sourceDir, "after.txt");
    fs.writeFileSync(source, "rename me");
    fs.writeFileSync(destination, "do not overwrite");
    await assert.rejects(f.manager.prepareFileOperation({ operation: "rename", sourcePath: source, destinationPath: destination }), /already exists/);
    fs.unlinkSync(destination);
    const prepared = await f.manager.prepareFileOperation({ operation: "rename", sourcePath: source, destinationPath: destination });
    const completed = await f.manager.approveFileOperation(prepared.id);
    assert.equal(completed.state, "completed");
    assert.equal(fs.existsSync(source), false);
    const undone = await f.manager.undoAction(prepared.id);
    assert.equal(undone.state, "rolled-back");
    assert.equal(fs.readFileSync(source, "utf8"), "rename me");
  } finally { f.close(); }
});

test("move operation moves a file and can put it back", async () => {
  const f = fixture();
  try {
    const source = path.join(f.sourceDir, "move.txt");
    const destination = path.join(f.targetDir, "move.txt");
    fs.writeFileSync(source, "move me");
    const prepared = await f.manager.prepareFileOperation({ operation: "move", sourcePath: source, destinationPath: destination });
    assert.equal((await f.manager.approveFileOperation(prepared.id)).state, "completed");
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(destination, "utf8"), "move me");
    assert.equal((await f.manager.undoAction(prepared.id)).state, "rolled-back");
    assert.equal(fs.readFileSync(source, "utf8"), "move me");
  } finally { f.close(); }
});

test("create-folder operation only removes the new folder when empty", async () => {
  const f = fixture();
  try {
    const prepared = await f.manager.prepareFileOperation({ operation: "create-folder", parentPath: f.targetDir, folderName: "New Folder" });
    assert.equal((await f.manager.approveFileOperation(prepared.id)).state, "completed");
    assert.equal(fs.statSync(path.join(f.targetDir, "New Folder")).isDirectory(), true);
    fs.writeFileSync(path.join(f.targetDir, "New Folder", "keep.txt"), "user data");
    const failedUndo = await f.manager.undoAction(prepared.id);
    assert.equal(failedUndo.state, "recovery-required");
    assert.equal(fs.existsSync(path.join(f.targetDir, "New Folder", "keep.txt")), true);
  } finally { f.close(); }
});
