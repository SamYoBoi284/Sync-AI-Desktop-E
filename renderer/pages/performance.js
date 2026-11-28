(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtRam, pageEyebrow } = window.SyncAI.shared;
const RAM_KEY = "ram_limiter";
const APPEARANCE_KEY = "appearance_preferences";
const toGb = bytes => Number(bytes) / (1024 ** 3);
const DEFAULT_APPEARANCE = {
  theme: "dark", accent: "#a879ff", interfaceColor: "#a879ff", linkedColors: true,
  density: "comfortable", chatStyle: "soft", fontSize: 14, motion: "system"
};

async function mountPerformance(root) {
  let lowStatus = null;
  let lowPreferences = { enabled: false };
  let lowLoading = true, lowSaving = false, lowMessage = "";
  let ramInfo = null, ramConfig = { enabled: false, limitGb: 1 }, ramSaved = { enabled: false, limitGb: 1 };
  let ramLoading = true, ramSaving = false, ramMessage = "";
  let motionPrefs = { ...DEFAULT_APPEARANCE }, motionSaved = { ...DEFAULT_APPEARANCE };
  let motionLoading = true, motionSaving = false, motionMessage = "";

  const recommendation = () => lowStatus?.recommendation || {
    tier: "Device profile unavailable", maxContextLength: 2048, maxBatchSize: 64,
    description: "Hardware-based recommendations are unavailable."
  };

  function render() {
    const maxRamGb = ramInfo ? Math.max(1, Math.floor(toGb(ramInfo.totalBytes) - 2)) : 1;
    const ramDirty = ramConfig.enabled !== ramSaved.enabled || ramConfig.limitGb !== ramSaved.limitGb;
    const motionDirty = JSON.stringify(motionPrefs) !== JSON.stringify(motionSaved);
    const device = lowStatus?.deviceMemory || null;
    const profile = recommendation();

    root.innerHTML =
      '<section class="shell-page shell-standard-page performance-page">' +
        pageEyebrow("SYSTEM PREFERENCES") +
        '<div class="shell-page-heading-row"><div><p class="shell-section-kicker">RESOURCE &amp; INTERFACE BEHAVIOR</p><h1>Performance<span>.</span></h1><p class="shell-page-description">Choose how Sync balances local inference resources and interface motion. Every optimization here is optional.</p></div><span class="shell-large-status"><span></span>USER CONTROL</span></div>' +

        '<section class="shell-settings-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">01 · INFERENCE ALLOCATION</p><h2>Low-Memory Mode</h2></div><span class="shell-panel-tag">OPTIONAL · OFF BY DEFAULT</span></div>' +
          '<p class="shell-settings-intro">Use a more conservative inference allocation on memory-constrained devices. When enabled, Sync applies installed-RAM-based ceilings to context length and batch size when the next model loads. It never changes your saved global settings or per-model profiles.</p>' +
          (lowLoading ? '<p class="shell-settings-footnote">Detecting device memory…</p>' : device ?
            '<div class="shell-ram-stats"><div><small>INSTALLED RAM</small><strong>' + toGb(device.totalBytes).toFixed(1) + ' GB</strong></div><div><small>AVAILABLE NOW</small><strong>' + toGb(device.availableBytes).toFixed(1) + ' GB</strong></div><div><small>RECOMMENDED CAPS</small><strong>' + Number(profile.maxContextLength).toLocaleString() + ' / ' + Number(profile.maxBatchSize).toLocaleString() + '</strong></div></div>' +
            '<label class="shell-ram-toggle"><span><strong>Enable Low-Memory Mode</strong><small>Reduce effective context and batch ceilings at model load time.</small></span><input id="lowMemoryEnabled" type="checkbox" ' + (lowPreferences.enabled ? 'checked' : '') + (lowSaving ? ' disabled' : '') + '></label>' +
            '<p class="shell-settings-footnote">Detected tier: ' + esc(profile.tier) + '. ' + esc(profile.description) + ' Available RAM is informational; it is not a guarantee that a given GGUF will fit.</p>' +
            '<button type="button" data-performance="save-low-memory" ' + (lowSaving ? 'disabled' : '') + '>' + (lowSaving ? 'Saving…' : 'Save Low-Memory Preference') + '</button>'
            : '<p class="shell-settings-footnote">Hardware-based recommendations require the native desktop host.</p>') +
          (lowMessage ? '<p class="shell-settings-feedback" role="status">' + esc(lowMessage) + '</p>' : '') +
        '</section>' +

        '<section class="shell-settings-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">02 · HARD RESOURCE CEILING</p><h2>Worker RAM Limiter</h2></div><span class="shell-panel-tag">OPTIONAL · OFF BY DEFAULT</span></div>' +
          '<p class="shell-settings-intro">On Windows, place the isolated llama.cpp worker inside a Job Object with a hard private-memory commit ceiling. This is separate from Low-Memory Mode: it enforces a process limit rather than adjusting inference allocation. A ceiling that is too low can prevent a model from loading.</p>' +
          (ramLoading ? '<p class="shell-settings-footnote">Detecting system memory…</p>' : ramInfo ?
            '<div class="shell-ram-stats"><div><small>INSTALLED RAM</small><strong>' + toGb(ramInfo.totalBytes).toFixed(1) + ' GB</strong></div><div><small>CURRENTLY AVAILABLE</small><strong>' + toGb(ramInfo.availableBytes).toFixed(1) + ' GB</strong></div><div><small>MAXIMUM CEILING</small><strong>' + maxRamGb + ' GB</strong></div></div>' +
            '<label class="shell-ram-toggle"><span><strong>Enable RAM Limiter</strong><small>Enforce a hard private-memory ceiling on the inference worker.</small></span><input id="ramEnabled" type="checkbox" ' + (ramConfig.enabled ? 'checked' : '') + (ramSaving ? ' disabled' : '') + '></label>' +
            '<div class="shell-ram-slider ' + (!ramConfig.enabled ? 'is-disabled' : '') + '"><div class="shell-ram-slider-heading"><label for="ram-limit">Worker memory ceiling</label><strong>' + ramConfig.limitGb + ' GB</strong></div>' +
              '<input id="ram-limit" type="range" min="1" max="' + maxRamGb + '" step="1" value="' + Math.min(ramConfig.limitGb, maxRamGb) + '"' + (!ramConfig.enabled || ramSaving ? ' disabled' : '') + '>' +
              '<div class="shell-ram-slider-scale"><span>1 GB</span><span>' + maxRamGb + ' GB</span></div><small>This limits committed private memory, not resident working-set size. Runtime diagnostics report both measurements separately.</small>' +
            '</div>' +
            '<button type="button" data-performance="save-ram" ' + (!ramDirty || ramSaving ? 'disabled' : '') + '>' + (ramSaving ? 'Saving…' : 'Save RAM Limiter') + '</button>'
            : '<p class="shell-settings-footnote">RAM detection requires the native desktop host.</p>') +
          (ramMessage ? '<p class="shell-settings-feedback" role="status">' + esc(ramMessage) + '</p>' : '') +
        '</section>' +

        '<section class="shell-settings-panel">' +
          '<div class="shell-panel-heading"><div><p class="shell-section-kicker">03 · INTERFACE MOTION</p><h2>Animation preferences</h2></div><span class="shell-panel-tag">ACCESSIBILITY &amp; COMFORT</span></div>' +
          '<p class="shell-settings-intro">Choose how much motion the interface uses. System follows the operating system preference; Reduced and Off minimize or disable interface animation.</p>' +
          (motionLoading ? '<p class="shell-settings-footnote">Loading saved motion preference…</p>' :
            '<div class="appearance-segment appearance-motion-options">' +
              [['system','System'],['full','Full'],['reduced','Reduced'],['off','Off']].map(([value,label]) =>
                '<button type="button" data-motion="' + value + '" class="' + (motionPrefs.motion === value ? 'is-selected' : '') + '" aria-pressed="' + (motionPrefs.motion === value) + '">' + label + '</button>'
              ).join('') +
            '</div>' +
            '<p class="appearance-hint">System follows the operating system reduced-motion preference. Reduced shortens transitions and animations; Off disables them.</p>' +
            '<div class="appearance-footer"><span class="appearance-feedback" role="status">' + esc(motionMessage) + '</span><button type="button" class="appearance-save" data-performance="save-motion" ' + (!motionDirty || motionSaving ? 'disabled' : '') + '>' + (motionSaving ? 'Saving…' : 'Save motion preference') + '</button></div>') +
        '</section>' +
        '<p class="shell-settings-footnote">Low-Memory Mode and the RAM Limiter are separate controls. Both are off by default. Changes to inference resource limits apply when a model is next loaded; they do not interrupt or reconfigure a running worker.</p>' +
      '</section>';
  }

  async function loadLowMemory() {
    try {
      lowStatus = await api.getLowMemoryPreferences();
      lowPreferences = { ...(lowStatus?.preferences || { enabled: false }) };
    } catch (cause) {
      lowMessage = 'Could not load Low-Memory preferences: ' + errorText(cause);
    } finally { lowLoading = false; render(); }
  }

  async function loadRam() {
    try {
      const [info, raw] = await Promise.all([api.getHostRamInfo(), api.getSetting(RAM_KEY)]);
      ramInfo = info;
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch {}
      const max = Math.max(1, Math.floor(toGb(info.totalBytes) - 2));
      const fallback = Math.max(1, Math.floor(Math.max(1, toGb(info.totalBytes) - 3)));
      ramConfig = {
        enabled: parsed?.enabled === true,
        limitGb: Math.min(max, Math.max(1, Number(parsed?.limitGb) || fallback))
      };
      ramSaved = { ...ramConfig };
    } catch (cause) {
      ramMessage = 'Could not load RAM limiter settings: ' + errorText(cause);
    } finally { ramLoading = false; render(); }
  }

  async function loadMotion() {
    try {
      const raw = await api.getSetting(APPEARANCE_KEY);
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch {}
      const apply = window.SyncAI.applyAppearancePreferences;
      motionPrefs = typeof apply === 'function' ? apply(parsed || DEFAULT_APPEARANCE) : { ...DEFAULT_APPEARANCE, ...(parsed || {}) };
      motionSaved = { ...motionPrefs };
    } catch (cause) {
      motionMessage = 'Could not load motion preference: ' + errorText(cause);
    } finally { motionLoading = false; render(); }
  }

  root.addEventListener('change', event => {
    if (event.target.id === 'lowMemoryEnabled') lowPreferences.enabled = event.target.checked;
    if (event.target.id === 'ramEnabled') ramConfig.enabled = event.target.checked;
    if (event.target.id === 'ram-limit') ramConfig.limitGb = Number(event.target.value);
    if (event.target.id === 'ramEnabled' || event.target.id === 'ram-limit' || event.target.id === 'lowMemoryEnabled') render();
  });

  root.addEventListener('click', async event => {
    const motionButton = event.target.closest('[data-motion]');
    if (motionButton && !motionLoading && !motionSaving) {
      motionPrefs = { ...motionPrefs, motion: motionButton.dataset.motion };
      if (typeof window.SyncAI.applyAppearancePreferences === 'function') window.SyncAI.applyAppearancePreferences(motionPrefs);
      render();
      return;
    }

    const action = event.target.closest('[data-performance]')?.dataset.performance;
    if (!action) return;

    if (action === 'save-low-memory' && !lowSaving) {
      lowSaving = true; lowMessage = ''; render();
      try {
        lowStatus = await api.setLowMemoryPreferences({ enabled: root.querySelector('#lowMemoryEnabled')?.checked === true });
        lowPreferences = { ...(lowStatus?.preferences || { enabled: false }) };
        lowMessage = 'Saved. The reduced context and batch ceilings apply the next time a model loads. Your saved model profiles remain unchanged.';
      } catch (cause) {
        lowMessage = 'Could not save Low-Memory settings: ' + errorText(cause);
      } finally { lowSaving = false; render(); }
    }

    if (action === 'save-ram' && !ramSaving) {
      ramSaving = true; ramMessage = ''; render();
      try {
        await api.setSetting(RAM_KEY, JSON.stringify(ramConfig));
        ramSaved = { ...ramConfig };
        ramMessage = 'Saved. The hard worker ceiling applies the next time a model is loaded.';
      } catch (cause) {
        ramMessage = 'Could not save RAM limiter settings: ' + errorText(cause);
      } finally { ramSaving = false; render(); }
    }

    if (action === 'save-motion' && !motionSaving) {
      motionSaving = true; motionMessage = ''; render();
      try {
        await api.setSetting(APPEARANCE_KEY, JSON.stringify(motionPrefs));
        motionSaved = { ...motionPrefs };
        motionMessage = 'Motion preference saved on this device.';
      } catch (cause) {
        motionMessage = 'Could not save motion preference: ' + errorText(cause);
      } finally { motionSaving = false; render(); }
    }
  });

  render();
  await Promise.all([loadLowMemory(), loadRam(), loadMotion()]);
  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountPerformance = mountPerformance;
})();
