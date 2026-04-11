// LoroDoc schema for pages
// Ported from moav2 loro-schema.ts — adapted for page model

import { LoroDoc } from 'loro-crdt'
import type { PageMeta, PageStatus } from './types'

/**
 * Create a new LoroDoc with the page schema:
 *   meta: LoroMap { id, title, createdAt, parentPageId?, status }
 *   content: LoroText (markdown body)
 *   view: LoroMap { cursorPosition?, scrollTop? }
 */
export function createPageDoc(id: string, title?: string): LoroDoc {
  const doc = new LoroDoc()

  const meta = doc.getMap('meta')
  meta.set('id', id)
  meta.set('title', title ?? 'Untitled')
  meta.set('createdAt', Date.now())
  meta.set('status', 'active')

  // Touch content and view so the containers exist
  doc.getText('content')
  doc.getMap('view')

  doc.commit()
  return doc
}

/**
 * Read page metadata from a LoroDoc
 */
export function getPageMeta(doc: LoroDoc): PageMeta {
  const meta = doc.getMap('meta')
  return {
    id: meta.get('id') as string,
    title: meta.get('title') as string,
    createdAt: meta.get('createdAt') as number,
    parentPageId: meta.get('parentPageId') as string | undefined,
    status: (meta.get('status') as PageStatus) ?? 'active',
  }
}

/**
 * Update page metadata fields
 */
export function setPageMeta(
  doc: LoroDoc,
  updates: Partial<Pick<PageMeta, 'title' | 'status' | 'parentPageId'>>,
): void {
  const meta = doc.getMap('meta')
  if (updates.title !== undefined) meta.set('title', updates.title)
  if (updates.status !== undefined) meta.set('status', updates.status)
  if (updates.parentPageId !== undefined) meta.set('parentPageId', updates.parentPageId)
  doc.commit()
}

/**
 * Get markdown content from the page
 */
export function getContent(doc: LoroDoc): string {
  return doc.getText('content').toString()
}

/**
 * Replace the full content of a page.
 * For MVP we do a full replace; future versions will use granular ops.
 */
export function setContent(doc: LoroDoc, text: string): void {
  const content = doc.getText('content')
  const current = content.toString()
  if (current.length > 0) {
    content.delete(0, current.length)
  }
  if (text.length > 0) {
    content.insert(0, text)
  }
  doc.commit()
}

/**
 * Branch: create a new LoroDoc that starts with the content of an existing page.
 * Uses Loro export/import to get an independent copy.
 */
export function branchPageDoc(source: LoroDoc, newId: string, newTitle: string): LoroDoc {
  // Export the source snapshot
  const snapshot = source.export({ mode: 'snapshot' })

  // Import into a fresh doc
  const child = new LoroDoc()
  child.import(snapshot)

  // Overwrite metadata for the new page
  const meta = child.getMap('meta')
  meta.set('id', newId)
  meta.set('title', newTitle)
  meta.set('createdAt', Date.now())
  meta.set('parentPageId', source.getMap('meta').get('id') as string)
  meta.set('status', 'active')

  child.commit()
  return child
}
