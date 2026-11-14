# Sync AI Desktop E (Electron)

The Electron edition of Sync AI Desktop uses the straightforward renderer architecture proven by ESM: native HTML, CSS and JavaScript modules loaded directly by Electron. There is no React, Vite, TypeScript compiler or frontend development server.

## Requirements

- Node.js 22.12+ and npm
- Windows 10/11 x64
- A local GGUF model file for actual chat generation

## Install and run

Run these commands from the repository directory:

    npm install
    npm run dev

Electron opens the local `index.html` directly. The first npm install downloads the Electron runtime and the prebuilt CPU llama.cpp package. It does not require Visual Studio Build Tools or a local C++ compiler. These are native/runtime dependencies, so use a stable Wi-Fi connection rather than a limited mobile-data plan.

## Build and validate

    npm test
    npm run test:inference-runtime
    npm run test:startup
    npm run build
    npm run dist

The test suite covers SQLite persistence and backups, GGUF metadata parsing, IPC/security contracts, Windows Job Object memory enforcement, and the vanilla renderer structure. The inference runtime smoke test initializes the prebuilt CPU llama.cpp backend in an Electron utility process and exercises its RAM-cap API. The startup smoke test launches the complete Electron app and waits for the renderer to report that its modules and preload bridge are ready. The build command syntax-checks the plain JavaScript renderer. The distribution command produces the Windows NSIS installer under `release/`.

## Architecture

- **Renderer:** `index.html`, CSS stylesheets in `src/`, and modular browser JavaScript in `renderer/`. Electron loads the HTML file with `BrowserWindow.loadFile()`; no local web server or bundle is involved.
- **Main process:** `electron/main.cjs` owns the desktop lifecycle, SQLite database, native file pickers, model registry and inference-worker orchestration.
- **Preload:** `electron/preload.cjs` exposes a small, explicit IPC bridge. The renderer has no Node.js integration and cannot access arbitrary filesystem APIs.
- **Inference:** a dedicated Electron UtilityProcess runs CPU llama.cpp away from the interface. On Windows, an optional Job Object enforces a hard private-memory ceiling on that worker only.

## Implemented in this port

- Electron main/preload separation with context isolation, disabled renderer Node integration, sandboxing, and a narrow IPC command allowlist.
- Direct local-file loading, blocked popups, and navigation restricted to the application's own `index.html`.
- System-tray Open/Hide/Exit actions and close-to-tray behavior.
- Local SQLite schema migrations through version 4 using Electron's built-in `node:sqlite`.
- Chat history, per-message diagnostics, queued assistant insertion, settings, and version-1 chat backup import/export.
- Workspace artifacts, selected context, Tasks, Notes, and File Library metadata persistence.
- Non-destructive GGUF registry management, bounded metadata parsing, SHA-256 fingerprinting, duplicate relinking, default selection, and registry-only removal.
- An isolated CPU inference worker with model load/unload, streamed completion, cancellation, runtime status, and message diagnostics.
- llama.cpp allocator cap plus Windows Job Object hard private-memory ceiling, with the Electron interface process kept outside the worker limit.
- Worker working-set/private-memory telemetry and kill-on-job-close cleanup.
- GGUF-based informational memory estimates and a 512 MiB File Library size ceiling.
- Windows CI for source checks, persistence tests, native-runtime smoke validation, full application startup smoke validation, and NSIS installer packaging.

## Validation boundary

CI validates the renderer modules, Electron startup through the renderer-ready handshake, SQLite persistence, GGUF parsing, IPC/security contracts, the memory-ceiling stress fixture, and the prebuilt native runtime. The automated startup smoke test proves that the main process, preload, local HTML document and renderer modules start together. It does not test interactive tray behavior or load a real user GGUF model.

A full conversation using a real user GGUF model still needs to be exercised with a valid local GGUF file on the target machine. Do not claim real-model generation or interactive window/tray behavior has passed until those paths have been tested.

The GGUF metadata parser reads only the bounded header/metadata table for registration and estimates; llama.cpp reads tensor data when the model is loaded. Removing a model or File Library registry entry never deletes the original user file.

The original Tauri edition remains separate: https://github.com/SamYoBoi284/Sync-AI-Desktop
