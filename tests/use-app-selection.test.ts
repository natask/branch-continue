import { describe, expect, it } from 'vitest'
import type { SourceNote } from '../src/core/quicknote/types'
import { resolveActiveSelection } from '../src/ui/hooks/use-app-selection'

function note(id: string, offset: number): SourceNote {
  return {
    id,
    offset,
    sourcePath: 'quicknote.org',
    startLine: offset + 1,
    endLine: offset + 2,
    rawHeadline: `headline-${id}`,
    title: id,
    timestamp: `[2026-04-11 Sat 12:00:0${offset} +0000]`,
    tags: [],
    body: `body-${id}`,
    preview: `preview-${id}`,
  }
}

describe('resolveActiveSelection', () => {
  const notes = [note('a', 0), note('b', 1), note('c', 2)]

  it('keeps current active note when still present', () => {
    const selected = resolveActiveSelection({
      notes,
      preferredNoteId: undefined,
      currentActiveNoteId: 'b',
      currentActiveNoteOffset: 0,
    })
    expect(selected?.id).toBe('b')
  })

  it('chooses preferred note id when provided', () => {
    const selected = resolveActiveSelection({
      notes,
      preferredNoteId: 'c',
      currentActiveNoteId: 'a',
      currentActiveNoteOffset: 0,
    })
    expect(selected?.id).toBe('c')
  })

  it('falls back to offset when current id is missing', () => {
    const selected = resolveActiveSelection({
      notes,
      preferredNoteId: undefined,
      currentActiveNoteId: 'missing',
      currentActiveNoteOffset: 2,
    })
    expect(selected?.id).toBe('c')
  })

  it('resets to first parsed note only on explicit null preferred id', () => {
    const selected = resolveActiveSelection({
      notes,
      preferredNoteId: null,
      currentActiveNoteId: 'c',
      currentActiveNoteOffset: 2,
    })
    expect(selected?.id).toBe('a')
  })
})
