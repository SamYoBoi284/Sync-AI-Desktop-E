# Sync AI Desktop E (Electron)

Electron edition of Sync AI Desktop. The React + TypeScript renderer is shared with the separate Tauri edition; desktop services run in the Electron main process behind a restricted preload IPC bridge.

## Requirements
- Node.js 22.12+ and npm
- Windows 10/11
- Electron's platform runtime is downloaded by npm during installation. If the Electron binary download times out, retry only when a stable connection is available.

## Setup
```cmd
npm install
npm run dev
```

## Build and test
```cmd
npm run build
npm test
npm run start
```

The test command uses Node's built-in test runner and temporary SQLite databases. The persistence layer uses the built-in `node:sqlite` module from the Electron/Node runtime, avoiding a separate native SQLite addon and a Visual Studio Build Tools dependency. Node currently labels this built-in module experimental; validate the exact Electron runtime before relying on packaged production builds.

## Implemented in this port
- Electron main/preload separation with context isolation, disabled renderer Node integration, sandboxing, and a narrow command allowlist.
- Renderer IPC sender checks, blocked popups, and navigation restricted to the local app.
- Single-instance activation, system-tray Open/Hide/Exit actions, and close-to-tray behavior.
- Local SQLite schema migrations matching the original desktop schema through version 4.
- Chat history, message diagnostics, queued assistant insertion, settings, and version-1 chat backup import/export.
- Workspace artifacts, selected context, Tasks, Notes, and File Library metadata persistence.
- Non-destructive GGUF registry management: file picker, GGUF magic/version header validation, SHA-256 fingerprinting, duplicate relinking, default selection, and registry-only removal.
- File Library import/relink with SHA-256 fingerprinting and a 512 MiB size ceiling.
- Automated persistence and backup tests.

## Known incomplete work
- **Native inference is not ported.** GGUF registration does not mean a model can be loaded or used. The original isolated llama.cpp worker, streaming generation, cancellation, telemetry, and Windows Job Object memory ceiling still need a compatible packaged runtime and Windows validation. The relevant IPC commands currently return explicit unsupported errors rather than pretending inference works.
- Model metadata extraction is not yet implemented beyond checking the GGUF header/version. Architecture and quantization remain blank until the full parser is ported.
- Resource estimation is not yet implemented.
- Electron launch, tray behavior, native SQLite availability in the exact Electron runtime, and installer packaging still require local Windows validation. A successful Vite build alone does not prove those runtime paths.
- No installer or Electron binary was downloaded as part of this source-only port work.

The original Tauri edition remains separate: https://github.com/SamYoBoi284/Sync-AI-Desktop
