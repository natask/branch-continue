// Event reader — query the event log

import type { PlatformDatabase } from '../platform/types'
import type { EventReader, EventQueryOpts, PageEvent } from './types'

function rowToEvent(row: Record<string, unknown>): PageEvent {
  return {
    id: row.id as string,
    type: row.type as string,
    pageId: row.page_id as string | undefined,
    payload: JSON.parse(row.payload as string),
    actor: row.actor as string,
    parentEventId: row.parent_event_id as string | undefined,
    lamportClock: row.lamport_clock as number | undefined,
    timestamp: row.timestamp as number,
  }
}

export function createReader(db: PlatformDatabase): EventReader {
  async function query(opts: EventQueryOpts = {}): Promise<PageEvent[]> {
    const clauses: string[] = []
    const params: unknown[] = []

    if (opts.type) {
      if (opts.type.includes('*')) {
        clauses.push('type LIKE ?')
        params.push(opts.type.replace(/\*/g, '%'))
      } else {
        clauses.push('type = ?')
        params.push(opts.type)
      }
    }
    if (opts.pageId) {
      clauses.push('page_id = ?')
      params.push(opts.pageId)
    }
    if (opts.actor) {
      clauses.push('actor = ?')
      params.push(opts.actor)
    }
    if (opts.since) {
      clauses.push('timestamp >= ?')
      params.push(opts.since)
    }
    if (opts.until) {
      clauses.push('timestamp <= ?')
      params.push(opts.until)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = opts.limit ?? 100
    const offset = opts.offset ?? 0

    const sql = `SELECT * FROM events ${where} ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const rows = await db.prepare(sql).all(...params)
    return rows.map(rowToEvent)
  }

  async function getById(id: string): Promise<PageEvent | null> {
    const row = await db.prepare('SELECT * FROM events WHERE id = ?').get(id)
    return row ? rowToEvent(row) : null
  }

  async function count(type?: string): Promise<number> {
    if (type) {
      const row = await db.prepare('SELECT COUNT(*) as cnt FROM events WHERE type = ?').get(type)
      return (row?.cnt as number) ?? 0
    }
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM events').get()
    return (row?.cnt as number) ?? 0
  }

  return { query, getById, count }
}
