# Sync AI Desktop E (Electron)

Electron edition of Sync AI Desktop. The React + TypeScript renderer is shared with the separate Tauri edition; desktop services run in the Electron main process behind a restricted preload IPC bridge.

## Requirements

- Node.js 22.12+ and npm
- Windows 10/11 x64
- A local GGUF model file for actual chat generation

## Install and run

Run these commands from the repository directory:

    npm install
    npm run dev

The first npm install downloads the Electron runtime and the prebuilt CPU llama.cpp package. It does not require Visual Studio Build Tools or a local C++ compiler. These are native/runtime dependencies, so use a stable Wi-Fi connection rather than a limited mobile-data plan.

## Build and validate

    npm test
    npm run test:inference-runtime
    npm run build
    npm run dist

The test suite includes SQLite persistence and backup tests, GGUF metadata parser tests, IPC/security contract tests, and a Windows Job Object stress test. The Electron smoke test initializes the bundled CPU llama.cpp backend in an Electron utility process and exercises its RAM-cap API. The build command checks TypeScript and builds the renderer. The distribution command produces the Windows NSIS installer under release/.

## Implemented in this port

- Electron main/preload separation with context isolation, disabled renderer Node integration, sandboxing, and a narrow IPC command allowlist.
- Renderer IPC sender checks, blocked popups, and navigation restricted to the local app.
- Single-instance activation, system-tray Open/Hide/Exit actions, and close-to-tray behavior.
- Local SQLite schema migrations matching the original desktop schema through version 4, using Electron's built-in node:sqlite.
- Chat history, per-message diagnostics, queued assistant insertion, settings, and version-1 chat backup import/export.
- Workspace artifacts, selected context, Tasks, Notes, and File Library metadata persistence.
- Non-destructive GGUF registry management: bounded metadata-table parser, architecture/name/quantization extraction, SHA-256 fingerprinting, duplicate relinking, default selection, and registry-only removal.
- A dedicated Electron utility-process inference worker using node-llama-cpp 3.22.3 in CPU-only mode, with model load/unload, streamed completion, cancellation, runtime status, and message diagnostics.
- RAM limiting at two layers: llama.cpp's allocator cap and a Windows Job Object hard private-committed-memory ceiling applied to the worker process. The Electron UI/main process is not assigned to that Job Object.
- Worker working-set/private-memory telemetry and kill-on-job-close cleanup.
- GGUF-based informational memory estimates using model metadata, KV-cache dimensions, and the existing 2,048 context / 128 batch defaults.
- File Library import/relink with SHA-256 fingerprinting and a 512 MiB size ceiling.
- Windows CI for automated tests, Electron native-runtime smoke validation, TypeScript/Vite production build, and NSIS installer packaging.

## Validation boundary

The Windows CI suite has passed persistence and backup tests, GGUF parser tests, IPC/security contract tests, a memory-ceiling stress test that confirms Windows terminates the inference worker after its private-memory ceiling is exceeded, Electron SQLite/native runtime smoke validation, and the TypeScript + Vite production build.

The automated runtime smoke test does not load a real user GGUF model or generate a full chat response. That final model-specific path still needs to be exercised with a valid local GGUF file on the target machine. The visible window/tray workflow also needs a target-machine smoke test.

The GGUF metadata parser reads only the bounded header/metadata table for registration and estimates; llama.cpp reads tensor data when the model is loaded. Removing a model or File Library registry entry never deletes the original user file.

The original Tauri edition remains separate: https://github.com/SamYoBoi284/Sync-AI-Desktop
