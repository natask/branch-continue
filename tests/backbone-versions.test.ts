import { describe, expect, it } from 'vitest'
import { appendQuickNoteEntry, parseQuickNoteFile, searchQuickNoteFile, updateQuickNoteEntry } from '../src/core/quicknote/org-file'
import { createSourceFileCommand, emptySourceFileHistory, appendSourceFileCommand, undoSourceFileCommand, redoSourceFileCommand, canUndoSourceFile } from '../src/core/history/source-file-history'
import { diffWords, replayBackboneVersions, VERSION_PREFIX } from '../src/core/backbone/versions'

const initial = () => appendQuickNoteEntry(parseQuickNoteFile('', '/sync/notes.org'), {
  title: 'Thought', body: 'An initial thought.', tags: ['idea'],
})
describe('portable Backbone versions', () => {
  it('reopens complete snapshots from the same source and restores without losing later work', () => {
    const first = initial()
    const edited = updateQuickNoteEntry(first.parsed, first.entry.id, { body: 'A refined thought.', actor: 'codex' })
    const snapshot = updateQuickNoteEntry(edited.parsed, edited.entry.id, { body: edited.entry.body, versionKind: 'snapshot', versionLabel: 'Milestone' })
    const original = first.entry.versions![0]
    const restored = updateQuickNoteEntry(snapshot.parsed, snapshot.entry.id, { body: original.body, title: original.title, tags: original.tags, versionKind: 'restored', restoredFrom: original.id })
    const reopened = parseQuickNoteFile(restored.parsed.content, '/another-device/notes.org').entries[0]
    expect(reopened.versions?.map((version) => version.kind)).toEqual(['created', 'edited', 'snapshot', 'restored'])
    expect(reopened.versions?.[1].actor).toBe('codex')
    expect(reopened.versions?.[2].label).toBe('Milestone')
    expect(reopened.versions?.[3].restoredFrom).toBe(original.id)
    expect(reopened.body.trim()).toBe(original.body)
    expect(reopened.noteUid).toBe(first.entry.noteUid)
    for (const line of snapshot.parsed.content.split('\n').filter((line) => line.startsWith(VERSION_PREFIX))) expect(restored.parsed.content).toContain(line)
    expect(searchQuickNoteFile(restored.parsed, 'refined')).toEqual([])
  })
  it('preserves old documents and captures their baseline on first edit', () => {
    const legacy = parseQuickNoteFile('* Legacy [2026-01-01 Thu 12:00]\nOld text.\n', 'legacy.org')
    expect(legacy.entries[0].versions).toEqual([])
    const next = updateQuickNoteEntry(legacy, legacy.entries[0].id, { body: 'New text.' })
    expect(next.entry.versions?.map((version) => version.body)).toEqual(['Old text.', 'New text.'])
    expect(next.entry.versions?.[0].actor).toBe('system')
  })
  it('keeps attachment paths and multiline text intact and avoids duplicate unchanged saves', () => {
    const first = initial()
    const body = 'Audio [[file:audio/voice.webm]]\n\nA paragraph.\n<!-- backbone-concepts:v1\n{}\n-->'
    const edited = updateQuickNoteEntry(first.parsed, first.entry.id, { body })
    const unchanged = updateQuickNoteEntry(edited.parsed, edited.entry.id, { body })
    expect(unchanged.entry.versions).toEqual(edited.entry.versions)
    expect(unchanged.entry.body.trimEnd()).toBe(body)
  })
  it('retains unknown or malformed records verbatim when editing', () => {
    const first = initial()
    const content = first.parsed.content + '#+BACKBONE_EVENT: {future schema}\n'
    const parsed = parseQuickNoteFile(content, 'notes.org')
    const edited = updateQuickNoteEntry(parsed, parsed.entries[0].id, { body: 'Updated' })
    expect(edited.parsed.content).toContain('#+BACKBONE_EVENT: {future schema}')
    expect(edited.entry.body).not.toContain('future schema')
  })
})
describe('word overlays', () => {
  it('reconstructs both versions, including whitespace and punctuation', () => {
    const before = 'A simple idea.\nSecond paragraph.'
    const after = 'A clear idea.\n\nSecond paragraph!'
    const diff = diffWords(before, after)
    expect(diff.filter((part) => part.type !== 'added').map((part) => part.text).join('')).toBe(before)
    expect(diff.filter((part) => part.type !== 'removed').map((part) => part.text).join('')).toBe(after)
    expect(diff.some((part) => part.type === 'added')).toBe(true)
  })
})

describe('append-only file undo', () => {
  it('undoes and redoes edits by adding restores while retaining all prior events', () => {
    const first = initial()
    const edited = updateQuickNoteEntry(first.parsed, first.entry.id, { body: 'Changed.' })
    const command = createSourceFileCommand({ before: first.parsed.content, after: edited.parsed.content, kind: 'update-note', label: 'Change', noteId: first.entry.noteUid! })!
    const state = appendSourceFileCommand(emptySourceFileHistory('notes.org'), command)
    const undo = undoSourceFileCommand(state, edited.parsed.content)!
    const undone = parseQuickNoteFile(undo.content, 'notes.org').entries[0]
    expect(undone.body.trimEnd()).toBe(first.entry.body.trimEnd())
    expect(undone.versions).toHaveLength(3)
    const redo = redoSourceFileCommand(undo.state, undo.content)!
    const redone = parseQuickNoteFile(redo.content, 'notes.org').entries[0]
    expect(redone.body.trimEnd()).toBe('Changed.')
    expect(redone.versions).toHaveLength(4)
    for (const version of edited.entry.versions!) expect(redone.versions).toContainEqual(version)
  })
  it('undoes creation by recording a discarded disposition and retains creation history', () => {
    const first = initial()
    const command = createSourceFileCommand({ before: '', after: first.parsed.content, kind: 'create-note', label: 'Create', noteId: first.entry.noteUid! })!
    const state = appendSourceFileCommand(emptySourceFileHistory('notes.org'), command)
    const undo = undoSourceFileCommand(state, first.parsed.content)!
    expect(parseQuickNoteFile(undo.content, '').entries[0].disposition).toBe('discarded')
    const redo = redoSourceFileCommand(undo.state, undo.content)!
    const restored = parseQuickNoteFile(redo.content, '').entries[0]
    expect(restored.disposition).toBeNull()
    expect(restored.versions).toHaveLength(3)
  })
  it('refuses stale same-note undo and unsafe legacy offset commands', () => {
    const first = initial()
    const edited = updateQuickNoteEntry(first.parsed, first.entry.id, { body: 'Changed.' })
    const command = createSourceFileCommand({ before: first.parsed.content, after: edited.parsed.content, kind: 'update-note', label: 'Change', noteId: first.entry.noteUid! })!
    const state = appendSourceFileCommand(emptySourceFileHistory('notes.org'), command)
    const external = updateQuickNoteEntry(edited.parsed, edited.entry.id, { body: 'External edit.' })
    expect(canUndoSourceFile(state, external.parsed.content)).toBe(false)
    delete command.afterNote
    delete command.beforeNote
    expect(undoSourceFileCommand(state, edited.parsed.content)).toBeNull()
  })
  it('preserves unknown Org properties and shared media when restoring body text', () => {
    const source = '* Legacy [2026-01-01 Thu 12:00]\n:PROPERTIES:\n:CUSTOM_ID: my-reference\n:END:\n[[file:audio/recording.webm]]\n'
    const parsed = parseQuickNoteFile(source, '')
    const edited = updateQuickNoteEntry(parsed, parsed.entries[0].id, { body: 'Changed.' })
    const command = createSourceFileCommand({ before: source, after: edited.parsed.content, kind: 'update-note', label: 'Change', noteId: edited.entry.noteUid! })!
    const undo = undoSourceFileCommand(appendSourceFileCommand(emptySourceFileHistory(''), command), edited.parsed.content)!
    expect(undo.content).toContain(':CUSTOM_ID: my-reference')
    expect(parseQuickNoteFile(undo.content, '').entries[0].body).toContain('[[file:audio/recording.webm]]')
    expect(redoSourceFileCommand(undo.state, undo.content)).not.toBeNull()
  })
})

describe('event replay', () => {
  it('replays the portable state and captures externally edited materialized text before the next save', () => {
    const first = initial()
    const external = first.parsed.content.replace('An initial thought.\n', 'An external thought.\n')
    const parsed = parseQuickNoteFile(external, 'notes.org')
    const next = updateQuickNoteEntry(parsed, parsed.entries[0].id, { body: 'Final thought.' })
    expect(next.entry.versions?.map((version) => version.body)).toEqual(['An initial thought.', 'An external thought.', 'Final thought.'])
    expect(next.entry.versions?.[1].label).toBe('External source change')
    expect(replayBackboneVersions(next.entry.versions!)?.body).toBe(next.entry.body.trimEnd())
    expect(next.entry.versions?.[2].previousVersionId).toBe(next.entry.versions?.[1].id)
  })
  it('rejects divergent event chains instead of silently discarding a branch', () => {
    const versions = initial().entry.versions!
    expect(() => replayBackboneVersions([...versions, { ...versions[0], id: 'diverged', previousVersionId: 'unknown' }])).toThrow('divergent')
  })
})
