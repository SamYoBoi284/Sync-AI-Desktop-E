# Electron Port Audit and Implementation Status

**Repository:** Sync-AI-Desktop-E  
**Updated:** 2026-11-13

## Executive summary

The React renderer already passes a local TypeScript + Vite production build. The Electron port now has a real local persistence layer and desktop shell implementation. The renderer's 44-command service contract is routed through a main-process allowlist. Most non-inference application features have source implementations, but the Electron app has not yet been launched or tested locally because the Electron runtime download was deferred to protect the user's limited data plan.

This is not a completed, validated desktop release. The native llama.cpp inference worker is the major remaining product feature, and Windows runtime validation is still required.

## Implementation status

| Area | Current status | Details |
| --- | --- | --- |
| React + TypeScript renderer | Build passed locally | `npm run build` completed with `tsc && vite build`. |
| Electron main/preload | Implemented in source | Context isolation, sandbox, disabled renderer Node integration, narrow IPC API. |
| IPC security | Implemented in source | Command allowlist, object argument check, trusted sender URL check, popup denial, local navigation restriction. |
| App lifecycle | Implemented in source | Single-instance lock, tray Open/Hide/Exit, close-to-tray, restore/focus behavior. |
| SQLite | Implemented in source; tests added | Built-in `node:sqlite`, WAL, foreign keys, schema migrations 1-4. Must be validated against Electron 39's bundled Node runtime. |
| Chats and settings | Implemented in source | CRUD, message persistence, diagnostics, queued assistant insertion, settings. |
| Chat backups | Implemented in source | Version-1 export/import, bounded backup size/counts, duplicate chat skipping. |
| Workspace | Implemented in source | CRUD, search, bounded selected context. |
| Tasks and Notes | Implemented in source | CRUD, filtering, sorting, context selection. |
| File Library | Implemented in source | File picker, SHA-256, duplicate detection, relink, non-destructive registry removal, 512 MiB ceiling. |
| GGUF registry | Partially implemented | File picker, GGUF magic/version check, SHA-256, duplicate relinking, default model, non-destructive registry removal. Metadata parser is not yet ported. |
| Runtime resource estimate | Not implemented | Requires GGUF metadata parser and runtime-specific memory model. |
| llama.cpp inference worker | Not implemented | Needs a reproducible Windows-compatible native runtime, child-process protocol, streaming, cancellation, telemetry, and recovery. |
| Windows Job Object memory cap | Not implemented | Must not be claimed until the Electron worker is running and verified under a Windows Job Object. |
| Electron launch / installer | Not validated | Electron binary download and packaging have not been attempted in this pass. |

## Command coverage

The frontend exposes 44 commands. The Electron main process now has handlers for the full command-name set:
- 3 host/startup commands
- 12 chat/message/backup/settings commands
- 4 model registry/import commands
- 6 runtime/generation commands (three return explicit unsupported errors for inference-dependent operations)
- 6 Workspace commands
- 4 Task commands
- 5 Note commands
- 4 File Library commands

A registered handler is not the same as a fully implemented feature. In particular, `estimate_model_resources`, `load_model`, and `generate_chat` intentionally fail with clear messages until the native inference layer is ported. `get_runtime_status` reports the unavailable backend rather than fabricating a loaded model.

## Architecture decisions

### SQLite without a native addon
The port uses Node's built-in `node:sqlite` `DatabaseSync` API instead of a native npm addon such as better-sqlite3. This avoids requiring a local C++ toolchain solely to compile the SQLite binding. The module is experimental in Node, so the bundled Node version and API availability must be verified inside Electron itself before production packaging.

### Data compatibility
The database schema preserves the original Tauri schema migrations through version 4 and the existing chat backup version-1 JSON shape. GGUF and File Library entries store canonical original file paths. Removing a registry row never deletes a user's original file.

### Inference isolation
Do not move llama.cpp into the Electron main process or renderer. The intended design remains a dedicated child worker, outside the UI process memory budget, with a bounded protocol and streamed generation events. The existing Tauri worker and Job Object implementation are the behavioral reference, not code that can simply be copied into Electron unchanged.

## Local validation sequence

After pulling the latest branch on Windows:

1. `npm run build` — renderer type-check and Vite production build.
2. `npm test` — SQLite migration, chat, backup, workspace, task, note, and validation tests.
3. `npm run dev` — requires the Electron binary to be present; this is the first full shell/IPC smoke test.
4. Exercise chat creation, message persistence, close-to-tray, tray restore, and second-instance activation.
5. Exercise Workspace, Tasks, Notes, settings, and backup export/import.
6. Exercise GGUF registration with a small valid GGUF file; verify that registry removal does not delete the source file.
7. Only after the native worker is integrated, test model load/unload, streaming, cancellation, worker failure, memory telemetry, and hard memory limits.
8. Run `npm run pack` and `npm run dist` only after development launch and runtime tests pass.

## Validation boundary

The successful earlier `npm run build` is evidence for the renderer only. The new Electron main-process and SQLite files were committed remotely in this pass and have **not** been executed in the user's local Windows environment. The added automated tests are ready to run, but their success is not yet known. Do not describe the desktop application, inference, or installer as finished until those checks pass.
