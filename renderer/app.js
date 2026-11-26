(() => {
const { api } = window.SyncAI;
const { pageTitles, navigationSections, esc, errorText } = window.SyncAI.shared;
const { mountChat, mountHistory, mountFolders, mountModels, mountWorkspace, mountTasks, mountLibrary, mountRuntime, mountSettings, mountPrivacyTools, mountMemory, mountPreview } = window.SyncAI.pages;

const root = document.getElementById("root");
if (!root) throw new Error("The Sync AI Desktop root element is missing.");

const state = { page: "new-chat", selectedChatId: null, selectedFolderId: null, info: null, bridge: "checking", cleanup: null, splash: false, actionStatus: { isRunning: false, activeAction: null }, stopActionBusy: false };
const appMarkup = () => `
  <div class="shell-root" id="appShell">
    <aside class="shell-sidebar" aria-label="Main navigation">
      <div class="shell-brand-lockup"><div class="shell-brand-mark" aria-hidden="true"><span></span><span></span><span></span></div><div><p class="shell-brand-name">SYNC AI</p><p class="shell-brand-caption">DESKTOP SYSTEM</p></div></div>
      <button class="shell-new-chat" type="button" data-action="new-chat"><span aria-hidden="true">+</span><span>New chat</span><kbd>CTRL N</kbd></button>
      <div class="shell-sidebar-content">
        <section class="shell-recent-section" aria-label="Recent conversations">
          <div class="shell-recent-heading"><h2>RECENT CHATS</h2><button type="button" data-action="go-history">SEE ALL</button></div>
          <label class="shell-chat-search"><span aria-hidden="true">⌕</span><input id="recentSearch" placeholder="Search conversations" aria-label="Search recent conversations"><button type="button" id="clearRecentSearch" aria-label="Clear search" hidden>×</button></label>
          <div id="recentChats"><p class="shell-recent-empty">Loading conversations…</p></div>
        </section>
        <section class="shell-recent-section shell-sidebar-folders" aria-label="Chat folders">
          <div class="shell-recent-heading"><h2>FOLDERS</h2><button type="button" data-nav="folders">MANAGE</button></div>
          <div id="chatFolders"><p class="shell-recent-empty">Loading folders…</p></div>
        </section>
        ${navigationSections.map(section => `
          <section class="shell-nav-section"><h2>${section.heading}</h2><ul>${section.entries.map(entry => `
            <li><button class="shell-nav-entry" type="button" data-nav="${entry.id}"><span class="shell-nav-glyph" aria-hidden="true">${entry.glyph}</span><span class="shell-nav-label">${entry.label}</span>${entry.availability === "planned" ? '<span class="shell-nav-status">SOON</span>' : ""}</button></li>
          `).join("")}</ul></section>
        `).join("")}
      </div>
      <div class="shell-sidebar-footer">
        <button class="shell-settings-button" type="button" data-nav="settings"><span aria-hidden="true">⚙</span><span>Settings</span><span class="shell-settings-chevron">›</span></button>
        <div class="shell-local-seal"><span class="shell-seal-dot"></span><span>LOCAL-FIRST</span></div>
        <p>Private by default. Explicit by design.</p>
        <span class="shell-build-label">DESKTOP FOUNDATION · <span id="sidebarVersion">0.1.0</span></span>
      </div>
    </aside>
    <main class="shell-main">
      <header class="shell-topbar">
        <div class="shell-breadcrumb"><span>SYNC AI</span><span class="shell-breadcrumb-slash">/</span><strong id="breadcrumbTitle">NEW CHAT</strong></div>
        <div class="shell-topbar-meta"><span class="shell-action-running" id="actionRunningStatus" hidden>FILE ACTION RUNNING</span><button class="shell-stop-action" id="globalStopAction" type="button" hidden>STOP &amp; RESTORE</button><span class="shell-version-label" id="topbarVersion">BUILD 0.1.0</span><span class="shell-connection-pill is-checking" id="connectionPill"><span class="shell-connection-dot"></span>CONNECTING</span></div>
      </header>
      <div class="shell-page-scroll" id="pageHost"><p class="shell-chat-empty">Preparing your workspace…</p></div>
    </main>
  </div>
  <div id="startupSplash" class="startup-screen" role="status" aria-live="polite" aria-label="Starting Sync AI Desktop" hidden>
    <div class="startup-content">
      <div class="startup-core" aria-hidden="true"><span class="startup-core-ring startup-core-ring--outer"></span><span class="startup-core-ring startup-core-ring--inner"></span><span class="startup-core-orb"></span><span class="startup-core-spark startup-core-spark--one"></span><span class="startup-core-spark startup-core-spark--two"></span></div>
      <div class="startup-brand"><p class="startup-wordmark">SYNC AI</p><p class="startup-edition">DESKTOP SYSTEM</p></div>
      <div class="startup-status"><span class="startup-status-dot"></span><span>INITIALIZING DESKTOP ENVIRONMENT</span></div>
      <div class="startup-progress" aria-hidden="true"><span></span></div><p class="startup-footnote">LOCAL-FIRST · YOUR SPACE IS PREPARING</p>
    </div>
  </div>
`;

root.innerHTML = appMarkup();
let pageHost = document.getElementById("pageHost");
const splash = document.getElementById("startupSplash");

function updateTopbar() {
  document.getElementById("breadcrumbTitle").textContent = (pageTitles[state.page] || "Sync AI").toUpperCase();
  const version = state.info?.version || "0.1.0";
  document.getElementById("topbarVersion").textContent = "BUILD " + version;
  document.getElementById("sidebarVersion").textContent = version;
  const pill = document.getElementById("connectionPill");
  pill.className = "shell-connection-pill is-" + state.bridge;
  pill.innerHTML = '<span class="shell-connection-dot"></span>' + ({
    connected: "ELECTRON HOST CONNECTED", preview: "BRIDGE UNAVAILABLE", checking: "CONNECTING"
  }[state.bridge]);
  document.querySelectorAll("[data-nav]").forEach(button => {
    const active = button.dataset.nav === state.page;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  renderActionStatus();
}

function renderActionStatus() {
  const running = Boolean(state.actionStatus?.isRunning);
  const active = state.actionStatus?.activeAction || null;
  const restoring = active?.state === "restoring";
  const removal = active?.toolId === "file.reversible_remove" || active?.operation === "delete";
  const status = document.getElementById("actionRunningStatus");
  const button = document.getElementById("globalStopAction");
  if (!status || !button) return;
  status.hidden = !running;
  status.textContent = running
    ? (restoring ? "ROLLING BACK · " : "ACTION · ") + (active?.fileName || active?.operation || "FILE OPERATION")
    : "";
  button.hidden = !running;
  button.disabled = state.stopActionBusy;
  button.textContent = state.stopActionBusy
    ? (removal ? "STOPPING & RESTORING…" : "STOPPING & ROLLING BACK…")
    : (removal ? "STOP & RESTORE" : "STOP & ROLLBACK");
  button.setAttribute("aria-label", removal
    ? "Stop the file removal and restore the original file"
    : "Stop the active file operation and roll back its changes where possible");
}

async function stopActiveActionFromUi() {
  if (state.stopActionBusy || !state.actionStatus?.isRunning) return;
  state.stopActionBusy = true;
  renderActionStatus();
  try {
    const result = await api.stopActiveAction();
    state.actionStatus = result?.status || await api.getActionStatus();
  } catch (error) {
    console.error("Could not stop the active file action:", error);
  } finally {
    try { state.actionStatus = await api.getActionStatus(); } catch {}
    state.stopActionBusy = false;
    renderActionStatus();
  }
}

async function refreshRecent() {
  const host = document.getElementById("recentChats"), foldersHost = document.getElementById("chatFolders");
  if (!host) return;
  const query = document.getElementById("recentSearch")?.value.trim() || "";
  try {
    const [chats, folders] = await Promise.all([api.listChats(query, 40, 0), api.listChatFolders()]);
    const groups = new Map();
    for (const chat of chats) {
      const date = new Date(chat.updatedAt), now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const age = Math.floor((today - day) / 86400000);
      const label = Number.isNaN(date.getTime()) ? "OLDER" : age <= 0 ? "TODAY" : age === 1 ? "YESTERDAY" : age < 7 ? "PREVIOUS 7 DAYS" : age < 30 ? "PREVIOUS 30 DAYS" : "OLDER";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(chat);
    }
    host.innerHTML = groups.size ? Array.from(groups, ([label, rows]) => `
      <div class="shell-recent-group"><h3>${label}</h3>${rows.slice(0, 8).map(chat => `
        <div class="shell-recent-chat-row">
          <button class="shell-recent-chat" type="button" data-open-chat="${esc(chat.id)}" title="${esc(chat.title)}"><span class="shell-recent-chat-mark" aria-hidden="true">${chat.isPinned ? "◆" : "◌"}</span><span>${esc(chat.title)}</span>${chat.isPinned ? '<i class="shell-recent-pinned">PIN</i>' : ""}</button>
          <button class="shell-recent-chat-menu-toggle" type="button" data-chat-menu-toggle aria-label="Conversation options for ${esc(chat.title)}" title="Conversation options">⋯</button>
          <div class="shell-chat-context-menu" hidden>
            <button type="button" data-chat-menu-action="rename" data-chat-id="${esc(chat.id)}">Rename</button>
            <button type="button" data-chat-menu-action="move" data-chat-id="${esc(chat.id)}" title="Move this conversation to the top of Recent">Move</button>
            <button type="button" data-chat-menu-action="archive" data-chat-id="${esc(chat.id)}">Archive</button>
            <button type="button" data-chat-menu-action="delete" data-chat-id="${esc(chat.id)}">Delete</button>
            <button type="button" data-chat-menu-action="export" data-chat-id="${esc(chat.id)}">Export</button>
            <button type="button" data-chat-menu-action="pin" data-chat-id="${esc(chat.id)}" data-pinned="${chat.isPinned ? "true" : "false"}">${chat.isPinned ? "Unpin" : "Pin"}</button>
            <button type="button" data-chat-menu-action="folder" data-chat-id="${esc(chat.id)}">Move to Folder <span>›</span></button>
            <div class="shell-chat-folder-options" hidden>
              ${folders.map(folder => '<button type="button" data-chat-folder-option data-chat-id="' + esc(chat.id) + '" data-folder-id="' + esc(folder.id) + '">' + esc(folder.name) + '</button>').join("")}
              <button type="button" class="is-create" data-chat-folder-create data-chat-id="${esc(chat.id)}">＋ New folder…</button>
              ${chat.folderId ? '<button type="button" data-chat-folder-option data-chat-id="' + esc(chat.id) + '" data-folder-id="">Remove from folder</button>' : ""}
            </div>
          </div>
        </div>
      `).join("")}</div>`).join("") : '<p class="shell-recent-empty">' + (query ? "No matching conversations." : "Your chats will appear here.") + "</p>";
    if (foldersHost) foldersHost.innerHTML = folders.length
      ? folders.slice(0, 8).map(folder => '<button type="button" class="shell-sidebar-folder" data-open-folder="' + esc(folder.id) + '"><span>▰</span><span>' + esc(folder.name) + '</span><small>' + folder.chatCount + '</small></button>').join("")
      : '<p class="shell-recent-empty">No folders yet.</p>';
  } catch (error) {
    host.innerHTML = '<p class="shell-recent-empty">' + esc(errorText(error)) + "</p>";
    if (foldersHost) foldersHost.innerHTML = '<p class="shell-recent-empty">' + esc(errorText(error)) + "</p>";
  }
}
function navigate(page, chatId = null) {
  if (!pageTitles[page]) return;
  if (page === "history" || page === "archive" || page === "new-chat") state.selectedChatId = null;
  if (page === "new-chat" && chatId) state.selectedChatId = chatId;
  state.page = page;
  updateTopbar();
  void renderPage();
}

async function renderPage() {
  if (state.cleanup) { try { state.cleanup(); } catch {} state.cleanup = null; }
  const freshHost = pageHost.cloneNode(false);
  pageHost.replaceWith(freshHost);
  pageHost = freshHost;
  pageHost.innerHTML = '<p class="shell-chat-empty">Opening ' + esc(pageTitles[state.page]) + "…</p>";
  const context = {
    navigate,
    openChat: id => navigate("new-chat", id),
    startNewChat: () => navigate("new-chat"),
    appInfo: state.info,
    bridgeKind: state.bridge,
    onChanged: () => { void refreshRecent(); }
  };
  try {
    let cleanup = () => {};
    switch (state.page) {
      case "new-chat": cleanup = await mountChat(pageHost, context, state.selectedChatId); break;
      case "history": cleanup = await mountHistory(pageHost, context); break;
      case "archive": cleanup = await mountHistory(pageHost, context, { archiveOnly: true }); break;
      case "folders": cleanup = await mountFolders(pageHost, context, state.selectedFolderId); break;
      case "models": cleanup = await mountModels(pageHost, context); break;
      case "workspace": cleanup = await mountWorkspace(pageHost, context); break;
      case "tasks": cleanup = await mountTasks(pageHost, context); break;
      case "library": cleanup = await mountLibrary(pageHost, context); break;
      case "runtime": cleanup = await mountRuntime(pageHost, context); break;
      case "settings": cleanup = await mountSettings(pageHost, context); break;
      case "memory": cleanup = await mountMemory(pageHost, context); break;
      case "privacy-tools": cleanup = await mountPrivacyTools(pageHost, context); break;
      default: cleanup = await mountPreview(pageHost, context, state.page); break;
    }
    state.cleanup = typeof cleanup === "function" ? cleanup : () => {};
  } catch (error) {
    pageHost.innerHTML = '<section class="shell-page shell-standard-page"><div class="shell-model-message is-error">This page could not be opened: ' + esc(errorText(error)) + '</div></section>';
  }
}

document.addEventListener("click", event => {
  if (event.target.closest("#globalStopAction")) { void stopActiveActionFromUi(); return; }

  const menuToggle = event.target.closest("[data-chat-menu-toggle]");
  if (menuToggle) {
    const menu = menuToggle.parentElement.querySelector(".shell-chat-context-menu");
    const shouldOpen = Boolean(menu?.hidden);
    document.querySelectorAll(".shell-chat-context-menu").forEach(item => { item.hidden = true; });
    if (menu) menu.hidden = !shouldOpen;
    return;
  }

  const folderOption = event.target.closest("[data-chat-folder-option]");
  if (folderOption) {
    void (async () => {
      try { await api.updateChatMetadata(folderOption.dataset.chatId, { folderId: folderOption.dataset.folderId || null }); }
      catch (error) { window.alert(errorText(error)); }
      await refreshRecent();
    })();
    return;
  }
  const createFolder = event.target.closest("[data-chat-folder-create]");
  if (createFolder) {
    const name = window.prompt("Name the new folder");
    if (name === null || !name.trim()) return;
    void (async () => {
      try {
        const folder = await api.createChatFolder(name.trim());
        await api.updateChatMetadata(createFolder.dataset.chatId, { folderId: folder.id });
      } catch (error) { window.alert(errorText(error)); }
      await refreshRecent();
    })();
    return;
  }
  const chatAction = event.target.closest("[data-chat-menu-action]");
  if (chatAction) {
    if (chatAction.dataset.chatMenuAction === "folder") {
      const submenu = chatAction.parentElement.querySelector(".shell-chat-folder-options");
      if (submenu) submenu.hidden = !submenu.hidden;
      return;
    }
    void (async () => {
      const id = chatAction.dataset.chatId;
      try {
        if (chatAction.dataset.chatMenuAction === "rename") {
          const chat = await api.getChat(id);
          const name = window.prompt("Rename conversation", chat.title);
          if (name === null || !name.trim()) return;
          await api.renameChat(id, name.trim());
        } else if (chatAction.dataset.chatMenuAction === "move") {
          await api.moveChatToTop(id);
        } else if (chatAction.dataset.chatMenuAction === "archive") {
          const chat = await api.getChat(id);
          if (!window.confirm("Archive “" + chat.title + "”? It will remain available in Archive.")) return;
          await api.updateChatMetadata(id, { archived: true });
          if (state.selectedChatId === id) navigate("new-chat");
        } else if (chatAction.dataset.chatMenuAction === "delete") {
          const chat = await api.getChat(id);
          if (!window.confirm("Delete “" + chat.title + "”? This permanently removes its messages from this local database.")) return;
          await api.deleteChat(id);
          if (state.selectedChatId === id) navigate("new-chat");
        } else if (chatAction.dataset.chatMenuAction === "export") {
          const backup = await api.exportChat(id);
          const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url; link.download = "sync-ai-chat-" + id.slice(0, 8) + ".json"; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else if (chatAction.dataset.chatMenuAction === "pin") {
          await api.updateChatMetadata(id, { pinned: chatAction.dataset.pinned !== "true" });
        }
      } catch (error) { window.alert(errorText(error)); }
      finally {
        document.querySelectorAll(".shell-chat-context-menu").forEach(item => { item.hidden = true; });
        await refreshRecent();
      }
    })();
    return;
  }

  const openFolder = event.target.closest("[data-open-folder]");
  if (openFolder) { state.selectedFolderId = openFolder.dataset.openFolder; navigate("folders"); return; }
  const nav = event.target.closest("[data-nav]");
  if (nav) { navigate(nav.dataset.nav); return; }
  const open = event.target.closest("[data-open-chat]");
  if (open) { navigate("new-chat", open.dataset.openChat); return; }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "new-chat") navigate("new-chat");
  if (action.dataset.action === "go-history") navigate("history");
});
window.SyncAI.onActionEvent(payload => {
  state.actionStatus = payload?.status || { isRunning: false, activeAction: null };
  renderActionStatus();
});

document.getElementById("recentSearch").addEventListener("input", () => {
  document.getElementById("clearRecentSearch").hidden = !document.getElementById("recentSearch").value;
  void refreshRecent();
});
document.getElementById("clearRecentSearch").addEventListener("click", () => {
  document.getElementById("recentSearch").value = "";
  document.getElementById("clearRecentSearch").hidden = true;
  void refreshRecent();
});
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault(); navigate("new-chat");
  }
});

async function bootstrap() {
  const started = Date.now();
  try {
    state.splash = await api.consumeStartupSplash();
    state.info = await api.getAppInfo();
    state.actionStatus = await api.getActionStatus();
    state.bridge = "connected";
  } catch (error) {
    state.bridge = "preview";
    console.error("Desktop bridge initialization failed:", error);
  }
  updateTopbar();
  await Promise.all([refreshRecent(), renderPage()]);
  if (state.splash) {
    splash.hidden = false;
    splash.style.display = "grid";
    document.getElementById("appShell").setAttribute("aria-hidden", "true");
    setTimeout(() => {
      splash.hidden = true;
      splash.style.display = "none";
      document.getElementById("appShell").removeAttribute("aria-hidden");
    }, Math.max(850 - (Date.now() - started), 0));
  }
  try { window.syncAI?.rendererReady?.(); } catch {}
}
void bootstrap();

})();
