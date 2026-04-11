// Event table schema initialization

import type { PlatformDatabase } from '../platform/types'

export async function initEventSchema(db: PlatformDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      page_id TEXT,
      payload TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'local',
      parent_event_id TEXT,
      lamport_clock INTEGER,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_page ON events(page_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  `)
}
