(() => {
const { api } = window.SyncAI;
const { esc, errorText, pageEyebrow } = window.SyncAI.shared;
const KEY = "appearance_preferences";
const DEFAULTS = Object.freeze({
  theme: "system",
  accent: "#a879ff",
  density: "comfortable",
  chatStyle: "soft",
  fontSize: 14,
  motion: "system"
});
const ACCENTS = [
  { name: "Violet", value: "#a879ff" },
  { name: "Cyan", value: "#48c9df" },
  { name: "Blue", value: "#6595ff" },
  { name: "Green", value: "#55c99a" },
  { name: "Rose", value: "#ed83ad" },
  { name: "Amber", value: "#e7b45e" }
];
const validHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ""));
function normalize(value) {
  const next = { ...DEFAULTS, ...(value && typeof value === "object" ? value : {}) };
  if (!["system", "dark", "light"].includes(next.theme)) next.theme = DEFAULTS.theme;
  if (!validHex(next.accent)) next.accent = DEFAULTS.accent;
  if (!["comfortable", "compact"].includes(next.density)) next.density = DEFAULTS.density;
  if (!["soft", "outline"].includes(next.chatStyle)) next.chatStyle = DEFAULTS.chatStyle;
  next.fontSize = Math.min(18, Math.max(12, Number(next.fontSize) || DEFAULTS.fontSize));
  if (!["system", "full", "reduced", "off"].includes(next.motion)) next.motion = DEFAULTS.motion;
  return next;
}
function applyPreferences(value) {
  const prefs = normalize(value);
  const html = document.documentElement;
  html.dataset.syncTheme = prefs.theme;
  html.dataset.syncDensity = prefs.density;
  html.dataset.syncChatStyle = prefs.chatStyle;
  html.dataset.syncMotion = prefs.motion;
  html.style.setProperty("--accent", prefs.accent);
  html.style.setProperty("--accent-soft", prefs.accent);
  html.style.setProperty("--sync-chat-font-size", prefs.fontSize + "px");
  return prefs;
}
async function mountAppearance(root) {
  let prefs = { ...DEFAULTS }, saved = { ...DEFAULTS }, loading = true, saving = false, feedback = "";
  function render() {
    const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
    root.innerHTML = `
      <section class="shell-page shell-standard-page appearance-page">
        ${pageEyebrow("PERSONALIZATION")}
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">MAKE THE SPACE YOURS</p><h1>Appearance<span>.</span></h1><p class="shell-page-description">Tune Sync's colors, layout density, chat presentation and motion. Changes preview immediately and are saved locally.</p></div><span class="shell-large-status"><span></span>LIVE PREVIEW</span></div>
        ${loading ? '<section class="appearance-panel"><p class="shell-settings-footnote">Loading saved appearance…</p></section>' : `
        <section class="appearance-panel">
          <div class="appearance-section-head"><div><p class="shell-section-kicker">01 · THEME</p><h2>Color mode</h2><p>Choose how Sync adapts to your environment.</p></div></div>
          <div class="appearance-choice-grid appearance-theme-grid">
            ${[["system","System","Follow Windows appearance","monitor"],["dark","Dark","The original Sync atmosphere","moon"],["light","Light","A brighter workspace","sun"]].map(([value,label,desc,glyph]) => `
              <button type="button" class="appearance-choice ${prefs.theme===value?"is-selected":""}" data-pref="theme" data-value="${value}" aria-pressed="${prefs.theme===value}">
                <span class="appearance-choice-glyph" aria-hidden="true">${glyph==="monitor"?"▣":glyph==="moon"?"◐":"☼"}</span><span><strong>${label}</strong><small>${desc}</small></span><i></i>
              </button>`).join("")}
          </div>
        </section>
        <section class="appearance-panel">
          <div class="appearance-section-head"><div><p class="shell-section-kicker">02 · ACCENT</p><h2>Accent color</h2><p>Used for focus states, selected controls and highlights.</p></div><span class="appearance-accent-chip" style="--choice-accent:${prefs.accent}"></span></div>
          <div class="appearance-accent-options">
            ${ACCENTS.map(item => `<button type="button" class="appearance-swatch ${prefs.accent===item.value?"is-selected":""}" data-pref="accent" data-value="${item.value}" style="--swatch:${item.value}" aria-label="${item.name}" aria-pressed="${prefs.accent===item.value}" title="${item.name}"></button>`).join("")}
            <label class="appearance-custom-color"><span>Custom</span><input type="color" id="appearanceCustomAccent" value="${prefs.accent}" aria-label="Choose custom accent color"></label>
          </div>
        </section>
        <section class="appearance-panel">
          <div class="appearance-section-head"><div><p class="shell-section-kicker">03 · LAYOUT</p><h2>Interface density</h2><p>Choose how much breathing room appears between controls and panels.</p></div></div>
          <div class="appearance-segment">
            <button type="button" data-pref="density" data-value="comfortable" class="${prefs.density==="comfortable"?"is-selected":""}" aria-pressed="${prefs.density==="comfortable"}">Comfortable</button>
            <button type="button" data-pref="density" data-value="compact" class="${prefs.density==="compact"?"is-selected":""}" aria-pressed="${prefs.density==="compact"}">Compact</button>
          </div>
        </section>
        <section class="appearance-panel">
          <div class="appearance-section-head"><div><p class="shell-section-kicker">04 · CHAT</p><h2>Message presentation</h2><p>Adjust the feel and readability of conversation messages.</p></div></div>
          <div class="appearance-field-row"><div><strong>Message style</strong><small>Soft surfaces or a more defined outline.</small></div>
            <div class="appearance-segment"><button type="button" data-pref="chatStyle" data-value="soft" class="${prefs.chatStyle==="soft"?"is-selected":""}" aria-pressed="${prefs.chatStyle==="soft"}">Soft</button><button type="button" data-pref="chatStyle" data-value="outline" class="${prefs.chatStyle==="outline"?"is-selected":""}" aria-pressed="${prefs.chatStyle==="outline"}">Outlined</button></div>
          </div>
          <div class="appearance-field-row"><div><strong>Message text size</strong><small>Current size: ${prefs.fontSize}px</small></div><input class="appearance-range" id="appearanceFontSize" type="range" min="12" max="18" step="1" value="${prefs.fontSize}" aria-label="Message text size"></div>
          <div class="appearance-chat-preview"><span>PREVIEW · YOU</span><p style="font-size:${prefs.fontSize}px">Hey Sync, this is how your messages will look.</p><span>PREVIEW · SYNC AI</span><p class="is-assistant" style="font-size:${prefs.fontSize}px">Got it. Your conversation will use these settings.</p></div>
        </section>
        <section class="appearance-panel">
          <div class="appearance-section-head"><div><p class="shell-section-kicker">05 · MOTION</p><h2>Animation preferences</h2><p>Keep the interface responsive and comfortable on your hardware.</p></div></div>
          <div class="appearance-segment appearance-motion-options">
            <button type="button" data-pref="motion" data-value="system" class="${prefs.motion==="system"?"is-selected":""}" aria-pressed="${prefs.motion==="system"}">System</button>
            <button type="button" data-pref="motion" data-value="full" class="${prefs.motion==="full"?"is-selected":""}" aria-pressed="${prefs.motion==="full"}">Full</button>
            <button type="button" data-pref="motion" data-value="reduced" class="${prefs.motion==="reduced"?"is-selected":""}" aria-pressed="${prefs.motion==="reduced"}">Reduced</button>
            <button type="button" data-pref="motion" data-value="off" class="${prefs.motion==="off"?"is-selected":""}" aria-pressed="${prefs.motion==="off"}">Off</button>
          </div>
          <p class="appearance-hint">System follows Windows' reduced-motion preference. Reduced and Off minimize interface animation.</p>
        </section>
        <div class="appearance-footer"><button type="button" class="appearance-reset" data-appearance-action="reset" ${saving?"disabled":""}>Restore defaults</button><span class="appearance-feedback" role="status">${esc(feedback)}</span><button type="button" class="appearance-save" data-appearance-action="save" ${!dirty||saving?"disabled":""}>${saving?"Saving…":"Save preferences"}</button></div>
        `}
      </section>`;
  }
  function update(next) {
    prefs = normalize(next);
    applyPreferences(prefs);
    render();
  }
  try {
    const raw = await api.getSetting(KEY);
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    prefs = normalize(parsed);
    saved = { ...prefs };
    applyPreferences(prefs);
  } catch (cause) {
    feedback = "Could not load saved preferences: " + errorText(cause);
    applyPreferences(prefs);
  } finally { loading = false; render(); }

  root.addEventListener("click", async event => {
    const choice = event.target.closest("[data-pref]");
    if (choice) { update({ ...prefs, [choice.dataset.pref]: choice.dataset.value }); return; }
    const action = event.target.closest("[data-appearance-action]")?.dataset.appearanceAction;
    if (!action) return;
    if (action === "reset") { feedback = "Defaults restored in the preview. Save to keep them."; update({ ...DEFAULTS }); return; }
    if (action === "save" && !saving) {
      saving = true; feedback = ""; render();
      try {
        await api.setSetting(KEY, JSON.stringify(prefs));
        saved = { ...prefs };
        feedback = "Appearance preferences saved on this device.";
      } catch (cause) { feedback = "Could not save preferences: " + errorText(cause); }
      finally { saving = false; render(); }
    }
  });
  root.addEventListener("input", event => {
    if (event.target.id === "appearanceCustomAccent") update({ ...prefs, accent: event.target.value });
    if (event.target.id === "appearanceFontSize") update({ ...prefs, fontSize: Number(event.target.value) });
  });
  return () => root.replaceChildren();
}
async function mountPreview(root, _context, page) {
  root.innerHTML = `<div class="shell-page shell-standard-page">${pageEyebrow("PLANNED FEATURE")}<section class="shell-preview-panel"><div class="shell-preview-symbol" aria-hidden="true">⌁</div><span class="shell-preview-label">FEATURE NOT IMPLEMENTED</span><h1>${esc(page)} is not available yet.</h1></section></div>`;
  return () => root.replaceChildren();
}
window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountAppearance = mountAppearance;
window.SyncAI.pages.mountPreview = mountPreview;
window.SyncAI.applyAppearancePreferences = applyPreferences;
})();