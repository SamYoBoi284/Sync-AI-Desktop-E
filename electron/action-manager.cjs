const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const TOOL_ID = "file.reversible_remove";
const now = () => new Date().toISOString();
const exists = async filePath => {
  try { await fsp.access(filePath); return true; }
  catch { return false; }
};
const abortError = () => {
  const error = new Error("The action was stopped by the user.");
  error.name = "AbortError";
  return error;
};
const throwIfAborted = signal => {
  if (signal?.aborted) throw abortError();
};

async function hashFile(filePath, signal = null) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath, signal ? { signal } : {});
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function copyFileAndHash(source, destination, signal = null, onCreated = null) {
  const hash = crypto.createHash("sha256");
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
  output.once("open", () => { try { onCreated?.(); } catch {} });
  await pipeline(
    fs.createReadStream(source, signal ? { signal } : {}),
    hasher,
    output,
    signal ? { signal } : {}
  );
  return hash.digest("hex");
}

function insideDirectory(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

class ActionManager {
  constructor({ database, recoveryDir, onChange = () => {}, hooks = {} }) {
    if (!database) throw new Error("ActionManager requires the local database.");
    if (!recoveryDir) throw new Error("ActionManager requires a Recovery Vault directory.");
    this.database = database;
    this.recoveryDir = path.resolve(recoveryDir);
    this.onChange = onChange;
    this.hooks = hooks;
    this.active = null;
  }

  publicAction(action) {
    if (!action) return null;
    return {
      id: action.id,
      toolId: action.toolId,
      summary: action.summary,
      target: action.target,
      state: action.state,
      undoable: Boolean(action.undoable),
      error: action.error || null,
      fileName: action.details?.fileName || path.basename(action.target || ""),
      sizeBytes: Number(action.details?.sizeBytes || 0),
      createdAt: action.createdAt,
      updatedAt: action.updatedAt
    };
  }

  save(action) {
    const saved = this.database.save_tool_action({ action: { ...action, updatedAt: now() } });
    try {
      this.onChange({
        status: this.getStatus(),
        action: this.publicAction(saved)
      });
    } catch {}
    return saved;
  }

  getStatus() {
    const action = this.active
      ? this.database.get_tool_action({ actionId: this.active.id })
      : null;
    return {
      isRunning: action?.state === "running" || action?.state === "restoring",
      activeAction: ["running", "restoring"].includes(action?.state) ? this.publicAction(action) : null
    };
  }

  listHistory(limit = 100) {
    return this.database.list_tool_actions({ limit }).map(action => this.publicAction(action));
  }

  async prepareFileRemoval(selectedPath) {
    if (typeof selectedPath !== "string" || !selectedPath.trim()) throw new Error("Choose a file first.");
    const selectedStat = await fsp.lstat(selectedPath);
    if (selectedStat.isSymbolicLink()) throw new Error("Symbolic links cannot be moved by this tool. Choose the actual file instead.");
    if (!selectedStat.isFile()) throw new Error("Only individual files are supported. Folders and special files are not allowed.");
    const filePath = await fsp.realpath(selectedPath);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("The selected item is not a regular file.");
    if (stat.size > MAX_FILE_BYTES) throw new Error("Files larger than 512 MiB are not supported by the reversible file tool.");

    await fsp.mkdir(this.recoveryDir, { recursive: true });
    const id = crypto.randomUUID();
    const fileName = path.basename(filePath);
    const previewHash = await hashFile(filePath);
    const details = {
      fileName,
      sha256: previewHash,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      atimeMs: stat.atimeMs,
      mode: stat.mode & 0o777,
      backupPath: path.join(this.recoveryDir, id + ".recovery"),
      partialPath: path.join(this.recoveryDir, id + ".partial")
    };
    const action = this.save({
      id,
      toolId: TOOL_ID,
      summary: "Move " + fileName + " into the Sync AI Recovery Vault",
      target: filePath,
      state: "awaiting-approval",
      undoable: false,
      details,
      error: null,
      createdAt: now(),
      updatedAt: now()
    });
    return this.publicAction(action);
  }

  async cancelFileRemoval(actionId) {
    const action = this.database.get_tool_action({ actionId });
    if (!action || action.state !== "awaiting-approval") throw new Error("That approval request is no longer pending.");
    const updated = this.save({ ...action, state: "cancelled", undoable: false, error: null });
    return this.publicAction(updated);
  }

  async approveFileRemoval(actionId) {
    if (this.active) throw new Error("Another tool action is already running.");
    const action = this.database.get_tool_action({ actionId });
    if (!action || action.toolId !== TOOL_ID || action.state !== "awaiting-approval") {
      throw new Error("That file action is not awaiting approval.");
    }
    const controller = new AbortController();
    const active = { id: actionId, controller, promise: null };
    this.active = active;
    active.promise = this.performFileRemoval(action, controller.signal).finally(() => {
      if (this.active === active) this.active = null;
      try { this.onChange({ status: this.getStatus(), action: this.publicAction(this.database.get_tool_action({ actionId })) }); } catch {}
    });
    return active.promise;
  }

  async performFileRemoval(initialAction, signal) {
    let action = initialAction;
    let details = { ...action.details };
    try {
      throwIfAborted(signal);
      action = this.save({ ...action, state: "running", undoable: false, error: null });
      const currentStat = await fsp.lstat(action.target);
      if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
        throw new Error("The selected path is no longer a regular file. Nothing was changed.");
      }
      if (currentStat.size !== details.sizeBytes || currentStat.mtimeMs !== details.mtimeMs) {
        throw new Error("The selected file changed after the review. Nothing was changed. Prepare the action again.");
      }
      const originalHash = await hashFile(action.target, signal);
      if (details.sha256 && details.sha256 !== originalHash) {
        throw new Error("The selected file contents changed after the review. Nothing was changed. Prepare the action again.");
      }
      details.sha256 = originalHash;
      action = this.save({ ...action, details });

      await fsp.mkdir(this.recoveryDir, { recursive: true });
      const copiedHash = await copyFileAndHash(action.target, details.partialPath, signal);
      const sourceHashAfterCopy = await hashFile(action.target, signal);
      if (copiedHash !== originalHash || sourceHashAfterCopy !== originalHash) {
        throw new Error("The file changed while its recovery copy was being verified. The original was left untouched.");
      }
      throwIfAborted(signal);

      if (await exists(details.backupPath)) throw new Error("A Recovery Vault entry with this identifier already exists.");
      await fsp.rename(details.partialPath, details.backupPath);
      action = this.save({ ...action, details });

      if (typeof this.hooks.afterBackup === "function") await this.hooks.afterBackup({ action: this.publicAction(action) });
      throwIfAborted(signal);

      const removalStat = await fsp.lstat(action.target);
      if (removalStat.isSymbolicLink() || !removalStat.isFile()
        || removalStat.dev !== currentStat.dev
        || removalStat.ino !== currentStat.ino
        || removalStat.size !== details.sizeBytes
        || removalStat.mtimeMs !== details.mtimeMs
        || (await hashFile(action.target, signal)) !== details.sha256) {
        throw new Error("The selected path changed during the operation. The original file was left untouched and the recovery copy was preserved.");
      }
      throwIfAborted(signal);
      await fsp.unlink(action.target);
      if (typeof this.hooks.afterUnlink === "function") {
        await this.hooks.afterUnlink({ action: this.publicAction(action), signal });
      }
      throwIfAborted(signal);

      action = this.save({
        ...action,
        state: "completed",
        undoable: true,
        details: { ...details, removedAt: now() },
        error: null
      });
      return this.publicAction(action);
    } catch (error) {
      const wasStopped = signal.aborted || error?.name === "AbortError";
      let finalState = wasStopped ? "stopped" : "failed";
      let finalError = wasStopped ? null : (error instanceof Error ? error.message : String(error));
      let keepRecoveryCopy = false;

      const originalExists = await exists(action.target);
      const backupExists = details.backupPath
        ? insideDirectory(this.recoveryDir, details.backupPath) && await exists(details.backupPath)
        : false;

      if (originalExists) {
        let originalIsUnchanged = false;
        if (details.sha256) {
          try { originalIsUnchanged = (await hashFile(action.target)) === details.sha256; } catch {}
        }
        if (originalIsUnchanged) {
          if (backupExists) await fsp.rm(details.backupPath, { force: true }).catch(() => {});
          if (!wasStopped && !finalError) finalError = null;
        } else if (backupExists) {
          finalState = "recovery-required";
          finalError = "The original path now contains different data. Sync preserved the verified Recovery Vault copy instead of overwriting anything: " + details.backupPath;
          keepRecoveryCopy = true;
        } else {
          finalState = "failed";
          finalError = wasStopped
            ? "The action was stopped before a verified recovery copy existed. The original file was left untouched."
            : (error instanceof Error ? error.message : "The selected file changed before a recovery copy was made. The original path was left untouched.");
        }
      } else if (backupExists && details.sha256) {
        try {
          await this.restoreFromBackup(action, details);
          finalState = wasStopped ? "stopped" : "failed";
          await fsp.rm(details.backupPath, { force: true });
        } catch (restoreError) {
          finalState = "recovery-required";
          finalError = "The action stopped after the original path was removed, and automatic restoration needs attention. Recovery copy: " + details.backupPath + ". " + (restoreError instanceof Error ? restoreError.message : String(restoreError));
          keepRecoveryCopy = true;
        }
      } else {
        finalState = "recovery-required";
        finalError = "The original file is missing and no verified Recovery Vault copy could be restored. Inspect the Recovery Vault before taking further action.";
        keepRecoveryCopy = backupExists;
      }

      if (details.partialPath && insideDirectory(this.recoveryDir, details.partialPath)) {
        await fsp.rm(details.partialPath, { force: true }).catch(() => {});
      }
      action = this.save({
        ...action,
        state: finalState,
        undoable: keepRecoveryCopy && await exists(details.backupPath),
        details,
        error: finalError
      });
      return this.publicAction(action);
    }
  }

  async restoreFromBackup(action, details, signal = null) {
    const backupPath = details.backupPath;
    if (!backupPath || !insideDirectory(this.recoveryDir, backupPath)) {
      throw new Error("The Recovery Vault path is invalid.");
    }
    if (!details.sha256 || !(await exists(backupPath))) throw new Error("The verified Recovery Vault copy is unavailable.");
    if ((await hashFile(backupPath, signal)) !== details.sha256) throw new Error("The Recovery Vault copy failed its SHA-256 check.");

    throwIfAborted(signal);
    const parent = path.dirname(action.target);
    const parentStat = await fsp.stat(parent);
    if (!parentStat.isDirectory()) throw new Error("The original parent folder is no longer available.");
    if (await exists(action.target)) {
      if ((await hashFile(action.target, signal)) === details.sha256) return true;
      throw new Error("A different file now exists at the original path. Sync did not overwrite it; the Recovery Vault copy was preserved.");
    }

    const tempPath = path.join(parent, "." + path.basename(action.target) + "." + action.id + ".sync-restore.tmp");
    let tempCreated = false;
    try {
      const copiedHash = await copyFileAndHash(backupPath, tempPath, signal, () => { tempCreated = true; });
      if (copiedHash !== details.sha256) throw new Error("The temporary restore copy failed verification.");
      throwIfAborted(signal);
      if (typeof this.hooks.beforeRestoreCommit === "function") {
        await this.hooks.beforeRestoreCommit({ action: this.publicAction(action), signal });
      }
      throwIfAborted(signal);
      await fsp.chmod(tempPath, Number(details.mode) || 0o600).catch(() => {});
      if (Number.isFinite(details.atimeMs) && Number.isFinite(details.mtimeMs)) {
        await fsp.utimes(tempPath, new Date(details.atimeMs), new Date(details.mtimeMs)).catch(() => {});
      }

      try {
        await fsp.link(tempPath, action.target);
      } catch (error) {
        if (error?.code === "EEXIST") throw new Error("A file appeared at the original path during restoration. It was not overwritten.");
        if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(error?.code)) throw error;
        await fsp.copyFile(tempPath, action.target, fs.constants.COPYFILE_EXCL);
      }

      if ((await hashFile(action.target)) !== details.sha256) {
        throw new Error("The restored file did not pass verification. The Recovery Vault copy was preserved.");
      }
      return true;
    } catch (error) {
      if (tempCreated) await fsp.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      if (tempCreated) await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  async undoAction(actionId) {
    if (this.active) throw new Error("Stop the active action before restoring another file.");
    const action = this.database.get_tool_action({ actionId });
    if (!action || !["completed", "recovery-required"].includes(action.state) || !action.undoable) {
      throw new Error("That action is not currently undoable.");
    }
    const controller = new AbortController();
    const active = { id: actionId, controller, promise: null };
    this.active = active;
    active.promise = this.performUndo(action, controller.signal).finally(() => {
      if (this.active === active) this.active = null;
      try { this.onChange({ status: this.getStatus(), action: this.publicAction(this.database.get_tool_action({ actionId })) }); } catch {}
    });
    return active.promise;
  }

  async performUndo(initialAction, signal) {
    let action = this.save({ ...initialAction, state: "restoring", undoable: true, error: null });
    try {
      await this.restoreFromBackup(action, action.details, signal);
      action = this.save({
        ...action,
        state: "rolled-back",
        undoable: false,
        details: { ...action.details, restoredAt: now() },
        error: null
      });
      await fsp.rm(action.details.backupPath, { force: true }).catch(() => {});
      return this.publicAction(action);
    } catch (error) {
      const originalExists = await exists(action.target);
      let originalMatches = false;
      if (originalExists && action.details.sha256) {
        try { originalMatches = (await hashFile(action.target)) === action.details.sha256; } catch {}
      }
      if (originalMatches) {
        action = this.save({
          ...action,
          state: "rolled-back",
          undoable: false,
          details: { ...action.details, restoredAt: now() },
          error: null
        });
        await fsp.rm(action.details.backupPath, { force: true }).catch(() => {});
        return this.publicAction(action);
      }

      if (signal.aborted || error?.name === "AbortError") {
        let recoveryAvailable = false;
        try {
          recoveryAvailable = Boolean(action.details.backupPath)
            && insideDirectory(this.recoveryDir, action.details.backupPath)
            && (await hashFile(action.details.backupPath)) === action.details.sha256;
        } catch {}
        action = this.save({
          ...action,
          state: recoveryAvailable ? "completed" : "recovery-required",
          undoable: recoveryAvailable,
          error: recoveryAvailable
            ? "Restore stopped before the original file was put back. The verified Recovery Vault copy is intact and can be restored again."
            : "Restore was stopped, but the Recovery Vault copy could not be verified. Manual recovery is required."
        });
        return this.publicAction(action);
      }

      action = this.save({
        ...action,
        state: "recovery-required",
        undoable: Boolean(await exists(action.details.backupPath)),
        error: error instanceof Error ? error.message : String(error)
      });
      return this.publicAction(action);
    }
  }

  async stopActiveAction() {
    const active = this.active;
    if (!active) return { stopped: false, status: this.getStatus() };
    active.controller.abort();
    const action = await active.promise;
    return { stopped: true, action, status: this.getStatus() };
  }

  async recoverInterrupted() {
    const interrupted = this.database.list_tool_actions({ limit: 500 })
      .filter(action => ["running", "restoring"].includes(action.state));
    const recovered = [];
    for (let action of interrupted) {
      const details = action.details || {};
      const originalExists = await exists(action.target);
      const backupExists = details.backupPath
        && insideDirectory(this.recoveryDir, details.backupPath)
        && await exists(details.backupPath);

      if (action.state === "restoring") {
        const tempPath = path.join(path.dirname(action.target), "." + path.basename(action.target) + "." + action.id + ".sync-restore.tmp");
        if (originalExists && details.sha256) {
          let matches = false;
          try { matches = (await hashFile(action.target)) === details.sha256; } catch {}
          if (matches) {
            if (backupExists) await fsp.rm(details.backupPath, { force: true }).catch(() => {});
            await fsp.rm(tempPath, { force: true }).catch(() => {});
            action = this.save({ ...action, state: "rolled-back", undoable: false, details: { ...details, restoredAt: now() }, error: "Sync restarted after the original file had been restored and verified." });
          } else {
            await fsp.rm(tempPath, { force: true }).catch(() => {});
            action = this.save({ ...action, state: "recovery-required", undoable: Boolean(backupExists), error: "Sync restarted while restoring, but the original path contains different data. Any Recovery Vault copy was preserved." });
          }
        } else if (!originalExists && backupExists) {
          await fsp.rm(tempPath, { force: true }).catch(() => {});
          action = this.save({ ...action, state: "completed", undoable: true, error: "Restore was interrupted by application shutdown. The verified Recovery Vault copy remains available; retry restoration from Action history." });
        } else {
          action = this.save({ ...action, state: "recovery-required", undoable: false, error: "Sync restarted during restoration and could not find a verified original or Recovery Vault copy. Manual inspection is required." });
        }
        recovered.push(this.publicAction(action));
        continue;
      }

      if (originalExists) {
        let unchanged = false;
        if (details.sha256) {
          try { unchanged = (await hashFile(action.target)) === details.sha256; } catch {}
        }
        if (unchanged) {
          if (backupExists) await fsp.rm(details.backupPath, { force: true }).catch(() => {});
          if (details.partialPath && insideDirectory(this.recoveryDir, details.partialPath)) await fsp.rm(details.partialPath, { force: true }).catch(() => {});
          action = this.save({ ...action, state: "stopped", undoable: false, error: "Sync restarted before the file operation completed. The original file was verified and left in place." });
        } else if (backupExists) {
          action = this.save({ ...action, state: "recovery-required", undoable: true, error: "Sync restarted and the original path contains data different from the reviewed file. The verified Recovery Vault copy was preserved." });
        } else {
          action = this.save({ ...action, state: "failed", undoable: false, error: "Sync restarted before a verified recovery copy was created. The original path remains in place." });
        }
      } else if (backupExists && details.sha256) {
        try {
          await this.restoreFromBackup(action, details);
          action = this.save({ ...action, state: "rolled-back", undoable: false, details: { ...details, restoredAt: now() }, error: "Sync restarted during the operation and restored the original file from its verified Recovery Vault copy." });
          await fsp.rm(details.backupPath, { force: true }).catch(() => {});
          if (details.partialPath && insideDirectory(this.recoveryDir, details.partialPath)) await fsp.rm(details.partialPath, { force: true }).catch(() => {});
        } catch (error) {
          action = this.save({ ...action, state: "recovery-required", undoable: true, error: "Automatic startup recovery needs attention: " + (error instanceof Error ? error.message : String(error)) });
        }
      } else {
        action = this.save({ ...action, state: "recovery-required", undoable: false, error: "Sync restarted during a file operation, but no verified Recovery Vault copy was found. Manual inspection is required." });
      }
      recovered.push(this.publicAction(action));
    }
    return recovered;
  }}

module.exports = { ActionManager, hashFile, copyFileAndHash, insideDirectory };