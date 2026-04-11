# Actionable Information Management System

## Core Insight

Branch Continue is not primarily a "branching notebook" — it's a system for **capturing, connecting, and retrieving actionable information** generated through thinking.

The three core capabilities:
1. **Capture** — every actionable moment (text written, edits, branches, searches, patterns noticed)
2. **Connect** — relate ideas causally (provenance, why did I branch here?, what led to this?)
3. **Retrieve** — find actionable information by content, by provenance, by time, by connection

## Governing Principle

Event sourcing as the foundation serves **dual purpose**: 
- Lossless application usage (complete record of thinking process)
- Sync protocol abstraction (peer-to-peer or central server are implementation details, not the core model)

## The Central Tension

**Fear:** Information loss = lost possibility space = can't reconstruct thinking or find unexpected connections later.

**Cost:** Unbounded capture = storage explosion + cognitive overload + signal drowning in noise.

**Resolution:** Intelligent tiered retention with decay, compression, and multi-fidelity access.

---

## Three-Tier Event Retention Strategy

### Tier 1: Hot (Actionable)
- **What:** High-signal, domain-level events that changed state
- **Examples:** `card.created`, `card.branched`, `card.updated`, `search.executed`, `category.assigned`
- **Storage:** In-memory + SQLite (fast access)
- **Fidelity:** Full
- **Retention:** Infinite (or until explicitly deleted)
- **Query cost:** O(1) lookup, indexed
- **Rationale:** These are the artifacts and decisions — always matter

### Tier 2: Warm (Contextual)
- **What:** Medium-signal raw events summarized to patterns
- **Examples:** 
  - Keystroke chains → "typed 47 chars, 3 deletions, 2 pauses >500ms"
  - Click sequences → "clicked branch button after 800ms hover"
  - Navigation patterns → "visited cards X, Y, Z in sequence"
- **Storage:** SQLite (indexed, queried less frequently)
- **Fidelity:** Compressed (summaries, not raw)
- **Retention:** ~90 days (configurable)
- **Query cost:** O(n) scan, but queryable
- **Rationale:** Understanding *intent* and *thinking process* — matters for context, decays with time

### Tier 3: Cold (Sampled)
- **What:** Low-signal raw events, sampled or summarized
- **Examples:**
  - Cursor position → sampled 10% of events or summary "cursor ranged lines 5-12"
  - Scroll pixels → summary "scroll velocity: 3px/100ms"
  - Hover events → sampled (1 in 10), or summary "hovered 7 times"
- **Storage:** SQLite (compressed column store) or external archive
- **Fidelity:** Sampled or summarized (reconstructable but not exact)
- **Retention:** ~7 days (configurable)
- **Query cost:** O(n) with higher I/O, sample bias
- **Rationale:** Context for "what was visible when?" — useful for short-term debugging, discarded after

---

## Key Design Principles

### Zero Intentional Loss
Nothing is deleted — it's just compressed or sampled. If you later need the exact keystroke sequence from 60 days ago, you can query the summarized warm tier and reconstruct it (though with lower fidelity). If it's expired, you still have *evidence* it happened ("typing activity detected").

### Queryability
Every tier must be queryable to answer:
- "What was I working on at timestamp T?"
- "How did I arrive at idea X?"
- "What edits led to this version?"
- "What was I looking at when I branched?"

### Replay Capability
The event log must be complete enough to replay thinking:
- Hot tier: exact state reconstruction
- Warm tier: intent and process reconstruction
- Cold tier: approximate context reconstruction

### Configurability
Retention windows, sampling rates, and compression strategies should be **user-configurable** — some users may want infinite keystroke history, others may want aggressive sampling after 7 days.

---

## Event Categories & Tier Assignment

| Event Type | Tier | Compression | Retention | Rationale |
|------------|------|-------------|-----------|-----------|
| `card.created` | Hot | None | ∞ | First-class artifact |
| `card.updated` | Hot | None | ∞ | Content mutations |
| `card.branched` | Hot | None | ∞ | Critical decision point |
| `card.deleted` | Hot | None | ∞ | Audit trail |
| `card.categorized` | Hot | None | ∞ | Explicit classification |
| `search.executed` | Hot | None | ∞ | Intent signal |
| `keystroke_chain` | Warm | Summary | 90d | Process understanding |
| `click_sequence` | Warm | Summary | 90d | Interaction pattern |
| `navigation_path` | Warm | Summary | 90d | Thinking flow |
| `cursor_sample` | Cold | Sample (10%) | 7d | Context only |
| `scroll_sample` | Cold | Sample (10%) | 7d | Context only |
| `hover_sample` | Cold | Sample (10%) | 7d | Context only |

---

## Open Questions to Research

1. **Is this tier model sound for reconstructing user intent?**
2. **What compression format preserves queryability?** (Delta encoding? Columnar? Sketches?)
3. **How to handle sync with tiered events?** (Do cold tier events sync, or local-only?)
4. **Configurability:** Should retention/sampling be per-user, per-event-type, or both?
5. **Storage backend:** SQLite FTS5 for hot, columnar (Parquet?) for warm/cold?

## Action Steps

- [ ] Research existing systems: How do Roam, Logseq, Obsidian handle history? Do they capture this finely?
- [ ] Research event compression: What formats work for keystroke chains, click sequences?
- [ ] Ask domain experts: Get feedback on tier model and event categories
- [ ] Design event schema: Finalize the `Event` type with tier metadata
- [ ] Prototype tier storage: Test SQLite hot tier + columnar warm tier
- [ ] Test replay: Verify event log can reconstruct thinking for various queries
