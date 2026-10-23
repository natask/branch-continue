import { describe, expect, it } from 'vitest'
import { appendQuickNoteEntry, parseQuickNoteFile, updateQuickNoteEntry } from '../src/core/quicknote/org-file'
import { readBackboneLog, replayBackboneLog } from '../src/core/backbone/log'
import { writeConcepts } from '../src/core/backbone/concepts'

describe('one portable Backbone stream', () => {
  it('replays multiple pages, concept changes, audio, instructions, and lineage from only the source text', () => {
    const first = appendQuickNoteEntry(parseQuickNoteFile('', 'source.org'), { body: 'Parent', title: 'Parent' })
    const child = appendQuickNoteEntry(first.parsed, { body: 'Child', title: 'Child', parentNoteId: first.entry.noteUid })
    const body = '<!-- backbone-page-system:v1 ' + encodeURIComponent(JSON.stringify('Refine only this idea.')) + ' -->\n' + writeConcepts('Child [[file:audio/voice.webm]]', [{ id: 'idea', parentId: null, title: 'Core idea', description: 'Meaning', sourceText: 'Child', outcome: 'Clear', createdAt: '2026-01-01', updatedAt: '2026-01-01' }])
    const changed = updateQuickNoteEntry(child.parsed, child.entry.id, { body, actor: 'codex', disposition: 'retained' })
    const events = readBackboneLog(changed.parsed.content)
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['page.created', 'page.edited', 'concepts.changed', 'audio.references-changed', 'page.instructions-changed']))
    const replay = replayBackboneLog(events)
    expect(replay.size).toBe(2)
    const page = replay.get(child.entry.noteUid!)!
    expect(page.version?.body).toBe(body)
    expect(page.version?.parentNoteId).toBe(first.entry.noteUid)
    expect(page.version?.disposition).toBe('retained')
    expect(page.instructions).toBe('Refine only this idea.')
    expect(page.audioReferences).toEqual(['file:audio/voice.webm'])
    expect(page.concepts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'idea' })]))
    expect(page.records.every((record) => record.actor === 'codex')).toBe(true)
    expect(readBackboneLog(changed.parsed.content)).toEqual(events)
  })
  it('records removals and restores complete domain state', () => {
    const first = appendQuickNoteEntry(parseQuickNoteFile('', ''), { body: '[[file:audio/voice.webm]]', title: 'Audio' })
    const removed = updateQuickNoteEntry(first.parsed, first.entry.id, { body: 'Text only.' })
    const restored = updateQuickNoteEntry(removed.parsed, removed.entry.id, { body: first.entry.body, versionKind: 'restored', restoredFrom: first.entry.versions![0].id })
    expect(replayBackboneLog(readBackboneLog(removed.parsed.content)).get(first.entry.noteUid!)?.audioReferences).toEqual([])
    expect(replayBackboneLog(readBackboneLog(restored.parsed.content)).get(first.entry.noteUid!)?.audioReferences).toEqual(['file:audio/voice.webm'])
  })
  it('creates only one user event for an untitled note edit', () => {
    const first = appendQuickNoteEntry(parseQuickNoteFile('', ''), { body: 'Initial' })
    const next = updateQuickNoteEntry(first.parsed, first.entry.id, { body: 'Changed' })
    expect(next.entry.versions).toHaveLength(2)
    expect(next.entry.versions?.map((version) => version.actor)).toEqual(['user', 'user'])
  })
})

describe('causal event order', () => {
  it('replays correctly when another device clock moves backwards', async () => {
    const { vi } = await import('vitest')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2035-01-01T00:00:00Z'))
      const first = appendQuickNoteEntry(parseQuickNoteFile('', ''), { body: 'Future clock', title: 'First' })
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'))
      const second = appendQuickNoteEntry(first.parsed, { body: 'Second page', title: 'Second' })
      const changed = updateQuickNoteEntry(second.parsed, first.entry.id, { body: 'Past clock [[file:audio/voice.webm]]' })
      const events = readBackboneLog(changed.parsed.content)
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
      expect(events[0].at > events[2].at).toBe(true)
      const page = replayBackboneLog(events).get(first.entry.noteUid!)!
      expect(page.version?.body).toBe('Past clock [[file:audio/voice.webm]]')
      expect(page.audioReferences).toEqual(['file:audio/voice.webm'])
    } finally { vi.useRealTimers() }
  })
  it('preserves old unsequenced history and continues its causal chain', () => {
    const first = appendQuickNoteEntry(parseQuickNoteFile('', ''), { body: 'Original', title: 'Old' })
    const legacy = first.parsed.content.replace(/,"sequence":\d+/g, '')
    const parsed = parseQuickNoteFile(legacy, '')
    const changed = updateQuickNoteEntry(parsed, parsed.entries[0].id, { body: 'Next' })
    const events = readBackboneLog(changed.parsed.content)
    expect(events[0].sequence).toBeUndefined()
    expect(events[1].sequence).toBe(1)
    expect(replayBackboneLog(events).get(first.entry.noteUid!)?.version?.body).toBe('Next')
  })
})
