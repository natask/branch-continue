// Page service — high-level orchestration for page CRUD
// Coordinates LoroDoc, SQLite persistence, and event logging

import { LoroDoc } from 'loro-crdt'
import type { PlatformDatabase } from '../platform/types'
import type { PageMeta } from '../page/types'
import type { EventWriter } from '../events/types'
import {
  createPageDoc,
  getPageMeta,
  setPageMeta,
  setContent,
  branchPageDoc,
} from '../page/loro-schema'
import {
  savePageSnapshot,
  loadPageSnapshot,
  loadAllPageMeta,
} from '../page/persistence'

function generatePageId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `pg-${ts}-${rand}`
}

export interface PageService {
  createPage(title?: string): Promise<{ id: string; doc: LoroDoc }>
  loadPage(id: string): Promise<LoroDoc | null>
  savePage(doc: LoroDoc): Promise<void>
  listPages(): Promise<PageMeta[]>
  updateTitle(doc: LoroDoc, title: string): Promise<void>
  updateContent(doc: LoroDoc, content: string): Promise<void>
  branchPage(sourceDoc: LoroDoc, newTitle: string): Promise<{ id: string; doc: LoroDoc }>
}

export function createPageService(db: PlatformDatabase, events: EventWriter): PageService {
  async function createPage(title?: string): Promise<{ id: string; doc: LoroDoc }> {
    const id = generatePageId()
    const doc = createPageDoc(id, title)

    const snapshot = doc.export({ mode: 'snapshot' })
    await savePageSnapshot(db, id, title ?? 'Untitled', snapshot)

    await events.append({
      type: 'page.created',
      pageId: id,
      payload: { title: title ?? 'Untitled' },
      actor: 'local',
    })

    return { id, doc }
  }

  async function loadPage(id: string): Promise<LoroDoc | null> {
    const snapshot = await loadPageSnapshot(db, id)
    if (!snapshot) return null

    const doc = new LoroDoc()
    doc.import(snapshot)
    return doc
  }

  async function savePage(doc: LoroDoc): Promise<void> {
    const meta = getPageMeta(doc)
    const snapshot = doc.export({ mode: 'snapshot' })
    await savePageSnapshot(db, meta.id, meta.title, snapshot, meta.parentPageId, meta.status)
  }

  async function listPages(): Promise<PageMeta[]> {
    return loadAllPageMeta(db)
  }

  async function updateTitle(doc: LoroDoc, title: string): Promise<void> {
    const meta = getPageMeta(doc)
    setPageMeta(doc, { title })
    await savePage(doc)

    await events.append({
      type: 'page.title_changed',
      pageId: meta.id,
      payload: { title },
      actor: 'local',
    })
  }

  async function updateContent(doc: LoroDoc, content: string): Promise<void> {
    const meta = getPageMeta(doc)
    setContent(doc, content)
    await savePage(doc)

    await events.append({
      type: 'page.content_saved',
      pageId: meta.id,
      payload: { length: content.length },
      actor: 'local',
    })
  }

  async function branchPage(
    sourceDoc: LoroDoc,
    newTitle: string,
  ): Promise<{ id: string; doc: LoroDoc }> {
    const newId = generatePageId()
    const child = branchPageDoc(sourceDoc, newId, newTitle)

    const snapshot = child.export({ mode: 'snapshot' })
    const sourceMeta = getPageMeta(sourceDoc)
    await savePageSnapshot(db, newId, newTitle, snapshot, sourceMeta.id)

    await events.append({
      type: 'page.branched',
      pageId: newId,
      payload: { parentPageId: sourceMeta.id, title: newTitle },
      actor: 'local',
    })

    return { id: newId, doc: child }
  }

  return { createPage, loadPage, savePage, listPages, updateTitle, updateContent, branchPage }
}
