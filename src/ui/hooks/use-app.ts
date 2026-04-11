import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  appendQuickNoteEntry,
  parseQuickNoteFile,
  searchQuickNoteFile,
  updateQuickNoteEntry,
  type ParsedQuickNoteFile,
} from '../../core/quicknote/org-file'
import {
  SourceSelectionCancelledError,
  createSourceBridge,
} from '../../core/quicknote/source-bridge'
import type {
  QuickNoteCreateRequest,
  QuickNoteSearchHit,
  SourceNote,
} from '../../core/quicknote/types'

interface AppState {
  ready: boolean
  error: string | null
  notes: SourceNote[]
  activeNoteId: string | null
  activeNote: SourceNote | null
  activeNoteOffset: number
  totalCount: number
  recentering: boolean
  sourcePath: string
  sourceSelected: boolean
  sourceWritable: boolean
  sourceMode: 'direct' | 'download'
  selectingSource: boolean
}

interface AppActions {
  selectNote: (note: SourceNote) => void
  searchNotes: (query: string) => Promise<QuickNoteSearchHit[]>
  jumpToSearchHit: (hit: QuickNoteSearchHit) => void
  createNote: (request: QuickNoteCreateRequest) => Promise<SourceNote>
  updateNote: (noteId: string, request: QuickNoteCreateRequest) => Promise<SourceNote>
  selectSourceFile: () => Promise<void>
  reloadSource: () => Promise<void>
}

const sourceBridge = createSourceBridge()
const EMPTY_PATH = 'No file selected'

export function useApp(): AppState & AppActions {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedQuickNoteFile | null>(null)
  const [notes, setNotes] = useState<SourceNote[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeNoteOffset, setActiveNoteOffset] = useState(0)
  const activeNoteIdRef = useRef<string | null>(null)
  const activeNoteOffsetRef = useRef(0)
  const [sourcePath, setSourcePath] = useState(EMPTY_PATH)
  const [sourceWritable, setSourceWritable] = useState(false)
  const [sourceMode, setSourceMode] = useState<'direct' | 'download'>('direct')
  const [selectingSource, setSelectingSource] = useState(false)

  const setActiveSelection = useCallback((note: SourceNote | null) => {
    const id = note?.id ?? null
    const offset = note?.offset ?? 0
    activeNoteIdRef.current = id
    activeNoteOffsetRef.current = offset
    setActiveNoteId(id)
    setActiveNoteOffset(offset)
  }, [])

  const applyParsed = useCallback(
    (nextParsed: ParsedQuickNoteFile, preferredNoteId?: string | null) => {
      setParsed(nextParsed)
      setNotes(nextParsed.entries)

      const resolvedPreferredId =
        preferredNoteId === undefined ? activeNoteIdRef.current : preferredNoteId
      let nextActive: SourceNote | null = null

      if (preferredNoteId === null) {
        nextActive = nextParsed.entries[0] ?? null
      } else {
        if (resolvedPreferredId) {
          nextActive = nextParsed.entries.find((entry) => entry.id === resolvedPreferredId) ?? null
        }

        if (!nextActive) {
          nextActive = getNoteByOffset(nextParsed.entries, activeNoteOffsetRef.current)
        }

        if (!nextActive) {
          nextActive = nextParsed.entries[0] ?? null
        }
      }

      setActiveSelection(nextActive)
    },
    [setActiveSelection],
  )

  const applySourceSummary = useCallback(
    (summary: { path: string; writable: boolean; mode: 'direct' | 'download' }) => {
      setSourcePath(summary.path || EMPTY_PATH)
      setSourceWritable(summary.writable)
      setSourceMode(summary.mode)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const restored = await sourceBridge.restoreLastSelection()
        if (cancelled) return

        if (restored) {
          applySourceSummary(restored.summary)
          applyParsed(parseQuickNoteFile(restored.content, restored.summary.path), null)
        } else {
          setSourcePath(EMPTY_PATH)
          setSourceWritable(false)
          setSourceMode('direct')
        }

        setReady(true)
      } catch (nextError) {
        if (cancelled) return
        setError(errorMessage(nextError))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyParsed, applySourceSummary])

  const selectSourceFile = useCallback(async () => {
    setSelectingSource(true)
    setError(null)

    try {
      const selected = await sourceBridge.selectFile()
      applySourceSummary(selected.summary)
      applyParsed(parseQuickNoteFile(selected.content, selected.summary.path), null)
    } catch (nextError) {
      if (isSelectionCancelled(nextError)) return
      setError(errorMessage(nextError))
    } finally {
      setSelectingSource(false)
    }
  }, [applyParsed, applySourceSummary])

  const reloadSource = useCallback(async () => {
    setError(null)

    try {
      const selected = await sourceBridge.read()
      applySourceSummary(selected.summary)
      applyParsed(parseQuickNoteFile(selected.content, selected.summary.path))
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }, [applyParsed, applySourceSummary])

  const searchNotes = useCallback(
    async (query: string) => {
      if (!parsed) return []
      return searchQuickNoteFile(parsed, query, 50)
    },
    [parsed],
  )

  const jumpToSearchHit = useCallback(
    (hit: QuickNoteSearchHit) => {
      setActiveSelection(hit.note)
    },
    [setActiveSelection],
  )

  const createNote = useCallback(
    async (request: QuickNoteCreateRequest) => {
      if (!parsed) {
        throw new Error('Select a source file first.')
      }

      const { parsed: nextParsed, entry } = appendQuickNoteEntry(parsed, request)
      await sourceBridge.write(nextParsed.content)
      applyParsed(nextParsed, entry.id)
      return entry
    },
    [applyParsed, parsed],
  )

  const updateNote = useCallback(
    async (noteId: string, request: QuickNoteCreateRequest) => {
      if (!parsed) {
        throw new Error('Select a source file first.')
      }

      const { parsed: nextParsed, entry } = updateQuickNoteEntry(parsed, noteId, request)
      await sourceBridge.write(nextParsed.content)
      applyParsed(nextParsed, entry.id)
      return entry
    },
    [applyParsed, parsed],
  )

  const activeNote = useMemo(
    () => (activeNoteId ? notes.find((note) => note.id === activeNoteId) ?? null : null),
    [activeNoteId, notes],
  )

  const selectNote = useCallback(
    (note: SourceNote) => {
      setActiveSelection(note)
    },
    [setActiveSelection],
  )

  return {
    ready,
    error,
    notes,
    activeNoteId: activeNote?.id ?? null,
    activeNote,
    activeNoteOffset,
    totalCount: notes.length,
    recentering: false,
    sourcePath,
    sourceSelected: parsed !== null,
    sourceWritable,
    sourceMode,
    selectingSource,
    selectNote,
    searchNotes,
    jumpToSearchHit,
    createNote,
    updateNote,
    selectSourceFile,
    reloadSource,
  }
}

function getNoteByOffset(notes: SourceNote[], offset: number): SourceNote | null {
  if (notes.length === 0) return null
  if (!Number.isFinite(offset)) return notes[0]
  const index = Math.min(Math.max(Math.round(offset), 0), notes.length - 1)
  return notes[index] ?? null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSelectionCancelled(error: unknown): boolean {
  if (error instanceof SourceSelectionCancelledError) return true
  const message = errorMessage(error).toLowerCase()
  return message.includes('cancel') || message.includes('aborted') || message.includes('abort')
}
