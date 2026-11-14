(() => {
const { api } = window.SyncAI;
const { esc, errorText, fmtDateShort } = window.SyncAI.shared;




const blankTask = () => ({ title: "", details: "", status: "todo", priority: "normal", dueDate: null });
const blankNote = () => ({ title: "", content: "", pinned: false, includeInContext: false });
async function mountTasks(root) {
  let view = "tasks", tasks = [], notes = [], taskDraft = blankTask(), editingTaskId = null;
  let noteDraft = blankNote(), selectedNoteId = null, loading = true, saving = false, error = "", notice = "";
  function render() {
    root.innerHTML = `
      <section class="shell-page shell-standard-page tasks-notes-page">
        <div class="shell-page-eyebrow"><span class="shell-eyebrow-line"></span>PERSONAL ORGANIZATION</div>
        <div class="shell-page-heading-row"><div><p class="shell-section-kicker">SMALL THINGS, KEPT TOGETHER</p><h1>Tasks & Notes<span>.</span></h1>
          <p class="shell-page-description">Lightweight planning and notes, stored in the same local database as your conversations.</p></div></div>
        <div class="tasks-tabs" role="tablist" aria-label="Tasks and Notes">
          <button type="button" role="tab" aria-selected="${view === "tasks"}" class="${view === "tasks" ? "is-active" : ""}" data-tasks="view" data-view="tasks">Tasks <span>${tasks.length}</span></button>
          <button type="button" role="tab" aria-selected="${view === "notes"}" class="${view === "notes" ? "is-active" : ""}" data-tasks="view" data-view="notes">Notes <span>${notes.length}</span></button>
        </div>
        ${notice ? '<p class="tasks-feedback" role="status">' + esc(notice) + "</p>" : ""}
        ${error ? '<p class="tasks-feedback is-error" role="alert">' + esc(error) + "</p>" : ""}
        ${loading ? '<p class="tasks-empty">Loading local items…</p>' : view === "tasks" ? `
          <div class="tasks-workspace">
            <form class="task-create-panel" id="taskForm"><div class="tasks-panel-heading"><span class="tasks-kicker">${editingTaskId ? "UPDATE TASK" : "CAPTURE A TASK"}</span><strong>${editingTaskId ? "Edit task" : "New task"}</strong></div>
              <label>Title<input name="title" value="${esc(taskDraft.title)}" maxlength="200" placeholder="What needs doing?" required></label>
              <label>Details<textarea name="details" rows="3" placeholder="Optional details…">${esc(taskDraft.details)}</textarea></label>
              <div class="task-create-options">
                <label>Priority<select name="priority">${["low","normal","high"].map(x => '<option value="' + x + '" ' + (taskDraft.priority === x ? "selected" : "") + '>' + x[0].toUpperCase() + x.slice(1) + "</option>").join("")}</select></label>
                <label>Due date<input type="date" name="dueDate" value="${esc(taskDraft.dueDate || "")}"></label>
                <label>Status<select name="status">${[["todo","To do"],["in-progress","In progress"],["done","Done"]].map(([v,l]) => '<option value="' + v + '" ' + (taskDraft.status === v ? "selected" : "") + '>' + l + "</option>").join("")}</select></label>
              </div>
              <button class="tasks-primary-button" type="submit" ${saving || !taskDraft.title.trim() ? "disabled" : ""}>${saving ? "Saving…" : editingTaskId ? "Save changes" : "Add task"}</button>
              ${editingTaskId ? '<button class="task-cancel-edit" type="button" data-tasks="cancel-edit" ' + (saving ? "disabled" : "") + '>Cancel editing</button>' : ""}
            </form>
            <section class="task-list-panel"><div class="tasks-panel-heading"><span class="tasks-kicker">YOUR QUEUE</span><strong>${tasks.length} tasks</strong></div>
              ${tasks.length === 0 ? '<p class="tasks-empty">No tasks yet. One tiny item at a time.</p>' : '<div class="task-list">' + tasks.map(task => `
                <article class="task-card task-card--${esc(task.status)}"><div class="task-card-main"><div class="task-title-line"><strong>${esc(task.title)}</strong><span class="task-priority task-priority--${esc(task.priority)}">${esc(task.priority)}</span></div>
                  ${task.details ? "<p>" + esc(task.details) + "</p>" : ""}<small>${task.dueDate ? "Due " + esc(task.dueDate) : "No due date"} · Updated ${esc(fmtDateShort(task.updatedAt))}</small>
                </div><div class="task-card-controls"><button type="button" class="task-edit-button" data-tasks="edit-task" data-id="${esc(task.id)}">Edit</button>
                  <select aria-label="Status for ${esc(task.title)}" data-tasks="status" data-id="${esc(task.id)}">${[["todo","To do"],["in-progress","In progress"],["done","Done"]].map(([v,l]) => '<option value="' + v + '" ' + (task.status === v ? "selected" : "") + '>' + l + "</option>").join("")}</select>
                  <button type="button" class="task-delete-button" data-tasks="delete-task" data-id="${esc(task.id)}" aria-label="Delete task">×</button>
                </div></article>`).join("") + "</div>"}
            </section>
          </div>` : `
          <div class="notes-workspace"><aside class="notes-list-panel"><div class="tasks-panel-heading"><span class="tasks-kicker">LOCAL NOTES</span><button type="button" data-tasks="new-note">＋ New</button></div>
            ${notes.length === 0 ? '<p class="tasks-empty">No notes saved yet.</p>' : notes.map(note => `
              <button type="button" class="note-list-entry${selectedNoteId === note.id ? " is-active" : ""}" data-tasks="select-note" data-id="${esc(note.id)}">
                <strong>${note.pinned ? "◆ " : ""}${esc(note.title)}</strong><small>${note.includeInContext ? "Included in chat context" : esc(fmtDateShort(note.updatedAt))}</small>
              </button>`).join("")}
          </aside><section class="note-editor-panel"><div class="tasks-panel-heading"><span class="tasks-kicker">${selectedNoteId ? "EDIT NOTE" : "NEW NOTE"}</span>
            ${selectedNoteId ? '<button class="notes-delete-button" type="button" data-tasks="delete-note" ' + (saving ? "disabled" : "") + '>Delete</button>' : ""}</div>
            <label>Title<input name="noteTitle" value="${esc(noteDraft.title)}" maxlength="200" placeholder="Note title"></label>
            <label class="note-content-label">Content<textarea name="noteContent" placeholder="Keep a thought, plan or reference here…">${esc(noteDraft.content)}</textarea></label>
            <label class="note-option"><input type="checkbox" name="pinned" ${noteDraft.pinned ? "checked" : ""}> Pin this note</label>
            <label class="note-option"><input type="checkbox" name="noteContext" ${noteDraft.includeInContext ? "checked" : ""}> Include in future chat context</label>
            <button class="tasks-primary-button" type="button" data-tasks="save-note" ${saving || !noteDraft.title.trim() ? "disabled" : ""}>${saving ? "Saving…" : "Save note"}</button>
            <p class="notes-context-hint">Only notes explicitly selected for context are added to local prompts.</p>
          </section></div>`}
      </section>`;
  }
  async function refreshTasks() { tasks = await api.listTasks(); }
  async function refreshNotes(preferredId = null) {
    notes = await api.listNotes();
    const summary = notes.find(note => note.id === (preferredId ?? selectedNoteId)) || notes[0] || null;
    const detail = summary ? await api.getNote(summary.id) : null;
    selectedNoteId = detail?.id ?? null;
    noteDraft = detail ? { title: detail.title, content: detail.content, pinned: detail.pinned, includeInContext: detail.includeInContext } : blankNote();
  }
  async function refreshAll() {
    loading = true; render();
    try { await Promise.all([refreshTasks(), refreshNotes()]); error = ""; }
    catch (cause) { error = errorText(cause); }
    finally { loading = false; render(); }
  }
  async function saveTask(event) {
    event?.preventDefault();
    if (saving || !taskDraft.title.trim()) return;
    saving = true; error = ""; notice = ""; render();
    try {
      if (editingTaskId) { await api.updateTask(editingTaskId, taskDraft); notice = "Task updated."; }
      else { await api.createTask(taskDraft); notice = "Task added."; }
      taskDraft = blankTask(); editingTaskId = null; await refreshTasks();
    } catch (cause) { error = errorText(cause); }
    finally { saving = false; render(); }
  }
  async function taskAction(action, id) {
    const task = tasks.find(item => item.id === id);
    if (!task) return;
    try {
      if (action === "edit-task") {
        editingTaskId = task.id; taskDraft = { title: task.title, details: task.details, status: task.status, priority: task.priority, dueDate: task.dueDate };
        view = "tasks"; notice = ""; error = ""; render(); return;
      }
      if (action === "delete-task") {
        if (!window.confirm("Delete task “" + task.title + "”?")) return;
        await api.deleteTask(task.id);
        if (editingTaskId === task.id) { editingTaskId = null; taskDraft = blankTask(); }
        notice = "Task deleted.";
      }
      await refreshTasks(); render();
    } catch (cause) { error = errorText(cause); render(); }
  }
  async function saveNote() {
    if (saving || !noteDraft.title.trim()) return;
    saving = true; error = ""; notice = ""; render();
    try {
      const saved = selectedNoteId ? await api.updateNote(selectedNoteId, noteDraft) : await api.createNote(noteDraft);
      await refreshNotes(saved.id); notice = "Note saved.";
    } catch (cause) { error = errorText(cause); }
    finally { saving = false; render(); }
  }
  async function noteAction(action, id) {
    try {
      if (action === "select-note") {
        const detail = await api.getNote(id);
        selectedNoteId = detail.id; noteDraft = { title: detail.title, content: detail.content, pinned: detail.pinned, includeInContext: detail.includeInContext };
        notice = ""; error = ""; render(); return;
      }
      if (action === "new-note") { selectedNoteId = null; noteDraft = blankNote(); notice = ""; render(); return; }
      if (action === "delete-note") {
        if (!selectedNoteId || !window.confirm("Delete this note?")) return;
        saving = true; render(); await api.deleteNote(selectedNoteId); selectedNoteId = null; await refreshNotes(null); notice = "Note deleted.";
      }
    } catch (cause) { error = errorText(cause); }
    finally { saving = false; render(); }
  }
  root.addEventListener("input", event => {
    const name = event.target.name;
    if (["title","details","priority","status","dueDate"].includes(name)) {
      taskDraft[name] = name === "dueDate" ? event.target.value || null : event.target.value;
      const submit = root.querySelector('#taskForm button[type="submit"]');
      if (submit) submit.disabled = saving || !taskDraft.title.trim();
    }
    if (name === "noteTitle") noteDraft.title = event.target.value;
    if (name === "noteContent") noteDraft.content = event.target.value;
    const save = root.querySelector('[data-tasks="save-note"]');
    if (save) save.disabled = saving || !noteDraft.title.trim();
  });
  root.addEventListener("change", event => {
    if (event.target.name === "pinned") noteDraft.pinned = event.target.checked;
    if (event.target.name === "noteContext") noteDraft.includeInContext = event.target.checked;
    if (event.target.dataset.tasks === "status") {
      const task = tasks.find(item => item.id === event.target.dataset.id);
      if (task) void api.updateTask(task.id, { title: task.title, details: task.details, status: event.target.value, priority: task.priority, dueDate: task.dueDate }).then(refreshTasks).then(render).catch(cause => { error = errorText(cause); render(); });
    }
  });
  root.addEventListener("submit", event => { if (event.target.id === "taskForm") void saveTask(event); });
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-tasks]");
    if (!button) return;
    const action = button.dataset.tasks;
    if (action === "view") { view = button.dataset.view; notice = ""; render(); }
    else if (action === "cancel-edit") { editingTaskId = null; taskDraft = blankTask(); notice = ""; render(); }
    else if (action === "edit-task" || action === "delete-task") void taskAction(action, button.dataset.id);
    else if (action === "new-note" || action === "select-note" || action === "delete-note") void noteAction(action, button.dataset.id);
    else if (action === "save-note") void saveNote();
  });
  await refreshAll();
  return () => root.replaceChildren();
}

window.SyncAI.pages = window.SyncAI.pages || {};
window.SyncAI.pages.mountTasks = mountTasks;
})();
