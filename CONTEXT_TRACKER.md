# Sync AI Desktop E — Project Context

> This file is the current handoff record for the Electron repository. It supersedes the old Tauri/React/Vite context copied into this repository during the initial port. The separate Tauri project remains at https://github.com/SamYoBoi284/Sync-AI-Desktop and is not modified by this Electron port.

## Current architecture (2026-11-14)

- **Desktop shell:** Electron.
- **Renderer:** plain HTML, CSS and classic browser JavaScript.
- **Entry point:** root `index.html`, loaded directly with Electron `BrowserWindow.loadFile()`.
- **Styles:** existing stylesheet set under `src/`.
- **Renderer modules:** ordered classic scripts under `renderer/`; no bundler, transpiler or development server.
- **Main process:** `electron/main.cjs`.
- **Preload:** `electron/preload.cjs`, exposing a narrow `window.syncAI` API.
- **Persistence:** SQLite through Node's built-in `node:sqlite`.
- **Inference:** CPU llama.cpp through `node-llama-cpp` inside an Electron UtilityProcess.
- **Windows memory isolation:** optional Job Object private-commit ceiling applies to the inference worker, not the Electron UI process.
- **Packaging:** Electron Builder / NSIS.

React, React DOM, TypeScript, Vite, their configuration files, and the old TSX renderer have been removed from this repository. Do not reintroduce them for routine UI work. Prefer the existing ESM-style architecture: HTML markup, CSS and modular JavaScript, with privileged operations kept in the main process behind the preload bridge.

## Repository boundaries

- Electron project: https://github.com/SamYoBoi284/Sync-AI-Desktop-E
- Original Tauri project: https://github.com/SamYoBoi284/Sync-AI-Desktop
- Android companion/reference: https://github.com/SamYoBoi284/Sync-AI

Keep these repositories separate. The Tauri and Android repositories must not be modified when working on this Electron edition.

## Source map

~~~text
index.html
src/
  styles.css
  shell.css
  history.css
  workspace.css
  tasks-notes.css
  library.css
renderer/
  api.js
  shared.js
  app.js
  pages/
    chat.js
    history.js
    models.js
    workspace.js
    tasks.js
    library.js
    settings.js
    runtime.js
    preview.js
electron/
  main.cjs
  preload.cjs
  database.cjs
  gguf.cjs
  inference-worker.mjs
  inference-memory-job.ps1
~~~

## Implemented source capabilities

- Native Electron shell, secure preload bridge, local-file navigation restriction, popup denial and direct HTML loading.
- Recent chat navigation and chat composer with sequential queueing, streamed tokens, cancellation and per-message diagnostics.
- SQLite migrations through schema version 4, chat/message persistence, settings and per-message diagnostics.
- Versioned chat backup export/import with validation and duplicate chat skipping.
- Workspace artifacts, selected context, Tasks, Notes and File Library metadata persistence.
- GGUF metadata parsing, SHA-256 identity, original-path model registry, duplicate relinking, default model selection and non-destructive registry removal.
- Isolated CPU llama.cpp worker with model load/unload, streamed completion, cancellation and runtime telemetry.
- Optional llama.cpp allocator cap and Windows Job Object hard private-memory ceiling for the worker.
- Runtime settings and diagnostics UI.

The File Library currently stores metadata, canonical path and hash. It does not feed file contents to the model. The model is not granted arbitrary filesystem, shell or process access. Any future tool operation needs a separately designed, one-time approval boundary.

## Run and test

From the repository root:

~~~cmd
npm install
npm run dev
~~~

Useful validation commands:

~~~cmd
npm test
npm run test:inference-runtime
npm run test:startup
npm run build
npm run dist
~~~

There is no Vite server to start and no `npm run dev` dependency on a TCP port. Electron opens root `index.html` directly.

## Validation boundaries

The Windows GitHub Actions workflow validates renderer JavaScript syntax, SQLite and backup persistence tests, GGUF parser tests, IPC/security contracts, Windows Job Object stress tests, prebuilt native inference runtime initialization, complete application startup through a renderer-ready handshake, and NSIS packaging.

Those tests do not prove that a real user GGUF model has been loaded and used for a full conversation on the target laptop. They also do not replace interactive testing of tray behavior or a hands-on review of each page with actual user data. State these limits accurately.

## Working conventions

- Inspect the actual source and branch state before changing files.
- Prefer one coherent implementation pass over repeated diagnostic-only commits.
- Keep user data, model weights, local databases and secrets out of Git.
- Preserve the main/UI process outside the inference worker's hard memory Job Object.
- Never give the model unrestricted filesystem, shell or process APIs.
- Validate the actual desktop entry point, not only syntax/build output.
- Distinguish source implementation, CI verification and target-machine validation.
- Keep this file, README and `docs/ELECTRON_PORT_AUDIT.md` synchronized when architecture changes.
