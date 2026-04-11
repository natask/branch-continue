import { describe, expect, it } from 'vitest'
import type { SourceNote } from '../src/core/quicknote/types'
import { orderNotes, resolveBoundaryNote } from '../src/ui/lib/note-order'

function note(id: string, startLine: number): SourceNote {
  return {
    id,
    offset: 0,
    sourcePath: 'quicknote.org',
    startLine,
    endLine: startLine + 1,
    rawHeadline: id,
    title: id,
    timestamp: null,
    tags: [],
    body: '',
    preview: '',
  }
}

describe('orderNotes', () => {
  const notes = [note('oldest', 3), note('middle', 10), note('latest', 40)]

  it('always orders oldest-first so latest stays last', () => {
    expect(orderNotes(notes).map((entry) => entry.id)).toEqual([
      'oldest',
      'middle',
      'latest',
    ])
  })
})

describe('resolveBoundaryNote', () => {
  const notes = [note('oldest', 3), note('middle', 10), note('latest', 40)]
  const ordered = orderNotes(notes)

  it('maps latest mode to latest note', () => {
    expect(resolveBoundaryNote(ordered, 'latest')?.id).toBe('latest')
  })

  it('maps oldest mode to oldest note', () => {
    expect(resolveBoundaryNote(ordered, 'oldest')?.id).toBe('oldest')
  })
})
