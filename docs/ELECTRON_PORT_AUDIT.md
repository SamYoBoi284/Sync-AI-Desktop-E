# Electron Port Audit and Implementation Status

**Repository:** Sync-AI-Desktop-E  
**Updated:** 2026-11-14

## Executive summary

The Electron edition uses a plain HTML/CSS/JavaScript renderer modeled on the proven ESM project architecture. Electron opens the repository's local `index.html` directly with `BrowserWindow.loadFile()`. There is no React, Vite, TypeScript compilation step, or renderer development server.

The Electron main/preload process retains the native desktop service layer: the 44-command IPC contract, SQLite persistence, file/model registries, and isolated CPU inference worker. The worker uses the prebuilt llama.cpp backend in an Electron UtilityProcess. On Windows it can be assigned to a Job Object with an optional hard process-private-memory ceiling, leaving the main UI process outside that cap.

A dedicated startup smoke test now launches the actual application and waits for a renderer-ready message sent through the preload bridge. This validates more than syntax compilation: it checks that Electron starts, the database and IPC initialize, the HTML file loads, and the JavaScript module graph reaches its bootstrap completion.

A full conversation using a real user GGUF model has not yet been run in CI or on the target machine. Interactive window/tray behavior also still needs target-machine validation.

## Architecture

| Layer | Implementation |
| --- | --- |
| Renderer markup | `index.html` |
| Renderer styles | Existing CSS files under `src/` |
| Renderer behavior | Native JavaScript ES modules under `renderer/` |
| Desktop main process | `electron/main.cjs` |
| Secure bridge | `electron/preload.cjs` |
| Persistence | SQLite via Node's built-in `node:sqlite` |
| Inference | Electron UtilityProcess + prebuilt CPU llama.cpp |
| Packaging | Electron Builder / Windows NSIS |

The renderer uses ordinary browser APIs and a small API wrapper that calls the explicit `window.syncAI` preload bridge. It cannot access Node.js modules or arbitrary filesystem operations. The HTML and its local module graph are packaged as application files, not compiled into a Vite bundle.

## Implementation status

| Area | Current status | Details |
| --- | --- | --- |
| Vanilla renderer | Implemented in source | Direct HTML entry, modular browser JavaScript, existing CSS design system, no framework or dev server. |
| Electron main/preload | Implemented in source | Context isolation, sandbox, disabled renderer Node integration, narrow IPC bridge. |
| IPC security | Implemented and contract-tested | 44 command names match the Electron handler allowlist; object-argument validation, trusted local-file sender check, popup denial and local navigation restriction. |
| App startup | Startup smoke test added | CI launches the real Electron entry point and waits for renderer readiness after native bridge initialization and page mount. |
| App lifecycle | Implemented in source | System tray Open/Hide/Exit and close-to-tray. Interactive tray/window behavior still requires target-machine testing. |
| SQLite | Implemented and Electron-smoke-tested | Built-in `node:sqlite`, WAL, foreign keys, schema migrations 1-4. Main-process smoke test performs a chat/message round-trip. |
| Chats and settings | Implemented and persistence-tested | CRUD, per-message diagnostics, queued assistant insertion, settings. |
| Chat backups | Implemented and persistence-tested | Version-1 export/import, bounded backup size/counts, duplicate chat skipping. |
| Workspace | Implemented and persistence-tested | CRUD, search, bounded selected context. |
| Tasks and Notes | Implemented and persistence-tested | CRUD, filtering, sorting and context selection. |
| File Library | Implemented in source and contract-covered | Native file picker, SHA-256, duplicate detection, relink, non-destructive registry removal, 512 MiB ceiling. |
| GGUF registry | Implemented and parser-tested | Bounded header/metadata parser, architecture/name/quantization extraction, SHA-256, duplicate relinking, default selection, non-destructive registry removal. |
| Native inference | Implemented; backend smoke-tested | node-llama-cpp 3.22.3 runs in an Electron utility process. Load/unload, streamed completion, cancellation and diagnostics are wired to the renderer. A full response with a real GGUF file still needs target-machine validation. |
| Windows hard memory cap | Implemented and stress-tested | PowerShell/C# helper assigns only the utility worker to a Windows Job Object, optionally sets JOB_OBJECT_LIMIT_PROCESS_MEMORY, reports working-set/private-commit metrics and kills the worker on cap breach or job close. |
| Runtime resource estimate | Implemented as informational estimate | Reads GGUF metadata for layer/KV-cache estimates and reports configured hard limit separately. |
| Windows installer | Packaging configured | CI builds the NSIS setup executable and uploads it as a workflow artifact. |

## IPC command coverage

The renderer API wrapper is `renderer/api.js`. The contract test extracts its command names and compares them exactly with the main-process `handlers` allowlist. The 44 commands cover app metadata, chats, backups, settings, models, runtime, generation, Workspace, Tasks, Notes and File Library.

## Native inference and RAM limiting

node-llama-cpp 3.22.3 is loaded in an Electron UtilityProcess, not in the renderer or main UI process. It runs CPU-only with prebuilt binaries and source-build fallback disabled. LlamaCompletion streams text chunks through the main process and preload bridge; cancellation uses an AbortController. Diagnostics include prompt/generated token counts, prompt-evaluation time, generation time, throughput, stop reason, model identity and timestamps.

The worker calls `llama.setRamCap()` before loading model weights. On Windows, a companion PowerShell process creates a Job Object, enables kill-on-job-close, applies `JOB_OBJECT_LIMIT_PROCESS_MEMORY` when configured and assigns the utility worker before model loading. The helper reports working-set and private committed bytes. The Electron main/UI process is never assigned to this Job Object.

## Windows CI checks

The Windows Node 24 workflow runs:

1. Syntax checks for Electron main/preload, inference worker and all vanilla renderer modules.
2. `npm test` for migrations, messages, diagnostics, backup import/export, Workspace, Tasks, Notes, GGUF parsing, IPC contracts and Job Object memory enforcement.
3. `npm run test:inference-runtime` to initialize built-in SQLite in Electron main and the prebuilt CPU llama.cpp backend in an Electron utility process, including its RAM-cap API.
4. `npm run test:startup` to launch the actual Electron app and wait for the renderer-ready handshake.
5. `npm run build` to validate JavaScript renderer syntax.
6. `npm run dist` to build the Windows NSIS installer with publishing disabled.

The smoke tests do not download a model or run a full generated conversation. That requires a real GGUF test asset or the user's own local model.

## Target-machine validation still required

After pulling the updated branch:

1. `git pull --rebase origin main`
2. `npm install` (updates/prunes frontend dependencies and retains the prebuilt CPU inference runtime).
3. `npm test`
4. `npm run test:inference-runtime`
5. `npm run test:startup`
6. `npm run dev` and exercise the visible window, tray restore and app exit.
7. Register a valid local GGUF, load/unload it, generate a response, cancel mid-generation, inspect per-message diagnostics and check the configured RAM ceiling.
8. Test backup export/import, Workspace, Tasks, Notes, settings and File Library with actual user data.

Do not claim real-model generation has passed until step 7 has been exercised. Do not claim interactive tray/window behavior has passed until step 6 has been exercised.
