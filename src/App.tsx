import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from './ui/hooks/use-app'
import { useEditorSession } from './ui/hooks/use-editor-session'
import { SearchModal } from './ui/components/SearchModal'
import { TimeMachine } from './ui/components/TimeMachine'
import { Editor } from './ui/components/Editor'
import { formatNotePosition, orderNotes, type NoteSortMode } from './ui/lib/note-order'
import type { QuickNoteSearchHit, SourceNote } from './core/quicknote/types'

export default function App() {
  const app = useApp()

  if (app.error) {
    return (
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
  }

  if (!app.ready) {
    return <div className="loading">loading file session</div>
  }

  if (!app.sourceSelected) {
    return <SourceSelectionScreen selectingSource={app.selectingSource} selectSourceFile={app.selectSourceFile} />
  }

  return <LoadedSourceApp app={app} />
}

function LoadedSourceApp({ app }: { app: ReturnType<typeof useApp> }) {
  const {
    notes,
    activeNoteId,
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

  const editorSession = useEditorSession({
    sourceSelected: true,
    createNote,
    updateNote,
  })

  const orderedNotes = useMemo(() => orderNotes(notes, sortMode), [notes, sortMode])
  const currentEditorNoteId = editorSession.editor?.source?.id ?? activeNoteId
  const editorPositionLabel = useMemo(
    () => formatNotePosition(orderedNotes, currentEditorNoteId, totalCount),
    [currentEditorNoteId, orderedNotes, totalCount],
  )

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
        const target = event.target as HTMLElement
        if (target.tagName === 'TEXTAREA') return
        event.preventDefault()
        setSearchOpen((current) => !current)
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

      const boundary = orderedNotes[0]
      if (!boundary) return
      event.preventDefault()
      selectNote(boundary)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editorSession, orderedNotes, searchOpen, selectNote])

  useEffect(() => {
    if (orderedNotes.length === 0) return
    if (activeNoteId && orderedNotes.some((note) => note.id === activeNoteId)) return
    selectNote(orderedNotes[0])
  }, [activeNoteId, orderedNotes, selectNote])

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

  const handleBranch = useCallback(
    (_from: SourceNote) => {
      editorSession.openBranchEditor()
    },
    [editorSession],
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-copy">
          <h1 className="topbar-title">Branch Continue</h1>
          <p className="topbar-path">{sourcePath}</p>
        </div>

        <div className="topbar-meta">
          <label className="topbar-sort" htmlFor="sort-mode">
            <span>Sort</span>
            <select
              id="sort-mode"
              value={sortMode}
              onChange={(event) => {
                const nextSortMode = event.target.value as NoteSortMode
                setSortMode(nextSortMode)
              }}
            >
              <option value="latest">Latest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <span className="meta-pill">{sourceWritable ? 'Direct Auto-Save' : 'Download Auto-Save'}</span>
          <button className="topbar-search" onClick={() => void selectSourceFile()} type="button">
            {selectingSource ? 'Selecting...' : 'Select File'}
          </button>
          <button className="topbar-search" onClick={() => void reloadSource()} type="button">
            Reload
          </button>
          <button className="topbar-search" onClick={editorSession.openBranchEditor} type="button">
            +
          </button>
          <button className="topbar-search" onClick={() => setSearchOpen(true)}>
            Search <kbd>⌘K</kbd>
          </button>
        </div>
      </header>

      <TimeMachine
        notes={notes}
        activeNoteId={activeNoteId}
        sortMode={sortMode}
        totalCount={totalCount}
        recentering={recentering}
        navigationEnabled={!searchOpen && !editorSession.editorOpen}
        onSelect={selectNote}
        onOpen={handleOpenNote}
        onBranch={handleBranch}
      />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={searchNotes}
        onSelect={handleSearchSelect}
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
            Works in browser and Tauri mobile. If direct writes are unavailable, auto-save will
            download an updated copy.
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
