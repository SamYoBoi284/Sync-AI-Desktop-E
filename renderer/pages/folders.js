(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtDate } = window.SyncAI.shared;
async function mountFolders(root, context, initialFolderId = null) {
  let folders = [], chats = [], selectedId = initialFolderId, busy = false, message = "", error = "";
  function render() {
    const selected = folders.find(folder => folder.id === selectedId) || null;
    root.innerHTML = `
      <section class="shell-page shell-standard-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>CONVERSATION ORGANIZATION</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">LOCAL CHAT LIBRARY</p><h1>Folders<span>.</span></h1><p class="shell-page-description">Group related conversations into named folders. Moving a chat never deletes or rewrites its messages.</p></div><button type="button" class="shell-model-import" data-folder="create" ${busy ? "disabled" : ""}>New folder +</button></div>
        ${message ? '<p class="shell-chat-notice" role="status">' + esc(message) + "</p>" : ""}
        ${error ? '<p class="shell-chat-alert" role="alert">' + esc(error) + "</p>" : ""}
        <div class="shell-folder-layout">
          <aside class="shell-folder-list">
            ${folders.length ? folders.map(folder => `
              <button class="shell-folder-entry ${folder.id === selectedId ? "is-selected" : ""}" type="button" data-folder="select" data-id="${esc(folder.id)}"><span class="shell-folder-symbol">▰</span><span><strong>${esc(folder.name)}</strong><small>${folder.chatCount} active conversations</small></span><span class="shell-folder-arrow">›</span></button>`).join("") : '<p class="shell-details-note">No folders yet. Create one to organize your chats.</p>'}
          </aside>
          <section class="shell-folder-detail">
            ${selected ? `
              <header><div><p class="shell-section-kicker">SELECTED FOLDER</p><h2>${esc(selected.name)}</h2></div><div class="shell-folder-actions"><button type="button" data-folder="rename" ${busy ? "disabled" : ""}>Rename</button><button type="button" class="is-danger" data-folder="delete" ${busy ? "disabled" : ""}>Delete folder</button></div></header>
              ${chats.length ? '<div class="shell-folder-chat-list">' + chats.map(chat => `
                <div class="shell-folder-chat-row"><button type="button" data-folder="open-chat" data-chat-id="${esc(chat.id)}"><strong>${esc(chat.title)}</strong><small>${chat.messageCount} messages · ${esc(fmtDate(chat.updatedAt))}</small></button><button type="button" data-folder="remove-chat" data-chat-id="${esc(chat.id)}" title="Move out of this folder">Remove from folder</button></div>`).join("") + "</div>" : '<p class="shell-details-note">This folder is empty. Use a conversation menu → Move to Folder to add chats here.</p>'}
            ` : '<p class="shell-details-note">Select a folder to view the conversations inside it.</p>'}
          </section>
        </div>
      </section>`;
  }
  async function refresh() {
    try {
      folders = await api.listChatFolders();
      if (!folders.some(folder => folder.id === selectedId)) selectedId = folders[0]?.id || null;
      chats = selectedId ? await api.listChats("", 200, 0, { folderId: selectedId }) : [];
      error = "";
    } catch (cause) { error = errorText(cause); }
    render();
  }
  async function run(action, button) {
    if (busy) return;
    busy = true; error = ""; message = ""; render();
    try {
      if (action === "create") {
        const name = window.prompt("Name the new folder");
        if (name === null || !name.trim()) return;
        const created = await api.createChatFolder(name.trim());
        selectedId = created.id; message = "Folder created.";
      } else if (action === "rename" && selectedId) {
        const current = folders.find(item => item.id === selectedId);
        const name = window.prompt("Rename folder", current?.name || "");
        if (name === null || !name.trim()) return;
        await api.renameChatFolder(selectedId, name.trim()); message = "Folder renamed.";
      } else if (action === "delete" && selectedId) {
        const current = folders.find(item => item.id === selectedId);
        if (!window.confirm("Delete folder “" + (current?.name || "") + "”? Its conversations will remain in History and become unfiled.")) return;
        await api.deleteChatFolder(selectedId); selectedId = null; message = "Folder deleted. Its chats remain intact.";
      } else if (action === "remove-chat") {
        await api.updateChatMetadata(button.dataset.chatId, { folderId: null }); message = "Conversation moved out of this folder.";
      } else if (action === "open-chat") {
        context.openChat(button.dataset.chatId); return;
      }
    } catch (cause) { error = errorText(cause); }
    finally { busy = false; await refresh(); context.onChanged?.(); }
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-folder]");
    if (!button) return;
    const action = button.dataset.folder;
    if (action === "select") { selectedId = button.dataset.id; void refresh(); }
    else void run(action, button);
  });
  await refresh();
  return () => root.replaceChildren();
}
window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountFolders = mountFolders;
})();