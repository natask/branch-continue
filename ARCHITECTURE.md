# Branch Continue Architecture

This document describes the active runtime architecture in `src/` as of 2026-04-11.

## 1) Runtime Entry and Top-Level Composition

- Entry point: `src/main.tsx`
- Root component: `src/App.tsx`

`App` owns high-level screen routing:

- Error screen if file operations fail.
- Loading screen while source restore is in progress.
- Source selection screen if no source file is selected.
- Full app UI only when a source is selected.

This means source gating is applied at the page layer, not per-control.

## 2) Active Module Map

### Core domain (`src/core/quicknote`)

- `types.ts`
  - `SourceNote`, `QuickNoteSearchHit`, create/update request types.
- `org-file.ts`
  - Parse source file into note entries.
  - Search note content.
  - Append/update note content and reparse.
- `source-bridge.ts`
  - Source selection/read/write abstraction.
  - Supports Tauri direct file access and browser file APIs.
  - Persists last selection (path or handle) and restores on startup.

### UI orchestration (`src/ui/hooks`)

- `use-app.ts`
  - App state coordinator for notes, active selection, source status.
  - Calls parse/search/update functions and source bridge.
  - Owns `activeNoteId` and source lifecycle.
- `use-editor-session.ts`
  - Editor session state (open/close, branch, undo/redo wiring).
  - Composes:
    - `use-editor-draft.ts` (autosave, persistence, Loro undo manager)
    - `use-editor-fields.ts` (title/timestamp/body editing)
    - `use-editor-tags.ts` (tag input/edit/remove)
    - `use-editor-focus.ts` (input focus management)

### UI components (`src/ui/components`)

- `TimeMachine.tsx`
  - Carousel navigation (wheel/arrows/enter), focused card state.
- `SearchModal.tsx`
  - Debounced search and result selection.
- `Editor.tsx`
  - Full editor UI bound to `useEditorSession`.

### Ordering utility (`src/ui/lib`)

- `note-order.ts`
  - Sort mode (`latest`/`oldest`) and note position helpers.

## 3) Data Flow

### Startup flow

1. `App` mounts and calls `useApp`.
2. `useApp` calls `sourceBridge.restoreLastSelection()`.
3. If a source is restored:
   - parse file via `parseQuickNoteFile`.
   - store parsed entries.
   - select initial active note (latest by file order).
4. `App` renders loaded UI only when `sourceSelected === true`.

### Read/search flow

- Search input in `SearchModal` calls `useApp.searchNotes`.
- `searchQuickNoteFile` scans lines and maps each match back to its containing note.
- Selecting a hit sets active note and opens editor for that note.

### Write/update flow

1. Editor mutates local draft state.
2. `useEditorDraft` schedules autosave (500ms debounce).
3. Save uses `createNote` or `updateNote` from `useApp`.
4. `useApp` updates file content through source bridge, reparses file, and reselects the saved note.

## 4) State Ownership

- Source lifecycle state (`ready`, `sourcePath`, `sourceWritable`, `sourceSelected`): `useApp`.
- Canonical note list (`notes`): `useApp`.
- Active card selection (`activeNoteId`, `activeNoteOffset`): `useApp`.
- Sort mode (`latest`/`oldest`): `App` loaded screen.
- Editor open state and draft internals: `useEditorSession` + sub-hooks.
- Carousel local focus index: `TimeMachine` (derived from active note id).

## 5) Identity and Ordering Semantics

- `SourceNote.id` is currently line-derived in parser (`qn-${startLine}`).
- `SourceNote.offset` is newest-first relative position at parse time.
- UI ordering is not assumed from parser output; `orderNotes(notes, sortMode)` is the display source of truth.

Important invariant:

- Active note should be preserved by note id whenever possible.
- Fallback selection to boundary note should happen only when there is no valid active id in current notes.

## 6) Known Sharp Edges

- `SourceNote.id` is line-based; structural edits that shift lines can change ids.
- `activeNoteOffset` fallback is index-like and depends on parse-time offset semantics.
- Any effect that restores source or reparses file must not be keyed by fast-changing selection state.

## 7) Invariants for Future Changes

- Never let startup restore effects re-run due to navigation state changes.
- Keep sort mode pure display behavior; changing sort must not overwrite selection.
- Apply source-selection gating at screen level, not via scattered button flags.
- For selection sync, prefer a single setter path that updates all related state.

## 8) Before vs After (2026-04-11 Bug Fix)

### `use-app.ts`

Before:

- `applyParsed` closed over `activeNoteId` and `activeNoteOffset`.
- Startup restore effect could re-run when selection changed.
- Selection writes happened through multiple direct setters.

After:

- `applyParsed` reads `activeNoteIdRef` and `activeNoteOffsetRef`.
- Startup restore is stable and does not re-run from card navigation.
- All selection writes flow through `setActiveSelection`.

### `note-order.ts` + `TimeMachine.tsx`

Before:

- Display ordering was effectively always latest-first.
- Sort mode selection did not truly change ordering behavior.

After:

- `orderNotes(notes, sortMode)` is the canonical ordering function.
- `TimeMachine` consumes `sortMode` and derives focus from the active note id in that order.

### `App.tsx`

Before:

- Source gating was spread across controls (`disabled={!sourceSelected}`).
- Startup/boundary selection logic could overwrite user navigation state.

After:

- Screen-level gating:
  - `SourceSelectionScreen` if source missing.
  - `LoadedSourceApp` only when source exists.
- Boundary fallback selection only occurs when active selection is missing.
