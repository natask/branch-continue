import type { QuickNoteCreateRequest, SourceNote } from '../../core/quicknote/types'

export type EditorState = {
  sessionKey: number
  source: SourceNote | null
  branchFrom: SourceNote | null
  editing: boolean
  title: string
  timestamp: string | null
  editingTimestamp: boolean
  tags: string[]
  body: string
  tagInput: string
  editingTitle: boolean
  editingTagIndex: number | null
  editingTagValue: string
  isNew: boolean
  dirty: boolean
  changeVersion: number
}

export interface UseEditorSessionOptions {
  sourceSelected: boolean
  createNote: (request: QuickNoteCreateRequest) => Promise<SourceNote>
  updateNote: (noteId: string, request: QuickNoteCreateRequest) => Promise<SourceNote>
}

export interface OpenEditorOptions {
  focusBody?: boolean
}

export type SetEditorState = (next: EditorState | null) => void

export function formatNewTimestamp(): string {
  const date = new Date()
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
  const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
  return `[${year}-${month}-${day} ${weekday} ${hours}:${minutes}:${seconds} ${sign}${offsetHours}${offsetMins}]`
}

export function editorFromNote(note: SourceNote, sessionKey: number): EditorState {
  return {
    sessionKey,
    source: note,
    branchFrom: null,
    editing: true,
    title: note.title,
    timestamp: note.timestamp,
    editingTimestamp: false,
    tags: [...note.tags],
    body: note.body || note.preview || '',
    tagInput: '',
    editingTitle: false,
    editingTagIndex: null,
    editingTagValue: '',
    isNew: false,
    dirty: false,
    changeVersion: 0,
  }
}

export function editorForBranch(sessionKey: number, branchFrom: SourceNote | null = null): EditorState {
  return {
    sessionKey,
    source: null,
    branchFrom,
    editing: true,
    title: '',
    timestamp: formatNewTimestamp(),
    editingTimestamp: false,
    tags: [],
    body: '',
    tagInput: '',
    editingTitle: false,
    editingTagIndex: null,
    editingTagValue: '',
    isNew: true,
    dirty: false,
    changeVersion: 0,
  }
}

export function normalizeDraftTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function areTagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}
