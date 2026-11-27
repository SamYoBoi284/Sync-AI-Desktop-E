# SYNC AI DESKTOP — MASTER DEVELOPMENT ROADMAP

**Repository:** SamYoBoi284/Sync-AI-Desktop-E  
**Branch:** main  
**Last reconciled:** 2026-11-26  
**Roadmap baseline:** 43e57d284555487e04cdb053b171e2f38d908dff  
**Current phase:** Phase 1 — Intelligence & Memory  
**Current status:** Phase 1 implementation scope complete; final database, CI, Electron UI and real-GGUF validation remains outstanding.

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
- Learning and summary prompts are also bounded by the active context allowance.
- The inference worker tokenizes the application prompt and Sync system prompt, calculates the true remaining context and caps generation to the configured output ceiling and actual available tokens (maximum 512).
- A clear error is returned when no output capacity remains.

**Known design limitation:** Retrieval ranking and prompt allocation are still lightweight lexical and estimated-character approaches. The character budget is not a tokenizer measurement; worker-side token counting is the final context guard. Embeddings, semantic/vector retrieval and more advanced adaptive allocation are not implemented.

### 4. Conversation summaries — IMPLEMENTATION COMPLETE

- Persistent per-conversation summary storage and coverage cursor.
- Summary invalidation when edits or inserted historical messages make the covered transcript stale.
- Automatic incremental summary generation using the already-loaded local model.
- Automatic summarization is enabled by default and can be disabled in Memory settings.
- Newest eight user/assistant messages remain verbatim.
- Prefix-batched processing; the cursor advances only through messages actually included in the summary prompt.
- Oversized earliest uncovered messages are not silently skipped.
- Summary text is consumed during prompt assembly.
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

This is the next immediate task and is intentionally handed to the user.

- Run the complete database and contract test suites.
- Run the repository build/syntax checks and inspect the latest GitHub Actions results.
- Verify the v7-to-v10 migration against populated user data.
- Verify Memory candidate approval/rejection and source provenance.
- Verify summary search, editing, deletion, rebuild, cancellation and cursor preservation.
- Verify cross-chat retrieval remains disabled by default, excludes the active chat and stays within its prompt budget when enabled.
- Verify model-profile persistence, validation, fallback defaults, reload behavior and deletion cascade.
- Manually inspect the Electron UI at normal and constrained window sizes.
- Load and test a real GGUF model, including context limits, output limits, profile application and worker recovery.
- Verify behavior on the intended low-RAM target device and with the Windows worker memory limiter configured.

**Validation already performed in the implementation handoff:** static syntax compilation passed for the changed CommonJS, classic renderer and test modules; the renderer API-to-main IPC comparison found no missing handlers. These checks are not a substitute for running the tests, CI, Electron UI or real-GGUF inference. Do not mark runtime validation complete until those checks have actually passed.

### Phase 1 position

- Repository/architecture audit: **COMPLETE**.
- Data model and storage APIs: **COMPLETE**, schema v10.
- Memory Center: **COMPLETE**.
- Independent Memory / Notes / Workspace retrieval: **COMPLETE**.
- Overall context orchestration and worker-side output guard: **COMPLETE for the current lexical/estimated-character design**.
- Automatic summaries and compaction: **IMPLEMENTED**.
- Summary Center and manual rebuild: **IMPLEMENTED**.
- Cross-conversation summary retrieval: **IMPLEMENTED, opt-in by default**.
- Per-GGUF inference profiles: **IMPLEMENTED**.
- Final test, CI, migration, manual UI and real-GGUF validation: **PENDING**.

**Next target after validation:** Phase 2 — Desktop Integration.

---

## PHASE 2 — DESKTOP INTEGRATION

**Priority: High**  
**Status: PARTIAL FOUNDATIONS; MAJOR FEATURES NOT STARTED**

### Quick Ask Overlay — NOT STARTED

- Configurable global shortcut.
- Lightweight floating window.
- Reuse the already-loaded model where possible.
- Quick conversation entry and response display.
- Safe handling when no model is loaded.

### Temporary Model Loading — NOT STARTED

- Load a model temporarily when required.
- Reuse an existing compatible loaded model whenever possible.
- Avoid unnecessary concurrent workers.
- Safely unload temporary models after the Quick Ask session.
- Preserve the user's normal model selection and runtime state.

### Low-Memory Loading Preference — PARTIAL FOUNDATION

Already present:
- Configurable worker private-memory ceiling.
- Windows Job Object enforcement when the RAM limiter is enabled.
- Existing context and batch controls.
- Per-model context/batch profiles.

Remaining:
- A persistent, user-facing Low-Memory loading preference/preset.
- A coordinated reduced-resource configuration for model loading and inference.
- Clear recommendations based on detected device capacity.
- Validation on the target low-RAM laptop.

### System Tray Companion — PARTIAL; BASE TRAY IMPLEMENTED

Already present:
- Tray icon with application-icon fallback.
- Open/restore Sync AI.
- Hide Sync AI.
- Exit Sync AI.
- Closing the main window hides it to the tray instead of quitting the application.

Remaining:
- New conversation from the tray.
- Quick Ask from the tray.
- Runtime/model status in the tray menu.
- Configurable close-to-tray and exit behavior.
- Explicit model-unload behavior when the user exits or closes the application, according to the chosen preference.
- Temporary model lifecycle for Quick Ask.

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

### Agent Mode — NOT STARTED

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
- Accent, density, chat style, font-size and motion settings.
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
- Data model and storage API: **COMPLETE — schema v10**.
- Memory Center: **COMPLETE**.
- Independent Notes and Workspace retrieval: **COMPLETE**.
- Context orchestration/global budgeting: **COMPLETE for current lexical and estimated-character design**.
- Automatic summaries and compaction: **IMPLEMENTED**.
- Summary Center and manual rebuild: **IMPLEMENTED**.
- Cross-conversation summary retrieval: **IMPLEMENTED — opt-in, off by default**.
- Per-GGUF inference profiles: **IMPLEMENTED**.
- Final database/contract tests, CI review, migration verification, manual Electron UI and real-GGUF validation: **PENDING**.

**Immediate next task:** Phase 1, item 7 — final validation.  
**Next development phase after validation:** Phase 2 — Desktop Integration, beginning with Quick Ask Overlay and completion of the tray companion.

**Continuity requirement:** Every future development session must inspect the current repository and this roadmap before starting new work. The implementation on the current branch takes precedence over this document if they disagree.
