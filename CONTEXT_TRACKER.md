# Sync AI Desktop E — Project Context

> Updated: 2026-11-26. This is the current handoff record for the Electron repository. Verify source before relying on older summaries. The separate Tauri and Android repositories remain independent projects.

## Current repository checkpoint

- Repository: `SamYoBoi284/Sync-AI-Desktop-E`
- Branch: `main`
- Latest Phase 1 implementation checkpoint: `d8ab68d20c75414fc624fb3a64b5fa8de9847f99` — database tests for Memory priority and summary invalidation (2026-11-26). Later documentation commits record this checkpoint.
- Application version in `package.json`: `0.1.0`.
- This checkpoint describes source present on GitHub. A source review does not equal an interactive Electron test or a real-model inference test.

## Current architecture

- **Desktop shell:** Electron.
- **Renderer entry:** root `index.html`, loaded directly with Electron `BrowserWindow.loadFile()`.
- **Renderer:** plain HTML, CSS and classic JavaScript scripts. Page scripts are scoped IIFEs and register mount functions on `window.SyncAI.pages`. They are loaded with deferred script tags in dependency order; this is not a Vite/React/TypeScript renderer and does not use ES-module imports in the page files.
- **Styles:** local CSS files under `src/`.
- **Main process:** `electron/main.cjs`; owns native lifecycle and privileged operations.
- **Preload:** `electron/preload.cjs`; exposes a restricted `window.syncAI` bridge.
- **Renderer API:** `renderer/api.js`; wraps bridge commands. Do not expose Node APIs to the renderer.
- **Persistence:** SQLite via Electron's built-in `node:sqlite`, implemented in `electron/database.cjs`; schema migrations through version 8 (migration v8 adds Memory metadata/provenance and conversation-summary storage).
- **Inference:** CPU llama.cpp via `node-llama-cpp` in an Electron UtilityProcess (`electron/inference-worker.mjs`).
- **Windows memory isolation:** optional Job Object private-commit ceiling applies to the inference worker, not the main/UI process.
- **Packaging:** Electron Builder / NSIS.
- **Runtime baseline in README:** Node.js 22.12+ and Windows 10/11 x64.

React, React DOM, TypeScript, Vite, the old TSX renderer and a frontend development server are not part of this repository's current architecture. Do not reintroduce them for routine UI work. Keep privileged operations behind the main/preload boundary.

## Repository boundaries

- Electron project: https://github.com/SamYoBoi284/Sync-AI-Desktop-E
- Original Tauri project: https://github.com/SamYoBoi284/Sync-AI-Desktop
- Android companion/reference: https://github.com/SamYoBoi284/Sync-AI

Do not mix these repositories or apply Electron changes to the Tauri or Android projects.

## Current source map

~~~text
index.html
src/
  styles.css
  shell.css
  history.css
  workspace.css
  tasks-notes.css
  library.css
  motion.css
  appearance.css
renderer/
  api.js
  shared.js
  app.js
  pages/
    chat.js
    history.js
    folders.js
    models.js
    workspace.js
    tasks.js
    library.js
    runtime.js
    settings.js
    memory.js
    privacy-tools.js
    preview.js
electron/
  main.cjs
  preload.cjs
  database.cjs
  gguf.cjs
  inference-worker.mjs
  inference-memory-job.ps1
  ...tests and smoke-test helpers
docs/
  ARCHITECTURE.md
  DEVELOPMENT_LOG.md
  ELECTRON_PORT_AUDIT.md
  ANDROID_TO_DESKTOP_SPEC.md
  phase and data-contract notes
CONTEXT_TRACKER.md
IMPLEMENTATION_NOTES.md
README.md
package.json
~~~

The active renderer page modules `folders.js`, `memory.js` and `privacy-tools.js` must be included when preparing a complete renderer handoff. The intelligence/memory design document is `docs/INTELLIGENCE_MEMORY_ARCHITECTURE.md`. Older source maps that omit them are incomplete.

## Renderer loading and navigation

`index.html` loads stylesheets in this order: `styles.css`, `shell.css`, `history.css`, `workspace.css`, `tasks-notes.css`, `library.css`, `motion.css`, `appearance.css`.

It loads the renderer scripts in this order: `api.js`, `shared.js`, page modules, then `app.js` last. Preserve this ordering unless the dependency graph is deliberately changed and verified.

- `renderer/shared.js` defines page titles, navigation sections, preview copy and shared helpers.
- `renderer/app.js` creates the persistent shell, owns global navigation/recent chats/action status, mounts and cleans up the active page, and performs bootstrap.
- Each page module owns its page-specific local state, markup and delegated events.
- `renderer/api.js` is the renderer-facing API wrapper. Its method/argument contracts must remain stable during visual-only work.

Routes currently include New Chat, History, Archive, Folders, Local Models, Workspace, Tasks & Notes, File Library, Runtime, Settings, Memory, Privacy & Tools and Appearance. Appearance is implemented with persisted System/Dark/Light, linked or separate accent/interface colors, density, chat style, font size and motion preferences.

## Implemented capabilities in the current source

### Chat and conversation management

- Local SQLite chat/message persistence, recent-chat list and date grouping.
- Chat title generation with topic categories and a casual-catch-up special case.
- Chat loading/switching, sequential generation queue, streamed token updates, cancellation and per-message generation diagnostics.
- Runtime polling/event tracking so the chat view can recover current generation state when refreshed or revisited.
- Edit-and-regenerate data flow exists: the renderer calls `api.editUserMessage(chatId, messageId, body)`, applies the returned chat, then queues regeneration from the edited user turn. The current UI still uses `window.prompt()`; the requested inline composer editing experience is not implemented yet.
- History and Archive share the same page module with an archive filter.
- Create, rename, pin/unpin, archive, restore, delete, move-to-top, move-to-folder and export actions.
- Sidebar recent conversations, conversation search, folder shortcuts and contextual chat menus.
- Versioned chat backup export/import with validation and duplicate-chat skipping.

### Models and local inference

- GGUF import/registration, bounded metadata parsing, SHA-256 identity/deduplication, original-path registration and missing-file detection/relinking.
- Default model selection, model load/unload and informational resource estimates.
- CPU llama.cpp inference in an isolated Electron UtilityProcess.
- Token streaming, generation cancellation, queue state and stored diagnostics.
- Runtime telemetry for worker PID, working set, private committed memory, memory ceiling, active/queued generations and worker errors.
- Optional Windows Job Object private-memory limit for the worker. The Electron main/UI process stays outside that limit.
- Runtime controls for context length and batch size; settings take effect on model reload.
- Force-stop/restart recovery control is exposed through Runtime. A recent source change addresses inference generation recovery, but a passing target-machine stress test is not asserted by this tracker.

### Memory

- Persistent, user-editable memory records stored locally in the `memories` table (migration v6).
- Memory import, create, edit, enable/disable and delete.
- The current memory library is capped at 50 records and 4 MiB total content; individual entries are capped at 1 MiB.
- Enabled memories are selected newest-first and injected within a configurable 128–512 estimated-token budget (default 256; approximate character-based limit).
- Optional auto-learning from completed conversations; disabled by default. It runs an additional inference, examines up to eight recent user turns (capped at 3,000 characters), and updates one `Learned profile` record capped at 1,500 characters.
- Auto-learning prompt constraints exclude sensitive personal categories and credentials, but provenance and category/importance metadata are not stored yet.
- Memory is managed in `renderer/pages/memory.js` and routed from Settings.

### Intelligence and memory audit (2026-11-26)

A full source-level baseline review has been completed and the implementation design is recorded in `docs/INTELLIGENCE_MEMORY_ARCHITECTURE.md`.

- Memory, Notes and conversations already have distinct storage foundations: `memories`, `notes`, and `chats`/`messages`.
- Notes are user-authored and have pinning plus an opt-in context flag. Workspace artifacts also have an opt-in context flag.
- Current `list_workspace_context()` combines opted-in Notes and Workspace artifacts into one bounded result (48 KiB), then `buildPrompt()` places them in the same Workspace reference section with kind labels.
- Current `list_memory_context()` injects every enabled memory newest-first; it does not rank by relevance, category, importance or pinning.
- Current prompt builder includes the last 24 user/assistant turns. No persistent conversation-summary/compaction table exists yet.
- The next Phase 1 work is a non-destructive schema/API design for memory metadata/provenance and conversation summaries, followed by independent Notes retrieval and relevance-based context orchestration.
- No database or runtime code was changed during the baseline audit. No Electron launch, `npm test`, `npm run build`, or real-GGUF test was performed.

### Composer tools and file-operation safety

- The chat composer has no visible `@` button; typed `@` autocomplete/filtering remains available.
- Current tool palette includes copy, move, rename, safe delete and create-folder operations.
- Tool requests are prepared first and require explicit approval before execution.
- Folder creation uses a themed in-app naming modal before native path selection.
- Privacy & Tools provides action history, state labels, approval/cancel/undo dialogs, focus management and focus restoration.
- Active file operations expose a global Stop & Restore / Stop & Rollback control.
- File operations are scoped to selected paths and have separate main-process safety mechanisms. Never replace approval/safety behavior with decorative UI.

### Productivity and local files

- Workspace artifact CRUD/search, editor and explicit opt-in chat context.
- Tasks CRUD/editing with status, priority and due date.
- Notes CRUD, pinning and opt-in chat context.
- File Library registration through native picker, canonical path, size and SHA-256, relinking and non-destructive registry removal.
- File Library currently stores metadata/path/hash only; it does not read file contents into chat.
- Workspace/Notes context is explicitly selected and bounded by the backend query limits documented in the phase notes.

## Visual foundation and current UI review findings

The visual language is dark navy/near-black with violet as primary accent, cyan as secondary accent, subtle gradients and monospaced technical labels.

Stylesheet responsibilities:
- `src/styles.css`: global tokens/base rules, original/general layout rules, splash visuals, responsive rules and chat streaming-dot animations.
- `src/shell.css`: main shell and accumulated shell/page components, including navigation, chat, runtime, settings, model cards, memory, privacy modals, tool palette and folder menus.
- `src/history.css`: History/Archive layout and message diagnostics.
- `src/workspace.css`: Workspace/shared workspace controls and some shared message-tool styles.
- `src/tasks-notes.css`: Tasks and Notes tabs, forms, task cards and note editor.
- `src/library.css`: File Library cards, status, safety notice and empty state.

The CSS has accumulated across multiple implementation phases. Some related selectors also exist in more than one stylesheet. Inspect actual markup/class usage and stylesheet order before consolidating or deleting rules. Do not remove unfamiliar styles solely because they look redundant.

Existing motion support includes the Sync core/splash animations, shell/modal transitions, animated three-dot generation indicators and selected reduced-motion overrides. The visual pass should create a coherent, restrained, reusable motion system without continuously animating large surfaces or degrading lower-end hardware.

### Splash screen finding — important

The splash markup is generated in `renderer/app.js`; its visual rules and animations are in `src/styles.css`. It is guarded by the native `consumeStartupSplash()` first-startup handshake.

Current renderer behavior:
- Bootstrap initializes the bridge, refreshes recent chats and renders the page.
- Only after that work, if the native startup flag is true, it reveals the splash.
- The current timer uses `Math.max(850 - (Date.now() - started), 0)`.

This does **not** meet the requested 4–7 second visible minimum. Merely replacing 850 with a larger number may not solve the lifecycle problem because the splash is currently revealed after renderer initialization. A correct adjustment must show it at the right time, keep it visible until the application is ready and the minimum display duration has elapsed, then transition smoothly without flashing an empty window. Preserve the existing artwork and branding.

### Other visual observations

- The generation indicator already has three animated dots in the streaming markup/CSS; preserve and improve it rather than accidentally replacing it with static text.
- Reduced-motion handling already exists in several stylesheet sections; extend it consistently to new motion.
- `src/styles.css` and `src/shell.css` contain accumulated/overlapping styling layers. Avoid wholesale replacement.
- The privacy approval modal includes meaningful keyboard/focus behavior. Preserve its accessibility and approval semantics.
- Runtime page refreshes telemetry every 1.5 seconds. Avoid visual rerender/focus regressions during updates.

## Current visual-overhaul handoff

The next visual pass is intended for Claude and is a presentation/UX polish pass, not a rebuild. The supplied set should include:

**Visual foundation**
- `index.html`
- `src/styles.css`
- `src/shell.css`
- `src/history.css`
- `src/workspace.css`
- `src/tasks-notes.css`
- `src/library.css`

**Renderer interface**
- `renderer/app.js`
- `renderer/shared.js`
- `renderer/pages/chat.js`
- `renderer/pages/history.js`
- `renderer/pages/folders.js`
- `renderer/pages/models.js`
- `renderer/pages/workspace.js`
- `renderer/pages/tasks.js`
- `renderer/pages/library.js`
- `renderer/pages/runtime.js`
- `renderer/pages/settings.js`
- `renderer/pages/memory.js`
- `renderer/pages/privacy-tools.js`
- `renderer/pages/preview.js`

**Project context**
- `CONTEXT_TRACKER.md`
- `README.md`
- `package.json` (reference only)
- `renderer/api.js` (reference only)

The additional `folders.js`, `memory.js` and `privacy-tools.js` entries are deliberately called out because they exist and are active, even if an older file checklist omitted them.

Visual-pass guardrails:
- Preserve Electron + classic HTML/CSS/JavaScript architecture and all functional selectors/data attributes.
- Do not edit `electron/main.cjs`, `electron/preload.cjs`, `electron/inference-worker.mjs`, database implementation, inference implementation or file-operation safety mechanisms.
- Do not alter `renderer/api.js` contracts.
- Keep splash artwork and brand identity; target a 4–7 second minimum visible interval while also waiting for real readiness.
- Keep all existing page modules registered and all existing features functional.
- Export modified/new files with original relative paths, plus an updated context tracker; report exactly which tests were executed and not executed.

## Planned work — not implemented yet

Keep these items separate from the visual-only Claude task.

### Keyboard shortcuts and interaction manager

- Build one centralized shortcut registry/manager rather than adding unrelated listeners to individual pages.
- Add a keyboard-shortcuts reference opened by `Ctrl + ?` and also reachable from Settings.
- Support enable/disable, customizable bindings, persistence across restarts, restore defaults, action search and conflict detection before saving.
- Context-aware dispatch and input protection are required. Shortcuts must not hijack normal text entry.
- Do not introduce application/window shortcuts such as Ctrl+W, Ctrl+Q or F11.
- Current confirmed key intentions: `Ctrl + K` opens global search; `Ctrl + Shift + P` opens the command palette; `Esc` means Back/Cancel with priority handling for nested UI; `Alt + C` cancels message editing. Other mappings remain to be finalized and conflict-checked.

### Global search and command palette

- `Ctrl + K` should open application-wide local/offline-first search, not only conversation search.
- Intended search areas: chat titles and message contents, settings names/descriptions, installed model metadata, folders, Library records/notes, Tasks, Workspace and available actions.
- Separate navigating to a search result from executing an action.
- `Ctrl + Shift + P` command palette executes commands such as New Chat, Switch Model, Open Runtime, Export Conversation, Archive Conversation and Toggle Theme.
- Search and palette may share indexing/matching infrastructure but must retain distinct result types and behavior.

### Composer and message editing

- Remove only the visible `@` button from the composer; preserve typed `@` autocomplete and tool selection.
- Replace the current `window.prompt()` message-edit UI with an inline composer editing state.
- Load the selected original user message into the composer.
- Show Cancel beside Send; Cancel exits without modifying the original.
- `Alt + C` cancels editing.
- Send must call the existing edit operation/update original message, not append a duplicate; preserve the current truncate-later-turns and regenerate-from-edited-turn behavior.
- Preserve disabled/busy behavior while generation or queued messages are active.

## Run and test

From repository root:
~~~cmd
npm install
npm run dev
~~~

Validation commands:
~~~cmd
npm test
npm run test:inference-runtime
npm run test:startup
npm run build
npm run dist
~~~

The package scripts define these checks. This tracker does not claim that they were run during the 2026-11-26 source review.

## Validation boundaries

- Automated project tests/CI described in `README.md` and `docs/ELECTRON_PORT_AUDIT.md` cover source syntax, persistence/backup, GGUF parsing, IPC/security contracts, memory enforcement, native runtime initialization, app startup handshake and packaging.
- Those checks do not prove that a real user GGUF model was loaded and used for a full conversation on the target laptop.
- Interactive tray/window behavior and hands-on page review still need target-machine testing.
- During the latest GitHub source review, files were fetched and read; no local Electron launch, npm build, npm test, native model test or target-machine test was performed.

## Working conventions

- Inspect the current branch/source before modifying files; do not rely on stale summaries.
- Keep renderer markup changes minimal and preserve IDs, data attributes, delegated event hooks, accessibility attributes and functional selectors.
- Keep native privileges in main/preload. Never grant the model unrestricted filesystem, shell or process access.
- Preserve user data, model weights, local databases and secrets outside Git.
- Keep Electron, Tauri and Android repositories separate.
- Distinguish source implementation, CI evidence and target-machine validation.
- Update this tracker, `IMPLEMENTATION_NOTES.md` and the relevant development log when architecture or feature status materially changes.

---

## Visual polish & animation pass (November 26, 2026)

### What changed
- Added a single additive motion/polish stylesheet, `src/motion.css`, loaded LAST in `index.html`. No existing CSS was deleted or rewritten; it layers transitions, keyframes and refinements over existing selectors.
- Splash lifecycle fixed in `renderer/app.js` (see below). Splash artwork, copy and colours are unchanged; only a staggered entrance and a fade/scale exit were added in CSS.
- `renderer/app.js`: page-enter hook (`markPageEntering`), boot/reveal classes, lifecycle-aware splash.
- `renderer/pages/chat.js`: entrance animation only for newly added messages, and auto-scroll that follows the stream only while the reader is near the bottom (<90 px), so manual scrolling is no longer overridden.
- `index.html`: one `<link>` for `src/motion.css`.

### Files modified / created
- NEW `src/motion.css`
- MODIFIED `index.html`, `renderer/app.js`, `renderer/pages/chat.js`, `CONTEXT_TRACKER.md`
- Not touched: `electron/*`, `renderer/api.js`, database/inference code, all other renderer pages and the other stylesheets.

### Splash lifecycle (new behaviour)
1. `consumeStartupSplash()` is now the first await. If it returns true the splash is shown immediately (before `getAppInfo`/recent chats/page render), the shell is `inert` + `aria-hidden` underneath, and `rendererReady()` is signalled after two animation frames so the window never shows empty.
2. Bootstrap continues behind the splash. When it finishes, the splash waits until `SPLASH_MIN_MS` (5200 ms, measured from when it became visible) has elapsed, then fades out over `SPLASH_EXIT_MS` (520 ms) while the shell fades in. If initialization is slower than the minimum it simply stays until ready.
3. Non-first launches: no splash, `rendererReady()` is signalled after render exactly as before. `.shell-root.is-booting` hides the shell only during the few ms before the flag is known; a 2.5 s guard removes it if the bridge hangs.
4. Reduced motion: exit shortened to 60 ms. Tune the two constants at the top of the splash block in `app.js`.

### Animation classes & conventions
- Tokens: `--sync-ease`, `--sync-ease-in`, `--sync-dur-fast` (140 ms) / `-base` (220 ms) / `-slow` (360 ms), `--sync-focus`, `--sync-focus-ring`.
- Keyframes are prefixed `sync-`: `page-in, rise, fade, pop, menu, menu-up, msg-user, msg-assistant, caret, ring, toast-in` (+ unused `shimmer` reserved).
- JS hooks: `.is-page-entering` on `#pageHost` (~700 ms after navigation; ALL enter/stagger animation is gated on it so Runtime telemetry and re-renders never replay it), `.is-entering` on new chat messages, `.is-booting` / `.is-revealing` on `#appShell`, `.is-leaving` on `#startupSplash`.
- Only transform/opacity animate continuously, and only on tiny elements (streaming caret, three dots, healthy-status ring). No large surface repaints.
- All new motion is disabled/neutralised in the `prefers-reduced-motion` block at the end of `motion.css`.
- Covered: global button/input/focus transitions, slim themed scrollbars, sidebar hover + animated active bar, context/dropdown/tool menus, card hover elevation + stagger on every page (Models, Runtime, Memory, Privacy & Tools, History/Archive, Folders, Workspace, Tasks & Notes, File Library, Settings), user/assistant message entrance and role edge accents, streaming caret, staggered three-dot indicator, send/stop states, status pill/dot transitions, custom animated switches for `.shell-ram-toggle`, `.memory-enable-toggle`, `.memory-card-toggle` (still native checkboxes), range-thumb hover, modal/backdrop entrance, inline feedback ("toast") entrance, tabular numerals for telemetry.

### Dependencies
None added. No frameworks, bundlers or animation libraries.

### Architectural decisions
- Motion lives in one new additive file instead of editing the accumulated styles.css/shell.css layers (safer; avoids regressions in overlapping selectors).
- Entrance animation is applied from JS after render because chat `render()` rebuilds the whole stage on every streamed token; CSS-only animation would replay constantly.
- Native checkbox semantics are kept for toggles (restyled only), preserving IDs, handlers and keyboard behaviour.

### Known limitations
- Modal/menu CLOSE animations are not implemented: the approval and tool modals are removed from the DOM synchronously, and delaying removal could affect focus restoration and the approval safety boundary. Entrance only.
- Streaming text is patched into the existing paragraph per token; a blinking caret is used instead of per-token fade.
- Native `title` tooltips are not stylable. Appearance settings remain a preview route.
- Visual output was not viewed in a running Electron window (see tests).

### Tests performed
- EXECUTED: `node --check` on modified JS (`renderer/app.js`, `renderer/pages/chat.js`) - pass.
- EXECUTED: css-tree parse of all 7 stylesheets - 0 parse errors, braces balanced.
- EXECUTED: jsdom harness of the splash lifecycle with stubbed bridge: fast init -> splash visible about 5.7 s (5.2 s minimum + 0.5 s exit), shell restored (not inert, no aria-hidden); init of 7 s -> splash stayed until ready (about 7.5 s); no first-start flag -> no splash; `rendererReady` called once in each case.
- EXECUTED: confirmed `index.html` script order and all 12 page modules still destructured in `app.js`; `data-*` attributes and IDs untouched (only additive classes).
- NOT PERFORMED: `npm run build` and `npm test` (they require the `electron/` sources and dependencies, which were not supplied), `npm run test:startup`, and any real Electron launch or visual/manual testing.

### Remaining work
- Run `npm run build`, `npm test`, `npm run test:startup` locally and look through each page in Electron; tune splash constants if desired.
- Optional: close animations for menus/modals (needs focus-safe teardown), per-page tweaks after visual review.
- Separate backlog (intentionally NOT started): keyboard customization, global search, command palette, universal Escape, @ button removal, composer-based message editing.


## Chat streaming and message-action stability fix (November 26, 2026)

- Stream token events now update the existing `.shell-chat-streaming-text` node through `textContent`; they no longer call the full chat `render()` for every token.
- Runtime polling compares the runtime/UI state before rendering and skips a full rebuild when the polled state has not materially changed. It still updates the active stream text in place.
- User/assistant message action controls now render as sibling action rails beneath their message articles, aligned to the corresponding message.
- User action is a pen SVG with delayed `Edit` tooltip. Assistant action is a document/upload-arrow SVG with delayed `Save to Workspace` tooltip. Existing delegated actions and save/edit handlers remain in use.
- Removed the visible composer `@` button and its click handler. Typed `@` autocomplete and tool selection remain intact.
- Removed the Stop button entrance animation and made the message action rail stable during streaming to prevent repeated opacity/entrance transitions.
- Scope: `renderer/pages/chat.js`, `src/motion.css`. No API, IPC, database, inference, or file-operation safety contracts changed.
- Validation: source-level checks confirmed the token event no longer invokes full render, the composer mention button/action are absent, sibling message action rails and streaming text target are present, and runtime polling is guarded. Full Electron build/tests and live visual verification still need to be run locally.


## Appearance preferences implementation (November 26, 2026)

- Replaced the Appearance "Coming soon" placeholder with a working settings page in `renderer/pages/preview.js` (exported as `mountAppearance`).
- Added persistent `appearance_preferences` setting through the existing `api.getSetting` / `api.setSetting` bridge contract.
- Controls: System/Dark/Light theme, six accent presets plus custom hex color picker, Comfortable/Compact density, Soft/Outlined chat message style, 12–18 px chat text size, and System/Full/Reduced/Off motion preferences.
- Preference changes preview immediately; Save persists locally and Restore defaults updates the live preview. Existing default remains the dark Sync navy/violet identity.
- Added `src/appearance.css` after `motion.css` for the new controls, light theme overrides, density/chat presentation and motion settings.
- `renderer/app.js` now routes the Appearance page to its real module and applies saved preferences during startup before the first page render. `renderer/shared.js` no longer advertises Appearance as coming soon.
- No framework, dependency, IPC, database schema or native host changes.
- Validation: source checks and syntax checks are still pending; live Electron appearance review and project build/tests must be run locally.


## Phase 1 implementation update (2026-11-26)

- Migration v8 adds Memory category, importance (1–5), pinned status, source provenance and per-conversation summary storage.
- Database operations, main-process handlers and renderer API wrappers are connected.
- Auto-learned profiles record source links to recent user messages.
- Memory page has category, importance and pin controls plus source conversation/message excerpt display.
- Bounded memory injection now prioritizes pinned, high-importance entries before recency. Relevance-based retrieval remains pending.
- Summary storage has a coverage cursor and invalidation on edits/insertions into summarized history, but no summary generation/automatic compaction/prompt integration yet.
- Syntax parsing passed for changed JavaScript files.
- CI on `d8ab68d20c75414fc624fb3a64b5fa8de9847f99`: all database tests, including the newly added memory/provenance/summary tests, passed on Windows and Ubuntu. Overall workflows remain red because of five unrelated existing failures: file-action data protection, three Windows file-operation path checks, and an inference source-contract assertion.
- No interactive Electron UI, real GGUF conversation or target-machine test has been performed.


## Phase 1 progress — independent context retrieval (2026-11-26)

- Added lightweight lexical retrieval ranking over normalized Unicode terms for Memory, Notes and Workspace artifacts. The query is bounded to 24 terms and 2,000 characters at the IPC boundary.
- Memory, Notes and Workspace are retrieved independently with separate context budgets. Notes remain opt-in through the existing "Include in future chat context" flag; Workspace artifacts retain their own opt-in flag.
- Chat generation passes the latest queued user message to each retrieval source.
- Prompt assembly has separate Memory, user Notes, Workspace, conversation summary and recent transcript sections, with reference-only/untrusted context framing.
- A saved conversation summary is now consumed by prompt assembly; transcript entries already covered by the summary cursor are skipped while the latest queued user message is retained.
- No automatic summary generation or context compaction exists yet.
- Added database tests for lexical matching, source separation and opt-in behavior, plus a contract test for independent IPC methods and prompt sections.
- Source parsing passed for the current changed JavaScript files at the last check.
- CI for commit 2209601e2487b8c37b59a23feba29788944be434 is pending/in progress. Previous run on 8b645c54b25ef21f5e52e92fd2ab566dddece6cf passed the newly added context database tests, while the whole Windows/Ubuntu suite remained red on known unrelated source-contract/file-operation assertions. Check the new run before treating validation as final.
