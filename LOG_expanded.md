# Branch Continue — Expanded Specification

## What it is

A canvas application for writing and thinking in branching markdown cards. Each card occupies the full screen and supports rich markdown rendering. At any point, a card can be **branched** — forking the document into a new lineage while preserving the original. This creates a tree of related thoughts that can be navigated, searched, and automatically categorized.

## Architecture

### Card Model

Each card is a Loro CRDT document containing:
- **Content** — Markdown text stored in a `LoroText`
- **Metadata** — Title, creation time, category, tags in a `LoroMap`
- **Parent reference** — Link to the card this was branched from (if any)

Cards are persisted as SQLite rows with Loro binary snapshots, enabling offline-first operation and conflict-free merging.

### Branching

Branching creates a new card initialized with the content of its parent. The parent-child relationship forms a tree. Each branch maintains its own edit history via Loro's built-in versioning, and supports undo/redo through `UndoManager`.

### Search

Reuses the `@moa.os/search` engine from moav2 — a zero-dependency TypeScript search with 4-factor scoring:

1. **Exact match** — Alias and prefix matching
2. **Fuzzy match** — DP-based scoring with boundary, streak, and camelCase bonuses
3. **Semantic** — Dot-product similarity (optional, requires embeddings)
4. **Frecency** — Recency-weighted access frequency

Score weights adapt by query length: short queries favor exact + frecency, long queries favor semantic + fuzzy.

### Auto-categorization

Cards are classified into categories based on content analysis. Categories emerge from the corpus rather than being predefined, using keyword extraction and topic clustering.

### Event History

All mutations (card creation, edits, branches, deletions) are recorded as append-only events in SQLite with FTS5 indexing. This enables:
- Full-text search across all historical content
- Replay and projection of card state at any point
- Causal linking between related operations

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Editor | Markdown editor with live preview |
| CRDT | loro-crdt (Rust WASM) |
| Persistence | SQLite (sql.js WASM) |
| Search | Pure TS (ported from @moa.os/search) |

## User Flow

1. Open the app to a blank canvas or the last active card
2. Write markdown content in the full-screen editor
3. Press "Branch" to fork the current card — a new card appears with the same content, ready for divergent editing
4. Navigate the branch tree in a sidebar to switch between cards
5. Search across all cards using the command palette
6. Cards are automatically categorized and tagged
