(() => {
const unavailable = () => new Error("The Sync AI desktop bridge is unavailable. Launch the Electron application to use local data and inference.");
function invoke(command, args = {}) {
  if (!window.syncAI || typeof window.syncAI.invoke !== "function") return Promise.reject(unavailable());
  return window.syncAI.invoke(command, args);
}
function onGenerationEvent(callback) {
  if (!window.syncAI || typeof window.syncAI.onGenerationEvent !== "function") return () => {};
  return window.syncAI.onGenerationEvent(callback);
}
const api = {
  getAppInfo: () => invoke("get_app_info"),
  consumeStartupSplash: () => invoke("consume_startup_splash"),
  listChats: (query = "", limit = 100, offset = 0) => invoke("list_chats", { query, limit, offset }),
  createChat: (title = null) => invoke("create_chat", { title }),
  getChat: chatId => invoke("get_chat", { chatId }),
  renameChat: (chatId, title) => invoke("rename_chat", { chatId, title }),
  deleteChat: chatId => invoke("delete_chat", { chatId }),
  exportChatBackup: () => invoke("export_chat_backup"),
  importChatBackup: backup => invoke("import_chat_backup", { backup }),
  appendMessage: (chatId, message) => invoke("append_message", { chatId, message }),
  updateMessageDiagnostics: (chatId, messageId, diagnostics) => invoke("update_message_diagnostics", { chatId, messageId, diagnostics }),
  appendAssistantMessageAfter: (chatId, userMessageId, message) => invoke("append_assistant_message_after", { chatId, userMessageId, message }),
  getSetting: key => invoke("get_setting", { key }),
  setSetting: (key, valueJson) => invoke("set_setting", { key, valueJson }),
  getHostRamInfo: () => invoke("get_host_ram_info"),
  listModels: () => invoke("list_models"),
  importGguf: () => invoke("import_gguf"),
  setDefaultModel: modelId => invoke("set_default_model", { modelId }),
  removeModel: modelId => invoke("remove_model", { modelId }),
  getRuntimeStatus: () => invoke("get_runtime_status"),
  estimateModelResources: modelId => invoke("estimate_model_resources", { modelId }),
  loadModel: modelId => invoke("load_model", { modelId }),
  unloadModel: () => invoke("unload_model"),
  generateChat: (prompt, generationId) => invoke("generate_chat", { prompt, generationId }),
  cancelGeneration: generationId => invoke("cancel_generation", { generationId }),
  listWorkspaceArtifacts: (query = "") => invoke("list_workspace_artifacts", { query: query || null }),
  getWorkspaceArtifact: artifactId => invoke("get_workspace_artifact", { artifactId }),
  createWorkspaceArtifact: artifact => invoke("create_workspace_artifact", { artifact }),
  updateWorkspaceArtifact: (artifactId, artifact) => invoke("update_workspace_artifact", { artifactId, artifact }),
  deleteWorkspaceArtifact: artifactId => invoke("delete_workspace_artifact", { artifactId }),
  listWorkspaceContext: () => invoke("list_workspace_context"),
  listTasks: (query = "") => invoke("list_tasks", { query: query || null }),
  createTask: task => invoke("create_task", { task }),
  updateTask: (taskId, task) => invoke("update_task", { taskId, task }),
  deleteTask: taskId => invoke("delete_task", { taskId }),
  listNotes: (query = "") => invoke("list_notes", { query: query || null }),
  getNote: noteId => invoke("get_note", { noteId }),
  createNote: note => invoke("create_note", { note }),
  updateNote: (noteId, note) => invoke("update_note", { noteId, note }),
  deleteNote: noteId => invoke("delete_note", { noteId }),
  listLibraryFiles: () => invoke("list_library_files"),
  importLibraryFile: () => invoke("import_library_file"),
  relinkLibraryFile: fileId => invoke("relink_library_file", { fileId }),
  removeLibraryFile: fileId => invoke("remove_library_file", { fileId }),
};

window.SyncAI = window.SyncAI || {};
window.SyncAI.api = api;
window.SyncAI.invoke = invoke;
window.SyncAI.onGenerationEvent = onGenerationEvent;
})();
