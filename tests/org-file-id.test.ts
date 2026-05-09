import { describe, expect, it } from 'vitest'
import {
  appendQuickNoteEntry,
  parseQuickNoteFile,
  searchQuickNoteFile,
  updateQuickNoteEntry,
} from '../src/core/quicknote/org-file'

const SOURCE_PATH = 'quicknote.org'

describe('parseQuickNoteFile note ids', () => {
  it('uses timestamp-based ids for timestamped notes', () => {
    const content = [
      '* First [2026-04-11 Sat 10:00:00 +0000]',
      'a',
      '',
      '* Second [2026-04-11 Sat 10:00:01 +0000]',
      'b',
      '',
    ].join('\n')

    const parsed = parseQuickNoteFile(content, SOURCE_PATH)
    expect(parsed.entries.length).toBe(2)
    expect(parsed.entries.every((entry) => entry.id.startsWith('qn-ts-'))).toBe(true)
  })

  it('only splits on timestamped org headlines', () => {
    const content = [
      '* First [2026-04-11 Sat 10:00:00 +0000]',
      'body',
      '*',
      '* text',
      '** Nested without timestamp',
      'tail',
      '* Second [2026-04-11 Sat 10:00:01 +0000] extra :tag:',
      'second body',
      '',
    ].join('\n')

    const parsed = parseQuickNoteFile(content, SOURCE_PATH)
    const first = parsed.entries.find((entry) => entry.title === 'First')

    expect(parsed.entries.length).toBe(2)
    expect(first?.body).toContain('*\n* text\n** Nested without timestamp')
    expect(parsed.entries[0]?.title).toContain('extra')
    expect(parsed.entries[0]?.tags).toEqual(['tag'])
  })

  it('keeps ids stable when line numbers shift', () => {
    const content = [
      '* First [2026-04-11 Sat 10:00:00 +0000]',
      'a',
      '',
      '* Second [2026-04-11 Sat 10:00:01 +0000]',
      'b',
      '',
    ].join('\n')

    const original = parseQuickNoteFile(content, SOURCE_PATH)
    const shifted = parseQuickNoteFile(`\n${content}`, SOURCE_PATH)

    expect(shifted.entries.map((entry) => entry.id)).toEqual(
      original.entries.map((entry) => entry.id),
    )
  })

  it('keeps duplicate timestamps unique', () => {
    const content = [
      '* One [2026-04-11 Sat 10:00:00 +0000]',
      'a',
      '',
      '* Two [2026-04-11 Sat 10:00:00 +0000]',
      'b',
      '',
    ].join('\n')

    const parsed = parseQuickNoteFile(content, SOURCE_PATH)
    const ids = parsed.entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('parses lineage metadata from an org PROPERTIES drawer', () => {
    const content = [
      '* Child [2026-04-11 Sat 10:00:02 +0000]',
      ':PROPERTIES:',
      ':BRANCH_CONTINUE_NOTE_UID: qnuid-child-1',
      ':BRANCH_CONTINUE_PARENT_NOTE_ID: qn-ts-2026-04-11-sat-100001+0000',
      ':END:',
      '#branch',
      'branched body',
      '',
    ].join('\n')

    const parsed = parseQuickNoteFile(content, SOURCE_PATH)
    expect(parsed.entries.length).toBe(1)
    expect(parsed.entries[0]?.noteUid).toBe('qnuid-child-1')
    expect(parsed.entries[0]?.parentNoteId).toBe('qn-ts-2026-04-11-sat-100001+0000')
    expect(parsed.entries[0]?.body.trimEnd()).toBe('branched body')
  })

  it('writes and reparses lineage metadata when appending a branch note', () => {
    const original = parseQuickNoteFile(
      [
        '* Parent [2026-04-11 Sat 10:00:01 +0000]',
        'parent body',
        '',
      ].join('\n'),
      SOURCE_PATH,
    )

    const { parsed: appended, entry } = appendQuickNoteEntry(original, {
      title: 'Child',
      timestamp: '[2026-04-11 Sat 10:00:02 +0000]',
      body: 'child body',
      parentNoteId: original.entries[0]?.id ?? null,
      tags: ['branch'],
    })

    expect(entry.parentNoteId).toBe(original.entries[0]?.id)
    expect(entry.noteUid).toMatch(/^qnuid-/)
    expect(appended.content).toContain(':PROPERTIES:')
    expect(appended.content).toContain(':BRANCH_CONTINUE_PARENT_NOTE_ID:')
    expect(appended.content).toContain(':BRANCH_CONTINUE_NOTE_UID:')
    expect(appended.entries[0]?.parentNoteId).toBe(original.entries[0]?.id)
  })

  it('preserves lineage metadata on update when request omits lineage fields', () => {
    const content = [
      '* Child [2026-04-11 Sat 10:00:02 +0000]',
      ':PROPERTIES:',
      ':BRANCH_CONTINUE_NOTE_UID: qnuid-child-1',
      ':BRANCH_CONTINUE_PARENT_NOTE_ID: qn-ts-2026-04-11-sat-100001+0000',
      ':END:',
      'original body',
      '',
    ].join('\n')

    const parsed = parseQuickNoteFile(content, SOURCE_PATH)
    const note = parsed.entries[0]
    expect(note).toBeDefined()

    const { parsed: updated, entry } = updateQuickNoteEntry(parsed, note!.id, {
      title: 'Child Edited',
      timestamp: note!.timestamp ?? undefined,
      tags: note!.tags,
      body: 'updated body',
    })

    expect(entry.noteUid).toBe('qnuid-child-1')
    expect(entry.parentNoteId).toBe('qn-ts-2026-04-11-sat-100001+0000')
    expect(updated.content).toContain(':BRANCH_CONTINUE_NOTE_UID: qnuid-child-1')
    expect(updated.content).toContain(
      ':BRANCH_CONTINUE_PARENT_NOTE_ID: qn-ts-2026-04-11-sat-100001+0000',
    )
  })

  it('finds typo-tolerant text matches inside note bodies', () => {
    const parsed = parseQuickNoteFile(
      [
        '* First [2026-04-11 Sat 10:00:00 +0000]',
        'Quarterly planning notes include renewal strategy.',
        '',
        '* Second [2026-04-11 Sat 10:00:01 +0000]',
        'A precise search phrase should rank above unrelated text.',
        '',
      ].join('\n'),
      SOURCE_PATH,
    )

    const typoResults = searchQuickNoteFile(parsed, 'renwel strat')
    expect(typoResults[0]?.preview).toContain('renewal strategy')

    const literalResults = searchQuickNoteFile(parsed, 'precise search')
    expect(literalResults[0]?.preview).toContain('precise search phrase')
  })
})
