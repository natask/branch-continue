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
import { resolveActiveSelection } from './use-app-selection'

interface AppState {
  ready: boolean
  lifecycle: 'booting' | 'no_source' | 'ready' | 'error'
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
  const [lifecycle, setLifecycle] = useState<AppState['lifecycle']>('booting')
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
      setActiveSelection(
        resolveActiveSelection({
          notes: nextParsed.entries,
          preferredNoteId,
          currentActiveNoteId: activeNoteIdRef.current,
          currentActiveNoteOffset: activeNoteOffsetRef.current,
        }),
      )
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

  const reloadSourceRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const restored = await sourceBridge.restoreLastSelection()
        if (cancelled) return

        if (restored) {
          applySourceSummary(restored.summary)
          applyParsed(parseQuickNoteFile(restored.content, restored.summary.path), null)
          setLifecycle('ready')
          sourceBridge.startWatching(() => {
            reloadSourceRef.current?.()
          })
        } else {
          setSourcePath(EMPTY_PATH)
          setSourceWritable(false)
          setSourceMode('direct')
          setLifecycle('no_source')
        }
      } catch (nextError) {
        if (cancelled) return
        setError(errorMessage(nextError))
        setLifecycle('error')
      }
    })()

    return () => {
      cancelled = true
      sourceBridge.stopWatching()
    }
  }, [applyParsed, applySourceSummary])

  const selectSourceFile = useCallback(async () => {
    setSelectingSource(true)
    setError(null)

    try {
      const selected = await sourceBridge.selectFile()
      applySourceSummary(selected.summary)
      applyParsed(parseQuickNoteFile(selected.content, selected.summary.path), null)
      setLifecycle('ready')
      sourceBridge.startWatching(() => {
        reloadSourceRef.current?.()
      })
    } catch (nextError) {
      if (isSelectionCancelled(nextError)) return
      setError(errorMessage(nextError))
      setLifecycle('error')
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
      setLifecycle('ready')
    } catch (nextError) {
      setError(errorMessage(nextError))
      setLifecycle('error')
    }
  }, [applyParsed, applySourceSummary])

  // Keep ref in sync so the file watcher can call the latest reloadSource.
  useEffect(() => {
    reloadSourceRef.current = reloadSource
  }, [reloadSource])

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
    ready: lifecycle !== 'booting',
    lifecycle,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSelectionCancelled(error: unknown): boolean {
  if (error instanceof SourceSelectionCancelledError) return true
  const message = errorMessage(error).toLowerCase()
  return message.includes('cancel') || message.includes('aborted') || message.includes('abort')
}
