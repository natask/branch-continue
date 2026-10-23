import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  appendQuickNoteEntry,
  parseQuickNoteFile,
  searchQuickNoteFile,
  updateQuickNoteEntry,
  type ParsedQuickNoteFile,
} from '../../core/quicknote/org-file'
import {
  SourceFileUnavailableError,
  SourceSelectionCancelledError,
  createSourceBridge,
} from '../../core/quicknote/source-bridge'
import type {
  QuickNoteCreateRequest,
  QuickNoteSearchHit,
  SourceNote,
} from '../../core/quicknote/types'
import {
  appendSourceFileCommand,
  canRedoSourceFile,
  canUndoSourceFile,
  createSourceFileCommand,
  emptySourceFileHistory,
  loadSourceFileHistory,
  redoSourceFileCommand,
  saveSourceFileHistory,
  undoSourceFileCommand,
  type SourceFileHistoryState,
} from '../../core/history/source-file-history'
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
  canUndoFile: boolean
  canRedoFile: boolean
}

interface AppActions {
  getLatestNote: (identity: string) => SourceNote | null
  selectNote: (note: SourceNote) => void
  searchNotes: (query: string) => Promise<QuickNoteSearchHit[]>
  jumpToSearchHit: (hit: QuickNoteSearchHit) => void
  createNote: (request: QuickNoteCreateRequest) => Promise<SourceNote>
  updateNote: (noteId: string, request: QuickNoteCreateRequest) => Promise<SourceNote>
  updateNoteByUid: (
    noteUid: string,
    buildRequest: (latest: SourceNote) => QuickNoteCreateRequest,
  ) => Promise<SourceNote>
  selectSourceFile: () => Promise<void>
  reloadSource: () => Promise<void>
  undoFile: () => Promise<boolean>
  redoFile: () => Promise<boolean>
}

const sourceBridge = createSourceBridge()
const EMPTY_PATH = 'No file selected'
const SOURCE_RESTORE_TIMEOUT_MS = 6000

export function useApp(): AppState & AppActions {
  const [lifecycle, setLifecycle] = useState<AppState['lifecycle']>('booting')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedQuickNoteFile | null>(null)
  const parsedRef = useRef<ParsedQuickNoteFile | null>(null)
  const sourceMutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [notes, setNotes] = useState<SourceNote[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeNoteOffset, setActiveNoteOffset] = useState(0)
  const activeNoteIdRef = useRef<string | null>(null)
  const activeNoteOffsetRef = useRef(0)
  const [sourcePath, setSourcePath] = useState(EMPTY_PATH)
  const [sourceWritable, setSourceWritable] = useState(false)
  const [sourceMode, setSourceMode] = useState<'direct' | 'download'>('direct')
  const [selectingSource, setSelectingSource] = useState(false)
  const [historyState, setHistoryState] = useState<SourceFileHistoryState | null>(null)
  const historyStateRef = useRef<SourceFileHistoryState | null>(null)
  const historyLoadGenerationRef = useRef(0)

  const setActiveHistory = useCallback((next: SourceFileHistoryState | null) => {
    historyStateRef.current = next
    setHistoryState(next)
  }, [])

  const activateHistory = useCallback(async (path: string) => {
    const generation = historyLoadGenerationRef.current + 1
    historyLoadGenerationRef.current = generation
    setActiveHistory(null)
    try {
      const loaded = await loadSourceFileHistory(path)
      if (historyLoadGenerationRef.current === generation) setActiveHistory(loaded)
    } catch {
      if (historyLoadGenerationRef.current === generation) {
        setActiveHistory(emptySourceFileHistory(path))
      }
    }
  }, [setActiveHistory])

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
      parsedRef.current = nextParsed
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

  const clearSourceState = useCallback(() => {
    parsedRef.current = null
    setParsed(null)
    setNotes([])
    setActiveSelection(null)
    setSourcePath(EMPTY_PATH)
    setSourceWritable(false)
    setSourceMode('direct')
    historyLoadGenerationRef.current += 1
    setActiveHistory(null)
    setError(null)
    setLifecycle('no_source')
    sourceBridge.stopWatching()
  }, [setActiveHistory, setActiveSelection])

  const reloadSourceRef = useRef<(() => Promise<void>) | null>(null)

  const runSourceMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = sourceMutationQueueRef.current.then(operation, operation)
    sourceMutationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }, [])

  useEffect(() => {
    let cancelled = false
    let settled = false
    const restoreTimeout = window.setTimeout(() => {
      if (settled) return
      cancelled = true
      clearSourceState()
    }, SOURCE_RESTORE_TIMEOUT_MS)

    ;(async () => {
      try {
        const restored = await sourceBridge.restoreLastSelection()
        settled = true
        window.clearTimeout(restoreTimeout)
        if (cancelled) return

        if (restored) {
          applySourceSummary(restored.summary)
          applyParsed(parseQuickNoteFile(restored.content, restored.summary.path), null)
          void activateHistory(restored.summary.path)
          setLifecycle('ready')
          sourceBridge.startWatching(() => {
            reloadSourceRef.current?.()
          })
        } else {
          clearSourceState()
        }
      } catch (nextError) {
        settled = true
        window.clearTimeout(restoreTimeout)
        if (cancelled) return
        if (isSourceUnavailable(nextError)) {
          clearSourceState()
          return
        }
        setError(errorMessage(nextError))
        setLifecycle('error')
      }
    })()

    return () => {
      cancelled = true
      window.clearTimeout(restoreTimeout)
      sourceBridge.stopWatching()
    }
  }, [activateHistory, applyParsed, applySourceSummary, clearSourceState])

  const selectSourceFile = useCallback(async () => {
    setSelectingSource(true)
    setError(null)

    try {
      const selected = await sourceBridge.selectFile()
      applySourceSummary(selected.summary)
      applyParsed(parseQuickNoteFile(selected.content, selected.summary.path), null)
      void activateHistory(selected.summary.path)
      setLifecycle('ready')
      sourceBridge.startWatching(() => {
        reloadSourceRef.current?.()
      })
    } catch (nextError) {
      if (isSelectionCancelled(nextError)) return
      if (isSourceUnavailable(nextError)) {
        clearSourceState()
        return
      }
      setError(errorMessage(nextError))
      setLifecycle('error')
    } finally {
      setSelectingSource(false)
    }
  }, [activateHistory, applyParsed, applySourceSummary, clearSourceState])

  const reloadSource = useCallback(async () => {
    setError(null)

    try {
      const selected = await sourceBridge.read()
      applySourceSummary(selected.summary)
      applyParsed(parseQuickNoteFile(selected.content, selected.summary.path))
      setLifecycle('ready')
    } catch (nextError) {
      if (isSourceUnavailable(nextError)) {
        clearSourceState()
        return
      }
      setError(errorMessage(nextError))
      setLifecycle('error')
    }
  }, [applyParsed, applySourceSummary, clearSourceState])

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
    (request: QuickNoteCreateRequest) => runSourceMutation(async () => {
      const currentParsed = parsedRef.current
      if (!currentParsed) {
        throw new Error('Select a source file first.')
      }

      const { parsed: nextParsed, entry } = appendQuickNoteEntry(currentParsed, request)
      try {
        await sourceBridge.write(nextParsed.content, currentParsed.content)
      } catch (nextError) {
        if (isSourceUnavailable(nextError)) {
          clearSourceState()
        }
        throw nextError
      }
      const command = createSourceFileCommand({
        before: currentParsed.content,
        after: nextParsed.content,
        kind: 'create-note',
        label: `Create ${entry.title || 'note'}`,
        noteId: entry.noteUid ?? entry.id,
      })
      if (command) {
        const base = historyStateRef.current?.sourceKey === currentParsed.sourcePath
          ? historyStateRef.current
          : emptySourceFileHistory(currentParsed.sourcePath)
        const nextHistory = appendSourceFileCommand(base, command)
        setActiveHistory(nextHistory)
        await persistSourceHistory(nextHistory)
      }
      applyParsed(nextParsed, entry.id)
      return entry
    }),
    [applyParsed, clearSourceState, runSourceMutation, setActiveHistory],
  )

  const updateNote = useCallback(
    (noteId: string, request: QuickNoteCreateRequest) => runSourceMutation(async () => {
      const currentParsed = parsedRef.current
      if (!currentParsed) {
        throw new Error('Select a source file first.')
      }

      const stableUid = request.noteUid?.trim()
      // Parser IDs can move when the Org file is reordered. Background task
      // updates carry the durable UID, so resolve that identity first.
      const target = (stableUid
        ? currentParsed.entries.find((entry) => entry.noteUid === stableUid)
        : undefined)
        ?? currentParsed.entries.find((entry) => entry.id === noteId)
      if (stableUid && target?.noteUid !== stableUid) {
        throw new Error(`Could not find note with stable UID ${stableUid} in selected file.`)
      }
      const resolvedNoteId = target?.id ?? noteId
      const activeEntry = currentParsed.entries.find((entry) => entry.id === activeNoteIdRef.current)
      const wasActive = activeNoteIdRef.current === resolvedNoteId
        || Boolean(stableUid && activeEntry?.noteUid === stableUid)
      const { parsed: nextParsed, entry } = updateQuickNoteEntry(currentParsed, resolvedNoteId, request)
      try {
        await sourceBridge.write(nextParsed.content, currentParsed.content)
      } catch (nextError) {
        if (isSourceUnavailable(nextError)) {
          clearSourceState()
        }
        throw nextError
      }
      const command = createSourceFileCommand({
        before: currentParsed.content,
        after: nextParsed.content,
        kind: 'update-note',
        label: `Edit ${entry.title || 'note'}`,
        noteId: entry.noteUid ?? entry.id,
      })
      if (command) {
        const base = historyStateRef.current?.sourceKey === currentParsed.sourcePath
          ? historyStateRef.current
          : emptySourceFileHistory(currentParsed.sourcePath)
        const nextHistory = appendSourceFileCommand(base, command)
        setActiveHistory(nextHistory)
        await persistSourceHistory(nextHistory)
      }
      // Background writes (for example a late agent result) must not steal the
      // Time Machine selection from the note the user is currently viewing.
      applyParsed(nextParsed, wasActive ? entry.id : undefined)
      return entry
    }),
    [applyParsed, clearSourceState, runSourceMutation, setActiveHistory],
  )

  const updateNoteByUid = useCallback(
    (noteUid: string, buildRequest: (latest: SourceNote) => QuickNoteCreateRequest) => (
      runSourceMutation(async () => {
        const currentParsed = parsedRef.current
        if (!currentParsed) throw new Error('Select a source file first.')
        const stableUid = noteUid.trim()
        if (!stableUid) throw new Error('A stable note UID is required.')
        const target = currentParsed.entries.find((entry) => entry.noteUid === stableUid)
        if (!target) throw new Error(`Could not find note with stable UID ${stableUid} in selected file.`)

        const request = { ...buildRequest(target), noteUid: stableUid }
        const activeEntry = currentParsed.entries.find((entry) => entry.id === activeNoteIdRef.current)
        const wasActive = activeEntry?.noteUid === stableUid
        const { parsed: nextParsed, entry } = updateQuickNoteEntry(currentParsed, target.id, request)
        try {
          await sourceBridge.write(nextParsed.content, currentParsed.content)
        } catch (nextError) {
          if (isSourceUnavailable(nextError)) clearSourceState()
          throw nextError
        }
        const command = createSourceFileCommand({
          before: currentParsed.content,
          after: nextParsed.content,
          kind: 'update-note',
          label: `Edit ${entry.title || 'note'}`,
          noteId: stableUid,
        })
        if (command) {
          const base = historyStateRef.current?.sourceKey === currentParsed.sourcePath
            ? historyStateRef.current
            : emptySourceFileHistory(currentParsed.sourcePath)
          const nextHistory = appendSourceFileCommand(base, command)
          setActiveHistory(nextHistory)
          await persistSourceHistory(nextHistory)
        }
        applyParsed(nextParsed, wasActive ? entry.id : undefined)
        return entry
      })
    ),
    [applyParsed, clearSourceState, runSourceMutation, setActiveHistory],
  )

  const undoFile = useCallback((): Promise<boolean> => runSourceMutation(async () => {
    const currentParsed = parsedRef.current
    const currentHistory = historyStateRef.current
    if (!currentParsed || !currentHistory || currentHistory.sourceKey !== currentParsed.sourcePath) return false
    const step = undoSourceFileCommand(currentHistory, currentParsed.content)
    if (!step) return false
    await sourceBridge.write(step.content, currentParsed.content)
    setActiveHistory(step.state)
    await persistSourceHistory(step.state)
    applyParsed(parseQuickNoteFile(step.content, currentParsed.sourcePath), null)
    return true
  }), [applyParsed, runSourceMutation, setActiveHistory])

  const redoFile = useCallback((): Promise<boolean> => runSourceMutation(async () => {
    const currentParsed = parsedRef.current
    const currentHistory = historyStateRef.current
    if (!currentParsed || !currentHistory || currentHistory.sourceKey !== currentParsed.sourcePath) return false
    const step = redoSourceFileCommand(currentHistory, currentParsed.content)
    if (!step) return false
    await sourceBridge.write(step.content, currentParsed.content)
    setActiveHistory(step.state)
    await persistSourceHistory(step.state)
    applyParsed(parseQuickNoteFile(step.content, currentParsed.sourcePath), null)
    return true
  }), [applyParsed, runSourceMutation, setActiveHistory])

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

  const canUndoFile = Boolean(parsed && historyState && canUndoSourceFile(historyState, parsed.content))
  const canRedoFile = Boolean(parsed && historyState && canRedoSourceFile(historyState, parsed.content))

  return {
    getLatestNote: (identity: string) => parsedRef.current?.entries.find((note) => note.noteUid === identity || note.id === identity) ?? null,
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
    canUndoFile,
    canRedoFile,
    selectNote,
    searchNotes,
    jumpToSearchHit,
    createNote,
    updateNote,
    updateNoteByUid,
    selectSourceFile,
    reloadSource,
    undoFile,
    redoFile,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function persistSourceHistory(state: SourceFileHistoryState): Promise<void> {
  try {
    await saveSourceFileHistory(state)
  } catch {
    // The source file is canonical. Keep the in-memory commands available for
    // this session if durable browser storage is temporarily unavailable.
  }
}

function isSelectionCancelled(error: unknown): boolean {
  if (error instanceof SourceSelectionCancelledError) return true
  const message = errorMessage(error).toLowerCase()
  return message.includes('cancel') || message.includes('aborted') || message.includes('abort')
}

function isSourceUnavailable(error: unknown): boolean {
  return error instanceof SourceFileUnavailableError
}
