# Development Log

Chronological record of meaningful implementation sessions. Keep entries factual and link commits or pull requests when available.

## 2026-11-12 — Phase 3 scope revision

- User approved per-assistant-message diagnostics as part of persisted chat messages.
- User requested chat backup export/import for future desktop versions; the desktop format will be versioned and preserve per-message diagnostics.
- Android backup v1 and raw chats.json compatibility are removed from desktop requirements.
- Phase 3 retains SQLite, chat/message CRUD, settings persistence, History search/rename/delete/reopen and transactional import/export.
- Added docs/PHASE3_DATA_CONTRACT.md as the implementation contract.
- This entry records scope only; implementation is tracked in the subsequent Phase 3 source entry.

## 2026-11-12 — Initial repository setup

- Confirmed the new public repository and its main default branch.
- Added README, baseline .gitignore, context tracker and initial architecture notes.
- Added placeholder directories for the planned application layers.
- No application code or dependencies were scaffolded.
- Validation: repository metadata and branch state checked; no build/tests existed yet.

## 2026-11-12 — Android source audit and desktop port specification

- Audited the Android reference branch feat/resource-manager-task-manager-17-10-2026.
- Inspected core chat layout and lifecycle, drawer navigation, theme system, appearance controls, Sync Core animation/state logic, preferences, chat persistence/backup, model registry, GGUF backend, JNI/native llama.cpp code, ToolEngine, ResourceManager and Workspace persistence.
- Added docs/ANDROID_TO_DESKTOP_SPEC.md with verified behaviors, source map, desktop component plan, Android backup compatibility, model/inference plan, deferred features, security approval architecture, Windows-specific concerns and staged acceptance checks.
- Updated docs/ARCHITECTURE.md, README.md and CONTEXT_TRACKER.md.
- User approved React + TypeScript. Vite selected for the frontend scaffold.
- No application code, dependencies, native build or tests were added/run.

## 2026-11-12 — Phase 1 Tauri + React foundation

- Added a React + TypeScript + Vite frontend scaffold based on the maintained Tauri React TypeScript starter structure.
- Added Tauri 2 Rust entry points and one read-only get_app_info command.
- Added a responsive foundation UI and typed frontend call to the Rust command.
- Configured Vite's Tauri environment handling and platform-specific build target using the official Tauri Vite guidance.
- Added a restrictive CSP and a main-window capability limited to core:default. No shell, filesystem, process or opener plugin was added.
- Kept navigation placeholders visibly marked planned and did not claim chat, model, storage or tool functionality.
- Disabled packaging until app icon and installer configuration are ready.
- Source files were committed and fetched back from GitHub for verification.
- Validation attempt: Node.js v22.16.0 and npm 10.9.2 are available in the execution container. Rust/Cargo are absent, and network DNS to GitHub/npm is unavailable, so dependencies could not be installed and no build or Tauri launch could be run. Vite 8 requires Node 20.19+ or 22.12+, so the available Node version meets that requirement.


## 2026-11-12 — Phase 2 startup lifecycle foundation

- Added `tauri-plugin-single-instance` as the first registered Tauri plugin. Subsequent launches restore, unminimize and focus the existing main window.
- Added a Rust atomic startup gate consumed by the first webview bootstrap call, preventing splash replay on tray restore or same-process page reload.
- Added a Sync-branded loading screen that waits for the native metadata handshake and a short minimum display interval; it does not wait for model initialization.
- Added a Rust-created native tray icon with Open, Hide and Exit actions. Left-click restores where supported; closing the main window hides it to tray.
- Updated architecture, project tracker and README with source-versus-runtime status.
- Validation: GitHub source and branch were inspected; no npm install, frontend build, Cargo check, Tauri launch or Windows interaction test was run. The code is committed but runtime-unverified.


## 2026-11-12 — Phase 2 desktop shell and navigation

- Replaced the static foundation/status page with a persistent navigation sidebar and page-aware top bar.
- Added functional navigation destinations for Chat, History, Workspace, Tasks & Notes, File Library, Local models, Appearance and Runtime.
- Built a dedicated chat landing screen with Sync Core-inspired visual treatment, model status and a disabled composer. No model response is fabricated.
- Added feature staging pages that describe intended responsibilities without claiming their underlying services are implemented.
- Added a runtime page that displays only metadata available from the existing Rust bridge.
- Added responsive layouts, keyboard focus treatment and reduced-motion styling.
- Updated README, architecture and the context tracker.
- Validation: source files and branch state were reviewed before commit. No TypeScript build, Rust build, Tauri launch or Windows runtime test was run.


## 2026-11-12 — Phase 3 initial storage and History implementation

- Added SQLite with bundled SQLite, a version-1 schema migration, chats/messages/app_settings tables, foreign keys and indexes.
- Added Rust storage models and typed Tauri commands for chat listing/search, create/load/rename/delete, message append, per-assistant-message diagnostics, settings and backup import/export.
- Added desktop-native sync-ai-desktop-backup format version 1. Import validates bounds, IDs, roles, timestamps and diagnostics, skips existing chat IDs and runs in a transaction. Export includes per-message diagnostics.
- Added Rust unit tests for migration, diagnostics persistence, backup round-trip, duplicate-chat skipping, invalid diagnostics roles and duplicate IDs in a backup.
- Added a History UI with search, create, open, rename, delete, diagnostics disclosure, backup import and backup export.
- Marked History as an active navigation destination. Android backup compatibility remains explicitly out of scope.
- Validation: source committed and key files fetched back from GitHub. The SQLite DDL, core list query, diagnostics constraint and cascade behavior were smoke-tested separately with Python sqlite3. The execution environment has Node.js 22.16.0/npm 10.9.2 but no Rust/Cargo; dependencies cannot be installed here. No TypeScript build, Cargo test/check or Windows runtime test is claimed.


## 2026-11-12 — Phase 2.2 sidebar redesign

- Replaced the History navigation row with a recent-conversations area, including search and date grouping (Today, Yesterday, Previous 7 days, Previous 30 days and Older).
- Recent rows use the SQLite-backed listChats command and route selection into History with the selected conversation ID.
- Added a Settings entry to the sidebar footer and a Settings destination using the existing staged feature-preview treatment.
- Kept workspace and system destinations in the main navigation and preserved the local-first footer.
- No separate frontend-only history cache or duplicate persistence layer was added.
- Validation: source reviewed and committed. No npm build, Cargo check, Tauri launch or Windows UI test was run.


## 2026-11-12 — Phase 4 Stage 1: model management and resource budget

- Added schema migration v2 and a GGUF model registry with SHA-256 uniqueness and a single default model.
- Added Rust commands for native file selection/import, managed model copy, streaming SHA-256, duplicate detection, listing, default selection and managed model removal.
- Added host installed/available RAM detection.
- Added the Local Models management page and optional RAM Limiter controls in Settings. The limiter is disabled by default and its selected budget persists through SQLite.
- Kept Stage 1 honest about its boundary: the RAM budget is not yet enforced during model loading. Memory estimation and pre-load enforcement belong to Stage 2.
- No arbitrary filesystem path is accepted from the webview for model import; Rust opens the native picker itself.
- Validation: source committed only. No npm build, Cargo check/test or Windows runtime test run.


## 2026-11-12 — Phase 4 Stage 2: GGUF metadata and native model lifecycle

- Added a bounded GGUF v2/v3 metadata parser for architecture, model name, general file type/quantization and dimensions used in memory estimates.
- Changed model import to validate the GGUF header and persist metadata in the existing SQLite v2 model columns; existing imports are metadata-refreshed when the library is opened.
- Added pinned llama_cpp = 0.3.2 Rust bindings, which build bundled llama.cpp and statically link by default.
- Added a CPU-only runtime manager and typed commands for runtime status, model load, model unload and resource estimation. The model is loaded only by explicit user action and is never auto-loaded on startup.
- Added 2,048-token context/128-token batch session setup, conservative metadata-based memory estimation, currently available RAM reserve checks, and a second pre-session check using llama.cpp's native session-size estimate.
- Blocked model deletion while that model is loading or active and canonicalized model paths inside the managed model directory.
- Updated Local Models and Settings with metadata, memory inspection, Load/Unload and RAM enforcement behavior.
- Validation: source changes committed for review only. No npm build, Cargo check/test, C++ compile/link, actual GGUF load or Windows runtime test was run. The C++/libclang toolchain is required on the Windows development machine.
- Stage 3 chat generation/streaming is not started.

## 2026-11-12 — Phase 4 corrections: external model paths and isolated worker

- Added SQLite migration v3 for nullable source-path metadata while preserving the legacy managed-path column for old library rows.
- Reworked GGUF import to register a canonical original path, calculate SHA-256 without copying the source file, and relink duplicate hashes when the same model is selected from another location.
- Reworked the model library to detect missing files, display the stored path and remove only the Sync registry record. The original file is never deleted.
- Moved llama.cpp model/session ownership into a dedicated child process launched in worker mode.
- Added Windows Job Object creation, optional per-process committed-memory limit, and kill-on-job-close lifecycle. The main Tauri/WebView application is not placed in the worker Job Object.
- Disabled model mmap in the worker so GGUF weights are allocated as worker-private memory subject to the configured commit ceiling.
- Added worker telemetry to Runtime: configured cap, PID, working set, private committed memory, and last worker error.
- Replaced the earlier generation-only RAM budget copy and stale model-load estimate gate with the hard worker-ceiling behavior. The pre-load model estimate is now informational only.
- Updated settings to save the ceiling explicitly and clarified that a smaller limit may prevent a model from loading.
- Validation: source changes authored and reviewed through GitHub API only. No npm build, Cargo check/test, Windows Job Object test, native compilation or actual GGUF load was run. Personal Windows device validation remains required.
- Phase 4 remains exactly three stages. At this checkpoint Stage 3 chat generation/streaming was still pending; it was connected in the following Phase 4 source implementation entry below.

## 2026-11-11 — Phase 4 source implementation

- Changed new GGUF imports to original-path registration with SHA-256 deduplication/relinking and SQLite v3 compatibility for legacy records.
- Added missing-file detection, Rust validation before load/default, non-destructive removal and unload-before-replacement.
- Moved llama.cpp into a dedicated worker. Windows Job Objects enforce the optional worker private-commit ceiling outside the main UI process. Runtime telemetry displays limit, PID, working set, private commit and errors.
- Connected Stage 3 chat persistence, role-labelled context, token streaming, cancellation, sequential queueing and per-assistant-message diagnostics. Added positional insertion so each answer stays after its triggering user turn.
- Model-specific templates remain deferred. No auto-load, sign-in startup, multimodal feature set or DAM category added.
- No frontend/Cargo/Windows/native build or real-model test has run.


## 2026-11-12 — Phase 5 Workspace and productivity source implementation

- Added SQLite schema migration v4 for Workspace artifacts, tasks, notes and File Library registry records.
- Added typed Rust storage models and native commands for Workspace artifact CRUD/search, context selection, Tasks & Notes CRUD, and File Library import/list/relink/remove.
- Workspace artifacts and notes are included in future local chat prompts only when the user explicitly enables their context checkbox. The combined context query is limited to 20 entries and 48 KiB.
- Added a “Save to Workspace” action to assistant replies. Newly saved replies default to excluded from chat context.
- Added Workspace editor/search, Tasks & Notes tabs and controls, and File Library UI.
- File Library imports use a native picker and register canonical original paths plus file size and SHA-256. The application does not copy, move or delete the original. File contents are not loaded into chat.
- Activated Workspace, Tasks & Notes and File Library navigation routes. Added responsive styles.
- Updated the README and Context Tracker, and added Phase 5 data/security documentation.
- Validation boundary: source consistency was reviewed through the GitHub API. No npm build, TypeScript typecheck, Cargo fmt/check/test, native compilation, Tauri launch or Windows runtime test was run. The Phase 5 source must be validated on the personal Windows development machine.


### Phase 5 follow-up — validation and safety refinements

- Added summary-only Workspace and Notes list queries; full content is fetched only when a user opens an artifact or note. Added a native `get_note` command.
- Added full task editing for title, details, status, priority and due date. Task details are capped at 32 KiB and task list results at 200.
- Added Rust validation that saved assistant-message provenance uses a source message belonging to the supplied source conversation.
- File Library hashing now uses one open file handle, verifies size and modification time after hashing, and rejects a file that changes while its fingerprint is being calculated. Non-UTF-8 paths are rejected rather than stored lossily.
- File Library relinking now requires an exact match with the original SHA-256 fingerprint. A changed file must be registered as a new library entry.
- Added Rust unit-test source for lightweight summary/detail behavior, mismatched chat/message provenance and mismatched File Library relinking.
- Re-ran a separate Python SQLite smoke test against the Phase 5 migration shape. It passed checks for tables/indexes, opt-in context query, 48 KiB clipping, summary-only query, FK nulling, task status/priority constraints and unique library path/hash constraints.
- This SQL smoke test does not compile or test Rust. Frontend build, Cargo fmt/check/test, native picker, Tauri launch, worker and Windows runtime remain unverified.


## 2026-11-14 — Electron renderer migration and current architecture

- The maintained desktop repository transitioned from the initial Tauri/React/Vite prototype to the current Electron edition.
- The current entry point is root `index.html`, opened with Electron `BrowserWindow.loadFile()`.
- The renderer is plain HTML/CSS and classic JavaScript scripts loaded with `defer`; page modules register mount functions under `window.SyncAI.pages`.
- Native operations remain in Electron main/preload behind a restricted IPC bridge. Persistence uses Electron's built-in `node:sqlite`; CPU llama.cpp inference runs in an isolated Electron UtilityProcess.
- The old Tauri project and Android companion remain separate repositories. This Electron repo must not change their source.
- The current architecture and security boundaries are documented in `README.md`, `docs/ARCHITECTURE.md`, `docs/ELECTRON_PORT_AUDIT.md` and `CONTEXT_TRACKER.md`.

## 2026-11-26 — Memory, composer tools, runtime recovery and chat management

- Added the persistent Memory management page with import, create, edit, enable/disable and delete controls; routed it from Settings.
- Added saved-memory prompt injection, structured chat-title generation and optional automatic learning from completed conversations.
- Added bounded memory handling: configured context budget is limited to 128–512 estimated tokens; conversation text and learned profile size are capped; auto-learning remains opt-in.
- Added the composer `@` file-tool palette for copy, move, rename, safe delete and folder creation. Tool operations are prepared separately and require explicit user approval. Folder naming uses a themed in-app prompt.
- Added/updated Privacy & Tools approval modal keyboard/focus behavior, action history, cancellation/undo paths and Stop & Restore / rollback controls.
- Added inference-generation recovery and exposed force-stop/restart controls and runtime diagnostics.
- Added supplied Sync artwork for the Windows taskbar/tray icon.
- Added chat message editing data-layer support through the existing edit API, plus chat archive/folder/sidebar management: rename, move-to-top, archive, delete, pinning and folder assignment.
- Latest inspected main commit: `63fa05e801bc1a108589924a18f87389e1dde11d` (`feat: add chat editing archive folders and sidebar menus`).
- Source review finding: message editing already updates the original user message and queues regeneration from that turn, but the current interface uses `window.prompt()`. Inline composer editing with Cancel/Alt+C is still pending.
- Source review finding: typed `@` autocomplete is already implemented independently of the visible composer `@` button.
- Source review finding: splash markup and styling already exist, but the renderer reveals it after bootstrap and currently calculates its minimum using 850 ms. The requested 4–7 second visible minimum and readiness-aware lifecycle remain to be implemented.
- Source review finding: only Ctrl+N is currently registered globally in `app.js`; a centralized shortcut system, universal Escape stack, global search and command palette are not implemented.
- Validation: this entry is based on the inspected GitHub commit history and current source. No Electron launch, npm build, npm test, real GGUF conversation or target-machine test was performed as part of this review.

## Planned follow-up — visual pass and interaction system

- Visual pass (Claude): polish all existing pages and shared motion while preserving architecture, functionality, accessibility, API contracts and file-operation safety. Keep the splash artwork; fix its lifecycle to remain visible for approximately 4–7 seconds minimum and until the app is ready. Export edited files and an updated tracker.
- After the visual pass: implement a centralized customizable shortcut manager, shortcut reference in Settings, global search (`Ctrl+K`), command palette (`Ctrl+Shift+P`), nested-interface Escape priority, visible @ button removal while preserving typed @, and inline composer message editing with Cancel and `Alt+C`.
- These are requested future tasks, not claims of completed implementation. Other keyboard bindings must be validated for conflicts before they are finalized.


## November 26, 2026 — Appearance preferences

- Replaced the Appearance placeholder with a live preferences page.
- Added local persistence using the existing settings bridge; no IPC or database schema changes.
- Implemented System/Dark/Light, accent presets and custom color, Comfortable/Compact density, Soft/Outlined chat style, adjustable message font size, and motion preferences.
- Saved preferences are applied during app bootstrap; page edits preview immediately and persist only after Save.
- Added `src/appearance.css` after the motion stylesheet. Source-level checks confirmed the stylesheet is linked last, CSS braces balance, the page route is registered, and the obsolete coming-soon copy is removed.
- Not yet verified in a running Electron window; run `npm run build` and `npm test`, then inspect both light and dark themes on the target machine.


## 2026-11-26 — Intelligence and memory architecture baseline

- Inspected the current main-branch SQLite schema, Memory page, Notes page, prompt builder, inference worker boundary, main-process command handlers, renderer API and existing persistence tests.
- Confirmed the actual database schema ceiling is migration v7; older Architecture/Context documentation that said v4 was stale.
- Confirmed Memory already supports local CRUD/import, a bounded 128–512 estimated-token prompt budget (default 256), and opt-in auto-learning. Current retrieval is enabled-memory, newest-first selection, not relevance ranking.
- Confirmed Notes already have a separate table and CRUD UI, but opted-in Notes and Workspace artifacts are combined by `list_workspace_context()` and delivered together in the Workspace reference block.
- Confirmed chat prompting uses the latest 24 user/assistant turns and has no persistent conversation-summary/compaction store.
- Agreed architecture: Memory = durable user facts; Notes = user-authored saved information; Conversation Context = recent transcript plus separately persisted summaries. These remain separate stores and separate prompt sections, coordinated by a lightweight retrieval layer.
- Added `docs/INTELLIGENCE_MEMORY_ARCHITECTURE.md` with the inventory, design decisions, proposed migration/API evolution, retrieval strategy, implementation sequence and acceptance tests.
- Updated architecture and handoff documentation to reflect the verified schema and current Appearance implementation.
- No database schema or runtime feature code was changed in this baseline milestone.
- Validation: GitHub source files were fetched and reviewed. No Electron launch, `npm test`, `npm run build`, real GGUF conversation or target-machine test was performed.


## 2026-11-26 — Phase 1 implementation: Memory metadata, provenance and summary storage

- Added SQLite migration v8 with Memory category, importance, pinning, `memory_sources` and `conversation_summaries`.
- Added validation and database methods for Memory metadata, source-link deduplication, source provenance snapshots and per-conversation summaries.
- Added stale-summary invalidation when editing covered user turns or inserting a response into summarized history.
- Added main-process handlers and renderer API wrappers.
- Auto-learned profile memories now attach recent source user messages from the originating conversation.
- Memory page now supports category, importance, pinning and source provenance display.
- Bounded memory injection prioritizes pinned entries, then importance, then recency. Relevance retrieval is still pending.
- Source-level JavaScript parsing passed for the changed database, main-process, renderer API, chat and Memory page files.
- GitHub Actions on `d8ab68d20c75414fc624fb3a64b5fa8de9847f99`: the database test set passed on Windows and Ubuntu, including all new Memory/provenance/summary tests. Overall workflows failed on five other assertions: one file-operation protection check, three Windows file-operation tests rejecting the runner temp path as traversing a symbolic link, and one stale inference source-contract assertion.
- No target-machine Electron UI test or real-GGUF inference test was run.


## 2026-11-26 — Phase 1 independent context retrieval

- Added bounded Unicode tokenization and lightweight deterministic lexical ranking for enabled Memory, opted-in Notes and opted-in Workspace artifacts.
- Split the previous combined Notes/Workspace database method into independent list_note_context() and list_workspace_context() methods, each with its own context budget.
- Added query-aware main-process handlers and renderer API wrappers for all three independent retrieval sources.
- Chat generation now uses the latest queued user message as the retrieval query.
- Prompt construction separates durable Memory, user-authored Notes, Workspace artifacts, older conversation summary and recent transcript into explicitly labelled context sections.
- If a persisted summary is available, prompt construction skips transcript entries already covered by its cursor while always retaining the latest queued user message.
- No summary generator, automatic compaction, embedding model, vector database or extra inference worker was added.
- Added database tests for lexical relevance ranking, source separation, opt-in enforcement and empty-query fallback. Added an IPC/prompt contract test for the distinct context sources.
- Source parsing passed for database, database tests, main process, renderer API and chat page.
- CI for the newest commit 2209601e2487b8c37b59a23feba29788944be434 was in progress at log time. Previous CI showed new DB tests passing but existing unrelated source-contract and Windows file-operation tests still failing.
- No target-device Electron UI or real GGUF test was performed.


## 2026-11-26 — Phase 1 substep checkpoint

- Marked Step 1 (data model/storage API) COMPLETE after migration v8, API wiring, metadata/provenance tests, summary invalidation tests and a populated v7 database upgrade fixture were included in CI.
- Marked Step 3 (independent Notes retrieval) COMPLETE after adding a dedicated Notes query, separate bounded retrieval, preserving the existing opt-in flag, and separating Notes from Workspace in prompt assembly.
- Step 2 Memory Center remains IN PROGRESS: category, importance, pinning and provenance UI are implemented; search/filter, usage accounting and auto-learn candidate review remain.
- Step 4 context orchestration remains IN PROGRESS: lexical ranking and separate source sections exist; overall context ceiling/tuning remain.
- Step 5 summaries remain IN PROGRESS: persistence, invalidation and prompt consumption exist; automatic summary generation/refresh and summary UI remain.
- Step 6 Model Profiles remains NOT STARTED.
- Source-validation on code commit 2209601e2487b8c37b59a23feba29788944be434: Ubuntu 48 passed, 1 failed, 1 skipped; Windows 45 passed, 5 failed. New Memory, migration, retrieval and prompt-contract tests passed. Remaining failures are the existing inference source-contract assertion plus four Windows file-operation/path safety assertions in hosted temporary folders. This is not a green full-suite result.
