(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtDate, downloadJson } = window.SyncAI.shared;




async function mountHistory(root, context) {
  let chats = [], selected = null, query = "", loading = true, busy = false, error = "", notice = "";
  function render() {
    root.innerHTML = `
      <section class="shell-page history-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>LOCAL CONVERSATIONS</div>
        <div class="history-toolbar"><div><h1>History</h1><p>Your conversations, stored on this device.</p></div>
          <div class="history-actions"><button type="button" data-history="new" ${busy ? "disabled" : ""}>New chat</button><button type="button" data-history="export" ${busy ? "disabled" : ""}>Export backup</button>
          <label class="history-file-button">Import backup<input id="historyImport" type="file" accept=".json,application/json" ${busy ? "disabled" : ""}></label></div>
        </div>
        ${notice ? '<p class="history-notice" role="status">' + esc(notice) + "</p>" : ""}
        ${error ? '<p class="history-error" role="alert">' + esc(error) + "</p>" : ""}
        <div class="history-layout">
          <aside class="history-list-panel"><input class="history-search" id="historySearch" value="${esc(query)}" placeholder="Search conversations…" aria-label="Search conversations">
            ${loading ? '<p class="history-empty">Loading history…</p>' : chats.length === 0 ? '<p class="history-empty">No conversations found.</p>' :
              '<ul class="history-chat-list">' + chats.map(chat => `
                <li><button class="history-chat-entry${selected?.id === chat.id ? " is-selected" : ""}" data-history="select" data-id="${esc(chat.id)}" type="button">
                  <strong>${esc(chat.title)}</strong><span>${chat.messageCount} messages</span><time>${esc(fmtDate(chat.updatedAt))}</time>
                </button></li>`).join("") + "</ul>"}
          </aside>
          <article class="history-detail-panel">
            ${!selected ? '<p class="history-empty">Select a conversation to view its messages.</p>' : `
              <header class="history-detail-header"><div><h2>${esc(selected.title)}</h2><p>Created ${esc(fmtDate(selected.createdAt))}</p></div>
                <div class="history-actions"><button type="button" data-history="continue" ${busy ? "disabled" : ""}>Continue chat</button><button type="button" data-history="rename" ${busy ? "disabled" : ""}>Rename</button><button type="button" data-history="delete" ${busy ? "disabled" : ""}>Delete</button></div>
              </header>
              <div class="history-messages">${selected.messages.map(message => {
                const d = message.diagnostics || {};
                const fields = [
                  ["Status",d.status],["Model",d.modelLabel ?? d.modelId],["Backend",d.backend],["Backend version",d.backendVersion],
                  ["Prompt tokens",d.promptTokens],["Generated tokens",d.generatedTokens],
                  ["Prompt evaluation",d.promptEvalMs == null ? null : d.promptEvalMs + " ms"],
                  ["Generation time",d.generationMs == null ? null : d.generationMs + " ms"],
                  ["Tokens per second",d.tokensPerSecond],["Context size",d.contextSize],["Maximum context",d.maxContextSize],
                  ["Temperature",d.temperature],["Stop reason",d.stopReason],["Error code",d.errorCode],["Error details",d.errorMessage],
                  ["Started",d.startedAt],["Finished",d.finishedAt],["Generation ID",d.generationId]
                ].filter(([,v]) => v !== null && v !== undefined && v !== "");
                return `<section class="history-message history-message--${esc(message.role)}"><div class="history-message-role">${esc(message.role)}</div><p style="white-space:pre-wrap">${esc(message.body)}</p>
                  ${message.role === "assistant" && message.diagnostics ? '<details class="history-diagnostics"><summary>Message diagnostics</summary><dl>' + fields.map(([label,value]) => '<div class="history-diagnostic-row"><dt>' + esc(label) + '</dt><dd>' + esc(value) + "</dd></div>").join("") + "</dl></details>" : ""}
                </section>`;
              }).join("")}${selected.messages.length === 0 ? '<p class="history-empty">This conversation has no messages yet.</p>' : ""}</div>
            `}
          </article>
        </div>
      </section>`;
  }
  async function refresh(preferredId) {
    loading = true; render();
    try {
      chats = await api.listChats(query);
      const wanted = preferredId || selected?.id;
      const row = chats.find(chat => chat.id === wanted) || chats[0] || null;
      selected = row ? await api.getChat(row.id) : null;
      error = "";
    } catch (cause) { error = errorText(cause); }
    finally { loading = false; render(); }
  }
  async function run(action) {
    if (busy) return;
    busy = true; error = ""; notice = ""; render();
    try {
      if (action === "new") {
        const chat = await api.createChat();
        await refresh(chat.id); notice = "Conversation created.";
      } else if (action === "export") {
        const backup = await api.exportChatBackup();
        downloadJson(backup, "sync-ai-desktop-backup-" + new Date().toISOString().slice(0,10) + ".json");
        notice = "Exported " + backup.chats.length + " conversation(s).";
      } else if (action === "rename" && selected) {
        const title = window.prompt("Rename conversation", selected.title);
        if (title === null || !title.trim()) return;
        await api.renameChat(selected.id, title.trim());
        await refresh(selected.id); notice = "Conversation renamed.";
      } else if (action === "delete" && selected) {
        if (!window.confirm("Delete “" + selected.title + "”? This also deletes its messages.")) return;
        await api.deleteChat(selected.id);
        selected = null; await refresh(); notice = "Conversation deleted.";
      } else if (action === "continue" && selected) {
        context.openChat(selected.id); return;
      }
    } catch (cause) { error = errorText(cause); }
    finally { busy = false; render(); context.onChanged?.(); }
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-history]");
    if (!button) return;
    const action = button.dataset.history;
    if (action === "select") {
      void api.getChat(button.dataset.id).then(chat => { selected = chat; render(); }).catch(cause => { error = errorText(cause); render(); });
    } else void run(action);
  });
  root.addEventListener("input", event => {
    if (event.target.id === "historySearch") {
      query = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void refresh(), 220);
    }
  });
  let searchTimer;
  root.addEventListener("change", async event => {
    if (event.target.id === "historyImport") {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      busy = true; error = ""; notice = ""; render();
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error("Backup exceeds the 50 MiB size limit.");
        const backup = JSON.parse(await file.text());
        const result = await api.importChatBackup(backup);
        await refresh();
        notice = "Imported " + result.importedChats + "; skipped " + result.skippedExistingChats + " existing conversation(s).";
      } catch (cause) { error = errorText(cause); }
      finally { busy = false; render(); context.onChanged?.(); }
    }
  });
  await refresh(context.initialChatId);
  return () => { clearTimeout(searchTimer); root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountHistory = mountHistory;
})();
