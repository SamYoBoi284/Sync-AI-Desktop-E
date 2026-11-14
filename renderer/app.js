(() => {
const { api } = window.SyncAI;
const { pageTitles, navigationSections, esc, errorText } = window.SyncAI.shared;
const { mountChat, mountHistory, mountModels, mountWorkspace, mountTasks, mountLibrary, mountRuntime, mountSettings, mountPreview } = window.SyncAI.pages;

const root = document.getElementById("root");
if (!root) throw new Error("The Sync AI Desktop root element is missing.");

const state = { page: "new-chat", selectedChatId: null, info: null, bridge: "checking", cleanup: null, splash: false };
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
        <div class="shell-topbar-meta"><span class="shell-version-label" id="topbarVersion">BUILD 0.1.0</span><span class="shell-connection-pill is-checking" id="connectionPill"><span class="shell-connection-dot"></span>CONNECTING</span></div>
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
}

async function refreshRecent() {
  const host = document.getElementById("recentChats");
  if (!host) return;
  const query = document.getElementById("recentSearch")?.value.trim() || "";
  try {
    const chats = await api.listChats(query, 40, 0);
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
        <button class="shell-recent-chat" type="button" data-open-chat="${esc(chat.id)}" title="${esc(chat.title)}"><span class="shell-recent-chat-mark" aria-hidden="true">◌</span><span>${esc(chat.title)}</span></button>
      `).join("")}</div>
    `).join("") : '<p class="shell-recent-empty">' + (query ? "No matching conversations." : "Your chats will appear here.") + "</p>";
  } catch (error) {
    host.innerHTML = '<p class="shell-recent-empty">' + esc(errorText(error)) + "</p>";
  }
}

function navigate(page, chatId = null) {
  if (!pageTitles[page]) return;
  if (page === "history" || page === "new-chat") state.selectedChatId = null;
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
      case "models": cleanup = await mountModels(pageHost, context); break;
      case "workspace": cleanup = await mountWorkspace(pageHost, context); break;
      case "tasks": cleanup = await mountTasks(pageHost, context); break;
      case "library": cleanup = await mountLibrary(pageHost, context); break;
      case "runtime": cleanup = await mountRuntime(pageHost, context); break;
      case "settings": cleanup = await mountSettings(pageHost, context); break;
      default: cleanup = await mountPreview(pageHost, context, state.page); break;
    }
    state.cleanup = typeof cleanup === "function" ? cleanup : () => {};
  } catch (error) {
    pageHost.innerHTML = '<section class="shell-page shell-standard-page"><div class="shell-model-message is-error">This page could not be opened: ' + esc(errorText(error)) + '</div></section>';
  }
}

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-nav]");
  if (nav) { navigate(nav.dataset.nav); return; }
  const open = event.target.closest("[data-open-chat]");
  if (open) { navigate("new-chat", open.dataset.openChat); return; }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "new-chat") navigate("new-chat");
  if (action.dataset.action === "go-history") navigate("history");
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
