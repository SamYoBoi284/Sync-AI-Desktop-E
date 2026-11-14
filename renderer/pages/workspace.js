(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtDate } = window.SyncAI.shared;




const blank = () => ({ title: "", kind: "document", content: "", includeInContext: false, sourceChatId: null, sourceMessageId: null });
async function mountWorkspace(root) {
  let artifacts = [], selectedId = null, draft = blank(), query = "", loading = true, saving = false, message = "", error = "";
  function render() {
    root.innerHTML = `
      <section class="shell-page shell-standard-page workspace-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>PERSISTENT WORKSPACE</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">YOUR WORK, KEPT LOCALLY</p><h1>Workspace<span>.</span></h1><p class="shell-page-description">Save useful replies, drafts, code and documents in one local space. Nothing is uploaded.</p></div>
          <button class="workspace-primary-button" data-workspace="new" type="button">＋ New artifact</button></div>
        ${message ? '<p class="workspace-feedback" role="status">' + esc(message) + "</p>" : ""}
        ${error ? '<p class="workspace-feedback is-error" role="alert">' + esc(error) + "</p>" : ""}
        <div class="workspace-layout">
          <aside class="workspace-library-panel"><div class="workspace-panel-heading"><div><span class="workspace-kicker">SAVED MATERIAL</span><strong>${artifacts.length} artifacts</strong></div></div>
            <input class="workspace-search" id="workspaceSearch" value="${esc(query)}" placeholder="Search Workspace…" aria-label="Search Workspace">
            ${loading ? '<p class="workspace-empty">Loading Workspace…</p>' : artifacts.length === 0 ? '<p class="workspace-empty">Your saved replies and documents will appear here.</p>' :
              '<div class="workspace-artifact-list">' + artifacts.map(item => `
                <button class="workspace-artifact-entry${selectedId === item.id ? " is-active" : ""}" type="button" data-workspace="select" data-id="${esc(item.id)}">
                  <span class="workspace-artifact-type">${esc(item.kind.toUpperCase())}</span><strong>${esc(item.title)}</strong><small>${esc(fmtDate(item.updatedAt))}</small>
                  ${item.includeInContext ? '<span class="workspace-context-badge">CHAT CONTEXT</span>' : ""}
                </button>`).join("") + "</div>"}
          </aside>
          <section class="workspace-editor-panel"><div class="workspace-editor-heading"><div><span class="workspace-kicker">${selectedId ? "EDIT ARTIFACT" : "NEW ARTIFACT"}</span><h2>${selectedId ? "Refine your work" : "Create something"}</h2></div>
            ${selectedId ? '<button class="workspace-delete-button" type="button" data-workspace="delete" ' + (saving ? "disabled" : "") + '>Delete</button>' : ""}</div>
            <label class="workspace-field">Title<input name="title" value="${esc(draft.title)}" maxlength="200" placeholder="Give this artifact a name"></label>
            <label class="workspace-field">Type<select name="kind">${["document","report","code","snippet","other"].map(kind => '<option value="' + kind + '" ' + (draft.kind === kind ? "selected" : "") + '>' + kind[0].toUpperCase() + kind.slice(1) + "</option>").join("")}</select></label>
            <label class="workspace-field workspace-content-field">Content<textarea name="content" placeholder="Write or paste content here. Markdown is welcome." spellcheck>${esc(draft.content)}</textarea></label>
            <label class="workspace-context-toggle"><input type="checkbox" name="includeInContext" ${draft.includeInContext ? "checked" : ""}><span><strong>Include in chat context</strong><small>Selected content may be added to future local prompts. It is capped and remains under your control.</small></span></label>
            ${draft.sourceChatId ? '<p class="workspace-source-note">Saved from conversation ' + esc(draft.sourceChatId.slice(0,8)) + "…</p>" : ""}
            <div class="workspace-editor-actions"><button class="workspace-primary-button" type="button" data-workspace="save" ${saving || !draft.title.trim() ? "disabled" : ""}>${saving ? "Saving…" : "Save artifact"}</button><span>Up to 2 MiB per artifact</span></div>
          </section>
        </div>
      </section>`;
  }
  async function refresh(preferredId) {
    loading = true; render();
    try {
      artifacts = await api.listWorkspaceArtifacts(query);
      const selected = artifacts.find(item => item.id === (preferredId ?? selectedId)) || artifacts[0] || null;
      const detail = selected ? await api.getWorkspaceArtifact(selected.id) : null;
      selectedId = detail?.id ?? null;
      draft = detail ? {
        title: detail.title, kind: detail.kind, content: detail.content, includeInContext: detail.includeInContext,
        sourceChatId: detail.sourceChatId, sourceMessageId: detail.sourceMessageId
      } : blank();
      error = "";
    } catch (cause) { error = errorText(cause); }
    finally { loading = false; render(); }
  }
  async function save() {
    if (saving || !draft.title.trim()) return;
    saving = true; message = ""; error = ""; render();
    try {
      const saved = selectedId ? await api.updateWorkspaceArtifact(selectedId, draft) : await api.createWorkspaceArtifact(draft);
      await refresh(saved.id); message = "Saved to Workspace.";
    } catch (cause) { error = errorText(cause); }
    finally { saving = false; render(); }
  }
  async function remove() {
    if (!selectedId || saving || !window.confirm("Delete this Workspace artifact?")) return;
    saving = true; error = ""; render();
    try { await api.deleteWorkspaceArtifact(selectedId); selectedId = null; await refresh(null); message = "Artifact deleted."; }
    catch (cause) { error = errorText(cause); }
    finally { saving = false; render(); }
  }
  let searchTimer;
  root.addEventListener("input", event => {
    if (event.target.id === "workspaceSearch") {
      query = event.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => void refresh(null), 220); return;
    }
    if (event.target.name && Object.hasOwn(draft, event.target.name)) {
      draft[event.target.name] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      const saveButton = root.querySelector('[data-workspace="save"]');
      if (saveButton) saveButton.disabled = saving || !draft.title.trim();
    }
  });
  root.addEventListener("change", event => {
    if (event.target.name === "kind") draft.kind = event.target.value;
    if (event.target.name === "includeInContext") draft.includeInContext = event.target.checked;
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-workspace]");
    if (!button) return;
    const action = button.dataset.workspace;
    if (action === "new") { selectedId = null; draft = blank(); message = ""; error = ""; render(); }
    if (action === "save") void save();
    if (action === "delete") void remove();
    if (action === "select") {
      const item = artifacts.find(entry => entry.id === button.dataset.id);
      if (!item) return;
      void api.getWorkspaceArtifact(item.id).then(detail => {
        selectedId = detail.id; draft = { title: detail.title, kind: detail.kind, content: detail.content, includeInContext: detail.includeInContext, sourceChatId: detail.sourceChatId, sourceMessageId: detail.sourceMessageId };
        message = ""; error = ""; render();
      }).catch(cause => { error = errorText(cause); render(); });
    }
  });
  await refresh(null);
  return () => { clearTimeout(searchTimer); root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountWorkspace = mountWorkspace;
})();
