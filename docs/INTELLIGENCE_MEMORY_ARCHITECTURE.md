# Intelligence & Memory Architecture

> Status: Baseline audit complete; implementation not started.
> Date: 2026-11-26
> Repository: `SamYoBoi284/Sync-AI-Desktop-E`, branch `main`

## 1. Objective

Build a persistent context system in which long-term Memory, user-authored Notes, and Conversation Context remain distinct sources of truth while being selectively retrieved and assembled for local inference.

The system must stay local-first, bounded, explainable, and inexpensive to run on CPU-only and low-memory devices. It must not require a second model or an embedding model merely to retrieve context.

## 2. Current implementation inventory

### 2.1 Long-term Memory

Existing implementation:

- SQLite table `memories`, introduced by database migration v6.
- Fields: `id`, `title`, `content`, `source`, `enabled`, `created_at`, `updated_at`.
- Memory page at `renderer/pages/memory.js`.
- Create, edit, import, enable/disable and delete are implemented.
- Per-record content limit: 1 MiB.
- Library limit: 50 records and 4 MiB total content.
- Memory context budget setting: `memory_context_tokens`, default 256 and clamped to 128–512 estimated tokens.
- Main-process `list_memory_context` selects every enabled memory ordered by `updated_at DESC`, then clips the combined content to the configured character budget.
- Optional auto-learning is controlled by `memory_auto_learn`, disabled by default.

Auto-learning currently runs an additional local inference after a successful assistant reply. It reviews up to the last eight user turns (bounded to 3,000 characters), updates a single `Learned profile` record, limits that profile to 1,500 characters, and includes prompt constraints against sensitive categories and credentials.

Gaps:

- No category, importance, or pinned metadata.
- No source-chat/message provenance attached to a memory record.
- No candidate-review workflow for automatically learned facts.
- Retrieval is recency-first, not relevance-first.
- The UI describes memory context as automatic injection, but does not show which specific memories were selected for a particular prompt.

### 2.2 User Notes

Existing implementation:

- SQLite table `notes`, introduced by migration v4.
- Notes have their own CRUD API and UI in the Notes tab of `renderer/pages/tasks.js`.
- Fields include title, content, pinned state, `include_in_context`, and timestamps.
- Notes can be manually created, edited, pinned, deleted, and explicitly opted into future chat context.

Gaps:

- Notes are currently included only when the user checks `include_in_context`.
- The database method `list_workspace_context` combines opted-in Notes and Workspace artifacts into one list with a shared 48 KiB limit.
- The prompt labels those items by kind, but both sources are placed inside the same Workspace reference section.
- There is no independent relevance-based Notes retrieval or per-source context budget.

Important boundary: Notes remain user-authored content. Automatic memory learning must not silently rewrite or delete a Note.

### 2.3 Conversation Context

Existing implementation:

- Conversations and messages are stored in SQLite tables `chats` and `messages`.
- The current prompt builder includes the last 24 user/assistant turns from the active conversation.
- The prompt is assembled in `renderer/pages/chat.js`.
- The inference worker adds its own fixed system prompt and receives the assembled prompt from the main process.

Gaps:

- There is no persisted summary table for older conversation turns.
- There is no automatic context compaction or summary refresh.
- There is no cross-conversation retrieval of relevant prior conversation summaries.
- A long conversation is currently handled by taking the latest 24 turns, not by retaining a rolling summary plus recent turns.

### 2.4 Database and API architecture

- Persistence uses Electron's built-in `node:sqlite` in `electron/database.cjs`.
- The current database migration ceiling is version 7; migration v7 adds chat folders and chat archive/pin fields.
- Main-process command handlers live in `electron/main.cjs`.
- The renderer API wrapper is `renderer/api.js`.
- The restricted IPC bridge is `electron/preload.cjs`.
- Renderer pages use classic JavaScript IIFEs registered under `window.SyncAI.pages`.
- The current project does not use React, TypeScript or Vite.

Documentation that states migrations stop at version 4 is stale and must be corrected.

## 3. Agreed conceptual separation

The system will have three distinct context domains:

### A. Memory — durable facts about the user

Examples:

- Stable preferences.
- Long-running goals.
- Technical environment facts.
- Ongoing interests or recurring workflows.
- User corrections that should persist across conversations.

Memory is durable, user-editable, and may be learned from conversations only under the user's configured learning preference.

### B. Notes — user-authored information to keep

Examples:

- Reminders.
- Reference material.
- Plans.
- Personal checklists.
- Information the user explicitly says to save.

Notes are owned by the user. They are not automatically rewritten by the learning process. Sync may retrieve them when relevant or when explicitly requested.

### C. Conversation Context — what has happened in conversations

Contains:

- Recent messages from the active conversation.
- A persistent summary of older messages when needed.
- Optionally, relevant summaries from other conversations when the user asks or retrieval finds a strong match.

Conversation summaries are derived from transcripts and must remain separate from user Memory and Notes. They must never be presented as direct user-authored facts.

Workspace artifacts remain their own source as well. They may be selected as context independently, but should not be mislabeled as Notes or Memory.

## 4. Context retrieval and prompt assembly

Create a context retrieval/orchestration layer that queries each source independently:

1. Active conversation: recent turns plus its stored summary, if one exists.
2. Memory: enabled records ranked by relevance, with pinning/importance as ranking signals.
3. Notes: relevant notes ranked independently; explicit user selection always takes precedence.
4. Other conversations: summaries only when a relevant cross-chat retrieval path is intentionally invoked.
5. Workspace: only explicitly selected artifacts at first; later retrieval can be evaluated independently.

Prompt assembly should use visibly distinct, source-labelled sections. Example structure:

- USER MEMORY (durable, editable user context)
- RELEVANT USER NOTES (user-authored reference material)
- CURRENT CONVERSATION SUMMARY (derived summary of older turns)
- RECENT CONVERSATION TRANSCRIPT (verbatim recent turns)
- SELECTED WORKSPACE MATERIAL (explicitly selected artifacts)

Retrieved content is context, not instructions. Memory, notes, summaries and workspace text must be clearly marked as untrusted reference material. The user's latest correction in the active transcript takes precedence over stale saved context.

### 4.1 Lightweight retrieval first

The initial retrieval implementation should avoid requiring embeddings or another model.

Recommended first approach:

- Normalize the latest user request into searchable terms.
- Query memory and Notes independently.
- Rank title/body matches using a small deterministic lexical scoring function.
- Include pinned and high-importance memories as ranking boosts, not as permission to exceed context limits.
- Prefer explicit user-selected items.
- Apply separate, configurable budgets to Memory, Notes, summaries and selected Workspace content.
- Return provenance and retrieval reasons so Sync can show what it used.

Evaluate SQLite FTS5 availability in the actual Electron runtime before depending on it. If unavailable or unsuitable, use bounded parameterized SQL search plus application-side scoring. Do not assume the Python/system SQLite build is identical to Electron's bundled SQLite.

Do not introduce a vector database, embedding runtime, or background embedding worker in this phase. Those could impose extra RAM/CPU costs and should only be considered as a later optional enhancement.

### 4.2 Context budgets

Keep the existing Memory budget setting backward-compatible initially. Its current default is 256 estimated tokens and its hard UI maximum is 512 estimated tokens.

Introduce separate source budgets only after measuring prompt overhead and available model context. A total context budget must prevent Memory, Notes, summaries and transcript from crowding out the user's latest request or the model's output space.

All budgets must be enforced in the main/database boundary, not solely by renderer controls.

## 5. Proposed data-model evolution

Do not replace existing tables or discard user data.

### 5.1 Memory metadata migration

Use a forward-only SQLite migration (next available migration is v8) to add structured metadata to existing memory records, such as:

- `category` (a small validated category set with a safe fallback).
- `importance` (bounded integer scale).
- `pinned` (boolean).
- Source/provenance metadata linking a learned memory to its originating conversation, and optionally contributing message IDs.

Existing records must migrate with safe defaults. Existing `source`, `enabled`, timestamps and content must remain intact.

If multiple source conversations need to be tracked, prefer a separate `memory_sources` relation rather than a single overloaded source string. Conversation deletion should clear provenance links without deleting the Memory record.

### 5.2 Conversation summaries

Add a separate summary store keyed to the conversation, with at minimum:

- Conversation ID.
- Summary text.
- Last summarized message position or equivalent cursor.
- Updated timestamp.
- Summary format/version metadata.

Use a foreign key with safe deletion behavior. Editing or deleting earlier messages must invalidate or safely rebuild summaries that no longer represent the transcript.

Do not store summaries in the Memory table.

### 5.3 Notes

Preserve the existing Notes table and CRUD behavior. Extend only if retrieval requires metadata such as categories or a modified search index. Do not merge Notes and Memory.

### 5.4 Settings

Keep user preferences in the existing settings store unless there is a concrete relational reason to add a new table. Validate and clamp all settings in the main process.

## 6. Automatic learning behavior

- Keep automatic learning disabled by default.
- Preserve the existing bounded learning prompt and sensitive-category exclusions.
- Separate learned candidates from manually authored Notes.
- Keep learned Memory records visible and editable.
- Add provenance to learned records.
- Consider a review-before-saving mode so users can approve, edit or reject a candidate.
- If automatic application remains available, make it an explicit opt-in choice and preserve a clear change history.
- Avoid running an additional inference after every reply unless auto-learning is enabled.
- Do not attempt learning when the model/worker is unavailable or the user has cancelled generation.

## 7. Implementation sequence

### Step 0 — Repository and architecture audit

**Status: COMPLETE**

- Verified current source and actual main branch head.
- Confirmed existing Memory, Notes and conversation storage.
- Identified current prompt assembly and retrieval behavior.
- Identified documentation drift around database migration version.
- No runtime behavior or database schema was changed during this audit.

### Step 1 — Data model and storage API

**Status: NOT STARTED**

- Design migration v8 for Memory metadata and provenance.
- Design a conversation-summary table and invalidation rules.
- Extend database CRUD and main-process commands.
- Add renderer API wrappers.
- Add migration, preservation, provenance and validation tests.

### Step 2 — Memory Center improvements

**Status: NOT STARTED**

- Add category, importance and pin controls.
- Show source/provenance.
- Add filtering/search and improved storage usage.
- Preserve import/edit/enable/disable/delete.
- Improve auto-learning controls and candidate review.

### Step 3 — Independent Notes retrieval

**Status: NOT STARTED**

- Add a dedicated Notes context query.
- Keep Notes separate from Workspace artifacts and Memory in prompt assembly.
- Respect explicit selection.
- Add bounded relevance-based retrieval.

### Step 4 — Context orchestration and retrieval

**Status: NOT STARTED**

- Add lightweight relevance ranking.
- Return source-labelled retrieved items and reasons.
- Use independent source budgets and an overall context ceiling.
- Preserve recent transcript verbatim.

### Step 5 — Conversation summaries and context compaction

**Status: NOT STARTED**

- Summarize older turns when approaching context limits.
- Retain recent turns verbatim.
- Track summary cursor and invalidation.
- Add transparent summary inspection/rebuild behavior.
- Evaluate cross-conversation summary retrieval later.

### Step 6 — Model Profiles

**Status: NOT STARTED**

- Define model-specific supported settings.
- Store profiles persistently.
- Validate settings against model capabilities.
- Avoid exposing unsupported parameters.

## 8. Acceptance tests

At minimum, add automated tests covering:

- Existing databases upgrade without losing any Memory, Notes, chats or messages.
- Existing memory source and enabled flags survive migration.
- Category, importance, pin and provenance fields validate and persist.
- Deleting a source chat does not delete the Memory record.
- Memory and Notes queries return separate results.
- Notes are not injected merely because a Memory is enabled.
- Only explicitly selected Workspace artifacts are included.
- Retrieval respects each source budget and the overall context ceiling.
- Pinned/important memories rank appropriately without bypassing hard limits.
- Older conversation messages are summarized without modifying transcript content.
- Editing/deleting messages invalidates summaries whose coverage is affected.
- Disabled auto-learning performs no extra learning inference.
- Existing chat streaming, cancellation, queueing and message diagnostics remain unaffected.

## 9. Validation boundaries

Source inspection is not proof of runtime behavior. The audit did not launch Electron, run `npm test`, run `npm run build`, load a real GGUF model, or exercise the app on the target laptop.

Record tests actually performed for each later implementation milestone. Do not claim a real-model test or target-machine test unless it occurred.
