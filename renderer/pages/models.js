(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtBytes } = window.SyncAI.shared;




async function mountModels(root) {
  let models = [], runtime = null, estimates = {}, profiles = {}, busy = false, busyModel = null, error = "", notice = "";
  const anyBusy = () => busy || busyModel !== null || Boolean(runtime?.isLoading) || Boolean(runtime?.isGenerating);
  function render() {
    root.innerHTML = `
      <section class="shell-page shell-standard-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>LOCAL INFERENCE LIBRARY</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">MODEL-SPECIFIC INFERENCE CONFIGURATION</p><h1>Local models<span>.</span></h1>
          <p class="shell-page-description">Register GGUF files by their original path. Importing never copies, moves or deletes the source file.</p></div>
          <button class="shell-model-import" data-model="import" type="button" ${anyBusy() ? "disabled" : ""}>${busy ? "WORKING…" : "+ IMPORT GGUF"}</button>
        </div>
        <section class="shell-settings-panel"><div class="shell-panel-heading"><div><p class="shell-section-kicker">ISOLATED NATIVE RUNTIME</p>
          <h2>${runtime?.isLoading ? "Loading model…" : runtime?.isLoaded ? esc(runtime.loadedModelName) : "No model loaded"}</h2></div><span class="shell-panel-tag">${esc(runtime?.backend ?? "llama.cpp · CPU · isolated worker")}</span></div>
          ${runtime?.isLoading ? '<p class="shell-settings-footnote">Loading ' + esc(runtime.loadingModelId) + '. The worker is starting outside the main interface process.</p>' :
            runtime?.isLoaded ? '<div class="shell-ram-stats"><div><small>CONTEXT</small><strong>' + Number(runtime.contextLength || 0).toLocaleString() + ' TOKENS</strong></div><div><small>BATCH</small><strong>' + esc(runtime.batchSize) + '</strong></div><div><small>WORKER PRIVATE COMMIT</small><strong>' + (runtime.workerPrivateBytes ? fmtBytes(runtime.workerPrivateBytes) : "—") + '</strong></div></div><button type="button" data-model="unload" ' + (anyBusy() ? "disabled" : "") + '>Unload model</button>' :
            '<p class="shell-settings-footnote">Model loading is manual. A model that exceeds the worker\'s configured private-memory ceiling may fail to load without taking down the Sync interface.</p>'}
        </section>
        <div class="shell-model-library-head"><div><h2>MODEL LIBRARY</h2><span>${models.length} ${models.length === 1 ? "MODEL" : "MODELS"}</span></div><span>ORIGINAL FILES · LOCAL REGISTRY</span></div>
        ${error ? '<p class="shell-model-message is-error" role="alert">' + esc(error) + "</p>" : ""}
        ${notice ? '<p class="shell-model-message" role="status">' + esc(notice) + "</p>" : ""}
        ${models.length === 0 ? '<div class="shell-model-empty"><span>◈</span><strong>No GGUF models registered</strong><p>Choose a GGUF file. Sync validates its header, calculates SHA-256 and stores its original absolute path in the local registry.</p><button class="shell-model-import" type="button" data-model="import" ' + (anyBusy() ? "disabled" : "") + '>Choose a GGUF file</button></div>' :
          '<div class="shell-model-list">' + models.map(model => {
            const estimate = estimates[model.id], active = runtime?.loadedModelId === model.id, isBusy = anyBusy();
            const profile = profiles[model.id] || { contextLength: 2048, batchSize: 128, temperature: 0.7, maxOutputTokens: 512, isCustomized: false };
            const contextChoices = [512,1024,2048,4096,8192,16384,32768];
            const batchChoices = [16,32,64,128,256,512,1024,2048];
            const outputChoices = [64,128,256,384,512];
            return `<article class="shell-model-card"><div class="shell-model-icon">◈</div><div class="shell-model-info">
              <div class="shell-model-title-row"><h3>${esc(model.name)}</h3>${model.isDefault ? '<span class="shell-model-default">DEFAULT</span>' : ""}${active ? '<span class="shell-model-default">LOADED</span>' : ""}${!model.isAvailable ? '<span class="shell-model-default is-error">MISSING</span>' : ""}</div>
              <p>${esc(model.fileName)} · ${fmtBytes(model.sizeBytes)}</p><small>${esc(model.architecture || "Unknown architecture")} · ${esc(model.quantization || "Unknown quantization")}</small>
              <small class="${!model.isAvailable ? "is-error" : ""}">${esc(model.filePath)}</small><small>SHA-256 · ${esc(model.sha256)}</small>
              ${estimate ? '<small>Estimated peak: ' + fmtBytes(estimate.estimatedPeakBytes) + ' · ' + (estimate.configuredLimitBytes ? "configured worker ceiling " + fmtBytes(estimate.configuredLimitBytes) : "worker ceiling disabled") + "</small>" : ""}
              ${!model.isAvailable ? '<small class="is-error">This registered path is unavailable. Select the file again to relink it.</small>' : ""}
              <details class="shell-model-profile">
                <summary>Inference profile <span>${profile.isCustomized ? "CUSTOM" : "DEFAULTS"}</span></summary>
                <div class="shell-model-profile-fields">
                  <label>Context window
                    <select data-profile-field="contextLength" ${isBusy ? "disabled" : ""}>
                      ${contextChoices.map(value => '<option value="' + value + '" ' + (Number(profile.contextLength) === value ? "selected" : "") + '>' + value.toLocaleString() + ' tokens</option>').join("")}
                    </select>
                  </label>
                  <label>Batch size
                    <select data-profile-field="batchSize" ${isBusy ? "disabled" : ""}>
                      ${batchChoices.map(value => '<option value="' + value + '" ' + (Number(profile.batchSize) === value ? "selected" : "") + ' ' + (value > Number(profile.contextLength) ? "disabled" : "") + '>' + value.toLocaleString() + '</option>').join("")}
                    </select>
                  </label>
                  <label>Temperature
                    <input data-profile-field="temperature" type="number" min="0" max="2" step="0.05" value="${Number(profile.temperature).toFixed(2)}" ${isBusy ? "disabled" : ""}>
                  </label>
                  <label>Maximum output
                    <select data-profile-field="maxOutputTokens" ${isBusy ? "disabled" : ""}>
                      ${outputChoices.map(value => '<option value="' + value + '" ' + (Number(profile.maxOutputTokens) === value ? "selected" : "") + '>' + value + ' tokens</option>').join("")}
                    </select>
                  </label>
                  <div class="shell-model-profile-actions">
                    <small>${profile.isCustomized ? "This model has saved settings." : "Uses global Runtime defaults until customized."} Changes apply the next time this model is loaded.</small>
                    <button type="button" data-model="profile-save" data-id="${esc(model.id)}" ${isBusy ? "disabled" : ""}>Save profile</button>
                    ${profile.isCustomized ? '<button type="button" class="is-muted" data-model="profile-reset" data-id="' + esc(model.id) + '" ' + (isBusy ? "disabled" : "") + '>Reset to global defaults</button>' : ""}
                  </div>
                </div>
              </details>
            </div><div class="shell-model-actions">
              ${!model.isDefault ? '<button type="button" data-model="default" data-id="' + esc(model.id) + '" ' + (isBusy || !model.isAvailable ? "disabled" : "") + '>Set default</button>' : ""}
              <button type="button" data-model="estimate" data-id="${esc(model.id)}" ${isBusy || !model.isAvailable || active ? "disabled" : ""}>Estimate</button>
              ${!active ? '<button type="button" data-model="load" data-id="' + esc(model.id) + '" ' + (isBusy || !model.isAvailable ? "disabled" : "") + '>' + (runtime?.isLoaded ? "Load instead" : "Load") + "</button>" :
                '<button type="button" data-model="unload" ' + (isBusy ? "disabled" : "") + '>Unload</button>'}
              <details class="shell-model-menu"><summary aria-label="More actions for ${esc(model.name)}">⋯</summary><div>
                ${!model.isDefault ? '<button type="button" data-model="default" data-id="' + esc(model.id) + '" ' + (isBusy || !model.isAvailable ? "disabled" : "") + '>Make default</button>' : ""}
                ${!active ? '<button type="button" data-model="load" data-id="' + esc(model.id) + '" ' + (isBusy || !model.isAvailable ? "disabled" : "") + '>' + (runtime?.isLoaded ? "Load instead of active model" : "Load model") + "</button>" : ""}
                ${active ? '<button type="button" data-model="unload" ' + (isBusy ? "disabled" : "") + '>Remove active selection</button>' : ""}
                <button type="button" data-model="remove" data-id="${esc(model.id)}" ${isBusy || active ? "disabled" : ""}>Remove from Sync AI</button>
              </div></details></div></article>`;
          }).join("") + "</div>"}
        <p class="shell-settings-footnote">Removing a library entry deletes only its registry record; it never deletes the corresponding GGUF file.</p>
      </section>`;
  }
  async function refresh() {
    try {
      [models, runtime] = await Promise.all([api.listModels(), api.getRuntimeStatus()]);
      const profileEntries = await Promise.all(models.map(async model => [model.id, await api.getModelProfile(model.id)]));
      profiles = Object.fromEntries(profileEntries);
      if (runtime.lastError) error = runtime.lastError;
    } catch { error = "Model registry and runtime status are available only inside the desktop app."; }
    render();
  }
  async function act(action, id) {
    if (anyBusy()) return;
    error = ""; notice = "";
    if (action === "remove") {
      const model = models.find(item => item.id === id);
      if (!model || !window.confirm("Remove " + model.name + " from the Sync AI library? The original GGUF file will remain untouched.")) return;
    }
    busy = action === "import" || action === "unload"; busyModel = id || null; render();
    try {
      if (action === "import") {
        const result = await api.importGguf();
        if (result) notice = result.duplicate ? "That exact model is already registered. Its original file location has been refreshed." : "GGUF registered. The file stays at its original location; Sync does not copy or move it.";
        estimates = {};
      }
      if (action === "profile-save") {
        const card = Array.from(root.querySelectorAll(".shell-model-card")).find(item =>
          item.querySelector('[data-model="profile-save"]')?.dataset.id === id);
        if (!card) throw new Error("The selected model profile editor is no longer available.");
        const read = field => card.querySelector('[data-profile-field="' + field + '"]')?.value;
        const profile = {
          contextLength: Number(read("contextLength")),
          batchSize: Number(read("batchSize")),
          temperature: Number(read("temperature")),
          maxOutputTokens: Number(read("maxOutputTokens"))
        };
        profiles[id] = await api.saveModelProfile(id, profile);
        notice = "Model-specific inference profile saved. It will apply the next time this model is loaded.";
      }
      if (action === "profile-reset") {
        await api.deleteModelProfile(id);
        profiles[id] = await api.getModelProfile(id);
        notice = "Model profile reset. This model will use the global Runtime defaults on its next load.";
      }
      if (action === "default") { await api.setDefaultModel(id); notice = "Default model updated."; }
      if (action === "estimate") {
        estimates[id] = await api.estimateModelResources(id);
        notice = "Informational estimate calculated. The Windows worker limit, not this estimate, enforces the ceiling.";
      }
      if (action === "load") {
        if (runtime?.isLoaded) await api.unloadModel();
        runtime = await api.loadModel(id);
        notice = "Selected model loaded into the isolated llama.cpp worker" +
          (profiles[id]?.isCustomized ? " with its saved inference profile." : " using global Runtime defaults.");
      }
      if (action === "unload") { runtime = await api.unloadModel(); notice = "The active model and inference worker were unloaded."; }
      if (action === "remove") { await api.removeModel(id); delete estimates[id]; notice = "Removed from Sync AI. The original model file was not deleted or moved."; }
      await refresh();
    } catch (cause) { error = errorText(cause); await refresh(); }
    finally { busy = false; busyModel = null; render(); }
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-model]");
    if (button) void act(button.dataset.model, button.dataset.id);
  });
  root.addEventListener("change", event => {
    if (event.target.dataset.profileField !== "contextLength") return;
    const card = event.target.closest(".shell-model-card");
    const batch = card?.querySelector('[data-profile-field="batchSize"]');
    if (!batch) return;
    const contextLength = Number(event.target.value);
    if (Number(batch.value) > contextLength) batch.value = [2048,1024,512,256,128,64,32,16].find(value => value <= contextLength) || 16;
    for (const option of batch.options) option.disabled = Number(option.value) > contextLength;
  });
  await refresh();
  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountModels = mountModels;
})();
