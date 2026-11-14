(() => {
const { plannedPageCopy, esc, pageEyebrow } = window.SyncAI.shared;
async function mountPreview(root, _context, page) {
  const content = plannedPageCopy[page] || plannedPageCopy.appearance;
  root.innerHTML = `
    <div class="shell-page shell-standard-page">
      ${pageEyebrow(content.eyebrow)}
      <section class="shell-preview-panel"><div class="shell-preview-symbol" aria-hidden="true">⌁</div>
        <span class="shell-preview-label">FEATURE NOT IMPLEMENTED</span><h1>${esc(content.title)}</h1>
        <p class="shell-preview-description">${esc(content.description)}</p><div class="shell-preview-divider"></div><p class="shell-preview-detail">${esc(content.detail)}</p>
      </section>
    </div>`;
  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountPreview = mountPreview;
})();
