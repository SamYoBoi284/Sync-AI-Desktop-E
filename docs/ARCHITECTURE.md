# Sync AI Desktop E — Architecture

## 1. Overview

Sync AI Desktop E is a Windows-first, local-first assistant built with Electron. Its renderer follows the architecture already proven by the ESM project: ordinary HTML, CSS and JavaScript loaded directly by Electron. The app does not use React, TypeScript, Vite or a renderer development server.

Electron provides the desktop window and native process boundary. The main process owns SQLite, file pickers, model registry operations and inference-worker lifecycle. A restricted preload script exposes a small IPC API to the page.

## 2. Runtime layout

~~~text
                    Electron BrowserWindow
                              |
                              | loads root index.html
                              v
                 HTML + CSS + classic JavaScript
                     renderer/app.js and pages
                              |
                              | window.syncAI
                              v
                      electron/preload.cjs
                              |
                         IPC allowlist
                              |
                              v
                       electron/main.cjs
                         /          \
                        /            \
                 SQLite database   Native services
                                      |
                               Electron UtilityProcess
                                      |
                                node-llama-cpp
                                      |
                                CPU GGUF inference
~~~

The renderer contains no Node.js integration. It cannot load arbitrary Node modules or directly access the filesystem. Every privileged operation is handled by an explicit command in the main-process allowlist.

## 3. Frontend

- `index.html` is the renderer entry point.
- Local CSS files under `src/` provide the visual system and page styling.
- `renderer/api.js` wraps the narrow preload bridge.
- `renderer/shared.js` contains shared formatting and UI helpers.
- `renderer/app.js` owns the persistent desktop shell, recent-chat list and page navigation.
- `renderer/pages/` contains isolated feature-page modules.

The page scripts are classic JavaScript files wrapped in small scopes and loaded in dependency order with `defer` script tags. They do not use ES-module imports, so the local `file://` renderer does not depend on browser module-fetch behavior or cross-origin handling. Each page exposes a mount function through the shared `window.SyncAI.pages` namespace.

To add a page:
1. Add a classic JavaScript file under `renderer/pages/`.
2. Read native operations from `window.SyncAI.api`; use shared helpers from `window.SyncAI.shared`.
3. Register the page mount function in `window.SyncAI.pages`.
4. Add its deferred script to `index.html` before `renderer/app.js`.
5. Add the page route and navigation label in `renderer/shared.js` and `renderer/app.js`.
6. Keep privileged behavior in the main process and expose only the required IPC command through preload.

## 4. Electron main and preload

`electron/main.cjs` owns:
- Electron startup and shutdown.
- The BrowserWindow and system tray.
- SQLite database initialization.
- Native file dialogs and file hashing.
- GGUF registration and original-path model management.
- IPC command validation and sender-origin checks.
- Inference UtilityProcess startup, cancellation, telemetry and cleanup.
- Windows Job Object attachment for the worker memory ceiling.

`electron/preload.cjs` uses `contextBridge` and `ipcRenderer` to expose `window.syncAI`. Do not expose `ipcRenderer`, Node modules, child-process APIs or unrestricted filesystem operations to page JavaScript.

## 5. Persistence

The app uses Electron's built-in `node:sqlite` through `electron/database.cjs`, with migrations through schema version 4. Data includes chats, messages, per-message diagnostics, settings, GGUF model registry, Workspace artifacts, Tasks, Notes and File Library metadata.

Chat backups use a desktop-native, versioned JSON format. Import validates the payload, enforces limits and skips duplicate chat IDs instead of overwriting local conversations.

The File Library records the user's canonical original path, file size and SHA-256 hash. It does not copy, move or delete the original file. The current library does not read file contents into prompts.

## 6. Local inference and memory isolation

The renderer never loads llama.cpp. The main process creates an Electron UtilityProcess for `electron/inference-worker.mjs`, which uses the prebuilt CPU `node-llama-cpp` runtime.

The main process controls model load/unload, streamed generation, cancellation, status and diagnostics. On Windows, the worker can be attached to a Job Object with a hard private-commit memory ceiling. The Electron main/UI process is deliberately outside that Job Object so a worker memory-limit failure does not have to terminate the interface.

The model library stores original file paths and hashes. Registering or removing a model changes only its registry record; the original GGUF file remains untouched.

## 7. Security boundaries

- `contextIsolation: true`, `nodeIntegration: false` and renderer sandboxing remain enabled.
- IPC accepts only commands in the explicit main-process handler allowlist and only from the trusted local HTML page.
- Popups are denied and navigation is restricted to the application's own `index.html`.
- The renderer cannot invoke shell commands or arbitrary processes.
- Model output is untrusted content. It does not gain authority to read files, execute commands or control the OS.
- Future host tools require a separate allowlist, exact-scope confirmation, one-time approval and independent main-process validation.

## 8. Validation

The Windows CI workflow checks source syntax, persistence and backup behavior, GGUF parsing, IPC/security contracts, Job Object memory enforcement, prebuilt native runtime initialization, full Electron startup through a renderer-ready handshake, and NSIS packaging.

A full response using a real user GGUF model and interactive tray behavior still require target-machine testing. Do not treat a successful source build or native runtime smoke test as proof of real-model chat behavior.
