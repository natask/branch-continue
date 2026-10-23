import { readConcepts, stripConceptMetadata } from './concepts'
import { createBackboneRecord, readBackboneRecord, readBackboneVersion, type BackboneActor, type BackboneRecord, type BackboneVersion } from './versions'

export type BackboneDomainEventType = 'concepts.changed' | 'audio.references-changed' | 'page.instructions-changed'
export interface BackboneLogEvent {
  id: string
  sequence?: number
  at: string
  noteUid: string
  actor: BackboneActor
  type: string
  payload: unknown
}
export interface ReplayedBackbonePage {
  version: BackboneVersion | null
  records: BackboneRecord[]
  concepts?: unknown
  audioReferences?: unknown
  instructions?: unknown
}

/** Persisted sequence defines causal order; old unsequenced records retain source order. */
export function readBackboneLog(sourceContent: string): BackboneLogEvent[] {
  const events: Array<BackboneLogEvent & { position: number }> = []
  for (const [position, line] of sourceContent.split(/\r?\n/).entries()) {
    const version = readBackboneVersion(line)
    if (version) events.push({ id: version.id, sequence: version.sequence, at: version.at, noteUid: version.noteUid, actor: version.actor, type: `page.${version.kind}`, payload: version, position })
    else {
      const record = readBackboneRecord(line)
      if (record) events.push({ ...record, position })
    }
  }
  const seen = new Set<string>()
  return events.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.position - b.position || a.id.localeCompare(b.id))
    .filter((event) => { if (seen.has(event.id)) return false; seen.add(event.id); return true })
    .map(({ position: _position, ...event }) => event)
}

export function replayBackboneLog(events: readonly BackboneLogEvent[]): Map<string, ReplayedBackbonePage> {
  const pages = new Map<string, ReplayedBackbonePage>()
  for (const event of events) {
    const page = pages.get(event.noteUid) ?? { version: null, records: [] }
    if (['page.created', 'page.edited', 'page.snapshot', 'page.restored'].includes(event.type)) {
      const version = event.payload as BackboneVersion
      if (version.noteUid !== event.noteUid || typeof version.body !== 'string') throw new Error('Invalid Backbone page event.')
      if (version.previousVersionId && page.version && version.previousVersionId !== page.version.id) throw new Error(`Backbone history has divergent versions at ${version.id}.`)
      page.version = { ...version, tags: [...version.tags] }
      page.concepts = readConcepts(version.body)
      page.audioReferences = audioReferences(version.body)
      page.instructions = readPageInstructions(version.body)
    } else {
      page.records.push({ ...event })
      const payload = event.payload as { after?: unknown } | null
      if (event.type === 'concepts.changed') page.concepts = payload?.after
      if (event.type === 'audio.references-changed') page.audioReferences = payload?.after
      if (event.type === 'page.instructions-changed') page.instructions = payload?.after
    }
    pages.set(event.noteUid, page)
  }
  return pages
}

export function readPageInstructions(body: string): string {
  const value = body.match(/^<!-- backbone-page-system:v1 (.*?) -->\n?/m)?.[1]
  if (!value) return ''
  try { const parsed: unknown = JSON.parse(decodeURIComponent(value)); return typeof parsed === 'string' ? parsed : '' } catch { return '' }
}
export function audioReferences(body: string): string[] {
  const visible = stripConceptMetadata(body).replace(/^<!-- backbone-page-system:v1 .*? -->\n?/m, '')
  return [...new Set(visible.match(/branch-continue-audio:\/\/[^\s)\]<>]+|(?:file:)?(?:[^\s\[\]<>]*\/)?[^\s\[\]<>]+\.(?:webm|wav|mp3|m4a|ogg|aac)(?:\?[^\s\]<>]*)?/gi) ?? [])].sort()
}
export function bodyChangeRecords(input: { noteUid: string; before: string; after: string; actor?: BackboneActor }): BackboneRecord[] {
  const fields: Array<[BackboneDomainEventType, unknown, unknown]> = [
    ['concepts.changed', readConcepts(input.before), readConcepts(input.after)],
    ['audio.references-changed', audioReferences(input.before), audioReferences(input.after)],
    ['page.instructions-changed', readPageInstructions(input.before), readPageInstructions(input.after)],
  ]
  return fields.filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after))
    .map(([type, before, after]) => createBackboneRecord({ noteUid: input.noteUid, actor: input.actor, type, payload: { before, after } }))
}

/** Assign a monotonic order to new fields without rewriting any existing history line. */
export function sequenceBackboneMetadata(lines: string[], sourceContent: string, existingCount = 0): string[] {
  let sequence = readBackboneLog(sourceContent).reduce((highest, event) => Math.max(highest, event.sequence ?? 0), 0)
  return lines.map((line, index) => {
    if (index < existingCount) return line
    const version = readBackboneVersion(line)
    const record = version ? null : readBackboneRecord(line)
    const event = version ?? record
    if (!event) return line
    sequence++
    return (version ? '#+BACKBONE_EVENT: ' : '#+BACKBONE_RECORD: ') + JSON.stringify({ ...event, sequence })
  })
}
