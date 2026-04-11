// Database initialization — single entry point for all schema setup

import type { PlatformDatabase } from '../platform/types'
import { waSqliteAdapter } from '../platform/sqlite'
import { initPageTables } from '../page/persistence'
import { initEventSchema } from '../events/schema'

let dbPromise: Promise<PlatformDatabase> | null = null

export function getDatabase(): Promise<PlatformDatabase> {
  if (!dbPromise) {
    dbPromise = initDatabase()
  }
  return dbPromise
}

async function initDatabase(): Promise<PlatformDatabase> {
  const db = await waSqliteAdapter.open('branch-continue')
  await initPageTables(db)
  await initEventSchema(db)
  return db
}
