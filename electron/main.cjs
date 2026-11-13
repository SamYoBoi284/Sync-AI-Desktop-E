const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");
let splashAvailable = true;

function registerIpc() {
  ipcMain.handle("sync:invoke", async (_event, command, args = {}) => {
    switch (command) {
      case "get_app_info": return { appName: "Sync AI Desktop", version: app.getVersion(), operatingSystem: process.platform, architecture: process.arch };
      case "consume_startup_splash": { const show = splashAvailable; splashAvailable = false; return show; }
      case "get_host_ram_info": return { totalBytes: os.totalmem(), availableBytes: os.freemem() };
      default: throw new Error(`Electron backend command not ported yet: ${command}`);
    }
  });
}

async function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 680, backgroundColor: "#090a12", show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.once("ready-to-show", () => win.show());
  if (!app.isPackaged) await win.loadURL("http://127.0.0.1:5173");
  else await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}
app.whenReady().then(async () => { registerIpc(); await createWindow(); app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) void createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
