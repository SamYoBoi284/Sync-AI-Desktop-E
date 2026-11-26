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


test("Stop after the original file is removed automatically restores it from the Recovery Vault", async () => {
  let releaseUnlink;
  let enteredUnlink;
  const entered = new Promise(resolve => { enteredUnlink = resolve; });
  const f = fixture({
    hooks: {
      afterUnlink: () => new Promise(resolve => {
        releaseUnlink = resolve;
        enteredUnlink();
      })
    }
  });
  try {
    const original = path.join(f.root, "already-removed.txt");
    const bytes = "this file must come back when Stop is pressed\n";
    fs.writeFileSync(original, bytes);
    const request = await f.manager.prepareFileRemoval(original);
    const operation = f.manager.approveFileRemoval(request.id);
    await entered;
    assert.equal(f.manager.getStatus().isRunning, true);
    assert.equal(fs.existsSync(original), false);

    const stopping = f.manager.stopActiveAction();
    releaseUnlink();
    const [result, stopResult] = await Promise.all([operation, stopping]);

    assert.equal(result.state, "stopped");
    assert.equal(stopResult.action.state, "stopped");
    assert.equal(fs.readFileSync(original, "utf8"), bytes);
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
    const restoreResult = await f.manager.undoAction(request.id);
    assert.equal(restoreResult.state, "recovery-required");
    assert.match(restoreResult.error, /different file now exists/i);

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

test("Stop during restoration leaves the verified Recovery Vault copy available", async () => {
  let releaseRestore;
  let enteredRestore;
  let shouldPause = true;
  const entered = new Promise(resolve => { enteredRestore = resolve; });
  const f = fixture({
    hooks: {
      beforeRestoreCommit: () => {
        if (!shouldPause) return;
        shouldPause = false;
        return new Promise(resolve => {
          releaseRestore = resolve;
          enteredRestore();
        });
      }
    }
  });
  try {
    const original = path.join(f.root, "restore-stop.txt");
    fs.writeFileSync(original, "restore operation must be cancellable\n");
    const request = await f.manager.prepareFileRemoval(original);
    const completed = await f.manager.approveFileRemoval(request.id);
    assert.equal(completed.state, "completed");
    assert.equal(fs.existsSync(original), false);

    const restoring = f.manager.undoAction(request.id);
    await entered;
    const activeStatus = f.manager.getStatus();
    assert.equal(activeStatus.isRunning, true);
    assert.equal(activeStatus.activeAction.state, "restoring");
    assert.equal(activeStatus.activeAction.fileName, "restore-stop.txt");
    const stopping = f.manager.stopActiveAction();
    releaseRestore();
    const [result, stopResult] = await Promise.all([restoring, stopping]);

    assert.equal(result.state, "completed");
    assert.equal(result.undoable, true);
    assert.equal(stopResult.stopped, true);
    assert.equal(fs.existsSync(original), false);
    assert.equal(fs.existsSync(f.database.get_tool_action({ actionId: request.id }).details.backupPath), true);

    const restored = await f.manager.undoAction(request.id);
    assert.equal(restored.state, "rolled-back");
    assert.equal(fs.readFileSync(original, "utf8"), "restore operation must be cancellable\n");
  } finally {
    f.close();
  }
});

test("startup recovery makes an interrupted restore safely retryable", async () => {
  const f = fixture();
  try {
    const original = path.join(f.root, "retry-restore.txt");
    fs.writeFileSync(original, "recover after restore interruption\n");
    const request = await f.manager.prepareFileRemoval(original);
    const completed = await f.manager.approveFileRemoval(request.id);
    assert.equal(completed.state, "completed");

    const record = f.database.get_tool_action({ actionId: request.id });
    const tempPath = path.join(f.root, "." + path.basename(original) + "." + request.id + ".sync-restore.tmp");
    fs.writeFileSync(tempPath, "incomplete restore\n");
    f.database.save_tool_action({ action: { ...record, state: "restoring", undoable: true } });

    const recovered = await f.manager.recoverInterrupted();
    assert.equal(recovered[0].state, "completed");
    assert.equal(recovered[0].undoable, true);
    assert.equal(fs.existsSync(tempPath), false);
    assert.equal(fs.existsSync(record.details.backupPath), true);
    assert.equal(fs.existsSync(original), false);

    const restored = await f.manager.undoAction(request.id);
    assert.equal(restored.state, "rolled-back");
    assert.equal(fs.readFileSync(original, "utf8"), "recover after restore interruption\n");
  } finally {
    f.close();
  }
});

test("changed file contents after review fail safely without claiming a Recovery Vault copy exists", async () => {
  const f = fixture();
  try {
    const original = path.join(f.root, "changed-after-review.txt");
    fs.writeFileSync(original, "original text\n");
    const request = await f.manager.prepareFileRemoval(original);
    fs.writeFileSync(original, "changed text!!\n");
    const result = await f.manager.approveFileRemoval(request.id);

    assert.equal(result.state, "failed");
    assert.equal(result.undoable, false);
    assert.match(result.error, /changed after the review/i);
    assert.equal(fs.readFileSync(original, "utf8"), "changed text!!\n");
    assert.equal(fs.existsSync(f.database.get_tool_action({ actionId: request.id }).details.backupPath), false);
  } finally {
    f.close();
  }
});
