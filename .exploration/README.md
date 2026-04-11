# Exploration Log

Exploration is the magnification of the mind by utilizing the breadth of knowledge out there.

This directory captures insights, connections, and generative thinking across domains as we design Branch Continue.

## Files

- **01-actionable-information-system.md** — Core vision: capture, connect, retrieve. Three-tier retention strategy for lossless but efficient event storage.
- **02-sync-abstraction.md** — Sync protocol as an abstraction layer on top of the event log. Event schema ready for peer-to-peer, server, or offline-first.
- **03-key-terms-and-concepts.md** — Vocabulary and concepts: signal vs. noise, intent-driven events, provenance tracking, actionable information.

## Active Research Questions

1. How do existing systems (Roam, Logseq, Obsidian, Notion) capture and surface history?
2. What's the optimal compression format for keystroke chains, click sequences, navigation patterns?
3. Can Loro CRDT merge events from distributed users, or do we need an abstraction?
4. How to infer user intent from raw events (pauses, patterns, context)?
5. How to support "share thinking" while preserving privacy?

## Next Steps

- [ ] Ask domain experts about the three-tier retention model
- [ ] Research existing systems' approach to history and provenance
- [ ] Design final event schema with tier metadata
- [ ] Prototype hot-tier storage and queries
- [ ] Test event replay and reconstruction
