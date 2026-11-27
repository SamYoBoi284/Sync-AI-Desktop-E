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


## Latest Phase 1 implementation handoff

- Schema v9: Memory candidate queue stores pending/approved/rejected suggestions plus source conversation/message snapshots.
- Memory Center now provides search, category/status filters, UTF-8 content byte usage, three learning modes and approval/rejection of candidates.
- Old installations remain compatible through the legacy `memory_auto_learn` fallback. New `memory_learning_mode` setting can be Off, Review first or Automatic.
- Global context budget is stored as `context_budget_percent` (40–80%, step 5, default65). The loaded model's context length is used to derive a conservative prompt character allowance and reserve output/safety capacity.
- Prompt building clips separate Memory, Notes, Workspace, summary and transcript sections under that allowance, preserving newest transcript text first.
- Per-conversation summary generation is enabled by default via `conversation_summary_auto`; it incrementally summarizes older turns once the prompt threshold is crossed, leaves the newest eight turns verbatim and saves a summary cursor.
- Step 2 COMPLETE; Step 4 COMPLETE for the current lexical/character-budget design; Step 5 IN PROGRESS for summary inspection/rebuild UI and cross-chat retrieval; Step 6 Model Profiles NOT STARTED.
- Current Ubuntu source-validation: 56 pass, 1 fail, 1 skipped; only failure is the pre-existing inference source-contract assertion. Windows hosted file/path tests and the Electron runtime/package workflow have not all completed at this checkpoint.
- Manual target-machine UI and real-GGUF tests remain outstanding.


## Context-window enforcement refinement

- Worker calculates output token allowance from actual loaded context size minus app-prompt tokens, system-prompt tokens and safety margin; output remains capped at 512 tokens.
- Overall context policy reserves system prompt, safety and reply capacity. UI displays effective prompt budget/output reserve.
- Automatic learning and summary prompts are budgeted too.
- Summary cursor advances only through an older-message prefix actually included in the summary prompt, preventing skipped backlog content when a full delta does not fit.
- Updated legacy source-contract assertions to match the actual `LlamaChatSession` API and `workerPid` memory-guard handoff. Latest commit `6bc3bc129759cf8b9ed8afa35daad83ab342c01d` is awaiting CI.


## Final Phase 1 handoff — 2026-11-26

- Memory Center search/category/status filters and byte usage are implemented. Learning has Off, Review first and Automatic modes. Candidate suggestions remain outside saved Memory until approved; reject preserves the current profile.
- Migration v9 persists candidate review history and source snapshots. Legacy auto-learn boolean remains supported as fallback.
- Global context budget setting: 40–80%, step5, default65. Main-process policy reserves system instructions/safety/output. UI displays effective prompt cap and output reserve.
- Inference worker tokenizes the prompt and Sync's system prompt, then caps generated tokens to actual remaining context (maximum512).
- Chat, learning and summary prompts are bounded. Summaries are incrementally generated in message-prefix batches; cursor advances only through messages actually sent to the model; newest eight messages stay verbatim.
- Automatic summaries default to enabled; toggle is in Memory settings. They reuse the loaded model and do not create another worker/model.
- Latest source contract correction commit: `700541503116b7c9932576952dd5b7f2d98a5bf2`; CI pending. Previous full validation failures were from stale test contracts updated in that commit plus Windows hosted temp-path/file-action issues in earlier runs.
- Do not claim target-device UI or real GGUF validation; neither was performed in this milestone.


## Navigation and responsive layout checkpoint — 2026-11-26

- Added an in-app Back stack and top-bar Back/ESC affordance for routes opened from within a page; selecting a root sidebar destination resets that stack.
- Escape now resolves supported nested chat menus/dialogs before page navigation. Privacy & Tools approval dialogs keep their own keyboard/focus handler.
- Horizontal overflow guards were added to the chat transcript and sidebar folder list; message-action tooltips now stay inside their side of the viewport.
- This has not yet been manually exercised in the Electron UI at different window sizes.


## Phase 1 implementation completion — 2026-11-26

- Schema v10 adds persistent per-model profiles with context window, batch size, temperature and maximum output-token settings. Validation is enforced in the SQLite API; deleting a model cascades its profile.
- Local Models exposes profile editing per GGUF. Existing global Runtime context/batch settings remain the fallback for models without a custom profile. A saved profile is applied at next load/recovery, not retroactively to a running worker.
- Memory Summary Center supports searching the summary index, viewing/editing stored text, reviewing its coverage cursor, deleting it and rebuilding from the original chat transcript.
- Rebuilds keep the newest eight turns outside the summary, process older history in bounded batches, and persist a replacement only when the complete rebuild succeeds. Cancellation/failure preserves the previous saved version.
- Cross-chat context retrieval is optional (off by default), relevance-ranked from the latest user message, excludes the active chat, and is bounded to four summaries / 6,000 source characters with a dedicated prompt allocation.
- This completes the three remaining Phase 1 implementation areas. User will perform item 4: full database and contract suites, CI review, migration preservation, manual UI checks and actual GGUF inference testing.
