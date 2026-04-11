import type { SourceNote } from '../../core/quicknote/types'

export interface ResolveActiveSelectionInput {
  notes: SourceNote[]
  preferredNoteId?: string | null
  currentActiveNoteId: string | null
  currentActiveNoteOffset: number
}

export function resolveActiveSelection(input: ResolveActiveSelectionInput): SourceNote | null {
  const { notes, preferredNoteId, currentActiveNoteId, currentActiveNoteOffset } = input
  if (notes.length === 0) return null

  if (preferredNoteId === null) {
    return notes[0] ?? null
  }

  const resolvedPreferredId =
    preferredNoteId === undefined ? currentActiveNoteId : preferredNoteId

  if (resolvedPreferredId) {
    const matched = notes.find((entry) => entry.id === resolvedPreferredId)
    if (matched) return matched
  }

  const byOffset = getNoteByOffset(notes, currentActiveNoteOffset)
  if (byOffset) return byOffset

  return notes[0] ?? null
}

export function getNoteByOffset(notes: SourceNote[], offset: number): SourceNote | null {
  if (notes.length === 0) return null
  if (!Number.isFinite(offset)) return notes[0]
  const index = Math.min(Math.max(Math.round(offset), 0), notes.length - 1)
  return notes[index] ?? null
}
