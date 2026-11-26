(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtDate, fmtBytes } = window.SyncAI.shared;
const AUTO_LEARN_KEY = "memory_auto_learn";
const MEMORY_BUDGET_KEY = "memory_context_tokens";

async function mountMemory(root) {
  let memories = [];
  let loading = true;
  let importing = false;
  let saving = false;
  let toggling = false;
  let editingId = null;
  let title = "";
  let content = "";
  let source = "manual";
  let enabled = true;
  let autoLearn = false;
  let tokenBudget = 256;
  let message = "";
  let messageIsError = false;
  let disposed = false;

  function resetEditor() {
    editingId = null;
    title = "";
    content = "";
    source = "manual";
    enabled = true;
  }

  function render() {
    if (disposed) return;
    const active = memories.filter(item => item.enabled).length;
    const storedChars = memories.reduce((sum, item) => sum + (item.content || "").length, 0);
    root.innerHTML =
      '<section class="shell-page shell-standard-page memory-page">' +
        '<div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>PERSONAL CONTEXT AND CONTINUITY</div>' +
        '<div class="shell-page-heading-row"><div><p class="shell-section-kicker">LOCAL INFERENCE CONTEXT</p><h1>Memory<span>.</span></h1>' +
          '<p class="shell-page-description">Saved memory stays on this device and is added to future prompts automatically.</p></div>' +
          '<span class="shell-large-status ' + (active ? "is-connected" : "") + '"><span></span>' + active + ' ACTIVE</span></div>' +
        (message ? '<p class="memory-feedback ' + (messageIsError ? "is-error" : "") + '" role="' + (messageIsError ? "alert" : "status") + '">' + esc(message) + '</p>' : '') +
        '<div class="memory-overview-grid">' +
          '<article><small>MEMORY ITEMS</small><strong>' + memories.length + '</strong></article>' +
          '<article><small>ACTIVE ITEMS</small><strong>' + active + '</strong></article>' +
          '<article><small>STORED TEXT</small><strong>' + fmtBytes(storedChars) + '</strong></article>' +
        '</div>' +
        '<section class="shell-settings-panel memory-budget-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">CONTEXT AND RESOURCE LIMITS</p><h2>Memory injection budget</h2></div><span class="shell-panel-tag">BOUNDED PROMPT</span></div>' +
          '<p class="shell-settings-intro">Only enabled memories are included. The budget limits how much memory text can enter each prompt. It does not change the model file or allocate a separate model-sized RAM buffer.</p>' +
          '<label class="memory-budget-control"><div><span>Maximum memory context</span><strong>' + tokenBudget + ' tokens</strong></div>' +
            '<input id="memoryBudget" type="range" min="128" max="512" step="32" value="' + tokenBudget + '" ' + (saving || toggling ? "disabled" : "") + '>' +
            '<div><small>Approx. ' + (tokenBudget * 4).toLocaleString() + ' characters</small><small>Hard limit: 512 tokens</small></div>' +
          '</label>' +
          '<p class="memory-limit-note">The token count is a conservative estimate based on characters. The actual tokenizer may count differently. Memory is capped at 512 estimated tokens so conversation and output retain most of the model context.</p>' +
          '<label class="memory-toggle-row"><span><strong>Learn from conversations</strong><small>After a successful reply, the local model can refresh a concise profile using facts you explicitly shared. This runs an extra local inference and may add time after each reply.</small></span>' +
            '<input id="memoryAutoLearn" type="checkbox" ' + (autoLearn ? "checked" : "") + ' ' + (toggling ? "disabled" : "") + '></label>' +
          '<p class="memory-limit-note">Auto-learning is off until you enable it. It excludes sensitive personal categories and credentials, and its saved profile remains visible and editable below.</p>' +
        '</section>' +
        '<section class="shell-settings-panel memory-editor-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">IMPORT OR WRITE CONTEXT</p><h2>' + (editingId ? "Edit memory" : "Add memory") + '</h2></div><span class="shell-panel-tag">PERSISTENT · LOCAL</span></div>' +
          '<p class="shell-settings-intro">Import a text, Markdown or JSON export from another AI once. Sync saves it in its local database, so you do not need to import it again when the app restarts.</p>' +
          '<div class="memory-editor-fields">' +
            '<label>Memory title<input id="memoryTitle" type="text" maxlength="160" placeholder="e.g. About me, preferences, ongoing projects" value="' + esc(title) + '" ' + (saving ? "disabled" : "") + '></label>' +
            '<label>Memory content<textarea id="memoryContent" rows="9" maxlength="1048576" placeholder="Paste exported memory or write background information here…"' + (saving ? " disabled" : "") + '>' + esc(content) + '</textarea></label>' +
            '<label class="memory-enable-toggle"><input id="memoryEnabled" type="checkbox" ' + (enabled ? "checked" : "") + ' ' + (saving ? "disabled" : "") + '> <span><strong>Use this memory in responses</strong><small>Enabled entries are automatically added before local inference.</small></span></label>' +
            '<div class="memory-editor-actions">' +
              '<button type="button" data-memory-action="import" ' + (importing || saving ? "disabled" : "") + '>' + (importing ? "Importing…" : "Import memory file") + '</button>' +
              '<span class="memory-source-label">Source: ' + esc(source) + '</span><span class="memory-editor-spacer"></span>' +
              (editingId ? '<button type="button" class="is-muted" data-memory-action="new">Discard edits</button>' : '') +
              '<button type="button" class="is-primary" data-memory-action="save" ' + (saving || !title.trim() || !content.trim() ? "disabled" : "") + '>' + (saving ? "Saving…" : editingId ? "Update memory" : "Save memory") + '</button>' +
            '</div>' +
            '<p class="memory-limit-note">Each saved memory can contain up to 1 MiB. The total injected context is controlled separately by the budget above.</p>' +
          '</div>' +
        '</section>' +
        '<section class="memory-library-section"><div class="privacy-history-heading"><div><p class="shell-section-kicker">PERSISTENT PERSONAL CONTEXT</p><h2>Saved memories</h2></div><button type="button" data-memory-action="refresh" ' + (loading ? "disabled" : "") + '>Refresh</button></div>' +
          (loading ? '<div class="privacy-history-empty">Loading local memories…</div>' :
            memories.length ? '<div class="memory-list">' + memories.map(item =>
              '<article class="memory-card">' +
                '<div class="memory-card-heading"><div><strong>' + esc(item.title) + '</strong><small>' + esc(item.source || "manual") + ' · ' + esc(fmtDate(item.updatedAt)) + '</small></div>' +
                '<label class="memory-card-toggle"><input type="checkbox" data-memory-toggle="' + esc(item.id) + '" ' + (item.enabled ? "checked" : "") + '><span>' + (item.enabled ? "ACTIVE" : "OFF") + '</span></label></div>' +
                '<p>' + esc((item.content || "").slice(0, 420)) + ((item.content || "").length > 420 ? "…" : "") + '</p>' +
                '<div class="memory-card-footer"><span>' + (item.content || "").length.toLocaleString() + ' characters</span><div><button type="button" data-memory-action="edit" data-id="' + esc(item.id) + '">Edit</button><button type="button" class="is-danger" data-memory-action="delete" data-id="' + esc(item.id) + '">Delete</button></div></div>' +
              '</article>'
            ).join("") + '</div>' :
              '<div class="privacy-history-empty">No memories saved yet. Import an AI memory export or add a short profile above. Saved items remain here across app restarts.</div>') +
        '</section>' +
      '</section>';
  }

  async function refresh() {
    loading = true;
    try {
      const [items, autoRaw, budgetRaw] = await Promise.all([
        api.listMemories(), api.getSetting(AUTO_LEARN_KEY), api.getSetting(MEMORY_BUDGET_KEY)
      ]);
      memories = items || [];
      try { autoLearn = autoRaw == null ? false : JSON.parse(autoRaw) === true; } catch { autoLearn = false; }
      try { tokenBudget = Number(budgetRaw == null ? 256 : JSON.parse(budgetRaw)); } catch { tokenBudget = 512; }
      tokenBudget = Math.min(1024, Math.max(128, Math.round(Number.isFinite(tokenBudget) ? tokenBudget : 256)));
      message = "";
      messageIsError = false;
    } catch (cause) {
      message = errorText(cause);
      messageIsError = true;
    } finally {
      loading = false;
      render();
    }
  }

  root.addEventListener("input", event => {
    if (event.target.id === "memoryTitle") title = event.target.value;
    if (event.target.id === "memoryContent") content = event.target.value;
    if (event.target.id === "memoryBudget") {
      tokenBudget = Number(event.target.value);
      const value = root.querySelector(".memory-budget-control strong");
      if (value) value.textContent = tokenBudget + " tokens";
      const chars = root.querySelector(".memory-budget-control small");
      if (chars) chars.textContent = "Approx. " + (tokenBudget * 4).toLocaleString() + " characters";
    }
  });

  root.addEventListener("change", async event => {
    if (event.target.id === "memoryEnabled") enabled = event.target.checked;
    if (event.target.id === "memoryBudget") {
      const next = Math.min(512, Math.max(128, Number(event.target.value) || 256));
      try {
        await api.setSetting(MEMORY_BUDGET_KEY, JSON.stringify(next));
        tokenBudget = next;
        message = "Memory prompt budget saved. It will apply to the next message.";
        messageIsError = false;
        render();
      } catch (cause) {
        message = errorText(cause); messageIsError = true; render();
      }
    }
    if (event.target.id === "memoryAutoLearn") {
      toggling = true; autoLearn = event.target.checked; render();
      try {
        await api.setSetting(AUTO_LEARN_KEY, JSON.stringify(autoLearn));
        message = autoLearn
          ? "Auto-learning enabled. Sync will refresh its learned profile after successful conversations."
          : "Auto-learning disabled. Existing memories remain saved and can still be used.";
        messageIsError = false;
      } catch (cause) {
        autoLearn = !event.target.checked;
        message = errorText(cause); messageIsError = true;
      } finally { toggling = false; render(); }
    }
  });

  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-memory-action]");
    if (!button) return;
    const action = button.dataset.memoryAction;
    const id = button.dataset.id;

    if (action === "refresh") { await refresh(); return; }
    if (action === "new") { resetEditor(); message = "Edits discarded."; messageIsError = false; render(); return; }
    if (action === "edit") {
      const item = memories.find(value => value.id === id);
      if (!item) return;
      editingId = item.id; title = item.title; content = item.content; source = item.source || "manual"; enabled = item.enabled;
      message = "Editing " + item.title + ". Changes are saved only when you select Update memory.";
      messageIsError = false; render(); root.querySelector("#memoryTitle")?.focus(); return;
    }
    if (action === "import") {
      if (importing || saving) return;
      importing = true; message = ""; messageIsError = false; render();
      try {
        const imported = await api.importMemoryFile();
        if (imported) {
          await refresh();
          editingId = imported.id; title = imported.title; content = imported.content; source = imported.source; enabled = imported.enabled;
          message = "Imported and saved locally. Review or edit it below; it will persist after restart.";
          messageIsError = false;
        }
      } catch (cause) { message = errorText(cause); messageIsError = true; }
      finally { importing = false; render(); }
      return;
    }
    if (action === "save") {
      if (saving || !title.trim() || !content.trim()) return;
      saving = true; message = ""; messageIsError = false; render();
      try {
        const saved = await api.saveMemory({ title: title.trim(), content, source, enabled }, editingId);
        await refresh();
        editingId = saved.id; title = saved.title; content = saved.content; source = saved.source; enabled = saved.enabled;
        message = "Memory saved locally. It will be available automatically in future conversations.";
        messageIsError = false;
      } catch (cause) { message = errorText(cause); messageIsError = true; }
      finally { saving = false; render(); }
      return;
    }
    if (action === "delete") {
      const item = memories.find(value => value.id === id);
      if (!item || !window.confirm("Delete this saved memory from this device?\n\n" + item.title)) return;
      try {
        await api.deleteMemory(id);
        if (editingId === id) resetEditor();
        await refresh();
        message = "Memory deleted from local storage.";
        messageIsError = false;
        render();
      } catch (cause) { message = errorText(cause); messageIsError = true; render(); }
    }
  });

  root.addEventListener("change", async event => {
    const id = event.target.dataset.memoryToggle;
    if (!id) return;
    try {
      await api.setMemoryEnabled(id, event.target.checked);
      await refresh();
      message = event.target.checked ? "Memory enabled for future prompts." : "Memory disabled. It remains saved but will not be injected.";
      messageIsError = false;
      render();
    } catch (cause) { message = errorText(cause); messageIsError = true; render(); }
  });

  await refresh();
  return () => { disposed = true; root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountMemory = mountMemory;
})();