const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SyncDatabase } = require("./database.cjs");
const { ActionManager, hashFile } = require("./action-manager.cjs");

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-ai-action-test-"));
  const database = new SyncDatabase(path.join(root, "test.sqlite3"));
  const recoveryDir = path.join(root, "recovery-vault");
  const manager = new ActionManager({ database, recoveryDir, ...options });
  return {
    root, database, recoveryDir, manager,
    close() {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test("approved file removal verifies a recovery copy and can restore the original", async () => {
  const f = fixture();
  try {
    const original = path.join(f.root, "notes.txt");
    fs.writeFileSync(original, "important user data\n");
    const request = await f.manager.prepareFileRemoval(original);
    assert.equal(request.state, "awaiting-approval");
    assert.equal(fs.readFileSync(original, "utf8"), "important user data\n");

    const completed = await f.manager.approveFileRemoval(request.id);
    assert.equal(completed.state, "completed");
    assert.equal(completed.undoable, true);
    assert.equal(fs.existsSync(original), false);

    const restored = await f.manager.undoAction(request.id);
    assert.equal(restored.state, "rolled-back");
    assert.equal(restored.undoable, false);
    assert.equal(fs.readFileSync(original, "utf8"), "important user data\n");
  } finally {
    f.close();
  }
});

test("Stop during a reversible removal cancels before unlink and preserves the original", async () => {
  let releaseBackup;
  let enteredBackup;
  const entered = new Promise(resolve => { enteredBackup = resolve; });
  const f = fixture({
    hooks: {
      afterBackup: () => new Promise(resolve => {
        releaseBackup = resolve;
        enteredBackup();
      })
    }
  });
  try {
    const original = path.join(f.root, "stop-me.txt");
    fs.writeFileSync(original, "do not lose this\n");
    const request = await f.manager.prepareFileRemoval(original);
    const operation = f.manager.approveFileRemoval(request.id);
    await entered;
    assert.equal(f.manager.getStatus().isRunning, true);

    const stopping = f.manager.stopActiveAction();
    releaseBackup();
    const [result, stopResult] = await Promise.all([operation, stopping]);

    assert.equal(result.state, "stopped");
    assert.equal(stopResult.stopped, true);
    assert.equal(fs.readFileSync(original, "utf8"), "do not lose this\n");
    assert.equal(fs.existsSync(path.join(f.recoveryDir, request.id + ".recovery")), false);
    assert.equal(f.manager.getStatus().isRunning, false);
  } finally {
    f.close();
  }
});

test("startup recovery restores a file if the app stopped after removing its original path", async () => {
  const f = fixture();
  try {
    const original = path.join(f.root, "interrupted.txt");
    const bytes = "restore me after restart\n";
    fs.writeFileSync(original, bytes);
    const request = await f.manager.prepareFileRemoval(original);
    const record = f.database.get_tool_action({ actionId: request.id });
    const vaultPath = record.details.backupPath;
    fs.copyFileSync(original, vaultPath);
    fs.unlinkSync(original);

    f.database.save_tool_action({
      action: {
        ...record,
        state: "running",
        undoable: false,
        details: { ...record.details, sha256: await hashFile(vaultPath) }
      }
    });

    const recovered = await f.manager.recoverInterrupted();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].state, "rolled-back");
    assert.equal(fs.readFileSync(original, "utf8"), bytes);
    assert.equal(fs.existsSync(vaultPath), false);
  } finally {
    f.close();
  }
});

test("undo never overwrites a different file created at the original path", async () => {
  const f = fixture();
  try {
    const original = path.join(f.root, "collision.txt");
    fs.writeFileSync(original, "the original\n");
    const request = await f.manager.prepareFileRemoval(original);
    const completed = await f.manager.approveFileRemoval(request.id);
    assert.equal(completed.state, "completed");

    fs.writeFileSync(original, "a different file\n");
    await assert.rejects(f.manager.undoAction(request.id), /different file now exists/i);

    const saved = f.database.get_tool_action({ actionId: request.id });
    assert.equal(saved.state, "recovery-required");
    assert.equal(saved.undoable, true);
    assert.equal(fs.readFileSync(original, "utf8"), "a different file\n");
    assert.equal(fs.existsSync(saved.details.backupPath), true);
  } finally {
    f.close();
  }
});

test("file tool rejects folders and never creates a pending action for them", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.manager.prepareFileRemoval(f.root), /individual files/i);
    assert.equal(f.manager.listHistory().length, 0);
  } finally {
    f.close();
  }
});