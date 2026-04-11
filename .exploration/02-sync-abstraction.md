# Sync Protocol Abstraction

## Core Principle

**Sync is an abstraction layer on top of the event log, not the core model.**

The event log is the source of truth. How that log is synchronized (peer-to-peer, central server, hybrid) is implementation detail.

## Implications

### Current (Single-User, Browser)
- Event log lives in SQLite (wa-sqlite) in IndexedDB
- No sync needed

### Future (Multi-User, Server)
- Event log still lives in SQLite locally
- Sync protocol: export hot-tier events since `lamport_clock > N`, send to server, server syncs to other clients
- Server stores same event log (or a merged version)
- Other clients replay events in lamport_clock order
- Loro CRDT handles merging conflicts

### Future (P2P, No Server)
- Event log in SQLite, same format
- Sync protocol: WebRTC/IPFS instead of HTTP
- Lamport clock ensures deterministic ordering without central authority
- Warm/cold tiers may not sync (local-only for bandwidth savings)

## Key Requirements for Abstraction

1. **Deterministic ordering** — lamport_clock ensures events can be replayed in the same order everywhere
2. **Causal integrity** — parent_event_id links preserve "why" across the network
3. **Tier flexibility** — hot events must sync, warm/cold are optional
4. **Conflict-free merging** — Loro CRDT + deterministic ordering = no merge conflicts

## Event Log Schema (Sync-Ready)

```sql
events (
  id TEXT PRIMARY KEY,              -- actor:lamport_clock
  type TEXT NOT NULL,               -- card.created, card.updated, etc.
  card_id TEXT,
  payload TEXT NOT NULL,            -- JSON
  actor TEXT NOT NULL,              -- user ID or 'local'
  parent_event_id TEXT,             -- causal link
  lamport_clock INTEGER NOT NULL,   -- global ordering (deterministic)
  timestamp INTEGER NOT NULL,
  tier TEXT NOT NULL,               -- 'hot', 'warm', 'cold'
  synced BOOLEAN DEFAULT FALSE       -- tracks what's been sent
)
```

## Sync Protocol (Abstracted)

```typescript
interface SyncProvider {
  // What events are available to sync?
  getPendingEvents(since: lamportClock): Promise<Event[]>
  
  // Store received events
  applyRemoteEvents(events: Event[]): Promise<void>
  
  // Mark events as synced
  markSynced(eventIds: string[]): Promise<void>
}

// Implementation: ServerSync, P2PSync, OfflineSync all implement this interface
const syncProvider = new ServerSync({ serverUrl: 'https://...' })
await syncProvider.getPendingEvents(lastSeenClock)
```

## Action Steps

- [ ] Design the SyncProvider interface
- [ ] Implement OfflineSync (no-op, for current single-user phase)
- [ ] Research: How do Yjs, Automerge, or CRDTs handle multi-device sync?
- [ ] Plan ServerSync implementation (HTTP + WebSocket)
- [ ] Plan P2PSync implementation (WebRTC + DHT)
