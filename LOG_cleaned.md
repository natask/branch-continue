# Branch Continue

A branching notebook where markdown cards fork into divergent continuations.

## Core primitives

- **Card** — A full-screen markdown document persisted as a file.
- **Branch** — Fork any card into a new lineage. Backed by Loro CRDT and SQLite event history.
- **Search** — Index and retrieve cards using the composite scoring engine from moav2 (`@moa.os/search`).
- **Auto-categorization** — Classify cards by content.

## Reuse from moav2

- `moa-os/search` — 4-factor search (exact, fuzzy, semantic, frecency).
- Event sourcing primitives — append-only event log with SQLite FTS5.
- Loro CRDT — document branching, undo/redo, snapshot persistence.
