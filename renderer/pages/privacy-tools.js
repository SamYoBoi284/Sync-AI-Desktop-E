(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtBytes, fmtDate } = window.SyncAI.shared;

async function mountPrivacyTools(root) {
  let actions = [];
  let loading = true;
  let busyId = null;
  let preparing = false;
  let error = "";
  let notice = "";
  let status = { isRunning: false, activeAction: null };
  let disposed = false;

  const stateLabel = state => ({
    "awaiting-approval": "AWAITING YOUR APPROVAL",
    running: "RUNNING",
    restoring: "RESTORING FILE",
    completed: "COMPLETED · UNDO AVAILABLE",
    "rolled-back": "RESTORED",
    stopped: "STOPPED · ORIGINAL PRESERVED",
    cancelled: "REQUEST CANCELLED",
    failed: "FAILED · ORIGINAL PRESERVED",
    "recovery-required": "RECOVERY NEEDS ATTENTION"
  }[state] || String(state || "UNKNOWN").toUpperCase());

  function renderAction(action) {
    const controls = action.state === "awaiting-approval"
      ? '<button type="button" data-tool-action="approve" data-id="' + esc(action.id) + '" ' + (busyId ? "disabled" : "") + '>Review &amp; approve</button><button type="button" class="is-muted" data-tool-action="cancel" data-id="' + esc(action.id) + '" ' + (busyId ? "disabled" : "") + '>Cancel request</button>'
      : ["completed", "recovery-required"].includes(action.state) && action.undoable
        ? '<button type="button" data-tool-action="undo" data-id="' + esc(action.id) + '" ' + (busyId ? "disabled" : "") + '>' + (action.state === "recovery-required" ? "Retry restore" : "Undo &amp; restore file") + '</button>'
        : "";
    return '<article class="privacy-action-card">' +
      '<div class="privacy-action-main">' +
        '<div class="privacy-action-title"><strong>' + esc(action.fileName || action.summary) + '</strong><span class="privacy-action-state is-' + esc(action.state) + '">' + esc(stateLabel(action.state)) + '</span></div>' +
        '<p>' + esc(action.summary) + '</p>' +
        '<small class="privacy-action-target">' + esc(action.target) + '</small>' +
        '<small>' + fmtBytes(action.sizeBytes || 0) + ' · ' + esc(fmtDate(action.updatedAt)) + '</small>' +
        (action.error ? '<p class="privacy-action-error">' + esc(action.error) + '</p>' : '') +
        (controls ? '<div class="privacy-action-controls">' + controls + '</div>' : '') +
      '</div></article>';
  }

  function render() {
    if (disposed) return;
    root.innerHTML =
      '<section class="shell-page shell-standard-page privacy-tools-page">' +
        '<div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>USER CONTROL AND LOCAL DATA</div>' +
        '<div class="shell-page-heading-row"><div><p class="shell-section-kicker">PHASE 6 · SAFETY FOUNDATION</p><h1>Privacy &amp; Tools<span>.</span></h1>' +
          '<p class="shell-page-description">See what Sync can access, which actions require approval, and what can be restored.</p></div>' +
          '<span class="shell-large-status ' + (status.isRunning ? "is-warning" : "is-connected") + '"><span></span>' + (status.isRunning ? "ACTION IN PROGRESS" : "NO ACTIVE ACTION") + '</span></div>' +
        (notice ? '<p class="privacy-feedback" role="status">' + esc(notice) + '</p>' : '') +
        (error ? '<p class="privacy-feedback is-error" role="alert">' + esc(error) + '</p>' : '') +
        '<div class="privacy-policy-grid">' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">⌂</span><strong>Local-first storage</strong><p>Chats, settings, tasks, notes, model registrations and action history are stored in the app\'s local data folder.</p><small>NO CLOUD SYNC CONNECTED</small></article>' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">◈</span><strong>Explicit file access</strong><p>The File Library stores selected paths and SHA-256 fingerprints. It does not read file contents into chat.</p><small>NO AUTOMATIC FILE SCANNING</small></article>' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">⊙</span><strong>Approval before action</strong><p>The available file action starts from a native picker and waits for a separate approval in this page. Restore operations can also be stopped safely.</p><small>NO SILENT APPROVALS</small></article>' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">↶</span><strong>Stop &amp; restore</strong><p>Stop cancels the active file operation and attempts to restore its original file. Completed removals can be undone from the history below.</p><small>VERIFIED RECOVERY COPIES</small></article>' +
        '</div>' +
        '<section class="shell-settings-panel privacy-tools-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">CURRENT TOOL BOUNDARIES</p><h2>Available tools</h2></div><span class="shell-panel-tag">NARROW ACCESS</span></div>' +
          '<div class="privacy-tool-row"><div><strong>Reversible file removal</strong><p>Moves one individually selected file (up to 512 MiB) into the private Recovery Vault after explicit approval. The file is verified before its original path is removed.</p></div><span class="privacy-tool-state">MANUAL APPROVAL</span></div>' +
          '<div class="privacy-tool-row"><div><strong>AI-requested tool calls</strong><p>The local model is not yet connected to the tool registry. It cannot initiate file operations or other host actions from chat in this build.</p></div><span class="privacy-tool-state is-planned">NOT CONNECTED</span></div>' +
          '<p class="shell-settings-footnote">No terminal, shell, clipboard, process-control, browser automation, folder deletion or unrestricted filesystem tool is exposed. Permanent deletion is not part of this tool.</p>' +
          '<div class="privacy-tool-launch"><div><strong>Prepare a reversible file action</strong><p>Choose one regular file. Sync will show the exact path and wait for your separate approval before moving it.</p></div>' +
            '<button type="button" data-tool-action="prepare" ' + (preparing || busyId || status.isRunning ? "disabled" : "") + '>' + (preparing ? "Opening file picker…" : "Choose file to review") + '</button></div>' +
        '</section>' +
        '<section class="privacy-history-section"><div class="privacy-history-heading"><div><p class="shell-section-kicker">PERSISTENT LOCAL JOURNAL</p><h2>Action history</h2></div><button type="button" data-tool-action="refresh" ' + (loading ? "disabled" : "") + '>Refresh</button></div>' +
          (loading ? '<p class="privacy-history-empty">Loading action history…</p>' : actions.length ? '<div class="privacy-action-list">' + actions.map(renderAction).join("") + '</div>' : '<div class="privacy-history-empty">No tool actions have been performed. Prepared requests and completed actions will appear here.</div>') +
        '</section>' +
        '<p class="shell-settings-footnote">Recovery copies remain in Sync AI\'s local Recovery Vault until restored, so they use local disk space. Sync never overwrites an unexpected file at the original path; when it cannot safely restore automatically, it preserves the recovery copy and marks the action for attention.</p>' +
      '</section>';
  }

  async function refresh() {
    loading = true;
    try {
      const results = await Promise.all([api.listToolActions(100), api.getActionStatus()]);
      actions = results[0] || [];
      status = results[1] || { isRunning: false, activeAction: null };
      error = "";
    } catch (cause) {
      error = errorText(cause);
    } finally {
      loading = false;
      render();
    }
  }

  async function runAction(name, id) {
    if (name === "prepare") {
      if (preparing || status.isRunning) return;
      preparing = true; error = ""; notice = ""; render();
      try {
        const prepared = await api.prepareFileRemoval();
        if (prepared) notice = "File selected. Review the exact path below, then approve the operation separately.";
        await refresh();
      } catch (cause) {
        error = errorText(cause);
      } finally {
        preparing = false;
        render();
      }
      return;
    }
    if (name === "refresh") { await refresh(); return; }
    if (busyId || !id) return;
    const action = actions.find(item => item.id === id);
    if (!action) return;
    if (name === "approve") {
      const confirmed = window.confirm(
        "Approve reversible removal of this file?\n\n" + action.target +
        "\n\nSync will verify a recovery copy before removing the original path. You can stop the operation while it is running, and completed actions can be undone."
      );
      if (!confirmed) return;
    }
    if (name === "undo") {
      const confirmed = window.confirm("Restore this file to its original path?\n\n" + action.target + "\n\nSync will not overwrite a different file that already exists there.");
      if (!confirmed) return;
    }
    if (name === "cancel" && !window.confirm("Cancel this pending file-action request? No file will be changed.")) return;

    busyId = id; error = ""; notice = ""; render();
    try {
      let result;
      if (name === "approve") result = await api.approveFileRemoval(id);
      else if (name === "cancel") result = await api.cancelFileRemoval(id);
      else if (name === "undo") result = await api.undoToolAction(id);
      if (result?.state === "completed") notice = "The file was moved into the Recovery Vault. Its action-history entry can restore it.";
      else if (result?.state === "rolled-back") notice = "The original file has been restored.";
      else if (result?.state === "stopped") notice = "The action stopped. The original file was left in place or restored.";
      else if (result?.state === "recovery-required") error = result.error || "This action needs recovery attention. The Recovery Vault copy was preserved.";
      else if (result?.state === "cancelled") notice = "The pending request was cancelled. No file was changed.";
      else if (result?.state === "failed") error = result.error || "The file action failed. The original file was preserved.";
      await refresh();
    } catch (cause) {
      error = errorText(cause);
      await refresh();
    } finally {
      busyId = null;
      render();
    }
  }

  const unlisten = window.SyncAI.onActionEvent(payload => {
    if (payload?.status) status = payload.status;
    if (payload?.action) {
      const index = actions.findIndex(item => item.id === payload.action.id);
      if (index >= 0) actions[index] = payload.action;
      else actions.unshift(payload.action);
    }
    render();
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-tool-action]");
    if (button) void runAction(button.dataset.toolAction, button.dataset.id);
  });
  await refresh();
  return () => { disposed = true; unlisten(); root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountPrivacyTools = mountPrivacyTools;
})();