# Branch Continue — Sharpened Plan

## Product Goal

Build a thinking tool that lets a user write freely, branch ideas into divergent pages, traverse those pages as a tree, and search across everything quickly.

The MVP is not trying to solve collaborative editing, agent layering, or sync in full. It must, however, be shaped so those can be added without rewriting the storage model.

The long-term direction is:

- user thought is preserved as a sequence, not just a latest blob
- agents can inspect context and act on documents through a browser-side execution environment
- agent edits and human refinements can become separate layers instead of destructive replacement
- state can be replayed from events, while snapshots keep the product fast

---

## Scope

## MVP: What We Are Actually Building First

1. Write in a full-screen markdown page.
2. Create a new page.
3. Branch a page into a child page with copied starting content.
4. Traverse pages from a sidebar tree.
5. Search pages by title and content.
6. Persist data locally in the browser.
7. Record append-only events for major user actions.

## Explicitly Not In MVP

- multi-actor sync
- remote collaboration
- agent-authored edit layers
- fine-grained CRDT patch inspection in the UI
- command execution from agents
- semantic search
- paragraph-level search results if this slows first ship

---

## Product Principles

1. Working software first. The first version must feel usable as a thinking tool, not as infrastructure.
2. Preserve original thought. Even if the UI feels simple, storage should avoid forcing destructive history loss.
3. Snapshots for speed, events for history. Rebuildability matters, but the app must stay fast.
4. Clear separation between document state, event log, and future overlays.
5. Small service boundaries now so future agent features can plug in cleanly.

---

## Architecture Direction

## Current System Shape

For MVP, each page has:

- a current materialized document state
- persisted snapshots for fast load
- append-only events for important actions

This means the app reads mostly from snapshots and metadata, while the event log acts as history and future foundation.

## Future System Shape

Later, we want:

- events replayed to reconstruct page state
- snapshots as cached checkpoints, not the only source of truth
- CRDT-backed edits represented as smaller operations over time
- overlays that reference a base page or base revision
- agent actions stored as distinct authored layers rather than silent replacements

That future direction should influence naming and interfaces now, but it should not bloat the MVP.

---

## Core Concepts

## Page

The user-facing unit. A page is a node in a tree and has a parent pointer when branched.

## Snapshot

A fast-load serialized representation of the latest materialized page state.

## Event

An append-only record of something that happened: page created, branched, title changed, content saved, search run.

## Revision

Not a full MVP feature yet, but the system should reserve room for identifying materialized states over time.

## Overlay

Not an MVP feature yet. A future overlay is a separate authored layer referencing a base page or revision. It may come from a user refinement pass or an agent operation.

---

## Data Model

## Page Document

For MVP, each page is backed by a `LoroDoc` with three root containers:

```ts
LoroDoc {
  meta: LoroMap {
    id: string
    title: string
    createdAt: number
    parentPageId?: string
    status: 'active' | 'archived'
  }
  content: LoroText
  view: LoroMap {
    cursorPosition?: number
    scrollTop?: number
  }
}
```

Notes:

- `content` is a single markdown text field for MVP.
- `view` is UI state only.
- no overlay containers inside the document yet

## SQLite: `page_snapshots`

```sql
CREATE TABLE page_snapshots (
  id TEXT PRIMARY KEY,
  title TEXT,
  snapshot BLOB NOT NULL,
  parent_page_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

This is the main read path for MVP.

## SQLite: `events`

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  page_id TEXT,
  payload TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'local',
  parent_event_id TEXT,
  lamport_clock INTEGER,
  timestamp INTEGER NOT NULL
);
```

Important:

- `parent_event_id` and `lamport_clock` exist as forward-compatible fields
- MVP does not depend on distributed correctness for these fields
- we can initially leave `lamport_clock` null or assign a simple local incrementing value

## Event Types For MVP

- `page.created`
- `page.branched`
- `page.content_saved`
- `page.title_changed`
- `page.archived`
- `search.executed`

Use coarse events first. Do not log every keystroke.

---

## Why Loro In MVP

We are using `loro-crdt` now for two reasons:

1. it gives us a durable document model with future-friendly edit semantics
2. it makes the future move toward non-destructive patch-based editing easier

We are not using it yet for full multi-actor collaboration. For MVP, it behaves mainly as a durable document container with export/import and local undo/redo potential.

---

## Storage Strategy

## MVP Read Path

1. list pages from `page_snapshots`
2. load active page snapshot
3. hydrate `LoroDoc`
4. render current title and markdown content

## MVP Write Path

1. user edits title or content
2. update in-memory `LoroDoc`
3. debounce save
4. export snapshot and upsert `page_snapshots`
5. append coarse event

## Future Read Path

1. replay events to a checkpoint or full state
2. apply overlays on top of a selected base revision
3. materialize effective content for the viewer/editor

This future path is not required in the first implementation, but service APIs should not prevent it.

---

## Search

## MVP Search

Use the `@moa.os/search` logic over an in-memory index of pages:

- title
- full content or truncated preview

Return page-level results only for first ship unless paragraph-level results are cheap.

## Future Search Direction

Later add:

- paragraph-level matches
- revision-aware search
- overlay-aware search
- agent action search

The current search layer should therefore be isolated from page persistence details.

---

## Agent Direction

This is not part of MVP implementation, but the plan should account for it.

## Future Agent Capabilities

- an agent can inspect page context and related pages
- an agent can run approved browser-side commands in an execution environment
- outputs from those commands can be surfaced back into the agent loop
- agent-authored changes should be attributable and separately stored

## Future Agent Editing Model

When an agent acts on a document, it should not silently replace the original page.

Preferred future model:

- base page remains addressable
- agent operation references base page or revision
- resulting edit is stored as an overlay, patch stream, or derived revision
- UI can later show original, edited, or merged view

This implies that current service boundaries should avoid assuming there is only one canonical authored version forever.

---

## Recommended Service Boundaries

Keep the first codebase small, but split responsibilities cleanly.

```text
core/
  platform/
    types.ts
    sqlite.ts

  page/
    types.ts
    loro-schema.ts
    persistence.ts

  events/
    types.ts
    schema.ts
    writer.ts
    reader.ts
    index.ts

  search/
    types.ts
    exact.ts
    fuzzy.ts
    compose.ts
    frecency.ts
    index.ts

  services/
    db.ts
    page-service.ts
    search-service.ts
```

Notes:

- keep `page-service` focused on current materialized pages
- keep `events` generic enough that future page, overlay, and agent events can share it
- do not add overlay services yet, but leave room for them later

---

## Revised Build Order

## Step 1: Scaffold

Create:

- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `src/styles/index.css`

## Step 2: Platform + Local Persistence

Port:

- platform DB interfaces
- `wa-sqlite` adapter

Initialize:

- `page_snapshots`
- `events`

## Step 3: Page Model

Implement:

- `createPageDoc`
- `loadPageDoc`
- `getPageMeta`
- `setPageMeta`
- `getContent`
- `setContent`
- `branchPageDoc`

## Step 4: Event Primitives

Implement a simplified event layer:

- append
- append batch
- query by page
- latest by type

Do not overbuild sync logic in this step.

## Step 5: Services

Implement:

- `createPage`
- `branchPage`
- `savePageContent`
- `renamePage`
- `archivePage`
- `loadPage`
- `listPages`
- `getTree`

These methods should emit events, but snapshots remain the main source for current state.

## Step 6: Search

Port the search package pieces needed for:

- exact scoring
- fuzzy scoring
- frecency
- composite ranking

Wire it against page title and content preview.

## Step 7: UI

Build:

- layout
- sidebar tree
- editor
- title field
- branch button
- new page button
- search palette

## Step 8: Tighten For Future Direction

Before calling MVP done, make sure:

- event payloads include enough page context to support future replay
- IDs and types are stable
- services do not assume a page can never have derived variants

---

## What To Port vs What To Adapt

## Port Mostly As-Is

- `moav2` `loro-schema.ts` as the starting shape
- `flow-persistence.ts` as the basis for `page_snapshots`
- `wa-sqlite-adapter.ts`
- `packages/search/src` pieces used for exact, fuzzy, compose, frecency

## Adapt, Do Not Copy Blindly

- `moav2` event primitives

Reason:

- the existing implementation is session-oriented
- this product is page-oriented
- the current plan wants forward-compatible fields for replay and sync

So the event code should be rewritten with the same spirit, not copied literally.

---

## Verification

## MVP Acceptance

1. `npm run dev` starts a usable app.
2. Empty state clearly prompts page creation.
3. Creating a page stores a snapshot and logs `page.created`.
4. Editing title and content updates the page after debounce.
5. Branching creates a child page with copied starting content.
6. Sidebar tree reflects parent-child structure.
7. Switching pages loads the correct materialized state.
8. Search finds pages by title and content.
9. Reloading the browser preserves pages and tree structure.

## Architecture Acceptance

Before we call the architecture sound, confirm:

1. page snapshots can be loaded without replaying events
2. events contain enough information to later support replay-based state derivation
3. nothing in the service layer assumes future agent edits must overwrite the base page

---

## Final Goal

The final goal is not just a note editor with branching.

It is a system where:

- you think in sequence
- branching preserves alternate lines of thought
- agents can work alongside that thinking
- agent actions are attributable and inspectable
- refinement does not erase origin
- history can be replayed, materialized, and searched

The MVP should feel simple.
The architecture should make that larger system possible.
