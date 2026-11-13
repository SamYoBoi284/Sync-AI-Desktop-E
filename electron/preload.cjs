const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("syncAI", {
  invoke: (command, args) => ipcRenderer.invoke("sync:invoke", command, args),
  onGenerationEvent: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on("sync:generation-event", listener); return () => ipcRenderer.removeListener("sync:generation-event", listener); },
});
