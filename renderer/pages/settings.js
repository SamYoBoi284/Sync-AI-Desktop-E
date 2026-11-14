(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtRam } = window.SyncAI.shared;




const KEY = "ram_limiter";
const toGb = bytes => bytes / (1024 ** 3);
const suggested = info => Math.max(1, Math.floor(Math.max(1, toGb(info.totalBytes) - 3)));
async function mountSettings(root, context) {
  let ram = null, config = { enabled: false, limitGb: 4 }, saved = { enabled: false, limitGb: 4 };
  let loading = true, saving = false, message = "";
  function render() {
    const maxGb = ram ? Math.max(1, Math.floor(toGb(ram.totalBytes) - 2)) : 1;
    const dirty = config.enabled !== saved.enabled || config.limitGb !== saved.limitGb;
    root.innerHTML = `
      <section class="shell-page shell-standard-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>PREFERENCES AND CONTROL</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">SYNC AI CONFIGURATION</p><h1>Settings<span>.</span></h1><p class="shell-page-description">Configure local resource preferences and desktop behavior.</p></div><span class="shell-large-status"><span></span>SETTINGS FOUNDATION</span></div>
        <div class="shell-settings-grid">
          <button class="shell-settings-card" type="button" data-settings="appearance"><span class="shell-settings-card-icon">◐</span><span><strong>Appearance</strong><small>Theme, accent color and motion preferences</small></span><span class="shell-settings-card-arrow">›</span></button>
          <button class="shell-settings-card" type="button" data-settings="runtime"><span class="shell-settings-card-icon">⌁</span><span><strong>Runtime</strong><small>Worker memory, native diagnostics and host information</small></span><span class="shell-settings-card-arrow">›</span></button>
        </div>
        <section class="shell-settings-panel"><div class="shell-panel-heading"><div><p class="shell-section-kicker">INFERENCE RESOURCE CONTROL</p><h2>RAM Limiter</h2></div><span class="shell-panel-tag">OPTIONAL · OFF BY DEFAULT</span></div>
          <p class="shell-settings-intro">Places the isolated llama.cpp worker inside a Windows Job Object with a hard private-memory commit ceiling. The limit includes model allocations and inference context, so a model that needs more than the ceiling may fail to load. The main Sync AI desktop process stays outside that limit.</p>
          ${loading ? '<p class="shell-settings-footnote">Detecting system memory…</p>' : ram ? `
            <div class="shell-ram-stats"><div><small>INSTALLED RAM</small><strong>${toGb(ram.totalBytes).toFixed(1)} GB</strong></div><div><small>CURRENTLY AVAILABLE</small><strong>${toGb(ram.availableBytes).toFixed(1)} GB</strong></div><div><small>MAXIMUM CEILING</small><strong>${maxGb} GB</strong></div></div>
            <label class="shell-ram-toggle"><span><strong>Enable RAM Limiter</strong><small>Enforce a hard process-memory ceiling on the inference worker.</small></span><input id="ramEnabled" type="checkbox" ${config.enabled ? "checked" : ""} ${saving ? "disabled" : ""}></label>
            <div class="shell-ram-slider ${!config.enabled ? "is-disabled" : ""}"><div class="shell-ram-slider-heading"><label for="ram-limit">Worker memory ceiling</label><strong>${config.limitGb} GB</strong></div>
              <input id="ram-limit" type="range" min="1" max="${maxGb}" step="1" value="${Math.min(config.limitGb,maxGb)}" ${!config.enabled || saving ? "disabled" : ""}>
              <div class="shell-ram-slider-scale"><span>1 GB</span><span>${maxGb} GB</span></div><small>This limits committed private memory, not resident working-set size. Runtime diagnostics report both measurements separately.</small>
            </div>
            <button type="button" data-settings="save" ${!dirty || saving ? "disabled" : ""}>${saving ? "Saving…" : "Save RAM Limiter"}</button>
          ` : '<p class="shell-settings-footnote">RAM detection requires the native desktop host.</p>'}
          ${message ? '<p class="shell-settings-feedback" role="status">' + esc(message) + "</p>" : ""}
        </section>
        <div class="shell-settings-grid shell-settings-secondary">
          <button class="shell-settings-card" type="button" data-settings="models"><span class="shell-settings-card-icon">◈</span><span><strong>Local models</strong><small>GGUF library, original file paths and model selection.</small></span><span class="shell-settings-card-arrow">›</span></button>
          <div class="shell-settings-card is-staged"><span class="shell-settings-card-icon">⌑</span><span><strong>Privacy and permissions</strong><small>Explicit approval controls arrive with the secure tool system.</small></span><span class="shell-settings-card-state">PLANNED</span></div>
        </div>
        <p class="shell-settings-footnote">Changing the saved ceiling does not resize a running worker. Unload and load the model again to apply a new limit. No model is loaded automatically at startup.</p>
      </section>`;
  }
  try {
    const [info, raw] = await Promise.all([api.getHostRamInfo(), api.getSetting(KEY)]);
    ram = info;
    let parsed;
    try { parsed = raw ? JSON.parse(raw) : undefined; } catch {}
    const max = Math.max(1, Math.floor(toGb(info.totalBytes) - 2));
    config = { enabled: parsed?.enabled === true, limitGb: Math.min(max, Math.max(1, parsed?.limitGb ?? suggested(info))) };
    saved = { ...config };
  } catch { message = "Hardware information is available only in the desktop app."; }
  finally { loading = false; render(); }

  root.addEventListener("change", event => {
    if (event.target.id === "ramEnabled") { config.enabled = event.target.checked; render(); }
    if (event.target.id === "ram-limit") { config.limitGb = Number(event.target.value); render(); }
  });
  root.addEventListener("click", async event => {
    const button = event.target.closest("[data-settings]");
    if (!button) return;
    const action = button.dataset.settings;
    if (action === "appearance") context.navigate("appearance");
    if (action === "runtime") context.navigate("runtime");
    if (action === "models") context.navigate("models");
    if (action === "save" && !saving) {
      saving = true; message = ""; render();
      try {
        await api.setSetting(KEY, JSON.stringify(config));
        saved = { ...config };
        message = "Saved. The new ceiling applies the next time a model is loaded.";
      } catch (cause) { message = "Could not save this setting: " + errorText(cause); }
      finally { saving = false; render(); }
    }
  });
  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountSettings = mountSettings;
})();
