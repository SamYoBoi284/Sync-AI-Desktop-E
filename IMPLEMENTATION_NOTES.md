# Sync AI Desktop E — Implementation Notes

The earlier React/TypeScript/Vite shell notes in this file were written for the initial prototype and are superseded by the Electron renderer migration committed on 2026-11-14.

The current renderer uses:
- root `index.html`,
- local CSS under `src/`,
- classic JavaScript files under `renderer/`,
- Electron `BrowserWindow.loadFile()` with no development server.

There is no React, TypeScript, Vite, TSX entry point or module-bundler build step in the current Electron repository.

For the current implementation map, native boundaries, run commands and validation limits, see:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ELECTRON_PORT_AUDIT.md`
- `CONTEXT_TRACKER.md`

The original Tauri project remains separate at https://github.com/SamYoBoi284/Sync-AI-Desktop. This Electron repo must not modify that project or the Android companion repository.
