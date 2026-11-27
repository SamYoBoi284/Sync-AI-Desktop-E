const { contextBridge, ipcRenderer, webFrame } = require("electron");
contextBridge.exposeInMainWorld("syncAI", {
  invoke: (command, args) => ipcRenderer.invoke("sync:invoke", command, args),
  onGenerationEvent: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on("sync:generation-event", listener); return () => ipcRenderer.removeListener("sync:generation-event", listener); },
  onActionEvent: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on("sync:action-event", listener); return () => ipcRenderer.removeListener("sync:action-event", listener); },
  rendererReady: () => ipcRenderer.send("sync:renderer-ready"),
  restoreFocusAfterDialog: () => ipcRenderer.send("sync:restore-focus-after-dialog"),
});

/*
 * Windows Electron/Chromium can lose DOM keyboard routing after a native
 * alert/confirm/prompt closes, even while the textarea still looks focused.
 * Wrap the page-world dialogs centrally so every composer and text field
 * benefits without changing individual renderer call sites.
 */
webFrame.executeJavaScript(`
  (() => {
    for (const name of ["alert", "confirm", "prompt"]) {
      const original = window[name].bind(window);
      window[name] = (...args) => {
        try { return original(...args); }
        finally { window.syncAI?.restoreFocusAfterDialog?.(); }
      };
    }
  })();
`);
