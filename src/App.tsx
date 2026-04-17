import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Leva } from 'leva'
import { useApp } from './ui/hooks/use-app'
import { useEditorSession } from './ui/hooks/use-editor-session'
import { SearchModal, type SearchCommandAction } from './ui/components/SearchModal'
import { TimeMachine } from './ui/components/TimeMachine'
import { Editor } from './ui/components/Editor'
import {
  formatNotePosition,
  orderNotes,
  resolveBoundaryNote,
  type NoteSortMode,
} from './ui/lib/note-order'
import type { QuickNoteSearchHit, SourceNote } from './core/quicknote/types'

const CARD_STACK_TUNER_KEY = 'branch-continue:show-card-stack-tuner'
const SWIPE_UP_NAV_TARGET_KEY = 'branch-continue:swipe-up-nav-target'
const WHEEL_NAV_DIRECTION_KEY = 'branch-continue:wheel-nav-direction'
const NOTE_NAV_SCROLL_STEP_PX = 40

type SwipeUpNavTarget = 'previous' | 'next'
type WheelNavDirection = 'natural' | 'reverse'

export default function App() {
  const app = useApp()
  const [isMobile, setIsMobile] = useState(() => isLikelyMobileDevice())
  const [showCardStackTuner, setShowCardStackTuner] = useState(resolveInitialCardStackTunerVisibility)

  useEffect(() => {
    const updateMobile = () => setIsMobile(isLikelyMobileDevice())
    updateMobile()
    window.addEventListener('resize', updateMobile)
    return () => window.removeEventListener('resize', updateMobile)
  }, [])

  useEffect(() => {
    if (!isMobile) return
    setShowCardStackTuner(false)
  }, [isMobile])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isMobile) return
      const shortcut = event.metaKey || event.ctrlKey
      if (!shortcut || !event.shiftKey || event.key.toLowerCase() !== 'l') return
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      setShowCardStackTuner((current) => !current)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMobile])

  useEffect(() => {
    try {
      window.localStorage.setItem(CARD_STACK_TUNER_KEY, showCardStackTuner ? '1' : '0')
    } catch {
      // Ignore persistence failures.
    }
  }, [showCardStackTuner])

  let content: ReactNode
  if (app.error) {
    content = (
      <div className="error-screen">
        <div className="error-panel">
          <p className="error-title">File operation failed.</p>
          <pre className="error-text">{app.error}</pre>
          <p className="error-hint">
            Current source: <code>{app.sourcePath}</code>
          </p>
        </div>
      </div>
    )
  } else if (!app.ready) {
    content = <div className="loading">loading file session</div>
  } else if (!app.sourceSelected) {
    content = (
      <SourceSelectionScreen selectingSource={app.selectingSource} selectSourceFile={app.selectSourceFile} />
    )
  } else {
    content = (
      <LoadedSourceApp
        app={app}
        isMobile={isMobile}
        showCardStackTuner={showCardStackTuner}
        setShowCardStackTuner={setShowCardStackTuner}
      />
    )
  }

  return (
    <>
      <Leva hidden={!showCardStackTuner || isMobile} />
      {content}
    </>
  )
}

function LoadedSourceApp({
  app,
  isMobile,
  showCardStackTuner,
  setShowCardStackTuner,
}: {
  app: ReturnType<typeof useApp>
  isMobile: boolean
  showCardStackTuner: boolean
  setShowCardStackTuner: (value: boolean | ((current: boolean) => boolean)) => void
}) {
  const {
    notes,
    activeNoteId,
    activeNote,
    totalCount,
    recentering,
    sourcePath,
    sourceWritable,
    selectingSource,
    selectNote,
    searchNotes,
    jumpToSearchHit,
    createNote,
    updateNote,
    selectSourceFile,
    reloadSource,
  } = app
  const [searchOpen, setSearchOpen] = useState(false)
  const [sortMode, setSortMode] = useState<NoteSortMode>(resolveInitialSortMode)
  const [swipeUpNavTarget, setSwipeUpNavTarget] = useState<SwipeUpNavTarget>(resolveInitialSwipeUpNavTarget)
  const [wheelNavDirection, setWheelNavDirection] = useState<WheelNavDirection>(resolveInitialWheelNavDirection)
  const editorWheelAccumRef = useRef(0)

  const editorSession = useEditorSession({
    sourceSelected: true,
    createNote,
    updateNote,
  })

  const orderedNotes = useMemo(() => orderNotes(notes), [notes])
  const notesById = useMemo(() => {
    const map = new Map<string, SourceNote>()
    for (const note of notes) {
      map.set(note.id, note)
    }
    return map
  }, [notes])
  const notesByUid = useMemo(() => {
    const map = new Map<string, SourceNote>()
    for (const note of notes) {
      if (note.noteUid) map.set(note.noteUid, note)
    }
    return map
  }, [notes])
  const childrenByParentRef = useMemo(() => {
    const map = new Map<string, SourceNote[]>()
    for (const note of notes) {
      if (!note.parentNoteId) continue
      const existing = map.get(note.parentNoteId) ?? []
      existing.push(note)
      map.set(note.parentNoteId, existing)
    }
    return map
  }, [notes])

  const currentEditorNoteId = editorSession.editor?.source?.id ?? activeNoteId
  const editorPositionLabel = useMemo(
    () => formatNotePosition(orderedNotes, currentEditorNoteId, totalCount),
    [currentEditorNoteId, orderedNotes, totalCount],
  )
  const currentContextNote = editorSession.editor?.source ?? activeNote
  const unsavedBranchSource = editorSession.editor?.source ? null : editorSession.editor?.branchFrom ?? null
  const currentParentNote = useMemo(
    () =>
      resolveLinkedNote(
        notesById,
        notesByUid,
        unsavedBranchSource?.noteUid ??
          unsavedBranchSource?.id ??
          currentContextNote?.parentNoteId ??
          null,
      ),
    [currentContextNote?.parentNoteId, notesById, notesByUid, unsavedBranchSource?.id, unsavedBranchSource?.noteUid],
  )
  const currentChildNotes = useMemo(() => {
    if (!currentContextNote) return []

    const matches = [
      ...(childrenByParentRef.get(currentContextNote.id) ?? []),
      ...(currentContextNote.noteUid ? childrenByParentRef.get(currentContextNote.noteUid) ?? [] : []),
    ]
    const unique = new Map<string, SourceNote>()
    for (const child of matches) {
      unique.set(child.id, child)
    }
    return Array.from(unique.values()).sort((a, b) => a.startLine - b.startLine)
  }, [childrenByParentRef, currentContextNote])

  const handleSearchSelect = useCallback(
    (hit: QuickNoteSearchHit) => {
      jumpToSearchHit(hit)
      setSearchOpen(false)
      editorSession.openNoteEditor(hit.note)
    },
    [editorSession, jumpToSearchHit],
  )

  const handleOpenNote = useCallback(
    (note: SourceNote) => {
      editorSession.openNoteEditor(note)
    },
    [editorSession],
  )

  const handleOpenLinkedNote = useCallback(
    (note: SourceNote) => {
      selectNote(note)
      editorSession.openNoteEditor(note)
    },
    [editorSession, selectNote],
  )

  const handleBranch = useCallback(
    (from: SourceNote) => {
      editorSession.openBranchEditor(from)
    },
    [editorSession],
  )

  const handleGoToBoundary = useCallback(() => {
    const boundary = resolveBoundaryNote(orderedNotes, sortMode)
    if (!boundary) return
    selectNote(boundary)
  }, [orderedNotes, selectNote, sortMode])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (editorSession.editor && shortcut && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        editorSession.handleUndo()
        return
      }

      if (editorSession.editor && shortcut && ((key === 'z' && event.shiftKey) || key === 'y')) {
        event.preventDefault()
        editorSession.handleRedo()
        return
      }

      if (shortcut && key === 'k') {
        if (isMobile) return
        const target = event.target as HTMLElement
        if (target.tagName === 'TEXTAREA') return
        event.preventDefault()
        setSearchOpen((current) => !current)
        return
      }

      if (shortcut && key === '[' && currentParentNote) {
        event.preventDefault()
        handleOpenLinkedNote(currentParentNote)
        return
      }

      if (shortcut && key === ']' && currentChildNotes.length > 0) {
        event.preventDefault()
        handleOpenLinkedNote(currentChildNotes[0]!)
        return
      }

      if (event.key !== 'Escape') return

      if (searchOpen) {
        event.preventDefault()
        setSearchOpen(false)
        return
      }

      if (editorSession.editor) {
        event.preventDefault()
        editorSession.closeEditor()
        return
      }

      const boundary = resolveBoundaryNote(orderedNotes, sortMode)
      if (!boundary) return
      event.preventDefault()
      selectNote(boundary)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    currentChildNotes,
    currentParentNote,
    editorSession,
    handleOpenLinkedNote,
    orderedNotes,
    searchOpen,
    selectNote,
    isMobile,
    sortMode,
  ])

  useEffect(() => {
    if (!editorSession.editor || orderedNotes.length === 0) return

    const handler = (event: WheelEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return

      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('.note-editor')) return

      event.preventDefault()

      const verticalGesture = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      const dominantDelta = verticalGesture ? event.deltaY : event.deltaX
      editorWheelAccumRef.current += dominantDelta

      const accumulated = editorWheelAccumRef.current
      const normalizedAccum = wheelNavDirection === 'natural' ? accumulated : accumulated * -1
      if (Math.abs(normalizedAccum) < NOTE_NAV_SCROLL_STEP_PX) return

      const stepCount = Math.trunc(Math.abs(normalizedAccum) / NOTE_NAV_SCROLL_STEP_PX)
      const consumedNormalized = Math.sign(normalizedAccum) * stepCount * NOTE_NAV_SCROLL_STEP_PX
      const consumedRaw = wheelNavDirection === 'natural' ? consumedNormalized : consumedNormalized * -1
      editorWheelAccumRef.current = accumulated - consumedRaw

      const stepDirection = (() => {
        if (verticalGesture) {
          const upDirection = swipeUpNavTarget === 'previous' ? -1 : 1
          return normalizedAccum < 0 ? upDirection : upDirection * -1
        }
        return normalizedAccum > 0 ? 1 : -1
      })()

      const currentId = editorSession.editor?.source?.id ?? activeNoteId
      if (!currentId) return

      const currentIndex = orderedNotes.findIndex((note) => note.id === currentId)
      if (currentIndex < 0) return

      const nextIndex = Math.max(
        0,
        Math.min(orderedNotes.length - 1, currentIndex + stepDirection * stepCount),
      )
      if (nextIndex === currentIndex) return

      const nextNote = orderedNotes[nextIndex]
      if (!nextNote) return

      selectNote(nextNote)
      editorSession.openNoteEditor(nextNote)
    }

    window.addEventListener('wheel', handler, { passive: false })
    return () => window.removeEventListener('wheel', handler)
  }, [activeNoteId, editorSession, orderedNotes, selectNote, swipeUpNavTarget, wheelNavDirection])

  useEffect(() => {
    if (orderedNotes.length === 0) return
    if (activeNoteId && orderedNotes.some((note) => note.id === activeNoteId)) return
    selectNote(orderedNotes[orderedNotes.length - 1]!)
  }, [activeNoteId, orderedNotes, selectNote])

  useEffect(() => {
    try {
      window.localStorage.setItem(SWIPE_UP_NAV_TARGET_KEY, swipeUpNavTarget)
    } catch {
      // Ignore persistence failures.
    }
  }, [swipeUpNavTarget])

  useEffect(() => {
    try {
      window.localStorage.setItem(WHEEL_NAV_DIRECTION_KEY, wheelNavDirection)
    } catch {
      // Ignore persistence failures.
    }
  }, [wheelNavDirection])

  const commandActions = useMemo<SearchCommandAction[]>(
    () => [
      {
        id: 'select-source-file',
        label: selectingSource ? 'Select Source File (busy...)' : 'Select Source File',
        hint: '⌘O',
        keywords: ['open', 'file', 'source'],
        group: 'Actions',
        disabled: selectingSource,
        run: () => void selectSourceFile(),
      },
      {
        id: 'reload-source-file',
        label: 'Reload Source File',
        hint: 'refresh',
        keywords: ['reload', 'refresh', 'source'],
        group: 'Actions',
        run: () => void reloadSource(),
      },
      {
        id: 'branch-current-note',
        label: 'Branch Current Note',
        hint: '⌘↩',
        keywords: ['branch', 'split'],
        group: 'Actions',
        run: () => editorSession.openBranchEditor(currentContextNote ?? null),
      },
      {
        id: 'open-parent-note',
        label: 'Open Parent Note',
        hint: '⌘[',
        keywords: ['parent', 'source', 'lineage'],
        group: 'Navigation',
        disabled: !currentParentNote,
        run: () => {
          if (!currentParentNote) return
          handleOpenLinkedNote(currentParentNote)
        },
      },
      {
        id: 'open-first-child-note',
        label: 'Open First Child Branch',
        hint: '⌘]',
        keywords: ['child', 'branch', 'lineage'],
        group: 'Navigation',
        disabled: currentChildNotes.length === 0,
        run: () => {
          const child = currentChildNotes[0]
          if (!child) return
          handleOpenLinkedNote(child)
        },
      },
      {
        id: 'go-boundary',
        label: sortMode === 'latest' ? 'Go to Latest Note' : 'Go to Oldest Note',
        hint: 'Esc',
        keywords: ['boundary', 'jump', sortMode],
        group: 'Navigation',
        disabled: orderedNotes.length === 0,
        run: handleGoToBoundary,
      },
      ...(isMobile
        ? []
        : [
            {
              id: 'set-sort-latest',
              label: `Jump Target: Latest${sortMode === 'latest' ? ' (current)' : ''}`,
              keywords: ['sort', 'latest', 'newest', 'jump'],
              group: 'Settings',
              run: () => setSortMode('latest'),
            },
            {
              id: 'set-sort-oldest',
              label: `Jump Target: Oldest${sortMode === 'oldest' ? ' (current)' : ''}`,
              keywords: ['sort', 'oldest', 'first', 'jump'],
              group: 'Settings',
              run: () => setSortMode('oldest'),
            },
            {
              id: 'set-swipe-previous',
              label: `Swipe Up: Previous${swipeUpNavTarget === 'previous' ? ' (current)' : ''}`,
              keywords: ['swipe', 'gesture', 'up', 'previous'],
              group: 'Settings',
              run: () => setSwipeUpNavTarget('previous'),
            },
            {
              id: 'set-swipe-next',
              label: `Swipe Up: Next${swipeUpNavTarget === 'next' ? ' (current)' : ''}`,
              keywords: ['swipe', 'gesture', 'up', 'next'],
              group: 'Settings',
              run: () => setSwipeUpNavTarget('next'),
            },
            {
              id: 'set-wheel-natural',
              label: `Scroll Direction: Natural${wheelNavDirection === 'natural' ? ' (current)' : ''}`,
              keywords: ['wheel', 'scroll', 'direction', 'natural'],
              group: 'Settings',
              run: () => setWheelNavDirection('natural'),
            },
            {
              id: 'set-wheel-reverse',
              label: `Scroll Direction: Reverse${wheelNavDirection === 'reverse' ? ' (current)' : ''}`,
              keywords: ['wheel', 'scroll', 'direction', 'reverse'],
              group: 'Settings',
              run: () => setWheelNavDirection('reverse'),
            },
            {
              id: 'toggle-card-stack-tuner',
              label: `${showCardStackTuner ? 'Hide' : 'Show'} Card Stack Tuner`,
              keywords: ['debug', 'leva', 'card stack'],
              group: 'Settings',
              run: () => setShowCardStackTuner((current) => !current),
            },
          ]),
      {
        id: 'close-editor',
        label: 'Close Editor',
        hint: 'Esc',
        keywords: ['close', 'editor', 'exit'],
        group: 'Editor',
        disabled: !editorSession.editor,
        run: () => editorSession.closeEditor(),
      },
      ...(isMobile
        ? []
        : [
            {
              id: 'editor-undo',
              label: 'Undo in Editor',
              hint: '⌘Z',
              keywords: ['undo', 'editor'],
              group: 'Editor',
              disabled: !editorSession.editor,
              run: () => editorSession.handleUndo(),
            },
            {
              id: 'editor-redo',
              label: 'Redo in Editor',
              hint: '⌘⇧Z',
              keywords: ['redo', 'editor'],
              group: 'Editor',
              disabled: !editorSession.editor,
              run: () => editorSession.handleRedo(),
            },
          ]),
    ],
    [
      currentChildNotes,
      currentContextNote,
      currentParentNote,
      editorSession,
      handleGoToBoundary,
      handleOpenLinkedNote,
      orderedNotes.length,
      reloadSource,
      selectingSource,
      selectSourceFile,
      showCardStackTuner,
      isMobile,
      sortMode,
      swipeUpNavTarget,
      wheelNavDirection,
    ],
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-copy">
          <h1 className="topbar-title">Branch Continue</h1>
          <p className="topbar-path">{sourcePath}</p>
        </div>

        <div className="topbar-meta">
          {!isMobile && <span className="meta-pill">{sourceWritable ? 'Direct Auto-Save' : 'Download Auto-Save'}</span>}
          {!isMobile && (
            <div className="topbar-jump">
              <button
                className={`topbar-jump-opt${sortMode === 'oldest' ? ' active' : ''}`}
                onClick={() => setSortMode('oldest')}
                type="button"
              >
                Oldest
              </button>
              <button
                className={`topbar-jump-opt${sortMode === 'latest' ? ' active' : ''}`}
                onClick={() => setSortMode('latest')}
                type="button"
              >
                Latest
              </button>
              <button
                className="topbar-jump-go"
                onClick={handleGoToBoundary}
                type="button"
              >
                Go
              </button>
            </div>
          )}
          {!isMobile && (
            <button className="topbar-search" onClick={() => void selectSourceFile()} type="button">
              {selectingSource ? 'Selecting...' : 'Select File'}
            </button>
          )}
          {!isMobile && (
            <button className="topbar-search" onClick={() => void reloadSource()} type="button">
              Reload
            </button>
          )}
          <button
            className="topbar-search topbar-search-strong"
            onClick={() => editorSession.openBranchEditor(currentContextNote ?? null)}
            type="button"
          >
            Branch
          </button>
          {!isMobile && (
            <button
              className="topbar-search"
              onClick={() =>
                setSwipeUpNavTarget((current) => (current === 'previous' ? 'next' : 'previous'))
              }
              type="button"
              title="Toggle swipe-up navigation target"
            >
              Swipe Up: {swipeUpNavTarget === 'previous' ? 'Previous' : 'Next'}
            </button>
          )}
          {!isMobile && (
            <button
              className="topbar-search"
              onClick={() =>
                setWheelNavDirection((current) => (current === 'natural' ? 'reverse' : 'natural'))
              }
              type="button"
              title="Toggle scroll direction for wheel note navigation"
            >
              Scroll: {wheelNavDirection === 'natural' ? 'Natural' : 'Reverse'}
            </button>
          )}
          <button className="topbar-search" onClick={() => setSearchOpen(true)} type="button">
            {isMobile ? 'Search' : 'Commands'}
          </button>
        </div>
      </header>
      {(currentParentNote || currentChildNotes.length > 0) && (
        <section className="lineage-strip">
          {currentParentNote && (
            <button
              className="lineage-pill lineage-pill-parent"
              onClick={() => handleOpenLinkedNote(currentParentNote)}
              type="button"
            >
              Back to source: {describeNote(currentParentNote)}
            </button>
          )}
          {currentChildNotes.length > 0 && (
            <div className="lineage-children">
              <span className="lineage-label">Branches</span>
              {currentChildNotes.slice(0, 3).map((child) => (
                <button
                  key={child.id}
                  className="lineage-pill"
                  onClick={() => handleOpenLinkedNote(child)}
                  type="button"
                >
                  {describeNote(child)}
                </button>
              ))}
              {currentChildNotes.length > 3 && (
                <span className="lineage-more">+{currentChildNotes.length - 3} more</span>
              )}
            </div>
          )}
        </section>
      )}

      <TimeMachine
        notes={notes}
        activeNoteId={activeNoteId}
        totalCount={totalCount}
        recentering={recentering}
        navigationEnabled={!searchOpen && !editorSession.editorOpen}
        swipeUpNavTarget={swipeUpNavTarget}
        wheelNavDirection={wheelNavDirection}
        onSelect={selectNote}
        onOpen={handleOpenNote}
        onBranch={handleBranch}
      />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={searchNotes}
        onSelect={handleSearchSelect}
        commandActions={commandActions}
      />

      {editorSession.editor && (
        <Editor session={editorSession} positionLabel={editorPositionLabel} />
      )}
    </div>
  )
}

function SourceSelectionScreen({
  selectingSource,
  selectSourceFile,
}: {
  selectingSource: boolean
  selectSourceFile: () => Promise<void>
}) {
  return (
    <div className="app">
      <div className="empty-panel">
        <div>
          <p className="empty-title">Select a source file to start.</p>
          <p className="empty-copy">
            Made with Love
          </p>
          <button className="btn-primary" onClick={() => void selectSourceFile()} type="button">
            {selectingSource ? 'Selecting...' : 'Choose File'}
          </button>
        </div>
      </div>
    </div>
  )
}

function resolveInitialSortMode(): NoteSortMode {
  if (typeof window === 'undefined') return 'latest'
  const start = new URLSearchParams(window.location.search).get('start')
  return start?.toLowerCase() === 'oldest' ? 'oldest' : 'latest'
}

function resolveInitialCardStackTunerVisibility(): boolean {
  if (typeof window === 'undefined') return false
  if (isLikelyMobileDevice()) return false

  const params = new URLSearchParams(window.location.search)
  const debugCardStack = params.get('card-stack-tuner')?.toLowerCase()
  if (debugCardStack === '1' || debugCardStack === 'true' || debugCardStack === 'on') {
    return true
  }
  if (debugCardStack === '0' || debugCardStack === 'false' || debugCardStack === 'off') {
    return false
  }

  try {
    const persisted = window.localStorage.getItem(CARD_STACK_TUNER_KEY)
    if (persisted === '1') return true
    if (persisted === '0') return false
  } catch {
    // Ignore persistence lookup failures.
  }

  return !import.meta.env.PROD
}

function resolveInitialSwipeUpNavTarget(): SwipeUpNavTarget {
  if (typeof window === 'undefined') return 'previous'

  try {
    const stored = window.localStorage.getItem(SWIPE_UP_NAV_TARGET_KEY)
    if (stored === 'previous' || stored === 'next') return stored
  } catch {
    // Ignore persistence lookup failures.
  }

  return isLikelyMobileDevice() ? 'next' : 'previous'
}

function resolveInitialWheelNavDirection(): WheelNavDirection {
  if (typeof window === 'undefined') return 'natural'

  try {
    const stored = window.localStorage.getItem(WHEEL_NAV_DIRECTION_KEY)
    if (stored === 'natural' || stored === 'reverse') return stored
  } catch {
    // Ignore persistence lookup failures.
  }

  return 'natural'
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
}

function isLikelyMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent.toLowerCase()
  const uaMobile = /android|iphone|ipad|ipod|mobile/.test(ua)
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return uaMobile || coarsePointer
}

function resolveLinkedNote(
  notesById: Map<string, SourceNote>,
  notesByUid: Map<string, SourceNote>,
  noteRef: string | null,
): SourceNote | null {
  if (!noteRef) return null
  return notesById.get(noteRef) ?? notesByUid.get(noteRef) ?? null
}

function describeNote(note: SourceNote): string {
  const title = note.title.trim()
  if (title.length > 0) return title
  if (note.timestamp) return note.timestamp
  return `L${note.startLine}`
}
