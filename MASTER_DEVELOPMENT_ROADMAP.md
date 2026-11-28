# SYNC AI DESKTOP — MASTER DEVELOPMENT ROADMAP

**Repository:** SamYoBoi284/Sync-AI-Desktop-E  
**Branch:** main  
**Last reconciled:** 2026-11-28  
**Roadmap baseline:** 5758d720eb5de611e5018804365bf541bde9bb56  
**Current phase:** Phase 2 — Desktop Integration  
**Current status:** Phase 1 implementation is complete, including the chat-maintenance/scroll correction and device-local time context. Phase 1 release validation remains tracked as pending. Phase 2 has its first implementation slice: Quick Ask overlay, configurable temporary-model selection, device clock context and expanded tray actions; runtime validation is pending.

Status meanings:
- **COMPLETE** — implementation exists in the current repository.
- **PARTIAL** — a usable foundation exists, but planned scope remains.
- **NOT STARTED** — no meaningful implementation is currently present.
- **VALIDATION PENDING** — implementation is present but has not yet passed the final validation gate.

---

## PHASE 1 — INTELLIGENCE & MEMORY

**Priority: Critical**  
**Implementation status: COMPLETE**  
**Release/validation status: PENDING**

### 1. Memory Center — COMPLETE

- Persistent local Memory stored in SQLite.
- Categories, importance ranking and pinning.
- Source provenance linked to conversations and message snapshots.
- Search plus category and active/disabled status filters.
- UTF-8 content storage usage displayed against the 4 MiB / 50-item limits.
- Import, create, edit, enable/disable and delete.
- Learning modes: Off / Review first / Automatic.
- Persistent candidate review queue, separate from saved Memory.
- Explicit candidate approval and rejection.
- Candidate approval updates the learned profile and attaches provenance; rejection does not modify the existing saved profile.
- Backward compatibility with the legacy auto-learning setting.
- Conservative learning: `NO_CHANGES` is a valid normal outcome; temporary moods, one-off actions, greetings, routine check-ins, casual slang/address habits, guesses and private details about others are not durable memories.
- Learning filters greeting-only and temporary-status user messages before profile extraction. The model must return explicit source message IDs and a separate complete profile; only validated IDs belonging to supplied substantive user messages are linked as provenance. Missing/invalid evidence IDs or an empty profile leave Memory unchanged.
- Existing learned-profile input is sanitized to exclude obvious temporary `Status`, slang-based `Habits` and miscellaneous `Other mentions` lines before the next model update; this does not automatically rewrite the currently saved local profile until a valid update occurs.
- General-purpose recurring-topic evidence is indexed from user messages across conversations (not a fixed keyword list). A subject is only presented as a candidate signal after at least four separate user messages across at least three chats; the model must still judge whether the user shows real interest, curiosity, enjoyment or sustained activity before suggesting it. Generic greetings, check-ins and colloquial filler are excluded from evidence.

### 2. Independent context retrieval — COMPLETE

- Durable Memory retrieval with lexical relevance ranking.
- Independent Notes retrieval with explicit opt-in to prompt context.
- Independent Workspace retrieval respecting its context-selection setting.
- Separate source-specific retrieval budgets.
- Source-labelled prompt sections.
- Memory, Notes and Workspace remain distinct data sources; Notes are not silently mixed into Workspace.
- Retrieved material is treated as reference content rather than instructions.

### 3. Overall context management — COMPLETE FOR THE CURRENT DESIGN

- Configurable overall prompt budget: 40–80%, in 5% steps; default 65%.
- Main-process policy reserves room for the fixed system prompt, safety margin and model output.
- The effective prompt allowance and output reserve are shown in Memory settings.
- Prompt assembly allocates bounded portions to the current chat summary, Memory, Notes, Workspace, optional cross-chat summaries and recent transcript.
- Recent transcript text is preferentially preserved when the prompt must be clipped.
- Rolling compaction uses the per-chat summary coverage cursor and keeps the newest eight user/assistant messages verbatim.
- Topic-aware summary selection: a clearly unrelated new subject or generic greeting does not pull the older summary into the active prompt; relevant topics and ambiguous follow-ups can retrieve it again.
- When an older summary is excluded as irrelevant, its already-covered transcript remains outside the active prompt too. This frees context for the new topic without deleting chat history or the saved summary.
- Learning and summary prompts are also bounded by the active context allowance.
- The inference worker tokenizes the application prompt and Sync system prompt, calculates the true remaining context and caps generation to the configured output ceiling and actual available tokens (maximum 512).
- A clear error is returned when no output capacity remains.

**Known design limitation:** Topic switching and summary relevance currently use lightweight lexical matching plus explicit ambiguous-follow-up heuristics, not semantic embeddings. The character budget is not a tokenizer measurement; worker-side token counting is the final context guard. Embeddings, semantic/vector retrieval and more advanced adaptive allocation are not implemented.

### 4. Conversation summaries — IMPLEMENTATION COMPLETE

- Persistent per-conversation summary storage and coverage cursor.
- Summary invalidation when edits or inserted historical messages make the covered transcript stale.
- Automatic incremental summary generation using the already-loaded local model.
- Automatic summarization is enabled by default and can be disabled in Memory settings.
- Newest eight user/assistant messages remain verbatim.
- Prefix-batched processing; the cursor advances only through messages actually included in the summary prompt.
- Oversized earliest uncovered messages are not silently skipped.
- Summary text is consumed during prompt assembly.
- The active chat query is passed into summary retrieval; unrelated summaries are withheld while short referential follow-ups retain continuity.
- The summary coverage cursor still removes covered old transcript turns from the active prompt even when that summary is not relevant to the new topic.
- Memory now contains a Summary Center with full-index search, conversation selection, summary inspection, coverage metadata and manual editing.
- Saved summaries can be deleted without deleting their original conversations.
- Manual rebuild works from the original transcript, keeps the newest eight messages outside the summary, processes older messages in bounded batches and only saves the replacement after all batches succeed.
- Cancellation, empty output or failure leaves the previously saved summary intact.

### 5. Cross-conversation summary retrieval — IMPLEMENTATION COMPLETE

- Optional relevance-ranked retrieval of summaries from other conversations.
- The active conversation is excluded.
- At most four other summaries are selected, with a 6,000-character retrieval ceiling and a dedicated 12% prompt allocation.
- Retrieval is **off by default** and can be enabled from Memory settings.
- Retrieved summaries are clearly labelled as derived reference material and are not treated as instructions.
- This feature does not merge conversations or change their saved transcripts.

### 6. Model Profiles — CORE IMPLEMENTATION COMPLETE

- SQLite schema version 10 adds persistent profiles keyed to registered GGUF model IDs.
- SQLite schema version 12 adds a local topic-observation index keyed to user message IDs; v12 replaces the temporary v11 communication-only evidence table with general topic/phrase evidence. Schema v13 clears prior cached observations so the new greeting/status/slang filters are applied to existing transcripts on next indexing. Schema v14 sanitizes obvious temporary/noise fields from legacy auto-learned profiles and clears their unverified bulk source links; manually authored Memory entries and chat transcripts are preserved.
- Each model can save its own:
  - Context window: 512–32,768 tokens.
  - Batch size: 16–2,048 tokens, constrained not to exceed the context window.
  - Temperature: 0–2.
  - Maximum output: 16–512 tokens.
- Local Models cards expose profile editing and reset-to-default controls.
- Profiles apply when a model is next loaded and during force-stop worker recovery; changing a saved profile does not mutate a currently running worker.
- Models without a custom profile continue to use the existing global Runtime context/batch settings and default generation values.
- Profiles are removed automatically when their registered model entry is deleted.

**Scope distinction:** These are per-GGUF inference-parameter profiles. Named task presets such as General conversation, Coding, Creative writing, Reasoning and Low-memory are not implemented yet. They should be treated as a separate enhancement, not as a missing part of the current per-model profile storage.

### 7. Final Phase 1 validation — PENDING

This remains a release-validation gate and can be completed alongside Phase 2 development; it is not a reason to leave Phase 1 implementation marked incomplete. The current known blocker is the Windows file-action test suite described in the validation snapshot below.

- Run the complete database and contract test suites.
- Run the repository build/syntax checks and inspect the latest GitHub Actions results.
- Verify the v7-to-v14 migration against populated user data, including existing v10/v11/v12/v13 installations and a fresh database.
- Verify recurring-topic evidence with a repeated subject (for example Rocket League) across at least three chats and four substantive user messages; a one-off subject (for example chess), routine greetings, casual slang and check-ins must not qualify. Confirm schema v13 rebuilds observations cached by older versions and schema v14 removes legacy learned-profile noise and unverified source links without touching manual Memory or chat history.
- Verify Review first only proposes a subject when the user's examples show genuine interest or sustained engagement, returns no suggestion for ordinary chatter or temporary activity, and links only the exact model-selected supporting message IDs rather than every recent user message.
- Verify greeting-only openers leave a chat titled `New conversation`, small-talk lead-ins are stripped from meaningful titles (for example, `doing good, what time is it rn?` becomes a time question title), and routine utility questions are excluded from Memory without being excluded from conversation titles.
- Verify a reader at the transcript bottom remains at the bottom when streaming is replaced with a saved reply, while a reader who has manually scrolled up keeps their position. Background Memory and summary maintenance must not insert chat notices or force transcript re-renders; ordinary notices must not change transcript layout height.
- Verify topic-aware rolling context: unrelated subject changes hide old summaries from the active prompt, relevant subjects retrieve them again, and ambiguous follow-ups keep continuity without deleting saved history.
- Verify Memory candidate approval/rejection and source provenance.
- Verify summary search, editing, deletion, rebuild, cancellation and cursor preservation.
- Verify cross-chat retrieval remains disabled by default, excludes the active chat and stays within its prompt budget when enabled.
- Verify model-profile persistence, validation, fallback defaults, reload behavior and deletion cascade.
- Manually inspect the Electron UI at normal and constrained window sizes.
- Verify ESM-style keyboard focus recovery after native `alert()`, `confirm()` and `prompt()` dialogs and after main-process Open/Save file pickers; test the chat composer, Memory editor, and other text inputs/textareas without Alt+Tab or clicking the title bar.
- Load and test a real GGUF model, including context limits, output limits, profile application and worker recovery.
- Verify behavior on the intended low-RAM target device and with the Windows worker memory limiter configured.

**Validation snapshot (source commit `d1b271fd`):** the Ubuntu source/action-safety workflow passed, including source syntax and the full database, contract and renderer test set. Windows source syntax also passed. The Windows action-safety and Electron test jobs fail in four file-operation cases: protected application-data rejection and symbolic-link destination handling for copy/rename/move. Those failures prevent the Windows persistence stage from advancing, so native GGUF runtime verification, full Electron startup, renderer automation and installer packaging are skipped. These existing file-action failures are separate from the Memory/Quick Ask changes. Do not mark Windows/runtime validation complete until those Windows tests and manual target-device checks pass.

### Phase 1 position

- Repository/architecture audit: **COMPLETE**.
- Data model and storage APIs: **COMPLETE**, schema v14 (model profiles v10; general topic evidence v12; noise-filter cache rebuild v13; learned-profile cleanup v14).
- Memory Center: **COMPLETE**.
- Independent Memory / Notes / Workspace retrieval: **COMPLETE**.
- Overall context orchestration and worker-side output guard: **COMPLETE for the current lexical/estimated-character design**.
- Automatic summaries and rolling compaction: **IMPLEMENTED — topic-aware summary selection; chat history remains intact**.
- Conservative learning and general recurring-interest evidence: **IMPLEMENTED — substantive-message filtering, 4 user messages across 3 conversations threshold, model-selected validated provenance IDs, v13 evidence-cache rebuild, and v14 legacy profile/provenance cleanup; model judgement remains required**.
- Global renderer keyboard-focus recovery after native dialogs/file pickers: **IMPLEMENTED; manual Windows Electron verification pending**.
- Summary Center and manual rebuild: **IMPLEMENTED**.
- Cross-conversation summary retrieval: **IMPLEMENTED, opt-in by default**.
- Per-GGUF inference profiles: **IMPLEMENTED**.
- Final test, CI, migration, manual UI and real-GGUF validation: **PENDING**.

**Phase 2 — Desktop Integration is now active.** Phase 1 implementation is complete; its release-validation gate remains open.

---

## PHASE 2 — DESKTOP INTEGRATION

**Priority: High**  
**Status: PARTIAL IMPLEMENTATION — Quick Ask and tray first slice committed; Low-Memory and remaining desktop integration work continue**

### Device-local context — IMPLEMENTED

- The normal chat prompt receives the operating system's local date, time, IANA time-zone name and UTC offset as trusted, bounded metadata.
- Present-time questions can be answered without network access; the model is instructed to use this metadata rather than guess.
- Quick Ask receives the same device-local clock context.

### Quick Ask Overlay — PARTIAL; FIRST IMPLEMENTATION SLICE COMPLETE

Implemented:
- Configurable global shortcut, persisted in Quick Ask settings (default: `CommandOrControl+Shift+Space`).
- Lightweight frameless, always-on-top floating window with its own scoped preload/IPC route and renderer.
- Quick conversation entry, live response streaming, Stop and Close controls.
- Reuses the already-loaded model and inference worker; it does not start a concurrent worker.
- If no model is loaded, starts the selected temporary model and reports a clear error when no usable model is available.
- Quick Ask is available from the configured global shortcut and the system tray.

Remaining:
- Manual Windows verification of shortcut conflicts, focus, overlay positioning, close/reopen behavior and streaming.
- Verify all failure/cancellation/close races with a real GGUF model and the low-RAM target device.

### Temporary Model Loading — PARTIAL; QUICK ASK LIFECYCLE IMPLEMENTED

Implemented for Quick Ask:
- Persistent Settings choices: **Default / Smallest / Most Recent / Custom**.
- Default selects the registered default model; Smallest selects the smallest available registered GGUF by file size.
- Most Recent selects the last model successfully loaded by Sync on this device; before one has been used, it falls back to the most recently imported available model.
- Custom selects a specific available registered GGUF.
- An already-loaded model always takes priority and is reused, regardless of the temporary selection rule.
- A model loaded only for Quick Ask is unloaded when the overlay closes; the registered default model is never changed.
- Temporary loading uses the existing isolated worker and refuses to start a second worker alongside a busy runtime.

Remaining:
- Runtime tests for model-resolution fallbacks, missing files, load failures, close-during-load, cancellation and unload behavior on Windows.
- Resource-aware compatibility checks beyond registered-file availability and the existing worker/RAM-limit enforcement.

### Low-Memory Loading Preference — FIRST IMPLEMENTATION SLICE COMPLETE; VALIDATION PENDING

Implemented:
- A persistent, explicitly optional **Low-Memory Mode**, disabled by default and exposed under **Settings → Performance**.
- Installed-RAM-based recommendation tiers:
  - 4 GB RAM or less: context ceiling 1,024 tokens; batch ceiling 32.
  - More than 4 GB up to 8 GB: context ceiling 2,048 tokens; batch ceiling 64.
  - More than 8 GB up to 16 GB: context ceiling 4,096 tokens; batch ceiling 128.
  - More than 16 GB: context ceiling 8,192 tokens; batch ceiling 256.
- When enabled, the policy only reduces the effective context and batch values for the next model load. It does not overwrite global inference settings or saved per-GGUF profiles.
- Requested and effective context/batch values plus the active loading profile are exposed in Runtime diagnostics.
- Settings shows installed and currently available RAM. Installed RAM selects the recommendation tier; currently available RAM is informational and is not treated as a guarantee that a specific GGUF will fit.
- The Windows Job Object RAM Limiter remains a separate optional hard private-memory ceiling; Low-Memory Mode does not silently enable it.
- A pure policy module and unit tests cover the disabled default, input validation, hardware tiers, non-destructive clamping and preservation of already-small profiles.

Remaining:
- Run the complete automated suite and Windows CI against the new implementation.
- Manually verify enabling/disabling the preference, persistence across restarts, model reload application, force-stop worker recovery, per-model profiles and interaction with the separate RAM Limiter.
- Test real GGUF loading and inference on the intended 8 GB laptop and on at least one lower-memory configuration.
- Improve model-fit guidance with real GGUF metadata estimates and current available-memory awareness; current tier caps are conservative heuristics, not a guarantee that any specific model will load.

**Automated validation snapshot (code commit `27b12591`):** the Ubuntu source/action-safety workflow passed the build and full test suite. Windows JavaScript source syntax passed; the Low-Memory policy tests, Performance page placement test and Windows Job Object memory guard test also passed. The overall Windows source/action-safety suite still fails four unrelated file-operation cases: protected application-data/Recovery Vault rejection and the copy, rename and move symbolic-link destination cases. Manual testing with a real GGUF on the 8 GB target laptop remains outstanding. The Windows Electron CI job was blocked at its persistence/contract test gate; native runtime verification, full Electron startup, renderer automation and installer packaging were skipped.

### System Tray Companion — IMPLEMENTED FIRST SLICE; RUNTIME VALIDATION PENDING

Implemented:
- Tray icon with application-icon fallback.
- Open/restore Sync AI and Hide Sync AI.
- New conversation and Quick Ask actions.
- Live model name and runtime state (loading, generating, ready, idle, recovery or error) in the tray context menu.
- Queue count appears while generations are waiting; the tray tooltip includes current runtime and model status.
- Tray status refreshes on model and generation state transitions without a polling timer that rebuilds the menu while it is open.
- **Settings → Desktop** includes a persisted Close to tray preference (enabled by default). When disabled, closing the main window exits Sync AI.
- **Settings → Desktop** includes a persisted Gracefully unload the active model on exit preference (enabled by default).
- Graceful exit waits for an active generation to abort and release its sequence before disposing the model/context and closing the worker.

Remaining:
- Manual Windows verification of tray model/runtime labels during idle, load, generation, queue, error, unload and worker recovery.
- Verify close-to-tray on/off behavior, tray Exit behavior and graceful model cleanup during an active generation on Windows.
- Verify both Desktop preferences persist across application restarts and behave correctly in the packaged build.

Voice Mode remains deferred to Phase 7.

---

## PHASE 3 — TOOLS & AUTOMATION

**Priority: Medium to High**  
**Status: NOT STARTED**

### Model Capability Assessment — NOT STARTED

- Tool-calling ability.
- Instruction-following reliability.
- Context capacity.
- Planning reliability.
- Resource availability.
- Capability results stored per model and exposed clearly to the user.
- Conservative fallbacks for models that cannot reliably use tools.

### Agent Mode — NOT STARTED - MIGHT BE DEFERRED TO PHASE 7

- Multi-step planning.
- Tool selection and capability checks.
- Explicit execution approval.
- Visible progress and cancellation.
- Error recovery.
- Integration with the transactional action and rollback system.
- No unrestricted autonomous filesystem or command execution.

### Workspace Watcher — NOT STARTED

- User-selected folders only.
- File change detection.
- Optional notifications.
- Exclusions and pause/resume.
- Explicit folder permissions.
- Clear indication of what is monitored and when.

### Git Assistant — NOT STARTED

- Repository status.
- Diff review.
- Commit message generation.
- Branch management.
- Approved Git operations.
- Optional installation/configuration.
- Explicit permissions and approval before repository-changing operations.

---

## PHASE 4 — SAFETY & RELIABILITY

**Priority: Critical**  
**Status: PARTIAL FOUNDATIONS; EXPANSION AND VALIDATION REQUIRED**

### Transactional Actions & Rollback — PARTIAL / CORE FILE-ACTION FOUNDATION IMPLEMENTED

Already present:
- Persistent action journal.
- Explicit review and approval before supported file changes.
- Copy, move, rename and folder-creation workflows.
- Reversible file removal through a verified Recovery Vault copy; permanent deletion is not offered by this tool.
- Stop control with rollback attempts.
- Undo for supported completed operations.
- Interrupted-action recovery and recoverable error states.
- Protected application-data and Recovery Vault paths.
- Destination-overwrite protection and path validation.

Remaining:
- Broader transactional grouping for multi-step actions.
- Stronger rollback guarantees across different tool types.
- More complete crash/interruption testing.
- Clear recovery review and reporting for partial failures.
- Integration with future Agent Mode so every approved action is journaled and reversible where possible.

### Permissions Center — NOT STARTED; SECURITY FOUNDATIONS EXIST

Already present:
- Restricted preload and IPC command allowlist.
- Renderer isolation and backend-side validation.
- User-selected paths for the existing file-operation tools.
- Explicit approval for supported file changes.
- Protected paths and scoped filesystem operations.

Remaining:
- Central permissions matrix for read/write/delete.
- Command execution permissions.
- Network access permissions.
- Git permissions.
- Folder-specific permissions.
- Per-tool approval requirements and persistent user preferences.
- Backend enforcement for every capability; UI-only permission checks are insufficient.
- Clear permission history and revocation controls.

### Runtime Monitor — PARTIAL; RUNTIME DIAGNOSTICS PAGE EXISTS

Already present:
- Application version, operating system and architecture.
- Isolated inference-worker state and loaded-model status.
- Worker PID and generation/queue state.
- Worker resident working-set and private committed-memory telemetry.
- Configured Windows worker memory ceiling and enforcement status.
- Context and batch controls.
- Last worker error and diagnostic message.
- Force Stop Generation and worker restart/recovery.
- Live refresh of current worker diagnostics.
- Per-generation token-speed, timing and inference diagnostics.

Remaining:
- CPU identity and utilization.
- Physical RAM totals and available RAM displayed in the Runtime page.
- Sync process CPU/RAM measurements beyond the current worker memory counters.
- Child-process resource aggregation.
- Resource peaks, averages and historical graphs.
- Recording sessions from 15 minutes to 5 hours, plus custom duration and manual stop.
- Saved reports and export.
- Worker health history, restart/failure timestamps and expanded error history.
- Diagnostic bundle export.
- Validation of measurement accuracy and overhead on low-RAM devices.

---

## PHASE 5 — PERSONALIZATION & PRODUCTIVITY

**Priority: Medium**  
**Status: PARTIAL — NOTES AND APPEARANCE FOUNDATIONS EXIST**

### Command Palette — NOT STARTED

- Ctrl + K.
- Navigation.
- Chat search.
- Model selection.
- Settings and application commands.
- Keyboard-accessible results and command descriptions.

### Message Bookmarks & Pins — NOT STARTED

- Save individual messages.
- Search and organize bookmarks.
- Jump to the original conversation and message.
- Remove or rename saved bookmarks without modifying the transcript.

### Persistent User Notes — PARTIAL; CORE IMPLEMENTED

Already present:
- Local persistence.
- Create, edit and delete.
- Pinning.
- Explicit opt-in to prompt context.
- Independent lexical relevance retrieval, separate from Memory and Workspace.

Remaining:
- Better organization and grouping.
- Enhanced explicit note lookup.
- Additional note-search and filtering controls.
- More convenient linking between notes, conversations and Workspace artifacts.

Notes remain separate from Memory. Memory is for durable user context; Notes are user-authored reference material.

### Appearance and chat management — EXISTING FOUNDATION

Already present:
- System/Dark/Light appearance modes.
- Accent, density, chat style and font-size settings.
- Motion preferences (System / Full / Reduced / Off) are grouped under **Settings → Performance** rather than Appearance.
- Chat archive, pin and folder organization.
- User-message edit-from-turn flow.
- In-app Back navigation and Escape handling for supported nested UI.
- Responsive overflow and tooltip-placement refinements.

Further refinements can be scheduled as needed without blocking the Command Palette or Bookmarks work.

---

## PHASE 6 — FIRST-TIME SETUP EXPERIENCE

**Priority: High**  
**Status: NOT STARTED**

- First-launch setup wizard.
- User type selection.
- Optional modules.
- Git Assistant preference.
- Workspace Watcher preference.
- Quick Ask configuration.
- Memory limits and learning behavior.
- Appearance.
- Privacy and permissions.
- Hardware-aware recommendations.
- All preferences remain editable after setup.
- Setup must not silently enable sensitive capabilities or grant broad permissions.

---

## PHASE 7 — DEFERRED FEATURES

### Voice Mode — DEFERRED

- Speech-to-text.
- Text-to-speech.
- Interruptible voice interaction.
- Device and model capability checks.

### Multi-Model Conversations — DEFERRED

- Multiple model interaction.
- Comparison and critique.
- Hardware-aware resource controls.
- No concurrent model workers unless resource limits and user intent allow them.

### Sync Projects — DEFERRED

- Project-specific instructions.
- Project-scoped memories.
- Conversations.
- Files and Workspace material.
- Model preferences.
- Clear isolation between project context and global Memory.

---

## DEVELOPMENT RULES

1. Inspect the current repository and relevant project documents before changing code.
2. Preserve the current Electron and classic JavaScript architecture.
3. Do not introduce frameworks or bundlers without approval.
4. Keep IPC and preload permissions restricted.
5. Enforce permissions in the backend, not only in the renderer.
6. Preserve local user data during schema migrations and test upgrades from populated databases.
7. Consider low-RAM devices and avoid unnecessary model workers.
8. Do not remove existing features without approval.
9. Test changed functionality and record actual results; distinguish syntax checks from tests, CI and manual runtime validation.
10. Update project documentation after every milestone.
11. Commit changes with descriptive messages.
12. Verify the final GitHub branch, commit and CI state before declaring completion.
13. Treat repository implementation as authoritative when this roadmap or an older conversation is stale.
14. Do not claim a feature is runtime-tested unless it has actually been exercised in the Electron application with the relevant model/device.

## CURRENT DEVELOPMENT POSITION

**Phase 1 — Intelligence & Memory**

- Repository and architecture audit: **COMPLETE**.
- Data model and storage API: **COMPLETE — schema v14**.
- Memory Center: **COMPLETE**.
- Independent Notes and Workspace retrieval: **COMPLETE**.
- Context orchestration/global budgeting: **COMPLETE for current lexical and estimated-character design**.
- Topic-aware rolling context compaction: **IMPLEMENTED; lexical relevance and follow-up heuristic, non-destructive to saved history**.
- Evidence-based recurring interests/preferences: **IMPLEMENTED; general topics/phrases, evidence threshold plus model judgement**.
- Native dialog/file-picker keyboard-focus recovery: **IMPLEMENTED; manual Windows verification pending**.
- Automatic summaries and compaction: **IMPLEMENTED**.
- Summary Center and manual rebuild: **IMPLEMENTED**.
- Cross-conversation summary retrieval: **IMPLEMENTED — opt-in, off by default**.
- Per-GGUF inference profiles: **IMPLEMENTED**.
- Phase 1 implementation: **COMPLETE**. Final database/contract test execution, CI review, v7-to-v14 migration verification, manual Electron UI and real-GGUF validation: **PENDING**.

**Phase 2 — Desktop Integration**

- Device-local time context: **IMPLEMENTED**.
- Quick Ask overlay, configurable shortcut, tray launch and live response display: **IMPLEMENTED; Windows runtime validation pending**.
- Temporary model policy: **IMPLEMENTED for Quick Ask — Default / Smallest / Most Recent / Custom; reuse existing model, unload temporary model when overlay closes**.
- Tray New conversation and Quick Ask actions: **IMPLEMENTED**.
- Optional Low-Memory Mode: **IMPLEMENTED — opt-in, off by default; installed-RAM tiers cap effective context/batch values without changing saved profiles; Runtime reports requested/effective allocations; automated and target-device validation pending**.
- Settings organization: **IMPLEMENTED — Appearance, Performance, Runtime and Memory categories; Low-Memory Mode, separate RAM Limiter and System/Full/Reduced/Off motion preferences are under Settings → Performance**.
- Runtime/model tray status: **IMPLEMENTED — live model name, runtime state and waiting generation count; Windows manual verification pending**.
- Desktop behavior: **IMPLEMENTED — persisted Close to tray and graceful model unload on exit preferences under Settings → Desktop; both enabled by default; runtime verification pending**.
- Quick Ask edge-case verification, packaged-build testing, real-GGUF Low-Memory validation and the Phase 1 validation gate: **PENDING**.

**Immediate next task:** Run automated CI for the integrated Performance, Desktop and tray changes, then manually verify the tray status transitions and Desktop close/exit preferences in the Windows Electron app. Also test graceful exit during an active real-GGUF generation and validate Low-Memory behavior on the intended 8 GB laptop. Keep Phase 1, item 7 as a separate validation task: verify v7-to-v14 migration and topic-learning/context-compaction regressions, then manually test chat scrolling, native-dialog focus, device-local time, Quick Ask and real-GGUF behavior on Windows. Phase 1 implementation is complete; validation must not be misreported.

**Continuity requirement:** Every future development session must inspect the current repository and this roadmap before starting new work. The implementation on the current branch takes precedence over this document if they disagree.
