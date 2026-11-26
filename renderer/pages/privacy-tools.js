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
  let selectedOperation = "delete";
  let folderName = "";
  let pendingModal = null;
  let modalReturnFocus = null;
  let disposed = false;

  const stateLabel = state => ({
    "awaiting-approval": "AWAITING YOUR APPROVAL",
    running: "RUNNING",
    restoring: "RESTORING",
    completed: "COMPLETED · UNDO AVAILABLE",
    "rolled-back": "UNDONE",
    stopped: "STOPPED · CHANGES REVERSED",
    cancelled: "REQUEST CANCELLED",
    failed: "FAILED · ORIGINAL PRESERVED",
    "recovery-required": "RECOVERY NEEDS ATTENTION"
  }[state] || String(state || "UNKNOWN").toUpperCase());

  function renderAction(action) {
    const controls = action.state === "awaiting-approval"
      ? '<button type="button" data-tool-action="approve" data-id="' + esc(action.id) + '" ' + (busyId ? "disabled" : "") + '>Review &amp; approve</button><button type="button" class="is-muted" data-tool-action="cancel" data-id="' + esc(action.id) + '" ' + (busyId ? "disabled" : "") + '>Cancel request</button>'
      : ["completed", "recovery-required"].includes(action.state) && action.undoable
        ? '<button type="button" data-tool-action="undo" data-id="' + esc(action.id) + '" ' + (busyId ? "disabled" : "") + '>' + (action.state === "recovery-required" ? "Retry / review undo" : "Undo operation") + '</button>'
        : "";
    const source = action.sourcePath || action.target || "";
    return '<article class="privacy-action-card">' +
      '<div class="privacy-action-main">' +
        '<div class="privacy-action-title"><strong>' + esc(action.fileName || action.summary) + '</strong><span class="privacy-action-state is-' + esc(action.state) + '">' + esc(stateLabel(action.state)) + '</span></div>' +
        '<p>' + esc(action.summary) + '</p>' +
        (source ? '<small class="privacy-action-target">FROM · ' + esc(source) + '</small>' : '') +
        (action.destinationPath ? '<small class="privacy-action-target">TO · ' + esc(action.destinationPath) + '</small>' : '') +
        '<small>' + fmtBytes(action.sizeBytes || 0) + ' · ' + esc(fmtDate(action.updatedAt)) + '</small>' +
        (action.error ? '<p class="privacy-action-error">' + esc(action.error) + '</p>' : '') +
        (controls ? '<div class="privacy-action-controls">' + controls + '</div>' : '') +
      '</div></article>';
  }

  function focusModal() {
    const modal = root.querySelector(".privacy-modal");
    if (!modal) return;
    const first = modal.querySelector('[data-tool-action="modal-close"], button:not([disabled]), [tabindex="0"]');
    (first || modal).focus?.();
  }

  function closeModal() {
    pendingModal = null;
    render();
    const target = modalReturnFocus;
    modalReturnFocus = null;
    if (target?.isConnected && typeof target.focus === "function") {
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }

  function renderModal() {
    if (!pendingModal) return "";
    const action = actions.find(item => item.id === pendingModal.id);
    if (!action) return "";
    const kind = pendingModal.kind;
    const title = kind === "approve" ? "Approve file operation"
      : kind === "undo" ? "Undo this operation?" : "Cancel pending operation?";
    const description = kind === "approve"
      ? (action.operation === "delete" || action.toolId === "file.reversible_remove"
        ? "Sync will create and verify a Recovery Vault copy before removing the original file."
        : "Sync will perform the reviewed operation only after you approve it. Existing destination files will never be overwritten.")
      : kind === "undo"
        ? "Sync will reverse this operation where it can verify the affected paths. It will not overwrite unrelated files or remove non-empty folders."
        : "The request will be cancelled before it changes any files.";
    const confirm = kind === "approve" ? "Approve & execute" : kind === "undo" ? "Undo operation" : "Cancel request";
    const source = action.sourcePath || action.target || "";
    return '<div class="privacy-modal-backdrop" data-tool-action="modal-backdrop">' +
      '<section class="privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacyModalTitle">' +
        '<div class="privacy-modal-top"><span class="privacy-modal-mark">✦</span><span>SYNC SECURITY</span><span class="privacy-modal-state">APPROVAL REQUIRED</span></div>' +
        '<h2 id="privacyModalTitle">' + esc(title) + '</h2>' +
        '<p class="privacy-modal-description">' + esc(description) + '</p>' +
        '<div class="privacy-modal-paths">' +
          (source ? '<div><small>' + (action.operation === "create-folder" ? "PARENT / ORIGINAL PATH" : "SOURCE PATH") + '</small><code>' + esc(source) + '</code></div>' : '') +
          (action.destinationPath ? '<div><small>DESTINATION PATH</small><code>' + esc(action.destinationPath) + '</code></div>' : '') +
          '<div><small>OPERATION</small><strong>' + esc(String(action.operation || action.toolId || "file action").replace(/^file\\./, "").replace(/-/g, " ").toUpperCase()) + '</strong></div>' +
        '</div>' +
        '<div class="privacy-modal-safety"><span>◇</span><span>Manual approval · Action journal · Stop control</span></div>' +
        '<div class="privacy-modal-actions"><button type="button" class="is-muted" data-tool-action="modal-close">Go back</button><button type="button" data-tool-action="modal-confirm" data-id="' + esc(action.id) + '">' + esc(confirm) + '</button></div>' +
      '</section></div>';
  }

  function render() {
    if (disposed) return;
    root.innerHTML =
      '<section class="shell-page shell-standard-page privacy-tools-page">' +
        '<div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>USER CONTROL AND LOCAL DATA</div>' +
        '<div class="shell-page-heading-row"><div><p class="shell-section-kicker">PHASE 6 · FILE OPERATIONS</p><h1>Privacy &amp; Tools<span>.</span></h1>' +
          '<p class="shell-page-description">Review every file change, approve it explicitly, and reverse supported operations from one journal.</p></div>' +
          '<span class="shell-large-status ' + (status.isRunning ? "is-warning" : "is-connected") + '"><span></span>' + (status.isRunning ? "ACTION IN PROGRESS" : "NO ACTIVE ACTION") + '</span></div>' +
        (notice ? '<p class="privacy-feedback" role="status">' + esc(notice) + '</p>' : '') +
        (error ? '<p class="privacy-feedback is-error" role="alert">' + esc(error) + '</p>' : '') +
        '<div class="privacy-policy-grid">' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">⌂</span><strong>Local-first storage</strong><p>Chats, settings, tasks, notes, model registrations and action history stay in local app storage.</p><small>NO CLOUD SYNC CONNECTED</small></article>' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">◈</span><strong>Scoped file access</strong><p>File operations begin from paths you select. Sync does not scan the whole computer or expose unrestricted filesystem access.</p><small>USER-SELECTED PATHS</small></article>' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">⊙</span><strong>Approval before changes</strong><p>Every prepared operation waits for a separate approval in this themed Sync dialog. The operating system still provides the native file and folder chooser.</p><small>NO SILENT APPROVALS</small></article>' +
          '<article class="privacy-policy-card"><span class="privacy-policy-icon">↶</span><strong>Stop &amp; undo</strong><p>Stop cancels the active operation and attempts rollback. Completed copy, move, rename, folder creation and recovery-vault removal actions can be undone when safe.</p><small>JOURNALED OPERATIONS</small></article>' +
        '</div>' +
        '<section class="shell-settings-panel privacy-tools-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">CONTROLLED FILESYSTEM TOOLS</p><h2>File operations</h2></div><span class="shell-panel-tag">MANUAL APPROVAL</span></div>' +
          '<div class="privacy-tool-row"><div><strong>Copy, move and rename</strong><p>Regular files up to 512 MiB. Copy verifies the new file; move and rename refuse occupied destinations. All are journaled and reversible where safe.</p></div><span class="privacy-tool-state">AVAILABLE</span></div>' +
          '<div class="privacy-tool-row"><div><strong>Delete safely</strong><p>Removal means moving the selected file into Sync’s Recovery Vault first. Permanent deletion is deliberately not offered.</p></div><span class="privacy-tool-state">RECOVERABLE</span></div>' +
          '<div class="privacy-tool-row"><div><strong>Create folder</strong><p>Creates one folder inside a parent directory you select. Undo removes it only while it is empty.</p></div><span class="privacy-tool-state">REVERSIBLE</span></div>' +
          '<div class="privacy-operation-launch">' +
            '<div class="privacy-operation-controls">' +
              '<label for="privacyOperationSelect">Operation</label>' +
              '<select id="privacyOperationSelect" class="privacy-operation-select">' +
                '<option value="delete" ' + (selectedOperation === "delete" ? "selected" : "") + '>Delete safely (Recovery Vault)</option>' +
                '<option value="copy" ' + (selectedOperation === "copy" ? "selected" : "") + '>Copy file</option>' +
                '<option value="move" ' + (selectedOperation === "move" ? "selected" : "") + '>Move file</option>' +
                '<option value="rename" ' + (selectedOperation === "rename" ? "selected" : "") + '>Rename file</option>' +
                '<option value="create-folder" ' + (selectedOperation === "create-folder" ? "selected" : "") + '>Create folder</option>' +
              '</select>' +
              (selectedOperation === "create-folder" ? '<input id="privacyFolderName" class="privacy-folder-name" type="text" maxlength="180" placeholder="New folder name" value="' + esc(folderName) + '">' : '') +
              '<button type="button" data-tool-action="prepare" ' + (preparing || busyId || status.isRunning ? "disabled" : "") + '>' + (preparing ? "Preparing…" : "Choose path(s) & review") + '</button>' +
            '</div>' +
            '<p>Nothing changes until you approve the prepared action. The native Windows chooser selects the source and destination; the approval itself uses Sync’s theme.</p>' +
          '</div>' +
        '</section>' +
        '<section class="privacy-history-section"><div class="privacy-history-heading"><div><p class="shell-section-kicker">PERSISTENT LOCAL JOURNAL</p><h2>Action history</h2></div><button type="button" data-tool-action="refresh" ' + (loading ? "disabled" : "") + '>Refresh</button></div>' +
          (loading ? '<p class="privacy-history-empty">Loading action history…</p>' : actions.length ? '<div class="privacy-action-list">' + actions.map(renderAction).join("") + '</div>' : '<div class="privacy-history-empty">No tool actions have been performed. Prepared and completed operations will appear here.</div>') +
        '</section>' +
        '<p class="shell-settings-footnote">Sync protects its own application-data directory and Recovery Vault. It never overwrites an existing destination. Recovery copies use local disk space; unsupported or interrupted operations are marked for review rather than silently discarded.</p>' +
      '</section>' + renderModal();
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
    if (name === "modal-close") {
      closeModal(); return;
    }
    if (name === "prepare") {
      if (preparing || status.isRunning) return;
      preparing = true; error = ""; notice = ""; render();
      try {
        const prepared = await api.prepareFileOperation(selectedOperation, folderName);
        if (prepared) notice = "Operation prepared. Check the source and destination in Action History, then approve it.";
        await refresh();
      } catch (cause) {
        error = errorText(cause);
      } finally {
        preparing = false; render();
      }
      return;
    }
    if (name === "refresh") { await refresh(); return; }
    if (name === "approve" || name === "undo" || name === "cancel") {
      if (!id) return;
      modalReturnFocus = document.activeElement;
      pendingModal = { kind: name, id };
      render();
      requestAnimationFrame(focusModal);
      return;
    }
    if (name === "modal-confirm") {
      const current = pendingModal;
      const actionId = current?.id || id;
      if (!current || !actionId || busyId) return;
      busyId = actionId; pendingModal = null; modalReturnFocus = null; error = ""; notice = ""; render();
      try {
        let result;
        if (current.kind === "approve") result = await api.approveFileAction(actionId);
        else if (current.kind === "cancel") result = await api.cancelFileAction(actionId);
        else if (current.kind === "undo") result = await api.undoToolAction(actionId);
        if (result?.state === "completed") notice = "Operation completed. Its action-history entry can undo it where safe.";
        else if (result?.state === "rolled-back") notice = "The operation was successfully undone.";
        else if (result?.state === "stopped") notice = "The operation stopped and its changes were reversed where possible.";
        else if (result?.state === "recovery-required") error = result.error || "This action needs manual recovery review.";
        else if (result?.state === "cancelled") notice = "The pending request was cancelled. No file was changed.";
        else if (result?.state === "failed") error = result.error || "The operation failed. Check Action History for details.";
        await refresh();
      } catch (cause) {
        error = errorText(cause);
        await refresh();
      } finally {
        busyId = null; render();
      }
      return;
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
  root.addEventListener("change", event => {
    if (event.target.id === "privacyOperationSelect") {
      selectedOperation = event.target.value;
      render();
    }
    if (event.target.id === "privacyFolderName") folderName = event.target.value;
  });
  root.addEventListener("input", event => {
    if (event.target.id === "privacyFolderName") folderName = event.target.value;
  });
  root.addEventListener("click", event => {
    // Only a click on the backdrop itself closes the modal. Clicks inside the
    // dialog must never be mistaken for backdrop clicks.
    if (event.target.matches(".privacy-modal-backdrop")) {
      closeModal();
      return;
    }
    const button = event.target.closest("[data-tool-action]");
    if (button) void runAction(button.dataset.toolAction, button.dataset.id);
  });
  const onKeyDown = event => {
    if (!pendingModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key === "Tab") {
      const modal = root.querySelector(".privacy-modal");
      const focusable = Array.from(modal?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  await refresh();
  return () => { disposed = true; unlisten(); window.removeEventListener("keydown", onKeyDown); root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountPrivacyTools = mountPrivacyTools;
})();