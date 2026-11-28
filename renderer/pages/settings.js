(() => {
const { api } = window.SyncAI;
const { esc, errorText } = window.SyncAI.shared;

async function mountSettings(root, context) {
  let quickAskPreferences = { shortcut: "CommandOrControl+Shift+Space", modelSelection: { mode: "default", customModelId: null } };
  let quickAskShortcutDraft = "CommandOrControl+Shift+Space";
  let quickAskModels = [];
  let quickAskMessage = "", quickAskSaving = false, loading = true;

  function render() {
    root.innerHTML = `
      <section class="shell-page shell-standard-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>PREFERENCES AND CONTROL</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">SYNC AI CONFIGURATION</p><h1>Settings<span>.</span></h1><p class="shell-page-description">Choose a settings category, then adjust the parts of Sync you want to personalize.</p></div><span class="shell-large-status"><span></span>SETTINGS</span></div>
        <div class="shell-settings-grid">
          <button class="shell-settings-card" type="button" data-settings="appearance"><span class="shell-settings-card-icon">◐</span><span><strong>Appearance</strong><small>Theme, colors, interface density and chat style</small></span><span class="shell-settings-card-arrow">›</span></button>
          <button class="shell-settings-card" type="button" data-settings="performance"><span class="shell-settings-card-icon">⌁</span><span><strong>Performance</strong><small>Low-Memory Mode, RAM limits and motion preferences</small></span><span class="shell-settings-card-arrow">›</span></button>
          <button class="shell-settings-card" type="button" data-settings="runtime"><span class="shell-settings-card-icon">◫</span><span><strong>Runtime</strong><small>Worker status, context allocation and diagnostics</small></span><span class="shell-settings-card-arrow">›</span></button>
          <button class="shell-settings-card" type="button" data-settings="memory"><span class="shell-settings-card-icon">✧</span><span><strong>Memory</strong><small>Manage durable context and what Sync retrieves</small></span><span class="shell-settings-card-arrow">›</span></button>
        </div>
        <section class="shell-settings-panel">
          <div class="shell-panel-heading"><div><p class="shell-section-kicker">PHASE 2 · DESKTOP INTEGRATION</p><h2>Quick Ask</h2></div><span class="shell-panel-tag">GLOBAL SHORTCUT</span></div>
          <p class="shell-settings-intro">Open a compact floating chat without switching to the full Sync window. Quick Ask reuses an already-loaded model. When no model is loaded, it can temporarily load one using the selection rule below and unload it when the overlay closes.</p>
          ${loading ? '<p class="shell-settings-footnote">Loading Quick Ask preferences…</p>' : `
            <label class="quick-ask-setting-field"><span><strong>Global shortcut</strong><small>Use an Electron accelerator such as CommandOrControl+Shift+Space.</small></span><input id="quickAskShortcut" type="text" maxlength="64" value="${esc(quickAskShortcutDraft)}" ${quickAskSaving ? "disabled" : ""}></label>
            <label class="quick-ask-setting-field"><span><strong>Temporary model selection</strong><small>Used only when no model is already loaded.</small></span>
              <select id="quickAskModelMode" ${quickAskSaving ? "disabled" : ""}>
                <option value="default" ${quickAskPreferences.modelSelection.mode === "default" ? "selected" : ""}>Default</option>
                <option value="smallest" ${quickAskPreferences.modelSelection.mode === "smallest" ? "selected" : ""}>Smallest</option>
                <option value="most-recent" ${quickAskPreferences.modelSelection.mode === "most-recent" ? "selected" : ""}>Most Recent</option>
                <option value="custom" ${quickAskPreferences.modelSelection.mode === "custom" ? "selected" : ""}>Custom</option>
              </select>
            </label>
            ${quickAskPreferences.modelSelection.mode === "custom" ? `
              <label class="quick-ask-setting-field"><span><strong>Custom GGUF model</strong><small>Choose an available model already registered in Local models.</small></span>
                <select id="quickAskCustomModel" ${quickAskSaving ? "disabled" : ""}>
                  <option value="">Choose a model…</option>
                  ${quickAskModels.filter(model => model.isAvailable).map(model => `<option value="${esc(model.id)}" ${quickAskPreferences.modelSelection.customModelId === model.id ? "selected" : ""}>${esc(model.name)} · ${(Number(model.sizeBytes) / (1024 ** 3)).toFixed(2)} GB</option>`).join("")}
                </select>
              </label>
            ` : ""}
            <p class="shell-settings-footnote">Most Recent means the model last loaded by Sync on this device; before one has been used, it falls back to the most recently imported available model. The existing loaded model always takes priority and is never unloaded by Quick Ask.</p>
            <button type="button" data-settings="save-quick-ask" ${quickAskSaving ? "disabled" : ""}>${quickAskSaving ? "Saving…" : "Save Quick Ask settings"}</button>
          `}
          ${quickAskMessage ? '<p class="shell-settings-feedback" role="status">' + esc(quickAskMessage) + "</p>" : ""}
        </section>
        <div class="shell-settings-grid shell-settings-secondary">
          <button class="shell-settings-card" type="button" data-settings="models"><span class="shell-settings-card-icon">◈</span><span><strong>Local models</strong><small>GGUF library, original file paths and model selection.</small></span><span class="shell-settings-card-arrow">›</span></button>
          <button class="shell-settings-card" type="button" data-settings="privacy-tools"><span class="shell-settings-card-icon">⌑</span><span><strong>Privacy &amp; Tools</strong><small>Review tool approvals, action history and local data boundaries.</small></span><span class="shell-settings-card-arrow">›</span></button>
        </div>
      </section>`;
  }

  try {
    const [savedPreferences, modelList] = await Promise.all([
      api.getQuickAskPreferences(), api.listModels()
    ]);
    quickAskPreferences = savedPreferences || quickAskPreferences;
    quickAskShortcutDraft = quickAskPreferences.shortcut || quickAskShortcutDraft;
    quickAskModels = Array.isArray(modelList) ? modelList : [];
  } catch (cause) {
    quickAskMessage = "Could not load Quick Ask settings: " + errorText(cause);
  } finally {
    loading = false;
    render();
  }

  root.addEventListener("input", event => {
    if (event.target.id === "quickAskShortcut") quickAskShortcutDraft = event.target.value;
  });

  root.addEventListener("change", event => {
    if (event.target.id === "quickAskModelMode") {
      quickAskPreferences.modelSelection.mode = event.target.value;
      render();
    }
    if (event.target.id === "quickAskCustomModel") quickAskPreferences.modelSelection.customModelId = event.target.value || null;
  });

  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-settings]");
    if (!button) return;
    const action = button.dataset.settings;
    if (["appearance","performance","runtime","memory","models","privacy-tools"].includes(action)) {
      context.navigate(action);
      return;
    }
    if (action === "save-quick-ask" && !quickAskSaving) {
      quickAskSaving = true;
      quickAskMessage = "";
      render();
      try {
        const preferences = {
          shortcut: root.querySelector("#quickAskShortcut")?.value || "",
          modelSelection: {
            mode: root.querySelector("#quickAskModelMode")?.value || "default",
            customModelId: root.querySelector("#quickAskCustomModel")?.value || null
          }
        };
        quickAskPreferences = await api.setQuickAskPreferences(preferences);
        quickAskShortcutDraft = quickAskPreferences.shortcut;
        quickAskMessage = "Saved. Quick Ask is available from the global shortcut or system tray.";
      } catch (cause) {
        quickAskMessage = "Could not save Quick Ask settings: " + errorText(cause);
      } finally {
        quickAskSaving = false;
        render();
      }
    }
  });

  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountSettings = mountSettings;
})();