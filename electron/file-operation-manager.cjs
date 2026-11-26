const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { ActionManager, hashFile, copyFileAndHash, insideDirectory } = require("./action-manager.cjs");

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const stamp = () => new Date().toISOString();
const exists = async value => { try { await fsp.lstat(value); return true; } catch { return false; } };
const abort = () => { const error = new Error("The action was stopped by the user."); error.name = "AbortError"; return error; };
const checkAbort = signal => { if (signal?.aborted) throw abort(); };

class FileOperationManager extends ActionManager {
  publicAction(action) {
    const base = super.publicAction(action);
    if (!base) return null;
    const details = action.details || {};
    return {
      ...base,
      operation: details.operation || (action.toolId === "file.reversible_remove" ? "delete" : null),
      sourcePath: details.sourcePath || details.parentPath || (action.toolId === "file.reversible_remove" ? action.target : null),
      destinationPath: details.destinationPath || null,
      fileName: details.fileName || base.fileName
    };
  }

  isProtected(candidate) {
    const absolute = path.resolve(candidate);
    return path.resolve(this.recoveryDir) === absolute
      || insideDirectory(this.recoveryDir, absolute)
      || this.protectedPaths.some(item => path.resolve(item) === absolute || insideDirectory(item, absolute));
  }

  async prepareFileOperation({ operation, sourcePath = null, destinationPath = null, parentPath = null, folderName = "" } = {}) {
    if (operation === "delete") return this.prepareFileRemoval(sourcePath);
    if (!["copy", "move", "rename", "create-folder"].includes(operation)) throw new Error("Unsupported file operation.");

    const id = crypto.randomUUID();
    const details = { operation, createdAt: stamp() };
    let target;
    let summary;
    let sizeBytes = 0;
    let fileName = "";

    if (operation === "create-folder") {
      if (typeof parentPath !== "string" || !parentPath.trim()) throw new Error("Choose a parent folder first.");
      const parentInput = path.resolve(parentPath);
      const parentStat = await fsp.lstat(parentInput);
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error("The selected parent must be a real directory.");
      const parent = await fsp.realpath(parentInput);
      const name = String(folderName || "").trim();
      if (!name || name.length > 180 || name === "." || name === ".."
        || path.basename(name) !== name || /[<>:"/\\|?*\x00-\x1f]/.test(name)
        || /[ .]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) {
        throw new Error("Enter a valid folder name. Path separators and reserved Windows names are not allowed.");
      }
      target = path.join(parent, name);
      if (this.isProtected(parent) || this.isProtected(target)) throw new Error("Sync's application data and Recovery Vault are protected.");
      if (await exists(target)) throw new Error("A file or folder with that name already exists.");
      details.parentPath = parent;
      details.destinationPath = target;
      details.fileName = name;
      summary = "Create folder " + name;
    } else {
      if (typeof sourcePath !== "string" || !sourcePath.trim()) throw new Error("Choose a source file first.");
      if (typeof destinationPath !== "string" || !destinationPath.trim()) throw new Error("Choose a destination path first.");
      const sourceInput = path.resolve(sourcePath);
      const sourceLstat = await fsp.lstat(sourceInput);
      if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) throw new Error("Only regular files are supported by this operation.");
      const source = await fsp.realpath(sourceInput);
      const sourceStat = await fsp.stat(source);
      if (this.isProtected(source)) throw new Error("Sync's application data and Recovery Vault are protected.");
      if (sourceStat.size > MAX_FILE_BYTES) throw new Error("Files larger than 512 MiB are not supported yet.");

      const destination = path.resolve(destinationPath);
      const parentInput = path.dirname(destination);
      const parentLstat = await fsp.lstat(parentInput);
      if (parentLstat.isSymbolicLink() || !parentLstat.isDirectory()) throw new Error("The destination's parent must be an existing real folder.");
      const parent = await fsp.realpath(parentInput);
      const resolvedDestination = path.join(parent, path.basename(destination));
      if (resolvedDestination !== destination) throw new Error("The destination path traverses a symbolic link. Choose a direct folder path.");
      if (this.isProtected(destination) || this.isProtected(parent)) throw new Error("Sync's application data and Recovery Vault are protected.");
      if (source === destination) throw new Error("The source and destination are the same path.");
      if (operation === "rename" && path.dirname(source) !== path.dirname(destination)) {
        throw new Error("Rename must stay in the original folder. Use Move to choose another folder.");
      }
      if (await exists(destination)) throw new Error("The destination already exists. Sync will not overwrite an existing file.");
      const sha256 = await hashFile(source);
      details.sourcePath = source;
      details.destinationPath = destination;
      details.sha256 = sha256;
      details.sizeBytes = sourceStat.size;
      details.mtimeMs = sourceStat.mtimeMs;
      details.atimeMs = sourceStat.atimeMs;
      details.mode = sourceStat.mode & 0o777;
      details.fileName = path.basename(source);
      details.tempPath = path.join(parent, "." + path.basename(destination) + "." + id + ".sync-copy.tmp");
      target = source;
      sizeBytes = sourceStat.size;
      fileName = path.basename(source);
      summary = operation === "copy" ? "Copy " + fileName
        : operation === "move" ? "Move " + fileName
        : "Rename " + fileName + " to " + path.basename(destination);
    }

    const action = this.save({
      id,
      toolId: "file." + operation,
      summary,
      target,
      state: "awaiting-approval",
      undoable: false,
      details: { ...details, sizeBytes },
      error: null,
      createdAt: stamp(),
      updatedAt: stamp()
    });
    return { ...this.publicAction(action), fileName: fileName || details.fileName || path.basename(target), sizeBytes };
  }

  async approveFileOperation(actionId) {
    const action = this.database.get_tool_action({ actionId });
    if (!action || action.state !== "awaiting-approval") throw new Error("That operation is no longer awaiting approval.");
    if (action.toolId === "file.reversible_remove") return this.approveFileRemoval(actionId);
    if (!["file.copy", "file.move", "file.rename", "file.create-folder"].includes(action.toolId)) {
      throw new Error("That file operation is not supported.");
    }
    if (this.active) throw new Error("Another tool action is already running.");
    const controller = new AbortController();
    const active = { id: actionId, controller, promise: null };
    this.active = active;
    active.promise = this.performFileOperation(action, controller.signal).finally(() => {
      if (this.active === active) this.active = null;
      try { this.onChange({ status: this.getStatus(), action: this.publicAction(this.database.get_tool_action({ actionId })) }); } catch {}
    });
    return active.promise;
  }

  async restoreMovedFile(details, signal = null) {
    const source = details.sourcePath;
    const destination = details.destinationPath;
    if (await exists(source)) {
      if (await exists(destination)
        && (await hashFile(source, signal)) === details.sha256
        && (await hashFile(destination, signal)) === details.sha256) {
        await fsp.unlink(destination);
      } else if (await exists(destination)) {
        throw new Error("The original path is occupied or changed. Sync preserved the destination rather than overwriting data.");
      }
      return true;
    }
    if (!(await exists(destination)) || (await hashFile(destination, signal)) !== details.sha256) {
      throw new Error("The moved file is missing or changed, so Sync cannot safely restore it.");
    }
    try {
      await fsp.rename(destination, source);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      const temp = path.join(path.dirname(source), "." + path.basename(source) + "." + crypto.randomUUID() + ".sync-move-back.tmp");
      try {
        const copied = await copyFileAndHash(destination, temp, signal);
        if (copied !== details.sha256) throw new Error("The move-back copy failed verification.");
        checkAbort(signal);
        if (await exists(source)) throw new Error("The original path became occupied during restoration.");
        await fsp.rename(temp, source);
        if ((await hashFile(source, signal)) !== details.sha256) throw new Error("The restored file failed verification.");
        await fsp.unlink(destination);
      } finally {
        await fsp.rm(temp, { force: true }).catch(() => {});
      }
    }
    return true;
  }

  async performFileOperation(initial, signal) {
    let action = this.save({ ...initial, state: "running", undoable: false, error: null });
    const details = { ...action.details };
    const operation = details.operation;
    let committed = false;
    try {
      checkAbort(signal);
      if (operation === "create-folder") {
        if (await exists(details.destinationPath)) throw new Error("The folder path appeared after review. Nothing was overwritten.");
        await fsp.mkdir(details.destinationPath);
        committed = true;
        checkAbort(signal);
      } else {
        const stat = await fsp.lstat(details.sourcePath);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== details.sizeBytes || stat.mtimeMs !== details.mtimeMs) {
          throw new Error("The source file changed after review. Prepare the operation again.");
        }
        if ((await hashFile(details.sourcePath, signal)) !== details.sha256) throw new Error("The source file contents changed after review.");
        if (await exists(details.destinationPath)) throw new Error("The destination appeared after review. Sync will not overwrite it.");
        if (operation === "copy") {
          const copied = await copyFileAndHash(details.sourcePath, details.tempPath, signal);
          if (copied !== details.sha256 || (await hashFile(details.sourcePath, signal)) !== details.sha256) {
            throw new Error("The source changed during copying. The incomplete copy will be removed.");
          }
          checkAbort(signal);
          if (await exists(details.destinationPath)) throw new Error("The destination appeared while copying. It was not overwritten.");
          await fsp.rename(details.tempPath, details.destinationPath);
          committed = true;
          if ((await hashFile(details.destinationPath)) !== details.sha256) throw new Error("The copied file failed its final SHA-256 verification.");
          checkAbort(signal);
        } else if (operation === "move") {
          try {
            await fsp.rename(details.sourcePath, details.destinationPath);
            committed = true;
          } catch (renameError) {
            if (renameError?.code !== "EXDEV") throw renameError;
            const copied = await copyFileAndHash(details.sourcePath, details.tempPath, signal);
            if (copied !== details.sha256 || (await hashFile(details.sourcePath, signal)) !== details.sha256) {
              throw new Error("The source changed during the cross-drive move. The original was left in place.");
            }
            checkAbort(signal);
            if (await exists(details.destinationPath)) throw new Error("The destination appeared while moving. It was not overwritten.");
            await fsp.rename(details.tempPath, details.destinationPath);
            committed = true;
            if ((await hashFile(details.destinationPath, signal)) !== details.sha256) throw new Error("The destination copy failed verification.");
            checkAbort(signal);
            if ((await hashFile(details.sourcePath, signal)) !== details.sha256) throw new Error("The source changed before the move could finish. Both paths were preserved.");
            await fsp.unlink(details.sourcePath);
          }
          if ((await hashFile(details.destinationPath, signal)) !== details.sha256) {
            throw new Error("The moved file failed its final SHA-256 verification.");
          }
          checkAbort(signal);
        } else {
          await fsp.rename(details.sourcePath, details.destinationPath);
          committed = true;
          if ((await hashFile(details.destinationPath, signal)) !== details.sha256) {
            throw new Error("The renamed file failed its final SHA-256 verification.");
          }
          checkAbort(signal);
        }
      }
      action = this.save({ ...action, state: "completed", undoable: true, details: { ...details, completedAt: stamp() }, error: null });
      return this.publicAction(action);
    } catch (error) {
      const stopped = signal.aborted || error?.name === "AbortError";
      let restored = false;
      let recoveryRequired = false;
      let rollbackError = "";
      if (details.tempPath) await fsp.rm(details.tempPath, { force: true }).catch(() => {});
      try {
        if (operation === "copy" && await exists(details.destinationPath)) {
          if ((await hashFile(details.destinationPath)) === details.sha256) {
            await fsp.unlink(details.destinationPath);
            restored = true;
          } else recoveryRequired = true;
        } else if (["move", "rename"].includes(operation) && await exists(details.destinationPath)) {
          await this.restoreMovedFile(details);
          restored = true;
        } else if (operation === "create-folder" && await exists(details.destinationPath)) {
          await fsp.rmdir(details.destinationPath);
          restored = true;
        } else restored = !committed;
      } catch (rollback) {
        recoveryRequired = true;
        rollbackError = rollback instanceof Error ? rollback.message : String(rollback);
      }
      const finalState = recoveryRequired ? "recovery-required" : stopped ? "stopped" : "failed";
      const message = recoveryRequired
        ? "The operation could not be fully rolled back. Sync preserved the affected path for manual review. " + rollbackError
        : stopped ? "The operation was stopped and its changes were rolled back where possible."
          : (error instanceof Error ? error.message : String(error));
      action = this.save({ ...action, state: finalState, undoable: recoveryRequired, details, error: message });
      return this.publicAction(action);
    }
  }

  async undoAction(actionId) {
    const action = this.database.get_tool_action({ actionId });
    if (!action || action.toolId === "file.reversible_remove") return super.undoAction(actionId);
    if (!["completed", "recovery-required"].includes(action.state) || !action.undoable) throw new Error("That action is not currently undoable.");
    if (this.active) throw new Error("Stop the active action before restoring another file.");
    const controller = new AbortController();
    const active = { id: actionId, controller, promise: null };
    this.active = active;
    active.promise = this.performFileUndo(action, controller.signal).finally(() => {
      if (this.active === active) this.active = null;
      try { this.onChange({ status: this.getStatus(), action: this.publicAction(this.database.get_tool_action({ actionId })) }); } catch {}
    });
    return active.promise;
  }

  async performFileUndo(initial, signal) {
    let action = this.save({ ...initial, state: "restoring", undoable: true, error: null });
    const d = action.details;
    try {
      checkAbort(signal);
      if (d.operation === "copy") {
        if (await exists(d.destinationPath)) {
          if ((await hashFile(d.destinationPath, signal)) !== d.sha256) throw new Error("The copied file has changed. Sync will not delete different data.");
          await fsp.unlink(d.destinationPath);
        }
      } else if (["move", "rename"].includes(d.operation)) {
        if (await exists(d.sourcePath)) {
          if ((await hashFile(d.sourcePath, signal)) === d.sha256 && !(await exists(d.destinationPath))) {
            action = this.save({ ...action, state: "rolled-back", undoable: false, details: { ...d, restoredAt: stamp() }, error: null });
            return this.publicAction(action);
          }
          throw new Error("The original path is occupied. Sync will not overwrite it.");
        }
        if (!(await exists(d.destinationPath)) || (await hashFile(d.destinationPath, signal)) !== d.sha256) {
          throw new Error("The moved file is missing or has changed, so it cannot be safely restored.");
        }
        await this.restoreMovedFile(d, signal);
      } else if (d.operation === "create-folder") {
        if (await exists(d.destinationPath)) await fsp.rmdir(d.destinationPath);
      } else throw new Error("Unsupported undo operation.");
      action = this.save({ ...action, state: "rolled-back", undoable: false, details: { ...d, restoredAt: stamp() }, error: null });
      return this.publicAction(action);
    } catch (error) {
      const stopped = signal.aborted || error?.name === "AbortError";
      action = this.save({
        ...action,
        state: stopped ? "recovery-required" : "recovery-required",
        undoable: true,
        error: stopped ? "Restore was stopped. The remaining destination was preserved for retry or manual review." : (error instanceof Error ? error.message : String(error))
      });
      return this.publicAction(action);
    }
  }

  async recoverInterrupted() {
    const recovered = await super.recoverInterrupted();
    const interrupted = this.database.list_tool_actions({ limit: 500 })
      .filter(action => ["running", "restoring"].includes(action.state) && action.toolId !== "file.reversible_remove");
    for (let action of interrupted) {
      const d = action.details || {};
      let state = "stopped";
      let undoable = false;
      let error = "Sync restarted during the operation. Any incomplete work was cleaned up where safe.";
      try {
        if (d.tempPath) await fsp.rm(d.tempPath, { force: true });
        if (d.operation === "copy" && await exists(d.destinationPath)) {
          const sourceStillMatches = await exists(d.sourcePath) && (await hashFile(d.sourcePath)) === d.sha256;
          if (sourceStillMatches && (await hashFile(d.destinationPath)) === d.sha256) await fsp.unlink(d.destinationPath);
          else { state = "recovery-required"; undoable = true; error = "Sync could not verify the original source of the interrupted copy. The destination was preserved."; }
        } else if (["move", "rename"].includes(d.operation) && await exists(d.destinationPath)) {
          await this.restoreMovedFile(d);

        } else if (d.operation === "create-folder" && await exists(d.destinationPath)) {
          await fsp.rmdir(d.destinationPath).catch(() => { state = "recovery-required"; undoable = true; error = "The created folder is no longer empty. Sync preserved it."; });
        }
      } catch (cause) {
        state = "recovery-required"; undoable = true;
        error = "Startup recovery needs attention: " + (cause instanceof Error ? cause.message : String(cause));
      }
      action = this.save({ ...action, state, undoable, error });
      recovered.push(this.publicAction(action));
    }
    return recovered;
  }
}

module.exports = { FileOperationManager };
