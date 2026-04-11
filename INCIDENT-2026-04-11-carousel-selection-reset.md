# Incident: Carousel Selection Reset to Latest

Date: 2026-04-11  
Area: note carousel navigation + source restore + ordering

## Symptom

While scrolling cards in `TimeMachine`, focus/selection intermittently jumped back to the latest card.

## Why The Codebase Was Not Working

This bug was a composition issue across three places, not one isolated line.

## Root Cause 1 (Primary)

File: `src/ui/hooks/use-app.ts`

- The startup restore effect depends on `applyParsed`.
- `applyParsed` previously depended on `activeNoteId` and `activeNoteOffset`.
- Every card selection change updated `activeNoteId`/`activeNoteOffset`, which recreated `applyParsed`.
- Recreated `applyParsed` retriggered the restore effect.
- Restore path calls `applyParsed(..., null)`, which intentionally selects first/latest note.

Result: normal scrolling could trigger a re-restore cycle that reset selection to latest.

### Fix

- Introduced `activeNoteIdRef` and `activeNoteOffsetRef`.
- Made `applyParsed` read refs instead of capturing selection state in callback deps.
- Kept a single selection setter (`setActiveSelection`) to update both refs and React state.

Net effect: startup restore no longer re-runs on selection changes.

## Root Cause 2

Files:

- `src/ui/lib/note-order.ts`
- `src/ui/components/TimeMachine.tsx`
- `src/App.tsx`

- `sortMode` existed in UI but ordering function always returned latest-first.
- Sort toggles could create confusing movement because display order did not match mode.

### Fix

- `orderNotes(notes, sortMode)` now supports both `latest` and `oldest`.
- `TimeMachine` now takes `sortMode` and uses sorted notes from that mode.

## Root Cause 3

File: `src/App.tsx`

- Previous startup/boundary logic forced explicit boundary reselection.
- That behavior could overwrite user navigation.

### Fix

- Removed startup boundary reselection pattern.
- Fallback select now happens only when active note is missing from current notes.

## Root Cause 4 (UX/Architecture Smell)

File: `src/App.tsx`

- Source gating was distributed across many controls (`disabled={!sourceSelected}`).
- This increased conditional complexity and made state interactions harder to reason about.

### Fix

- Added screen-level gating:
  - `SourceSelectionScreen` when no source.
  - `LoadedSourceApp` when source exists.

The interactive UI does not render unless a source is selected.

## Files Changed For This Fix

- `src/ui/hooks/use-app.ts`
- `src/ui/lib/note-order.ts`
- `src/ui/components/TimeMachine.tsx`
- `src/App.tsx`

## Before vs After Snapshot

### Behavior

Before:

- Scrolling could unexpectedly snap focus back to latest.
- Sort toggle could look inconsistent because ordering logic ignored mode.
- Source gating logic was distributed and harder to reason about.

After:

- Scrolling keeps active selection unless note truly disappears.
- Sort mode changes the rendered order deterministically.
- Source gating is screen-level, reducing conditional UI branches.

### State/Effect Coupling

Before:

- Restore lifecycle and active selection were coupled through callback dependencies.

After:

- Restore lifecycle is decoupled from fast-changing selection state via refs.

### Selection Write Path

Before:

- Mixed direct writes to `activeNoteId` and `activeNoteOffset`.

After:

- Unified write path via `setActiveSelection` keeps refs/state in sync.

## Validation Performed

- TypeScript + production build succeeds with `pnpm build`.

## Regression Checks To Keep

1. Scroll carousel repeatedly and confirm no jump to latest.
2. Toggle sort mode and confirm currently selected note id stays selected.
3. Open editor, autosave, close editor, continue scrolling, confirm no reset.
4. Search-select a note and confirm it remains active after subsequent parse/update.
