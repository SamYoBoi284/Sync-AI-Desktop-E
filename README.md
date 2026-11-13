# Sync AI Desktop E (Electron)

Electron runtime edition of Sync AI Desktop. The React + TypeScript UI is shared with the Tauri edition; desktop services are being migrated behind a typed, restricted IPC bridge.

## Requirements
- Node.js 22.12+ (or 20.19+) and npm
- Windows 10/11

## Setup
Run `npm install`, then `npm run dev`.

## Build
Run `npm run build`, then `npm run start`.

## Port status
- Electron main/preload scaffold with context isolation, disabled renderer Node integration, and a narrow IPC entry point.
- Shared UI is copied from the Tauri source tree into this repository as the initial port baseline.
- App metadata, startup handshake, and host RAM query are implemented.
- Chat/database persistence, Workspace, Tasks & Notes, File Library, model management, GGUF inference, and remaining native commands still need Electron implementations. The UI is present, but those features are not yet functional in this edition.

The original Tauri edition remains separate: https://github.com/SamYoBoi284/Sync-AI-Desktop
