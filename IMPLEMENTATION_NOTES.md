# Sync AI Desktop E — Implementation Notes

> Updated: 2026-11-26. This file is a concise handoff index for the current Electron repository. For complete architecture/status detail, see `CONTEXT_TRACKER.md`.

## Current project

- Repository: `SamYoBoi284/Sync-AI-Desktop-E`, branch `main`.
- Latest reviewed application-source commit: `363647adbd113b829307a6110b58a60988ab7bff`. The intelligence/memory architecture baseline is documented at `ed26ba2d8cc4107aca3bdb86664fc78192ce3279`.
- Electron application using root `index.html`, local CSS in `src/`, classic JavaScript renderer scripts in `renderer/`, restricted preload bridge, SQLite and isolated CPU llama.cpp UtilityProcess.
- No React, Vue, Angular, TypeScript, Vite, TSX renderer or frontend development server.

## Current implemented areas

- Chat creation/loading, SQLite messages, streamed local inference, sequential queueing, cancellation, generation diagnostics and chat title generation.
- Chat management: recent list/search, pinning, rename, move-to-top, folders, archive/restore, delete and export/import.
- Message editing data operation exists and regenerates from the edited turn, but the current visible editor still uses `window.prompt()`; inline composer editing remains future work.
- Local GGUF registry, metadata/hash validation, original-path tracking, relinking, model load/unload, worker telemetry and optional Windows Job Object private-memory ceiling.
- Persistent Memory page, import/edit/enable/disable/delete, bounded prompt budget and optional bounded auto-learning. A Phase 1 baseline audit is complete; category/importance/pinning/provenance and relevance retrieval remain to be built.
- Notes already have independent local persistence and CRUD, but Notes and Workspace context are currently combined at prompt assembly. Conversation summaries/compaction are not yet implemented.
- Composer `@` tool palette, file operation preparation and explicit approvals; typed `@` works independently of the visible button.
- Privacy & Tools action journal, modal approval/cancellation/undo, focus handling and global stop/rollback controls.
- Workspace artifacts, Tasks, Notes and metadata-only File Library.

## Renderer source map

- `index.html`: direct Electron entry; deferred scripts must keep page dependencies before `renderer/app.js`.
- `src/styles.css`: base styles, shared visual tokens, splash and generation indicator.
- `src/shell.css`: shell and accumulated page/component styling.
- `src/history.css`: History/Archive.
- `src/workspace.css`: Workspace and shared styles.
- `src/tasks-notes.css`: Tasks and Notes.
- `src/library.css`: File Library.
- `renderer/api.js`: restricted API wrapper; reference only during visual pass.
- `renderer/shared.js`: page metadata and common helpers.
- `renderer/app.js`: shell, routing, recent chat/sidebar actions, bootstrap and splash lifecycle.
- `renderer/pages/chat.js`: composer, messages, generation, editing flow and file tools.
- `renderer/pages/history.js`: History and Archive.
- `renderer/pages/folders.js`: folder management.
- `renderer/pages/models.js`: GGUF management.
- `renderer/pages/workspace.js`: artifact management.
- `renderer/pages/tasks.js`: task and note management.
- `renderer/pages/library.js`: File Library.
- `renderer/pages/runtime.js`: telemetry, context/batch settings and force-stop recovery.
- `renderer/pages/settings.js`: RAM limiter and page navigation.
- `renderer/pages/memory.js`: persistent saved memory and auto-learning controls.
- `renderer/pages/privacy-tools.js`: file-operation approvals, action journal and undo.
- `renderer/pages/preview.js`: Appearance preferences plus any remaining staged/preview pages.

## Important source-review findings for visual work

1. `styles.css` and `shell.css` contain accumulated styles and some overlapping responsibilities. Inspect selectors before consolidating or deleting them.
2. The splash markup is in `renderer/app.js`; appearance/animations are in `src/styles.css`. The current renderer shows it after bootstrap work and uses an 850 ms remaining-minimum calculation. The desired 4–7 second visible minimum needs a lifecycle-aware fix, not just a bigger number.
3. The three-dot generation indicator already exists in chat markup/CSS. Preserve and polish it.
4. Privacy approval dialogs include focus management, keyboard handling and focus restoration. Preserve these safety/accessibility behaviors.
5. Runtime telemetry refreshes every 1.5 seconds; avoid focus loss and layout flicker.
6. Include `folders.js`, `memory.js` and `privacy-tools.js` in a complete page-module handoff; older lists may omit these active modules.

## Intelligence & memory baseline

- See `docs/INTELLIGENCE_MEMORY_ARCHITECTURE.md` for the source-verified inventory, agreed data separation, retrieval design and Phase 1 implementation sequence.
- Current SQLite schema is migration v7 (not v4).
- Memory table exists; Notes table exists separately; conversation transcripts exist, but persistent conversation summaries do not.
- The baseline audit changed documentation only. No database migration or runtime behavior was modified.

## Current visual pass

Claude's task is a visual polish/animation overhaul only. Keep the Electron/classic-script architecture, existing IDs/data attributes/event delegation and API contracts. Do not edit `electron/main.cjs`, `electron/preload.cjs`, `electron/inference-worker.mjs`, database/inference implementation or file-operation safety code. Export modified/new files preserving relative paths and an updated tracker; report executed versus unexecuted tests honestly.

## Planned next interaction work — not yet implemented

- Centralized, persistent, customizable keyboard shortcut manager with reference UI in Settings, conflict detection and context-aware input protection.
- `Ctrl + K` global app search across chats/messages, settings, models, folders, files/notes, tasks, workspace and actions.
- `Ctrl + Shift + P` command palette for executing app actions, distinct from search-result navigation.
- Universal `Esc` Back/Cancel stack: close the most immediate nested interface first.
- `Ctrl + ?` opens shortcut reference; `Alt + C` cancels message editing. Do not add Ctrl+W, Ctrl+Q or F11 window shortcuts. Other bindings remain to be finalized.
- Remove visible composer `@` button only; preserve manually typed `@` autocomplete.
- Replace prompt-based user-message editing with an inline composer edit state, Cancel beside Send, Alt+C cancellation and submission through the existing edit/regenerate data operation.

## Validation boundary

The most recent review fetched and inspected GitHub source; it did not launch Electron or execute npm tests/builds. See `README.md`, `docs/ELECTRON_PORT_AUDIT.md` and `CONTEXT_TRACKER.md` for documented CI coverage and target-machine testing still required.
