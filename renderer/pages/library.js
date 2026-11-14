(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtBytes, fmtDateShort } = window.SyncAI.shared;




async function mountLibrary(root) {
  let files = [], loading = true, busyId = null, importing = false, error = "", notice = "";
  function render() {
    root.innerHTML = `
      <section class="shell-page shell-standard-page file-library-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>USER-SELECTED LOCAL FILES</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">A LOCAL INDEX, NOT A CLOUD DRIVE</p><h1>File Library<span>.</span></h1>
          <p class="shell-page-description">Register files you choose, track their paths and detect when they move. Originals stay where they are.</p></div>
          <button class="library-primary-button" type="button" data-library="add" ${importing ? "disabled" : ""}>${importing ? "Checking file…" : "＋ Add file"}</button></div>
        <div class="library-safety-note"><strong>File access boundary</strong><span>Sync currently stores file metadata and hashes only. It does not read library contents into chat. Any future AI file operation will require a separate, one-time approval flow.</span></div>
        ${notice ? '<p class="library-feedback" role="status">' + esc(notice) + "</p>" : ""}
        ${error ? '<p class="library-feedback is-error" role="alert">' + esc(error) + "</p>" : ""}
        <div class="library-list-heading"><div><span class="library-kicker">REGISTERED FILES</span><strong>${files.length} entries</strong></div><span>MAXIMUM 512 MiB PER FILE</span></div>
        ${loading ? '<p class="library-empty">Checking your file registry…</p>' : files.length === 0 ? `
          <div class="library-empty-state"><span aria-hidden="true">▤</span><strong>Your File Library is empty.</strong>
            <p>Add a file using the native picker. Sync stores its canonical location and SHA-256 fingerprint, not a second copy of the file.</p>
            <button type="button" data-library="add" ${importing ? "disabled" : ""}>Choose a file</button>
          </div>` : '<div class="library-file-list">' + files.map(file => `
            <article class="library-file-card"><div class="library-file-icon">${esc((file.extension || "FILE").slice(0,4).toUpperCase())}</div>
              <div class="library-file-main"><div class="library-file-title"><strong>${esc(file.fileName)}</strong><span class="${file.isAvailable ? "is-available" : "is-missing"}">${file.isAvailable ? "AVAILABLE" : "MISSING"}</span></div>
                <p>${fmtBytes(file.sizeBytes)} · Added ${esc(fmtDateShort(file.addedAt))}</p><small>${esc(file.sourcePath)}</small><code>SHA-256 · ${esc(file.sha256)}</code>
              </div><div class="library-file-actions">
                ${!file.isAvailable ? '<button type="button" data-library="relink" data-id="' + esc(file.id) + '" ' + (busyId === file.id ? "disabled" : "") + '>' + (busyId === file.id ? "Checking…" : "Relink") + "</button>" : ""}
                <button type="button" class="is-danger" data-library="remove" data-id="${esc(file.id)}" ${busyId === file.id ? "disabled" : ""}>Remove</button>
              </div></article>`).join("") + "</div>"}
      </section>`;
  }
  async function refresh() {
    loading = true; render();
    try { files = await api.listLibraryFiles(); error = ""; }
    catch (cause) { error = errorText(cause); }
    finally { loading = false; render(); }
  }
  async function action(name, id) {
    if (name === "remove") {
      const file = files.find(item => item.id === id);
      if (!file || !window.confirm("Remove “" + file.fileName + "” from the library? The original file will not be deleted.")) return;
    }
    if (name === "add") importing = true; else busyId = id;
    error = ""; notice = ""; render();
    try {
      if (name === "add") {
        const result = await api.importLibraryFile();
        if (result) notice = result.duplicate ? "That file was already known. Its path was refreshed." : "File registered in your local library.";
      }
      if (name === "relink") {
        const result = await api.relinkLibraryFile(id);
        if (result) notice = "File path updated.";
      }
      if (name === "remove") { await api.removeLibraryFile(id); notice = "Library entry removed. Original file untouched."; }
      await refresh();
    } catch (cause) { error = errorText(cause); }
    finally { importing = false; busyId = null; render(); }
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-library]");
    if (button) void action(button.dataset.library, button.dataset.id);
  });
  await refresh();
  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountLibrary = mountLibrary;
})();
