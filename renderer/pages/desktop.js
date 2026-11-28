(() => {
const { api } = window.SyncAI;
const { esc, errorText, pageEyebrow } = window.SyncAI.shared;

const DEFAULTS = Object.freeze({
  closeToTray: true,
  unloadModelOnExit: true
});

async function mountDesktop(root) {
  let preferences = { ...DEFAULTS };
  let saved = { ...DEFAULTS };
  let loading = true;
  let saving = false;
  let message = "";

  function render() {
    const dirty = preferences.closeToTray !== saved.closeToTray ||
      preferences.unloadModelOnExit !== saved.unloadModelOnExit;
    root.innerHTML = `
      <section class="shell-page shell-standard-page desktop-page">
        ${pageEyebrow("DESKTOP INTEGRATION")}
        <div class="shell-page-heading-row">
          <div>
            <p class="shell-section-kicker">WINDOW &amp; EXIT BEHAVIOR</p>
            <h1>Desktop<span>.</span></h1>
            <p class="shell-page-description">Choose how Sync behaves when you close its window or exit from the system tray.</p>
          </div>
          <span class="shell-large-status"><span></span>LOCAL CONTROL</span>
        </div>

        ${loading ? '<section class="shell-settings-panel"><p class="shell-settings-footnote">Loading desktop preferences…</p></section>' : `
          <section class="shell-settings-panel">
            <div class="shell-panel-heading">
              <div><p class="shell-section-kicker">01 · WINDOW CLOSE</p><h2>Close to tray</h2></div>
              <span class="shell-panel-tag">OPTIONAL</span>
            </div>
            <label class="shell-ram-toggle">
              <span><strong>Keep Sync running when the window closes</strong><small>Closing the main window hides Sync in the system tray. Use Exit Sync AI from the tray menu to quit completely.</small></span>
              <input id="closeToTray" type="checkbox" ${preferences.closeToTray ? "checked" : ""} ${saving ? "disabled" : ""}>
            </label>
            <p class="shell-settings-footnote">When disabled, the main window's close button exits Sync AI instead of hiding it. The separate Hide Sync AI tray command always remains available.</p>
          </section>

          <section class="shell-settings-panel">
            <div class="shell-panel-heading">
              <div><p class="shell-section-kicker">02 · MODEL CLEANUP</p><h2>Unload model on exit</h2></div>
              <span class="shell-panel-tag">RESOURCE CLEANUP</span>
            </div>
            <label class="shell-ram-toggle">
              <span><strong>Gracefully unload the active model</strong><small>Ask the inference worker to release model and llama.cpp resources before Sync exits.</small></span>
              <input id="unloadModelOnExit" type="checkbox" ${preferences.unloadModelOnExit ? "checked" : ""} ${saving ? "disabled" : ""}>
            </label>
            <p class="shell-settings-footnote">When disabled, Sync terminates the worker directly during application exit. The operating system still reclaims its memory when the process ends.</p>
          </section>

          <div class="appearance-footer">
            <span class="appearance-feedback" role="status">${esc(message)}</span>
            <button type="button" class="appearance-save" data-desktop-action="save" ${!dirty || saving ? "disabled" : ""}>${saving ? "Saving…" : "Save desktop preferences"}</button>
          </div>
        `}
      </section>`;
  }

  try {
    const result = await api.getDesktopBehaviorPreferences();
    preferences = { ...DEFAULTS, ...(result || {}) };
    saved = { ...preferences };
  } catch (cause) {
    message = "Could not load desktop preferences: " + errorText(cause);
  } finally {
    loading = false;
    render();
  }

  root.addEventListener("change", event => {
    if (event.target.id === "closeToTray") preferences.closeToTray = event.target.checked;
    if (event.target.id === "unloadModelOnExit") preferences.unloadModelOnExit = event.target.checked;
    render();
  });

  root.addEventListener("click", async event => {
    if (event.target.closest('[data-desktop-action="save"]') == null || saving) return;
    saving = true;
    message = "";
    render();
    try {
      preferences = await api.setDesktopBehaviorPreferences(preferences);
      saved = { ...preferences };
      message = "Desktop preferences saved on this device.";
    } catch (cause) {
      message = "Could not save desktop preferences: " + errorText(cause);
    } finally {
      saving = false;
      render();
    }
  });

  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountDesktop = mountDesktop;
})();