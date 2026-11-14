(() => {
const pageTitles = {
  "new-chat": "New chat", history: "History", workspace: "Workspace", tasks: "Tasks & Notes",
  library: "File Library", models: "Local models", appearance: "Appearance", runtime: "Runtime", settings: "Settings"
};
const navigationSections = [
  { heading: "WORKSPACE", entries: [
    { id: "workspace", label: "Workspace", glyph: "▧", availability: "available" },
    { id: "tasks", label: "Tasks & Notes", glyph: "☷", availability: "available" },
    { id: "library", label: "File Library", glyph: "▤", availability: "available" }
  ]},
  { heading: "SYSTEM", entries: [
    { id: "models", label: "Local models", glyph: "◈", availability: "available" },
    { id: "appearance", label: "Appearance", glyph: "◐", availability: "planned" },
    { id: "runtime", label: "Runtime", glyph: "⌁", availability: "available" }
  ]}
];
const plannedPageCopy = {
  history: { eyebrow: "CONVERSATION STORAGE", title: "Your conversations live here.", description: "Browse, search, reopen and manage locally stored conversations.", detail: "Chat storage and versioned desktop backup are implemented in the local database." },
  workspace: { eyebrow: "WORKSPACE", title: "A place for work in progress.", description: "Save assistant replies, drafts, code and documents in a persistent local workspace.", detail: "Artifacts can be selected explicitly as context for future local conversations." },
  tasks: { eyebrow: "PERSONAL ORGANIZATION", title: "Keep the small things in view.", description: "Manage lightweight tasks and notes alongside your conversations.", detail: "Tasks, notes, due dates, pinning and opt-in chat context are stored locally in SQLite." },
  library: { eyebrow: "LOCAL FILES", title: "A local index of your files.", description: "Register selected files, track their original locations and detect when they move.", detail: "The library stores paths and SHA-256 fingerprints only. It does not read file contents into chat." },
  models: { eyebrow: "LOCAL INFERENCE", title: "Your models. Your machine.", description: "Manage local GGUF models and control the inference runtime.", detail: "Model registration, loading, unloading and runtime diagnostics are part of the local inference system." },
  appearance: { eyebrow: "PERSONALIZATION", title: "Appearance controls are coming.", description: "Theme, color accent and motion preferences will be brought over from the Android design system.", detail: "The desktop implementation will support system, dark and light modes, theme identities, accents and reduced motion." }
};
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const errorText = error => error instanceof Error ? error.message : String(error);
const fmtDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleString();
};
const fmtDateShort = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleDateString();
};
const fmtBytes = bytes => {
  if (bytes == null || !Number.isFinite(Number(bytes))) return "—";
  const n = Number(bytes);
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = n / 1024, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(size >= 10 ? 1 : 2) + " " + units[i];
};
const fmtRam = bytes => bytes == null ? "—" : bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + " GB" : (bytes / 1024 ** 2).toFixed(0) + " MB";
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : "gen-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
const setFeedback = (root, message, kind = "notice", selector = ".page-feedback") => {
  const node = root.querySelector(selector);
  if (node) { node.textContent = message || ""; node.hidden = !message; node.classList.toggle("is-error", kind === "error"); }
};
const downloadJson = (value, filename) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const pageEyebrow = text => '<div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>' + esc(text) + '</div>';

window.SyncAI.shared = { pageTitles, navigationSections, plannedPageCopy, esc, errorText, fmtDate, fmtDateShort, fmtBytes, fmtRam, makeId, setFeedback, downloadJson, pageEyebrow };

})();
