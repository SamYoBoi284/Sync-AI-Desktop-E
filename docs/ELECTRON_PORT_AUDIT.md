# Electron Port Audit and Implementation Status

**Repository:** Sync-AI-Desktop-E  
**Updated:** 2026-11-13

## Executive summary

The Electron edition now has implementations for the complete 44-command renderer IPC contract, persistent SQLite storage, the desktop shell, file/model registries, and an isolated native inference worker. The worker uses the prebuilt CPU llama.cpp backend in an Electron utility process. On Windows it is assigned to a Job Object with an optional hard process-private-memory ceiling, leaving the Electron UI/main process outside that cap.

The Windows CI suite has passed the persistence/backup tests, GGUF parser tests, IPC/security contract tests, a memory-ceiling stress test, Electron SQLite/native runtime smoke validation, and the TypeScript + Vite production build.

A full conversation using a real user GGUF model has not yet been run in CI or on the user's target machine. The packaged app's normal window/tray flow also needs a target-machine smoke test. Keep those validation boundaries explicit.

## Implementation status

| Area | Current status | Details |
| --- | --- | --- |
| React + TypeScript renderer | Implemented and build-tested | npm run build completes with tsc and Vite. |
| Electron main/preload | Implemented in source | Context isolation, sandbox, disabled renderer Node integration, narrow IPC bridge. |
| IPC security | Implemented and contract-tested | Command allowlist, object-argument validation, trusted sender URL check, popup denial, local navigation restriction. |
| App lifecycle | Implemented in source | Single-instance lock, tray Open/Hide/Exit, close-to-tray, restore/focus behavior. Visible tray/window behavior still needs a target-machine smoke test. |
| SQLite | Implemented and Electron-smoke-tested | Built-in node:sqlite, WAL, foreign keys, schema migrations 1-4. Main-process Electron smoke test performs a chat/message round-trip. |
| Chats and settings | Implemented and persistence-tested | CRUD, per-message diagnostics, queued assistant insertion, settings. |
| Chat backups | Implemented and persistence-tested | Version-1 export/import, bounded backup size/counts, duplicate chat skipping. |
| Workspace | Implemented and persistence-tested | CRUD, search, bounded selected context. |
| Tasks and Notes | Implemented and persistence-tested | CRUD, filtering, sorting, context selection. |
| File Library | Implemented in source and contract-covered | File picker, SHA-256, duplicate detection, relink, non-destructive registry removal, 512 MiB ceiling. |
| GGUF registry | Implemented and parser-tested | Bounded header/metadata parser, architecture/name/quantization extraction, SHA-256, duplicate relinking, default selection, non-destructive registry removal. |
| Native inference | Implemented; backend smoke-tested | node-llama-cpp 3.22.3 runs in an Electron utility process. Model load/unload, streamed completion, cancellation, and diagnostics are wired to the frontend. A full response with a real GGUF file still needs target-machine validation. |
| Windows hard memory cap | Implemented and stress-tested | PowerShell/C# helper assigns only the utility worker to a Windows Job Object, optionally sets JOB_OBJECT_LIMIT_PROCESS_MEMORY, reports working-set/private-commit metrics, and kills the worker on cap breach or job close. The main Electron process remains outside the Job Object. |
| Runtime resource estimate | Implemented as informational estimate | Reads GGUF metadata for layer/KV-cache estimates and returns the configured hard limit separately. The estimate itself does not enforce the limit. |
| Native runtime install/package | Implemented in source | Uses the prebuilt CPU runtime, disables source builds (build: never), and configures Windows-specific native files for ASAR packaging. |
| Windows installer | Packaging configured; latest CI run pending | CI runs NSIS packaging with publishing disabled and uploads the generated setup artifact. |

## Command coverage

The frontend exposes 44 commands. electron/contract.test.cjs extracts command names from src/services/nativeBridge.ts and verifies exact coverage against the main-process handler allowlist. All 44 names have matching handlers, including native inference load, unload, generate, cancel, and runtime-status commands.

## Architecture decisions

### SQLite without a native addon

The port uses Node's built-in node:sqlite DatabaseSync API instead of a third-party native SQLite addon. This avoids requiring a local C++ toolchain solely for the database binding. The exact Electron runtime has been smoke-tested with a temporary database and chat/message round-trip. Node labels node:sqlite experimental, so retain the smoke test when upgrading Electron/Node.

### Native inference isolation

node-llama-cpp 3.22.3 is loaded in an Electron utility process, not in the renderer or main UI process. It runs CPU-only with prebuilt binaries and source-build fallback disabled. LlamaCompletion streams text chunks back through the main process and preload bridge; cancellation uses an AbortController. Diagnostics include prompt/generated token counts, prompt-evaluation time, generation time, throughput, stop reason, model identity, and timestamps.

### RAM limiting

The worker calls llama.setRamCap() before loading model weights. On Windows, a companion PowerShell process creates a Job Object, enables kill-on-job-close, applies JOB_OBJECT_LIMIT_PROCESS_MEMORY when the setting is enabled, and assigns the utility worker before the worker is permitted to load a model. The helper reports working-set and private committed bytes. The Electron main/UI process is never assigned to this Job Object. A Windows integration test deliberately allocates memory until the cap terminates the child process.

### Data compatibility

The database schema preserves the desktop schema migrations through version 4 and the existing chat backup version-1 JSON shape. GGUF and File Library entries store canonical original file paths. Removing a registry row never deletes a user's original file.

## Windows CI checks

The Windows Node 24 workflow runs:

1. node --check on Electron main/preload and inference worker source.
2. npm test for migrations, messages, diagnostics, backup import/export, Workspace, Tasks, Notes, GGUF parsing, IPC contracts, and Job Object memory enforcement.
3. npm run test:inference-runtime to initialize built-in SQLite in Electron main and the prebuilt CPU llama.cpp backend in an Electron utility process, including its RAM-cap API.
4. npm run build for TypeScript and Vite production build.
5. npm run dist for the Windows NSIS installer, with publishing disabled; the setup executable is uploaded as a workflow artifact.

The smoke test does not download a model or run a full generated conversation. That requires a real GGUF test asset or the user's existing local model.

## Target-machine validation still required

After pulling the latest branch and installing native dependencies on the user's Windows machine:

1. git pull --rebase origin main
2. npm install (downloads Electron and the prebuilt CPU inference runtime; use stable Wi-Fi).
3. npm test
4. npm run test:inference-runtime
5. npm run build
6. npm run dev and exercise visible window startup, close-to-tray, tray restore, single-instance activation, and app exit.
7. Register a valid local GGUF, load/unload it, generate a response, cancel mid-generation, inspect per-message diagnostics, and deliberately set a conservative RAM ceiling to verify the UI remains alive if the worker reaches it.
8. Test backup export/import and the Workspace, Tasks, Notes, settings, and File Library UI with actual user data.

Do not claim real-model generation has passed until step 7 has been exercised. Do not claim the target machine's normal UI/tray flow has passed until step 6 has been exercised.
