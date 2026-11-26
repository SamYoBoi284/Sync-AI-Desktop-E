# Sync AI Desktop E — Filesystem & Desktop Tools Roadmap

## Design principles
- Main-process-only filesystem authority; renderer never receives raw filesystem access.
- Explicit, scoped permissions and a review step for destructive or broad changes.
- Durable action journal, cancellation, progress events, and recovery wherever technically possible.
- Never overwrite a destination silently. Detect conflicts and ask for a decision.
- Cross-volume moves use copy → verify → remove source, never an unverified rename.
- Clearly distinguish reversible actions from actions that cannot be fully rolled back.

## Stage 1 — Safety UX and foundation
- [x] Use the supplied neon Sync icon for the Windows app, window/taskbar, and tray (asset replacement pending commit).
- [ ] Replace the OS approval dialog with a themed in-app modal; final authorization stays in Electron main.
- [ ] Generalize action records beyond reversible file removal.
- [ ] Add structured progress, cancellation, and recovery status to each operation.
- [ ] Add conflict handling and startup reconciliation tests.

## Stage 2 — Core filesystem operations
- [ ] Inspect file/folder metadata and list directory contents.
- [ ] Search only within user-selected folders; no silent whole-drive crawling.
- [ ] Copy files and folders with progress, destination conflict checks, and partial-copy cleanup.
- [ ] Move files and folders using verified copy/remove across volumes and safe rename on the same volume.
- [ ] Rename files and folders with collision checks and undo records.
- [ ] Create folders and safely undo only folders that remain empty.
- [ ] Delete files and folders through Recovery Vault/quarantine; no permanent delete by default.
- [ ] Restore and retry recovery-required operations without overwriting newer user data.

## Stage 3 — Batch and organization tools
- [ ] Multi-select and batch operations with per-item results.
- [ ] Batch rename with preview and collision detection.
- [ ] Organize by explicit rules (extension, date, naming pattern) with dry-run preview.
- [ ] Duplicate detection using hashes; never delete duplicates automatically.
- [ ] Archive/extract supported formats with path-traversal protections and size limits.

## Stage 4 — AI tool integration
- [ ] Add a narrow, typed tool registry for the local model.
- [ ] Require folder scopes and operation-specific permissions.
- [ ] Show plans before multi-step actions; request approval before writes/deletes.
- [ ] Stream progress and allow Stop from any page.
- [ ] Keep complete, searchable action history.

## Stage 5 — Hardening and release
- [ ] Unit tests for cancellation at every commit boundary.
- [ ] Fault-injection tests for disk-full, permission, file-lock, and process-crash scenarios.
- [ ] Windows integration tests for taskbar/tray icon and packaged builds.
- [ ] Accessibility, keyboard navigation, and reduced-motion checks for the approval modal.
- [ ] Document backup retention, disk usage, permissions, and irreversible limitations.

## Safety contract
An operation is not successful until its result is verified. If rollback cannot be guaranteed, Sync preserves available recovery data, marks the action as requiring attention, and explains what remains. Stop prevents new work immediately and attempts safe rollback; it never claims already-committed external side effects were undone when they were not.
