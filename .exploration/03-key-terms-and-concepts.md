# Key Terms and Concepts

## Information Architecture

### Capture
Every user action becomes an event. Raw and immediate.
- Keystroke, click, hover, scroll, branch, search, edit
- Goal: nothing actionable is lost

### Connect
Events are linked by causality and reference.
- `parent_event_id` — what caused this event?
- `card_id` — what domain object does this affect?
- `correlation_id` — what group does this belong to?
- Goal: reconstruct the thinking path

### Retrieve
Users query the event log to find actionable information.
- By content: "Find all edits to card X"
- By provenance: "What led to this idea?"
- By pattern: "When did I search for Y?"
- Goal: actionable information is discoverable

---

## Event Semantics

### Signal vs. Noise
- **Signal:** Changes state or reveals intent (keystroke that edits content, click on branch button)
- **Noise:** No state change or reveals nothing (cursor movement without selection, hover without action)
- **Filtering:** Raw events → tier assignment based on signal/noise ratio

### Intent-Driven
Events should encode *why the user acted*, not just *that they acted*.
- ✗ "user clicked at coordinates (142, 57)"
- ✓ "user clicked branch button after 800ms hover, intending to fork idea X"

### Semantic Events
Domain-level events that represent meaningful state changes.
- `card.created`, `card.branched`, `card.updated`, `search.executed`
- Derived from raw events via filtering
- Stored in hot tier

### Provenance Tracking
The answer to "why does this exist?"
- Card X exists because card Y was branched → event links Y→X via parent_event_id
- Event Y happened because event X triggered it → causation chain
- Goal: full causal history

---

## Storage and Retrieval

### Lossless Reconstruction
The event log is complete enough to replay the user's thinking.
- Hot tier: exact reconstruction
- Warm tier: approximate reconstruction (summaries, not raw)
- Cold tier: best-effort reconstruction (sampled)

### Queryability
Events are indexed for fast retrieval.
- FTS5 for text content search
- SQL indexes for card_id, timestamp, actor
- Tier-specific query strategies (hot = O(1), warm = O(n), cold = O(n) + sampling bias)

### Temporal Queries
"What was I doing at time T?"
- Events indexed by timestamp
- Lamport clock for causal ordering
- Snapshot of card state reconstructable at any point

---

## Sync and Distribution

### Lamport Clock
A logical timestamp that ensures deterministic event ordering without central authority.
- Each actor increments its own clock
- When receiving an event, update clock to max(local, remote) + 1
- Ensures the same event order everywhere

### Causal Links
Events reference their causes, preserving intent across the network.
- `parent_event_id` — direct causation ("keystroke caused card.updated")
- `correlation_id` — grouping ("all events in this branching session")
- Enables reconstruction of thinking even in distributed systems

### Sync Abstraction
The event log is sync-protocol-agnostic.
- Central server: pull/push via HTTP
- P2P: gossip via WebRTC
- Offline-first: local-only, sync when available
- All use the same event log format

---

## User Experience

### Actionable Information
The currency of the system.
- Not "data" (raw facts)
- Not "telemetry" (aggregated stats)
- But "actionable information" — things the user can do something with

Examples:
- "I wrote 200 words in card X before branching" — actionable (understand your thinking speed)
- "I branched 5 times from the same parent" — actionable (explore convergence patterns)
- "I searched for Z, then edited card Y" — actionable (find related ideas)

### Memory Palace
The thinking tool remembers what you did, why you did it, and lets you revisit your thinking process.
- Capture every decision point
- Connect related ideas
- Retrieve by exploration (browse, search, filter)

### Shared Experience
When you share with someone else, they see:
- Your final branching structure (what you concluded)
- Your edits and content (what you wrote)
- Optionally: your thinking process (why you branched, what you searched)
- Can fork your ideas and continue your thinking

---

## Open Research Questions

1. **Existing systems:** How do Roam, Logseq, Obsidian capture history? Do they store raw events or just snapshots?
2. **CRDT semantics:** Can Loro's character-level CRDT merge keystroke events from distributed users? Or do we need an abstraction layer?
3. **Intent inference:** Can we automatically infer intent from raw events (e.g., "user paused for 500ms" = thinking, not distraction)?
4. **Compression:** What's the smallest representation of "keystroke chain" that still preserves queryability?
5. **Privacy:** How to support "share thinking" while respecting privacy (e.g., share insights, hide raw keystrokes)?
