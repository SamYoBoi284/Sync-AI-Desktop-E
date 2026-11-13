# Electron Port Audit

**Repository:** Sync-AI-Desktop-E  
**Audit date:** 2026-11-13  
**Baseline:** frontend production build passes locally (TypeScript + Vite). Electron runtime launch has not yet been validated because the Electron binary has not been downloaded on the development machine.

## Executive summary

The React UI is compiling under the Electron/Vite toolchain. The renderer has been moved behind an Electron preload bridge, and the repository has no `src-tauri` directory or `@tauri-apps` dependency in `package.json`. The frontend service file is now a compatibility boundary named `nativeBridge.ts`, but its API is still the complete desktop service contract originally implemented by Tauri.

The current Electron main process implements only three of the 44 commands used by the frontend service layer:

- `get_app_info`
- `consume_startup_splash`
- `get_host_ram_info`

The other 41 commands are currently rejected by the main-process default branch. As a result, most pages can render, but persistence, model management, runtime operations, and generation are not functional yet.

## Current state

| Area | Status | Notes |
| --- | --- | --- |
| React + TypeScript renderer | Implemented / build passed | Local production build completed with `tsc && vite build`. |
| Vite production assets | Implemented / build passed | Output generated under `dist/`. |
| Electron main process | Initial scaffold | Creates a BrowserWindow and loads Vite or packaged assets. |
| Preload bridge | Initial scaffold | Uses context isolation, disabled renderer Node integration, and a narrow exposed API. |
| App metadata / splash / host RAM | Implemented in Electron | Three IPC commands are handled. |
| Chat persistence and backups | Not ported | 10 chat/settings/message commands remain unimplemented. |
| Model registry and GGUF import | Not ported | 4 model commands remain unimplemented. |
| Inference runtime and generation | Not ported | 6 runtime/generation commands remain unimplemented; no worker is connected. |
| Workspace artifacts | Not ported | 6 commands remain unimplemented. |
| Tasks and Notes | Not ported | 9 commands remain unimplemented. |
| File Library | Not ported | 4 commands remain unimplemented. |
| Tray / single-instance / hide-on-close | Not ported | These behaviors exist in the Tauri host and need deliberate Electron equivalents. |
| Native inference dependency | Not ported | The original Tauri implementation uses a dedicated llama.cpp worker and Windows Job Objects for the optional hard memory ceiling. |
| Electron launch / packaging | Not yet validated | Electron binary download was deferred due network/data constraints. |

## Frontend command contract

The current `src/services/nativeBridge.ts` exposes 44 command names. Three are implemented in `electron/main.cjs`; 41 remain.

### Implemented (3)

- `get_app_info`
- `consume_startup_splash`
- `get_host_ram_info`

### Not yet implemented (41)

- Chats and settings: `list_chats`, `create_chat`, `get_chat`, `rename_chat`, `delete_chat`, `export_chat_backup`, `import_chat_backup`, `get_setting`, `set_setting`, `append_message`, `update_message_diagnostics`, `append_assistant_message_after`
- Models: `list_models`, `import_gguf`, `set_default_model`, `remove_model`
- Runtime and generation: `get_runtime_status`, `estimate_model_resources`, `load_model`, `unload_model`, `generate_chat`, `cancel_generation`
- Workspace: `list_workspace_artifacts`, `get_workspace_artifact`, `create_workspace_artifact`, `update_workspace_artifact`, `delete_workspace_artifact`, `list_workspace_context`
- Tasks: `list_tasks`, `create_task`, `update_task`, `delete_task`
- Notes: `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`
- File Library: `list_library_files`, `import_library_file`, `relink_library_file`, `remove_library_file`

## Tauri-specific findings

- No Tauri package dependency is declared in the Electron `package.json`.
- The Electron repository does not contain the original `src-tauri` host directory.
- The renderer uses `window.syncAI.invoke` rather than calling Tauri directly.
- A stale comment in `src/App.tsx` still describes the browser preview as having no “Tauri IPC host”; update wording to “Electron IPC host” or “desktop IPC host” during the next renderer cleanup.
- The original Tauri host also implements tray integration, single-instance activation, and hide-on-close behavior. These are product behaviors, not merely framework details, and should be carried over intentionally.

## Recommended port order

### Stage A — Desktop shell hardening
1. Add an explicit IPC command allowlist and validate payload shapes at the main-process boundary.
2. Add application lifecycle behavior: tray menu, single-instance lock, hide-on-close policy, and safe window restoration.
3. Improve IPC error normalization so renderer errors are stable and useful.
4. Keep renderer privileges restricted; do not expose raw filesystem, process, or shell APIs.

### Stage B — Local data foundation
1. Select and validate a SQLite strategy that works inside the Electron runtime without forcing the user to install Visual Studio Build Tools.
2. Port schema migrations and storage contracts from the Tauri implementation.
3. Port chat history, message diagnostics, settings, and versioned chat backup import/export.
4. Port Workspace, Tasks, Notes, and File Library storage after the shared database foundation is tested.

### Stage C — Model management
1. Port host RAM and model resource estimates.
2. Implement safe GGUF file selection, metadata inspection, hashing, duplicate detection, relinking, and non-destructive registry removal.
3. Preserve canonical original model paths; do not silently copy or delete user model files.

### Stage D — Inference worker
1. Choose a Windows-compatible llama.cpp integration that can be built and distributed reproducibly.
2. Keep inference in a dedicated child process, separate from the Electron main and renderer processes.
3. Preserve streaming, cancellation, sequential generation, diagnostics, and worker failure recovery.
4. Recreate the optional Windows Job Object memory ceiling only after the basic worker lifecycle is stable.
5. Do not claim the hard memory ceiling is supported until it is tested on Windows.

### Stage E — Validation and packaging
1. Validate clean install, development launch, production launch, and packaged installer.
2. Test SQLite migrations and backup round trips.
3. Test real GGUF load/unload/generation and worker termination.
4. Test tray, single-instance, and close behavior.
5. Run a security review of IPC and file handling.

## Important validation boundary

A successful `npm run build` confirms TypeScript compilation and Vite asset generation. It does **not** confirm that Electron launches, that IPC commands work, that SQLite persists data, that GGUF inference works, or that a Windows installer can be produced. Each of those needs its own runtime validation.
