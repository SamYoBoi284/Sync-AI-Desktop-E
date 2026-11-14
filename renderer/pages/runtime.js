(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtRam } = window.SyncAI.shared;




async function mountRuntime(root, context) {
  let runtime = null, runtimeError = "", disposed = false;
  const connected = context.bridgeKind === "connected";
  function render() {
    const info = context.appInfo;
    root.innerHTML = `
      <div class="shell-page shell-standard-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>SYSTEM INSPECTION</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">APPLICATION STATUS</p><h1>Runtime <span>diagnostics.</span></h1><p class="shell-page-description">The desktop host and isolated inference-worker resource usage.</p></div>
          <span class="shell-large-status ${connected ? "is-connected" : ""}"><span></span>${connected ? "NATIVE HOST" : "BRIDGE UNAVAILABLE"}</span></div>
        <section class="shell-runtime-grid" aria-label="Runtime components">
          <article class="shell-runtime-card shell-runtime-card--accent"><span class="shell-card-index">01 / APPLICATION</span><h2>${esc(info?.appName ?? "Sync AI Desktop")}</h2>
            <p>The Electron host and interface stay outside the inference worker's memory ceiling.</p><span class="shell-card-foot"><i class="${connected ? "is-on" : ""}"></i>${connected ? "HOST CONNECTED" : "WAITING FOR DESKTOP HOST"}</span></article>
          <article class="shell-runtime-card"><span class="shell-card-index">02 / INFERENCE WORKER</span><h2>${esc(runtime?.isLoaded ? runtime.loadedModelName : runtime?.isLoading ? "Loading model…" : "No model loaded")}</h2>
            <p>${esc(runtime?.backend ?? "Waiting for the inference manager.")}</p><span class="shell-card-foot"><i class="${runtime?.isLoaded ? "is-on" : ""}"></i>${runtime?.isGenerating ? "GENERATING" : runtime?.isLoaded ? "WORKER ACTIVE" : runtime?.isLoading ? "STARTING" : "IDLE"}</span></article>
          <article class="shell-runtime-card"><span class="shell-card-index">03 / MEMORY ENFORCEMENT</span><h2>${runtime?.memoryLimitBytes ? fmtRam(runtime.memoryLimitBytes) : "No hard ceiling"}</h2>
            <p>${runtime?.memoryLimitBytes ? "Windows Job Object process committed-memory limit." : "The worker has no configured hard ceiling at present."}</p><span class="shell-card-foot"><i class="${runtime?.hardLimitSupported ? "is-safe" : ""}"></i>${runtime?.hardLimitSupported ? "WINDOWS JOB OBJECT SUPPORT" : "HARD LIMIT UNAVAILABLE"}</span></article>
        </section>
        <section class="shell-runtime-details"><div class="shell-panel-heading"><div><p class="shell-section-kicker">WORKER RESOURCE TELEMETRY</p><h2>Memory diagnostics</h2></div><span class="shell-panel-tag">REFRESHES EVERY 1.5 SEC</span></div>
          ${runtimeError ? '<p class="shell-details-note">' + esc(runtimeError) + "</p>" : runtime ? `
            <dl class="shell-details-grid"><div><dt>Configured hard ceiling</dt><dd>${fmtRam(runtime.memoryLimitBytes)}</dd></div><div><dt>Worker resident working set</dt><dd>${fmtRam(runtime.workerWorkingSetBytes)}</dd></div>
            <div><dt>Worker private committed memory</dt><dd>${fmtRam(runtime.workerPrivateBytes)}</dd></div><div><dt>Worker process ID</dt><dd>${runtime.workerPid ?? "Not running"}</dd></div>
            <div><dt>Generation state</dt><dd>${runtime.isGenerating ? "Generating" : "Idle"}</dd></div><div><dt>Loaded model</dt><dd>${esc(runtime.loadedModelName ?? "None")}</dd></div>
            <div><dt>Context / batch</dt><dd>${runtime.contextLength ? Number(runtime.contextLength).toLocaleString() + " / " + esc(runtime.batchSize) : "—"}</dd></div></dl>
          ` : '<p class="shell-details-note">Waiting for worker telemetry.</p>'}
          <p class="shell-details-note">The Job Object ceiling applies to committed private memory. Resident working set measures pages currently resident in RAM; it is not the enforcement counter. GGUF weights are loaded without file-backed memory mapping so their model allocations are inside the worker's private-memory accounting.</p>
        </section>
        ${runtime?.lastError ? '<section class="shell-runtime-details"><div class="shell-panel-heading"><div><p class="shell-section-kicker">LAST WORKER ERROR</p><h2>' + esc(runtime.lastErrorCode || "Runtime error") + '</h2></div><span class="shell-panel-tag">DIAGNOSTIC</span></div><p class="shell-model-message is-error" role="alert">' + esc(runtime.lastError) + "</p></section>" : ""}
        <section class="shell-runtime-details"><div class="shell-panel-heading"><div><p class="shell-section-kicker">ELECTRON BRIDGE</p><h2>Host details</h2></div><span class="shell-panel-tag">READ-ONLY METADATA</span></div>
          ${connected && info ? '<dl class="shell-details-grid"><div><dt>Application</dt><dd>' + esc(info.appName) + '</dd></div><div><dt>Version</dt><dd>' + esc(info.version) + '</dd></div><div><dt>Operating system</dt><dd>' + esc(info.operatingSystem) + '</dd></div><div><dt>Architecture</dt><dd>' + esc(info.architecture) + "</dd></div></dl>" :
            '<p class="shell-details-note">The desktop bridge did not respond. Relaunch the Electron application to inspect native host metadata.</p>'}
        </section>
      </div>`;
  }
  async function refresh() {
    try { runtime = await api.getRuntimeStatus(); runtimeError = ""; }
    catch (cause) { runtimeError = errorText(cause); }
    if (!disposed) render();
  }
  render();
  await refresh();
  const timer = setInterval(() => { void refresh(); }, 1500);
  return () => { disposed = true; clearInterval(timer); root.replaceChildren(); };
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountRuntime = mountRuntime;
})();
