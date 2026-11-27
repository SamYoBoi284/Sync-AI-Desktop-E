# Sync AI Desktop E — Implementation Notes

> Updated: 2026-11-26. This file is a concise handoff index for the current Electron repository. For complete architecture/status detail, see `CONTEXT_TRACKER.md`.

## Current project

- Repository: `SamYoBoi284/Sync-AI-Desktop-E`, branch `main`.
- Phase 1 implementation checkpoint: `d8ab68d20c75414fc624fb3a64b5fa8de9847f99`. Architecture baseline and follow-up design: `docs/INTELLIGENCE_MEMORY_ARCHITECTURE.md`.
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


## Phase 1 implementation update

- Schema v8 and Memory metadata/provenance/summary storage are implemented.
- Memory page metadata and provenance display are implemented.
- Auto-learn source links and database/API wiring are implemented.
- Metadata-priority ordering is in place; relevance ranking and independent Notes retrieval remain.
- Summary generation/compaction/prompt consumption remain.
- The current CI run passed the new database tests on both platforms but failed on five unrelated file-operation/source-contract assertions. Do not mark the whole CI suite green.


## Phase 1 context retrieval update

- Implemented independent lexical retrieval for enabled Memory, opted-in Notes and opted-in Workspace artifacts.
- Each source is query-ranked separately and has an independent character budget; existing Notes and Workspace opt-in switches are respected.
- The chat queue uses the queued user message as the bounded retrieval query.
- Prompt assembly now separates Memory, Notes, Workspace, older conversation summary and recent transcript.
- Existing saved conversation summaries can be consumed; automatic summary generation/compaction remains pending.
- Database tests cover relevance ranking, source separation and opt-in behavior. Contract coverage checks the independent IPC and prompt boundaries.
- CI for the latest commit 2209601e2487b8c37b59a23feba29788944be434 had not completed at this checkpoint; do not infer a passing build from source parsing alone.


## Phase 1 substep status

- Step 1 — data model/storage API: COMPLETE. Migration v8, Memory metadata/provenance, summary storage/invalidation, IPC/API and a populated v7 upgrade fixture are implemented. New DB tests pass in source-validation CI.
- Step 2 — Memory Center: IN PROGRESS. Metadata/provenance UI is implemented; filtering/search, storage accounting and learning review remain.
- Step 3 — independent Notes retrieval: COMPLETE. Notes are queried separately from Workspace and Memory, with opt-in preserved.
- Step 4 — context orchestration: IN PROGRESS. Query-aware lexical selection and distinct prompt sections are wired; an overall context ceiling remains.
- Step 5 — summaries/compaction: IN PROGRESS. Stored summaries are invalidated safely and consumed by prompts; generation/refresh/UI are pending.
- Step 6 — Model Profiles: NOT STARTED.
