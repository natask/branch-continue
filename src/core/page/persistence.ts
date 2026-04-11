// SQLite persistence for page snapshots
// Ported from moav2 flow-persistence.ts

import type { PlatformDatabase } from '../platform/types'
import type { PageMeta, PageStatus } from './types'

export async function initPageTables(db: PlatformDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS page_snapshots (
      id TEXT PRIMARY KEY,
      title TEXT,
      snapshot BLOB NOT NULL,
      parent_page_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_page_status ON page_snapshots(status);
    CREATE INDEX IF NOT EXISTS idx_page_parent ON page_snapshots(parent_page_id);
    CREATE INDEX IF NOT EXISTS idx_page_updated ON page_snapshots(updated_at);
  `)
}

export async function savePageSnapshot(
  db: PlatformDatabase,
  pageId: string,
  title: string,
  snapshot: Uint8Array,
  parentPageId?: string,
  status: PageStatus = 'active',
): Promise<void> {
  const now = Date.now()
  const existing = await db.prepare('SELECT id FROM page_snapshots WHERE id = ?').get(pageId)

  if (existing) {
    await db.prepare(
      'UPDATE page_snapshots SET title = ?, snapshot = ?, parent_page_id = ?, status = ?, updated_at = ? WHERE id = ?',
    ).run(title, snapshot, parentPageId ?? null, status, now, pageId)
  } else {
    await db.prepare(
      'INSERT INTO page_snapshots (id, title, snapshot, parent_page_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(pageId, title, snapshot, parentPageId ?? null, status, now, now)
  }
}

export async function loadPageSnapshot(
  db: PlatformDatabase,
  pageId: string,
): Promise<Uint8Array | null> {
  const row = await db.prepare('SELECT snapshot FROM page_snapshots WHERE id = ?').get(pageId)
  if (!row) return null
  const blob = row.snapshot
  if (blob instanceof Uint8Array) return blob
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob)
  return null
}

export async function loadAllPageMeta(db: PlatformDatabase): Promise<PageMeta[]> {
  const rows = await db.prepare(
    'SELECT id, title, parent_page_id, status, created_at FROM page_snapshots ORDER BY updated_at DESC',
  ).all()

  return rows.map((r) => ({
    id: r.id as string,
    title: (r.title as string) ?? 'Untitled',
    createdAt: r.created_at as number,
    parentPageId: (r.parent_page_id as string | null) ?? undefined,
    status: (r.status as PageStatus) ?? 'active',
  }))
}

export async function deletePage(db: PlatformDatabase, pageId: string): Promise<void> {
  await db.prepare('DELETE FROM page_snapshots WHERE id = ?').run(pageId)
}

export async function updatePageStatus(
  db: PlatformDatabase,
  pageId: string,
  status: PageStatus,
): Promise<void> {
  await db.prepare('UPDATE page_snapshots SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    Date.now(),
    pageId,
  )
}
