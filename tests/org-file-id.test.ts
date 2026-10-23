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

  it('keeps child lineage attached when a newly created root timestamp changes', () => {
    const original = parseQuickNoteFile('', SOURCE_PATH)
    const { parsed: withRoot, entry: root } = appendQuickNoteEntry(original, {
      title: 'Root',
      timestamp: '[2026-04-11 Sat 10:00:01 +0000]',
      body: 'root body',
    })

    expect(root.noteUid).toMatch(/^qnuid-/)
    expect(root.parentNoteId).toBeNull()

    const { parsed: withChild, entry: child } = appendQuickNoteEntry(withRoot, {
      title: 'Child',
      timestamp: '[2026-04-11 Sat 10:00:02 +0000]',
      body: 'child body',
      parentNoteId: root.noteUid,
    })
    const originalRootId = root.id

    const { parsed: updated, entry: editedRoot } = updateQuickNoteEntry(
      withChild,
      originalRootId,
      {
        title: root.title,
        timestamp: '[2026-04-11 Sat 11:30:00 +0000]',
        tags: root.tags,
        body: root.body,
      },
    )

    expect(editedRoot.id).not.toBe(originalRootId)
    expect(editedRoot.noteUid).toBe(root.noteUid)
    expect(updated.entries.find((entry) => entry.id === child.id)?.parentNoteId).toBe(root.noteUid)
    expect(updated.entries.some((entry) => entry.noteUid === child.parentNoteId)).toBe(true)
  })

  it('keeps legacy root notes without lineage metadata editable', () => {
    const parsed = parseQuickNoteFile(
      [
        '* Legacy root [2026-04-11 Sat 10:00:01 +0000]',
        'legacy body',
        '',
      ].join('\n'),
      SOURCE_PATH,
    )
    const legacyRoot = parsed.entries[0]!

    const { parsed: updated, entry } = updateQuickNoteEntry(parsed, legacyRoot.id, {
      title: legacyRoot.title,
      timestamp: '[2026-04-11 Sat 11:30:00 +0000]',
      tags: legacyRoot.tags,
      body: legacyRoot.body,
    })

    expect(entry.noteUid).toMatch(/^qnuid-/)
    expect(entry.parentNoteId).toBeNull()
    expect(updated.content).toContain(':PROPERTIES:')
    expect(entry.versions?.[0]?.body).toBe('legacy body')
  })

  it('backfills a stable UID when a legacy branch is saved for handoff', () => {
    const parsed = parseQuickNoteFile(
      [
        '* Legacy branch [2026-04-11 Sat 10:00:02 +0000]',
        ':PROPERTIES:',
        ':BRANCH_CONTINUE_PARENT_NOTE_ID: qnuid-parent-1',
        ':END:',
        'legacy branch body',
        '',
      ].join('\n'),
      SOURCE_PATH,
    )
    const legacyBranch = parsed.entries[0]!
    expect(legacyBranch.noteUid).toBeNull()

    const { entry } = updateQuickNoteEntry(parsed, legacyBranch.id, {
      title: legacyBranch.title,
      timestamp: legacyBranch.timestamp ?? undefined,
      tags: legacyBranch.tags,
      body: legacyBranch.body,
      parentNoteId: legacyBranch.parentNoteId,
    })

    expect(entry.noteUid).toMatch(/^qnuid-/)
    expect(entry.parentNoteId).toBe('qnuid-parent-1')
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

  it('persists a bounded branch disposition without placing it in note text', () => {
    const original = parseQuickNoteFile('', SOURCE_PATH)
    const { parsed: withBranch, entry: branch } = appendQuickNoteEntry(original, {
      title: 'A side thought',
      timestamp: '[2026-04-11 Sat 10:00:02 +0000]',
      body: 'Keep this exact thought.',
      parentNoteId: 'qnuid-parent-1',
      disposition: 'retained',
    })

    expect(branch.disposition).toBe('retained')
    expect(branch.body.trimEnd()).toBe('Keep this exact thought.')
    expect(withBranch.content).toContain(':BRANCH_CONTINUE_DISPOSITION: retained')

    const { parsed: handedOff, entry } = updateQuickNoteEntry(withBranch, branch.id, {
      title: branch.title,
      timestamp: branch.timestamp ?? undefined,
      tags: branch.tags,
      body: branch.body,
      disposition: 'handed-off',
    })

    expect(entry.disposition).toBe('handed-off')
    expect(handedOff.content).toContain(':BRANCH_CONTINUE_DISPOSITION: handed-off')
    expect(handedOff.content).not.toContain(':BRANCH_CONTINUE_DISPOSITION: retained')
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
