(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtDate, fmtBytes } = window.SyncAI.shared;
const AUTO_LEARN_KEY = "memory_auto_learn";
const LEARNING_MODE_KEY = "memory_learning_mode";
const MEMORY_BUDGET_KEY = "memory_context_tokens";
const CONTEXT_BUDGET_KEY = "context_budget_percent";
const AUTO_SUMMARY_KEY = "conversation_summary_auto";
const MEMORY_LIMIT_BYTES = 4 * 1024 * 1024;
const MEMORY_LIMIT_ITEMS = 50;
const CATEGORIES = [
  ["general","General"],["profile","Profile"],["preferences","Preferences"],
  ["projects","Projects"],["technical","Technical"],["workflows","Workflows"],["interests","Interests"]
];
const VALID_LEARNING_MODES = ["off","review","automatic"];

async function mountMemory(root) {
  let memories = [];
  let candidates = [];
  let loading = true, importing = false, saving = false, toggling = false, reviewing = false;
  let editingId = null, title = "", content = "", source = "manual", enabled = true;
  let category = "general", importance = 3, pinned = false;
  let learningMode = "off", memoryTokenBudget = 256, contextBudgetPercent = 65;
  let autoSummaries = true;
  let contextWindowTokens = 2048;
  let searchQuery = "", categoryFilter = "all", statusFilter = "all";
  let message = "", messageIsError = false, disposed = false;

  function resetEditor() {
    editingId = null; title = ""; content = ""; source = "manual";
    enabled = true; category = "general"; importance = 3; pinned = false;
  }
  function bytes(value) {
    try { return new TextEncoder().encode(String(value || "")).length; }
    catch { return String(value || "").length * 2; }
  }
  function storedBytes() {
    return memories.reduce((sum, item) => sum + bytes(item.content), 0);
  }
  function filteredMemories() {
    const term = searchQuery.trim().toLocaleLowerCase();
    return memories.filter(item => {
      if (categoryFilter !== "all" && (item.category || "general") !== categoryFilter) return false;
      if (statusFilter === "active" && !item.enabled) return false;
      if (statusFilter === "disabled" && item.enabled) return false;
      if (!term) return true;
      return [item.title,item.content,item.source,item.category].some(value => String(value || "").toLocaleLowerCase().includes(term));
    });
  }

  function renderMemoryResults() {
    const host = root.querySelector("#memoryLibraryResults");
    if (!host) return;
    const visible = filteredMemories();
    if (!memories.length) {
      host.innerHTML = '<div class="privacy-history-empty">No memories saved yet. Import an AI memory export or add a short profile above. Saved items remain here across app restarts.</div>';
      return;
    }
    if (!visible.length) {
      host.innerHTML = '<div class="privacy-history-empty">No memories match these filters. Clear the search or choose another category/status.</div>';
      return;
    }
    host.innerHTML = '<div class="memory-filter-summary">Showing ' + visible.length + ' of ' + memories.length + ' memories</div><div class="memory-list">' + visible.map(item =>
      '<article class="memory-card">' +
        '<div class="memory-card-heading"><div><strong>' + esc(item.title) + '</strong><small>' + esc(item.source || "manual") + ' · ' + esc(fmtDate(item.updatedAt)) + '</small></div>' +
        '<label class="memory-card-toggle"><input type="checkbox" data-memory-toggle="' + esc(item.id) + '" ' + (item.enabled ? "checked" : "") + '><span>' + (item.enabled ? "ACTIVE" : "OFF") + '</span></label></div>' +
        '<p>' + esc((item.content || "").slice(0, 420)) + ((item.content || "").length > 420 ? "…" : "") + '</p>' +
        '<div class="memory-card-meta"><span>' + esc(item.category || "general") + '</span><span>Importance ' + Number(item.importance || 3) + '/5</span>' + (item.pinned ? '<span class="is-pinned">PINNED</span>' : '') + (item.source === "Auto-learned from conversations" ? '<span class="is-learned">LEARNED</span>' : '') + '</div>' +
        ((item.sources || []).length ? '<div class="memory-provenance"><small>SOURCE CONVERSATIONS</small>' + item.sources.map(origin => '<div><strong>' + esc(origin.chatTitle || "Conversation") + '</strong>' + (origin.messageExcerpt ? '<p>' + esc(origin.messageExcerpt) + '</p>' : '') + '<small>' + esc(fmtDate(origin.createdAt)) + (origin.chatId ? ' · Linked' : ' · Original conversation deleted') + '</small></div>').join('') + '</div>' : '') +
        '<div class="memory-card-footer"><span>' + bytes(item.content).toLocaleString() + ' bytes · ' + (item.content || "").length.toLocaleString() + ' characters</span><div><button type="button" data-memory-action="edit" data-id="' + esc(item.id) + '">Edit</button><button type="button" class="is-danger" data-memory-action="delete" data-id="' + esc(item.id) + '">Delete</button></div></div>' +
      '</article>'
    ).join("") + '</div>';
  }

  function renderCandidates() {
    const host = root.querySelector("#memoryCandidateResults");
    if (!host) return;
    if (!candidates.length) {
      host.innerHTML = '<div class="privacy-history-empty">No memories are waiting for approval. Switch learning to Review first to inspect suggestions before saving them.</div>';
      return;
    }
    host.innerHTML = '<div class="memory-filter-summary">' + candidates.length + ' pending candidate' + (candidates.length === 1 ? '' : 's') + '</div><div class="memory-list">' + candidates.map(item =>
      '<article class="memory-card memory-candidate-card">' +
        '<div class="memory-card-heading"><div><strong>' + esc(item.title) + '</strong><small>Suggested by Sync · ' + esc(fmtDate(item.createdAt)) + '</small></div><span class="memory-candidate-status">AWAITING REVIEW</span></div>' +
        '<p>' + esc(item.content) + '</p>' +
        (item.sourceChatTitle ? '<div class="memory-provenance"><small>SOURCE CONVERSATION</small><strong>' + esc(item.sourceChatTitle) + '</strong>' + (item.sourceMessages || []).map(origin => origin.excerpt ? '<p>' + esc(origin.excerpt) + '</p>' : '').join('') + '</div>' : '') +
        '<div class="memory-card-footer"><span>Not saved to Memory yet</span><div><button type="button" data-memory-action="reject-candidate" data-id="' + esc(item.id) + '" ' + (reviewing ? 'disabled' : '') + '>Reject</button><button type="button" class="is-primary" data-memory-action="approve-candidate" data-id="' + esc(item.id) + '" ' + (reviewing ? 'disabled' : '') + '>Approve and save</button></div></div>' +
      '</article>'
    ).join("") + '</div>';
  }

  function render() {
    if (disposed) return;
    const active = memories.filter(item => item.enabled).length;
    const usedBytes = storedBytes();
    const storagePercent = Math.min(100, Math.round(usedBytes / MEMORY_LIMIT_BYTES * 100));
    const storageSlots = Math.max(0, MEMORY_LIMIT_ITEMS - memories.length);
    root.innerHTML =
      '<section class="shell-page shell-standard-page memory-page">' +
        '<div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>PERSONAL CONTEXT AND CONTINUITY</div>' +
        '<div class="shell-page-heading-row"><div><p class="shell-section-kicker">LOCAL INFERENCE CONTEXT</p><h1>Memory<span>.</span></h1>' +
          '<p class="shell-page-description">Durable facts about you, kept separate from your Notes and conversation history.</p></div>' +
          '<span class="shell-large-status ' + (active ? "is-connected" : "") + '"><span></span>' + active + ' ACTIVE</span></div>' +
        (message ? '<p class="memory-feedback ' + (messageIsError ? "is-error" : "") + '" role="' + (messageIsError ? "alert" : "status") + '">' + esc(message) + '</p>' : '') +
        '<div class="memory-overview-grid">' +
          '<article><small>MEMORY ITEMS</small><strong>' + memories.length + ' / ' + MEMORY_LIMIT_ITEMS + '</strong></article>' +
          '<article><small>ACTIVE ITEMS</small><strong>' + active + '</strong></article>' +
          '<article><small>STORAGE USED</small><strong>' + esc(fmtBytes(usedBytes)) + '</strong></article>' +
          '<article><small>PENDING REVIEW</small><strong>' + candidates.length + '</strong></article>' +
        '</div>' +
        '<section class="shell-settings-panel memory-budget-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">TOTAL PROMPT RESOURCE LIMIT</p><h2>Overall context budget</h2></div><span class="shell-panel-tag">' + contextWindowTokens.toLocaleString() + ' TOKEN WINDOW</span></div>' +
          '<p class="shell-settings-intro">Controls the approximate share of the loaded model context Sync may use for the entire app-built prompt: recent conversation, summaries, Memory, Notes and selected Workspace material. The remaining capacity is reserved for the model reply and safety margin.</p>' +
          '<label class="memory-budget-control"><div><span>Maximum prompt budget</span><strong id="contextBudgetValue">' + contextBudgetPercent + '% · about ' + Math.floor(contextWindowTokens * contextBudgetPercent / 100).toLocaleString() + ' tokens</strong></div>' +
            '<input id="contextBudgetPercent" type="range" min="40" max="80" step="5" value="' + contextBudgetPercent + '" ' + (saving || toggling ? "disabled" : "") + '>' +
            '<div><small>' + (100 - contextBudgetPercent) + '% reserved for output/safety</small><small>Estimate uses characters, not the model tokenizer</small></div>' +
          '</label>' +
          '<p class="memory-limit-note">This is a conservative application-level estimate, not an exact tokenizer measurement. Long conversations will be summarized and older turns compacted rather than growing without limit.</p>' +
          '<label class="memory-toggle-row"><span><strong>Automatically summarize older conversation turns</strong><small>Keep a rolling summary of older messages while the newest eight messages stay verbatim. This uses the loaded model only when the conversation grows beyond its context budget.</small></span><input id="autoSummaries" type="checkbox" ' + (autoSummaries ? 'checked' : '') + ' ' + (toggling ? 'disabled' : '') + '></label>' +
        '</section>' +
        '<section class="shell-settings-panel memory-budget-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">SOURCE-SPECIFIC LIMIT</p><h2>Memory context budget</h2></div><span class="shell-panel-tag">MAX 512 TOKENS</span></div>' +
          '<p class="shell-settings-intro">A separate cap for saved Memory records. Relevant entries are ranked first, with pinned and important facts receiving a priority boost.</p>' +
          '<label class="memory-budget-control"><div><span>Maximum Memory context</span><strong id="memoryBudgetValue">' + memoryTokenBudget + ' tokens</strong></div>' +
            '<input id="memoryBudget" type="range" min="128" max="512" step="32" value="' + memoryTokenBudget + '" ' + (saving || toggling ? "disabled" : "") + '>' +
            '<div><small>Approx. ' + (memoryTokenBudget * 4).toLocaleString() + ' characters</small><small>Hard limit: 512 estimated tokens</small></div>' +
          '</label>' +
        '</section>' +
        '<section class="shell-settings-panel memory-learning-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">AUTOMATIC KNOWLEDGE CAPTURE</p><h2>Learning management</h2></div><span class="shell-panel-tag">USER CONTROLLED</span></div>' +
          '<label class="memory-learning-control">Learning behavior<select id="memoryLearningMode" ' + (toggling ? "disabled" : "") + '>' +
            '<option value="off" ' + (learningMode === "off" ? "selected" : "") + '>Off</option>' +
            '<option value="review" ' + (learningMode === "review" ? "selected" : "") + '>Review first</option>' +
            '<option value="automatic" ' + (learningMode === "automatic" ? "selected" : "") + '>Automatic</option>' +
          '</select></label>' +
          '<p class="memory-learning-explanation">' +
            (learningMode === "off" ? 'Sync will not run the extra learning inference. Existing saved memories remain available and editable.' :
             learningMode === "review" ? 'After a successful conversation, Sync may suggest a durable fact. Suggestions appear in the review queue below and are not saved to Memory until you approve them.' :
             'After a successful conversation, Sync may update the learned profile automatically. You can edit or disable the profile at any time.') +
          '</p>' +
          '<p class="memory-limit-note">Learning uses an additional local inference only when enabled. It is bounded to recent user messages and excludes sensitive categories and credentials. Review mode is recommended when you want to inspect every suggested change.</p>' +
          (learningMode === "review" ? '<div class="memory-candidate-summary">' + candidates.length + ' suggestion' + (candidates.length === 1 ? '' : 's') + ' waiting for your approval.</div>' : '') +
        '</section>' +
        '<section class="shell-settings-panel memory-editor-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">IMPORT OR WRITE CONTEXT</p><h2>' + (editingId ? "Edit memory" : "Add memory") + '</h2></div><span class="shell-panel-tag">PERSISTENT · LOCAL</span></div>' +
          '<p class="shell-settings-intro">Add stable facts about yourself or import an existing AI memory export. Reminders and temporary plans belong in Notes instead.</p>' +
          '<div class="memory-editor-fields">' +
            '<label>Memory title<input id="memoryTitle" type="text" maxlength="160" placeholder="e.g. About me, preferences, ongoing projects" value="' + esc(title) + '" ' + (saving ? "disabled" : "") + '></label>' +
            '<label>Memory content<textarea id="memoryContent" rows="9" maxlength="1048576" placeholder="Write durable background information here…" ' + (saving ? "disabled" : "") + '>' + esc(content) + '</textarea></label>' +
            '<div class="memory-metadata-fields">' +
              '<label>Category<select id="memoryCategory" ' + (saving ? "disabled" : "") + '>' + CATEGORIES.map(([value,label]) => '<option value="' + value + '" ' + (category === value ? "selected" : "") + '>' + label + '</option>').join("") + '</select></label>' +
              '<label>Importance<select id="memoryImportance" ' + (saving ? "disabled" : "") + '>' + [1,2,3,4,5].map(value => '<option value="' + value + '" ' + (importance === value ? "selected" : "") + '>' + value + (value === 1 ? " · Low" : value === 5 ? " · Critical" : value === 3 ? " · Normal" : "") + '</option>').join("") + '</select></label>' +
            '</div>' +
            '<label class="memory-enable-toggle"><input id="memoryPinned" type="checkbox" ' + (pinned ? "checked" : "") + ' ' + (saving ? "disabled" : "") + '> <span><strong>Pin this memory</strong><small>Pinned entries receive a priority boost during relevant retrieval.</small></span></label>' +
            '<label class="memory-enable-toggle"><input id="memoryEnabled" type="checkbox" ' + (enabled ? "checked" : "") + ' ' + (saving ? "disabled" : "") + '> <span><strong>Use this memory in responses</strong><small>Disabled memories remain saved but are not retrieved.</small></span></label>' +
            '<div class="memory-editor-actions">' +
              '<button type="button" data-memory-action="import" ' + (importing || saving ? "disabled" : "") + '>' + (importing ? "Importing…" : "Import memory file") + '</button>' +
              '<span class="memory-source-label">Source: ' + esc(source) + '</span><span class="memory-editor-spacer"></span>' +
              (editingId ? '<button type="button" class="is-muted" data-memory-action="new">Discard edits</button>' : '') +
              '<button type="button" class="is-primary" data-memory-action="save" ' + (saving || !title.trim() || !content.trim() ? "disabled" : "") + '>' + (saving ? "Saving…" : editingId ? "Update memory" : "Save memory") + '</button>' +
            '</div>' +
            '<p class="memory-limit-note">Each saved memory can contain up to 1 MiB. The entire Memory library is capped at 50 items and 4 MiB of content.</p>' +
          '</div>' +
        '</section>' +
        '<section class="memory-library-section memory-candidates-section"><div class="privacy-history-heading"><div><p class="shell-section-kicker">USER APPROVAL REQUIRED</p><h2>Learning review queue</h2></div><button type="button" data-memory-action="refresh" ' + (loading || reviewing ? "disabled" : "") + '>Refresh</button></div>' +
          '<p class="shell-settings-intro">Suggestions in this queue are separate from saved Memory. Approving replaces or creates the learned profile; rejecting leaves your existing Memory unchanged.</p>' +
          '<div id="memoryCandidateResults"></div>' +
        '</section>' +
        '<section class="memory-library-section"><div class="privacy-history-heading"><div><p class="shell-section-kicker">PERSISTENT PERSONAL CONTEXT</p><h2>Saved memories</h2></div><span class="shell-panel-tag">' + memories.length + ' ITEMS</span></div>' +
          '<div class="memory-storage-meter"><div><span>' + esc(fmtBytes(usedBytes)) + ' of 4 MiB</span><strong>' + storagePercent + '%</strong></div><div class="memory-storage-track"><span style="width:' + storagePercent + '%"></span></div><small>' + storageSlots + ' item slots remaining · ' + Math.max(0, MEMORY_LIMIT_BYTES - usedBytes).toLocaleString() + ' bytes remaining</small></div>' +
          '<div class="memory-library-controls">' +
            '<input id="memorySearch" type="search" placeholder="Search saved memories…" value="' + esc(searchQuery) + '">' +
            '<select id="memoryCategoryFilter" aria-label="Filter memories by category"><option value="all">All categories</option>' + CATEGORIES.map(([value,label]) => '<option value="' + value + '" ' + (categoryFilter === value ? "selected" : "") + '>' + label + '</option>').join("") + '</select>' +
            '<select id="memoryStatusFilter" aria-label="Filter memories by status"><option value="all" ' + (statusFilter === "all" ? "selected" : "") + '>All statuses</option><option value="active" ' + (statusFilter === "active" ? "selected" : "") + '>Active</option><option value="disabled" ' + (statusFilter === "disabled" ? "selected" : "") + '>Disabled</option></select>' +
          '</div>' +
          '<div id="memoryLibraryResults"></div>' +
        '</section>' +
      '</section>';
    renderCandidates();
    renderMemoryResults();
  }

  async function refresh() {
    loading = true;
    try {
      const results = await Promise.allSettled([
        api.listMemories(), api.getSetting(AUTO_LEARN_KEY), api.getSetting(LEARNING_MODE_KEY),
        api.getSetting(MEMORY_BUDGET_KEY), api.listMemoryCandidates("pending", 50), api.getContextPolicy(), api.getSetting(AUTO_SUMMARY_KEY)
      ]);
      if (results[0].status !== "fulfilled") throw results[0].reason;
      memories = results[0].value || [];
      const legacyRaw = results[1].status === "fulfilled" ? results[1].value : null;
      const modeRaw = results[2].status === "fulfilled" ? results[2].value : null;
      try {
        const storedMode = modeRaw == null ? null : JSON.parse(modeRaw);
        learningMode = VALID_LEARNING_MODES.includes(storedMode) ? storedMode : null;
      } catch { learningMode = null; }
      if (!learningMode) {
        let legacyEnabled = false;
        try { legacyEnabled = legacyRaw == null ? false : JSON.parse(legacyRaw) === true; } catch {}
        learningMode = legacyEnabled ? "automatic" : "off";
      }
      let memoryBudget = 256;
      try { memoryBudget = results[3].status === "fulfilled" && results[3].value != null ? Number(JSON.parse(results[3].value)) : 256; } catch {}
      memoryTokenBudget = Math.min(512, Math.max(128, Math.round(Number.isFinite(memoryBudget) ? memoryBudget : 256)));
      if (results[4].status === "fulfilled") candidates = results[4].value || [];
      if (results[5].status === "fulfilled" && results[5].value) {
        contextBudgetPercent = results[5].value.percent || 65;
        contextWindowTokens = results[5].value.contextWindowTokens || 2048;
      }
      try { autoSummaries = results[6].status !== "fulfilled" || results[6].value == null ? true : JSON.parse(results[6].value) !== false; } catch { autoSummaries = true; }
      if (!messageIsError) message = "";
    } catch (cause) {
      message = errorText(cause); messageIsError = true;
    } finally {
      loading = false;
      render();
    }
  }

  root.addEventListener("input", event => {
    if (event.target.id === "memoryTitle") title = event.target.value;
    if (event.target.id === "memoryContent") content = event.target.value;
    if (event.target.id === "memorySearch") {
      searchQuery = event.target.value;
      renderMemoryResults();
    }
    if (event.target.id === "contextBudgetPercent") {
      const value = Number(event.target.value);
      const label = root.querySelector("#contextBudgetValue");
      if (label) label.textContent = value + "% · about " + Math.floor(contextWindowTokens * value / 100).toLocaleString() + " tokens";
    }
    if (event.target.id === "memoryBudget") {
      const value = Number(event.target.value);
      const label = root.querySelector("#memoryBudgetValue");
      if (label) label.textContent = value + " tokens";
      const chars = root.querySelector(".memory-budget-panel #memoryBudget")?.parentElement?.querySelector("div:last-child small");
      if (chars) chars.textContent = "Approx. " + (value * 4).toLocaleString() + " characters";
    }
  });

  root.addEventListener("change", async event => {
    if (event.target.id === "memoryEnabled") enabled = event.target.checked;
    if (event.target.id === "memoryCategory") category = event.target.value;
    if (event.target.id === "memoryImportance") importance = Number(event.target.value);
    if (event.target.id === "memoryPinned") pinned = event.target.checked;
    if (event.target.id === "autoSummaries") {
      toggling = true; render();
      try {
        autoSummaries = event.target.checked;
        await api.setSetting(AUTO_SUMMARY_KEY, JSON.stringify(autoSummaries));
        message = autoSummaries ? "Automatic conversation summaries enabled." : "Automatic conversation summaries disabled. Existing summaries remain saved and may still be used.";
        messageIsError = false;
      } catch (cause) { autoSummaries = !event.target.checked; message = errorText(cause); messageIsError = true; }
      finally { toggling = false; render(); }
    }
    if (event.target.id === "memoryCategoryFilter") { categoryFilter = event.target.value; renderMemoryResults(); }
    if (event.target.id === "memoryStatusFilter") { statusFilter = event.target.value; renderMemoryResults(); }

    if (event.target.id === "memoryBudget") {
      const next = Math.min(512, Math.max(128, Number(event.target.value) || 256));
      try {
        await api.setSetting(MEMORY_BUDGET_KEY, JSON.stringify(next));
        memoryTokenBudget = next; message = "Memory source budget saved."; messageIsError = false; render();
      } catch (cause) { message = errorText(cause); messageIsError = true; render(); }
    }
    if (event.target.id === "contextBudgetPercent") {
      const next = Math.min(80, Math.max(40, Math.round(Number(event.target.value) / 5) * 5));
      saving = true; render();
      try {
        const policy = await api.setContextBudgetPercent(next);
        contextBudgetPercent = policy.percent;
        contextWindowTokens = policy.contextWindowTokens;
        message = "Overall prompt budget saved. It will apply to the next message.";
        messageIsError = false;
      } catch (cause) { message = errorText(cause); messageIsError = true; }
      finally { saving = false; render(); }
    }
    if (event.target.id === "memoryLearningMode") {
      const next = event.target.value;
      if (!VALID_LEARNING_MODES.includes(next)) return;
      toggling = true; render();
      try {
        await api.setSetting(AUTO_LEARN_KEY, JSON.stringify(next === "automatic"));
        await api.setSetting(LEARNING_MODE_KEY, JSON.stringify(next));
        learningMode = next;
        message = next === "off" ? "Learning disabled. Saved memories and pending suggestions are unchanged."
          : next === "review" ? "Review mode enabled. New suggestions will wait for your approval."
          : "Automatic learning enabled. Sync may update its learned profile after successful conversations.";
        messageIsError = false;
      } catch (cause) { message = errorText(cause); messageIsError = true; }
      finally { toggling = false; render(); }
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
      editingId = item.id; title = item.title; content = item.content; source = item.source || "manual";
      enabled = item.enabled; category = item.category || "general"; importance = Number(item.importance || 3); pinned = Boolean(item.pinned);
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
          editingId = imported.id; title = imported.title; content = imported.content; source = imported.source;
          enabled = imported.enabled; category = imported.category || "general"; importance = Number(imported.importance || 3); pinned = Boolean(imported.pinned);
          message = "Imported and saved locally. Review or edit it below; it will persist after restart."; messageIsError = false;
        }
      } catch (cause) { message = errorText(cause); messageIsError = true; }
      finally { importing = false; render(); }
      return;
    }
    if (action === "save") {
      if (saving || !title.trim() || !content.trim()) return;
      saving = true; message = ""; messageIsError = false; render();
      try {
        const saved = await api.saveMemory({ title:title.trim(),content,source,enabled,category,importance,pinned },editingId);
        await refresh();
        editingId=saved.id; title=saved.title; content=saved.content; source=saved.source; enabled=saved.enabled;
        category=saved.category; importance=saved.importance; pinned=saved.pinned;
        message = "Memory saved locally."; messageIsError = false;
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
        await refresh(); message = "Memory deleted from local storage."; messageIsError = false; render();
      } catch (cause) { message = errorText(cause); messageIsError = true; render(); }
      return;
    }
    if (action === "approve-candidate" || action === "reject-candidate") {
      if (reviewing) return;
      const candidate = candidates.find(item => item.id === id);
      if (!candidate) return;
      const approve = action === "approve-candidate";
      if (approve && !window.confirm("Approve this suggestion and save it as the learned profile?\n\n" + candidate.title)) return;
      reviewing = true; render();
      try {
        const result = await api.reviewMemoryCandidate(id, approve ? "approve" : "reject");
        await refresh();
        message = approve
          ? "Suggestion approved. The learned profile has been saved to Memory."
          : "Suggestion rejected. Your existing memories were left unchanged.";
        messageIsError = false;
      } catch (cause) { message = errorText(cause); messageIsError = true; }
      finally { reviewing = false; render(); }
    }
  });

  root.addEventListener("change", async event => {
    const id = event.target.dataset.memoryToggle;
    if (!id) return;
    try {
      await api.setMemoryEnabled(id, event.target.checked);
      await refresh();
      message = event.target.checked ? "Memory enabled for relevant future prompts." : "Memory disabled. It remains saved but will not be retrieved.";
      messageIsError = false; render();
    } catch (cause) { message = errorText(cause); messageIsError = true; render(); }
  });

  await refresh();
  return () => { disposed = true; root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountMemory = mountMemory;
})();