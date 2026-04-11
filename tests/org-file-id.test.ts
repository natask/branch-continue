import { describe, expect, it } from 'vitest'
import { parseQuickNoteFile } from '../src/core/quicknote/org-file'

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
})
