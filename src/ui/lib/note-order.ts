import type { SourceNote } from '../../core/quicknote/types'

export type NoteSortMode = 'latest' | 'oldest'

export function orderNotes(notes: SourceNote[]): SourceNote[] {
  return [...notes].sort((a, b) => a.startLine - b.startLine)
}

export function resolveBoundaryNote(
  notes: SourceNote[],
  sortMode: NoteSortMode,
): SourceNote | null {
  if (notes.length === 0) return null
  if (sortMode === 'latest') return notes[notes.length - 1] ?? null
  return notes[0] ?? null
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
  return index >= 0 ? `${total - index} / ${total}` : `new / ${total}`
}
