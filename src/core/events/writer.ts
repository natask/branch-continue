// Event writer — append-only event log

import type { PlatformDatabase } from '../platform/types'
import type { EventWriter, NewPageEvent, PageEvent } from './types'

function generateId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}`
}

export function createWriter(db: PlatformDatabase): EventWriter {
  const insert = db.prepare(
    'INSERT INTO events (id, type, page_id, payload, actor, parent_event_id, lamport_clock, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )

  async function append(event: NewPageEvent): Promise<PageEvent> {
    const id = generateId()
    const timestamp = Date.now()
    await insert.run(
      id,
      event.type,
      event.pageId ?? null,
      JSON.stringify(event.payload),
      event.actor,
      event.parentEventId ?? null,
      event.lamportClock ?? null,
      timestamp,
    )
    return { ...event, id, timestamp }
  }

  async function appendBatch(events: NewPageEvent[]): Promise<PageEvent[]> {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const results: PageEvent[] = []
      for (const event of events) {
        results.push(await append(event))
      }
      await db.exec('COMMIT')
      return results
    } catch (err) {
      await db.exec('ROLLBACK')
      throw err
    }
  }

  return { append, appendBatch }
}
