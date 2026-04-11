import type { SourceNote } from '../../core/quicknote/types'

export type NoteSortMode = 'latest' | 'oldest'

export function orderNotes(notes: SourceNote[], sortMode: NoteSortMode = 'latest'): SourceNote[] {
  const multiplier = sortMode === 'latest' ? -1 : 1
  return [...notes].sort((a, b) => (a.startLine - b.startLine) * multiplier)
}

export function findNoteIndex(notes: SourceNote[], noteId: string | null): number {
  if (!noteId) return -1
  return notes.findIndex((note) => note.id === noteId)
}

export function formatNotePosition(
  notes: SourceNote[],
  noteId: string | null,
  totalCount: number,
): string {
  const index = findNoteIndex(notes, noteId)
  const total = totalCount || notes.length
  return index >= 0 ? `${index + 1} / ${total}` : `new / ${total}`
}
