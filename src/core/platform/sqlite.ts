// wa-sqlite adapter for browser-based SQLite with IndexedDB persistence
// Ported from moav2/src/platform/shared/wa-sqlite-adapter.ts

import type { PlatformDatabase, PlatformStatement, PlatformSqlite } from './types'

// wa-sqlite v1 imports
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — wa-sqlite ships JS-only, no .d.ts
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
// @ts-ignore
import wasmUrl from 'wa-sqlite/dist/wa-sqlite-async.wasm?url'
// @ts-ignore
import * as SQLite from 'wa-sqlite'

class WaSqliteStatement implements PlatformStatement {
  constructor(
    private sqlite3: SQLiteAPI,
    private db: number,
    private sql: string,
  ) {}

  async run(...params: unknown[]): Promise<{ changes: number }> {
    for await (const stmt of this.sqlite3.statements(this.db, this.sql)) {
      if (params.length > 0) {
        this.sqlite3.bind_collection(stmt, params)
      }
      await this.sqlite3.step(stmt)
    }
    return { changes: this.sqlite3.changes(this.db) }
  }

  async get(...params: unknown[]): Promise<Record<string, unknown> | undefined> {
    const rows = await this.all(...params)
    return rows.length > 0 ? rows[0] : undefined
  }

  async all(...params: unknown[]): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = []
    for await (const stmt of this.sqlite3.statements(this.db, this.sql)) {
      if (params.length > 0) {
        this.sqlite3.bind_collection(stmt, params)
      }
      const columns = this.sqlite3.column_names(stmt)
      while ((await this.sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
        const row: Record<string, unknown> = {}
        for (let i = 0; i < columns.length; i++) {
          row[columns[i]] = this.sqlite3.column(stmt, i)
        }
        results.push(row)
      }
    }
    return results
  }
}

class WaSqliteDatabase implements PlatformDatabase {
  constructor(
    private sqlite3: SQLiteAPI,
    private db: number,
  ) {}

  async exec(sql: string): Promise<void> {
    await this.sqlite3.exec(this.db, sql)
  }

  prepare(sql: string): PlatformStatement {
    return new WaSqliteStatement(this.sqlite3, this.db, sql)
  }

  async close(): Promise<void> {
    await this.sqlite3.close(this.db)
  }
}

// Minimal type for the wa-sqlite C API surface we use
type SQLiteAPI = {
  statements(db: number, sql: string): AsyncIterable<number>
  bind_collection(stmt: number, params: unknown[] | Record<string, unknown>): number
  step(stmt: number): Promise<number>
  column_names(stmt: number): string[]
  column(stmt: number, i: number): unknown
  changes(db: number): number
  exec(db: number, sql: string): Promise<number>
  close(db: number): Promise<number>
  open_v2(name: string, flags?: number, vfs?: string): Promise<number>
  vfs_register(vfs: unknown, makeDefault?: boolean): number
}

export const waSqliteAdapter: PlatformSqlite = {
  async open(name: string): Promise<PlatformDatabase> {
    const module = await SQLiteESMFactory({
      locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file),
    })
    const api = SQLite.Factory(module) as unknown as SQLiteAPI

    const db = await api.open_v2(name)

    await api.exec(db, 'PRAGMA journal_mode = MEMORY')
    await api.exec(db, 'PRAGMA synchronous = OFF')
    await api.exec(db, 'PRAGMA foreign_keys = OFF')

    return new WaSqliteDatabase(api, db)
  },
}
