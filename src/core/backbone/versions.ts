/** Portable Backbone records live inside the source document, never in a device cache. */
export type BackboneActor = 'user' | 'codex' | 'system'
export type BackboneVersionKind = 'created' | 'edited' | 'snapshot' | 'restored'
export interface BackboneVersion {
  id: string
  sequence?: number
  noteUid: string
  at: string
  actor: BackboneActor
  kind: BackboneVersionKind
  title: string
  body: string
  tags: string[]
  timestamp?: string | null
  parentNoteId?: string | null
  disposition?: 'retained' | 'discarded' | 'handed-off' | null
  previousVersionId?: string
  restoredFrom?: string
  label?: string
}
export interface BackboneRecord {
  id: string
  sequence?: number
  at: string
  noteUid: string
  type: string
  payload: unknown
  actor: BackboneActor
}
export const VERSION_PREFIX = '#+BACKBONE_EVENT: '
export const RECORD_PREFIX = '#+BACKBONE_RECORD: '
export function createBackboneRecord(input: Omit<BackboneRecord, 'id' | 'at' | 'actor'> & { actor?: BackboneActor }): BackboneRecord {
  return { ...input, id: createBackboneId(), at: new Date().toISOString(), actor: input.actor ?? 'user' }
}
export function createBackboneId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
export function readBackboneVersion(line: string): BackboneVersion | null {
  if (!line.startsWith(VERSION_PREFIX)) return null
  try {
    const value = JSON.parse(line.slice(VERSION_PREFIX.length)) as BackboneVersion
    return value && (value.sequence === undefined || (Number.isSafeInteger(value.sequence) && value.sequence > 0)) && typeof value.id === 'string' && typeof value.noteUid === 'string' &&
      typeof value.at === 'string' && typeof value.body === 'string' && typeof value.title === 'string' &&
      Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string') &&
      ['user', 'codex', 'system'].includes(value.actor) &&
      ['created', 'edited', 'snapshot', 'restored'].includes(value.kind) ? value : null
  } catch { return null }
}
export function readBackboneRecord(line: string): BackboneRecord | null {
  if (!line.startsWith(RECORD_PREFIX)) return null
  try {
    const value = JSON.parse(line.slice(RECORD_PREFIX.length)) as BackboneRecord
    return value && (value.sequence === undefined || (Number.isSafeInteger(value.sequence) && value.sequence > 0)) && typeof value.id === 'string' && typeof value.at === 'string' &&
      typeof value.noteUid === 'string' && typeof value.type === 'string' &&
      ['user', 'codex', 'system'].includes(value.actor) ? value : null
  } catch { return null }
}
export interface WordChange { type: 'equal' | 'added' | 'removed'; text: string }
/** Whitespace is retained so rendering the unchanged/added tokens reconstructs the new text. */
export function diffWords(before: string, after: string): WordChange[] {
  const a = before.match(/\s+|[^\s]+/g) ?? []
  const b = after.match(/\s+|[^\s]+/g) ?? []
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let aEnd = a.length, bEnd = b.length
  while (aEnd > prefix && bEnd > prefix && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd-- }
  const result: WordChange[] = []
  const add = (type: WordChange['type'], text: string) => {
    if (!text) return
    const previous = result[result.length - 1]
    if (previous?.type === type) previous.text += text
    else result.push({ type, text })
  }
  add('equal', a.slice(0, prefix).join(''))
  // Bound memory for very large notes; common prefix/suffix still display precisely.
  if ((aEnd - prefix) * (bEnd - prefix) > 500_000) {
    add('removed', a.slice(prefix, aEnd).join('')); add('added', b.slice(prefix, bEnd).join(''))
  } else {
    const width = bEnd - prefix + 1
    const table = new Uint32Array((aEnd - prefix + 1) * width)
    for (let i = aEnd - 1; i >= prefix; i--) for (let j = bEnd - 1; j >= prefix; j--) {
      const pos = (i - prefix) * width + j - prefix
      table[pos] = a[i] === b[j] ? 1 + table[pos + width + 1] : Math.max(table[pos + width], table[pos + 1])
    }
    let i = prefix, j = prefix
    while (i < aEnd || j < bEnd) {
      if (i < aEnd && j < bEnd && a[i] === b[j]) { add('equal', a[i++]); j++ }
      else if (i < aEnd && (j === bEnd || table[(i - prefix + 1) * width + j - prefix] >= table[(i - prefix) * width + j - prefix + 1])) add('removed', a[i++])
      else add('added', b[j++])
    }
  }
  add('equal', a.slice(aEnd).join(''))
  return result
}

/** Every event contains a materialized state; replay needs no device database or older file. */
export function replayBackboneVersions(versions: readonly BackboneVersion[]): BackboneVersion | null {
  let current: BackboneVersion | null = null
  const seen = new Set<string>()
  for (const version of versions) {
    if (seen.has(version.id)) continue
    if (current && version.noteUid !== current.noteUid) throw new Error('Cannot replay versions from different pages.')
    if (version.previousVersionId && current && version.previousVersionId !== current.id) {
      throw new Error(`Backbone history has divergent versions at ${version.id}.`)
    }
    current = version
    seen.add(version.id)
  }
  return current ? { ...current, tags: [...current.tags] } : null
}
