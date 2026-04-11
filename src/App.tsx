import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from './ui/hooks/use-app'
import { useEditorSession } from './ui/hooks/use-editor-session'
import { SearchModal } from './ui/components/SearchModal'
import { TimeMachine } from './ui/components/TimeMachine'
import { Editor } from './ui/components/Editor'
import {
  formatNotePosition,
  orderNotes,
  resolveBoundaryNote,
  type NoteSortMode,
} from './ui/lib/note-order'
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
    sortMode,
  ])

  useEffect(() => {
    if (orderedNotes.length === 0) return
    if (activeNoteId && orderedNotes.some((note) => note.id === activeNoteId)) return
    selectNote(orderedNotes[orderedNotes.length - 1]!)
  }, [activeNoteId, orderedNotes, selectNote])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-copy">
          <h1 className="topbar-title">Branch Continue</h1>
          <p className="topbar-path">{sourcePath}</p>
        </div>

        <div className="topbar-meta">
          <span className="meta-pill">{sourceWritable ? 'Direct Auto-Save' : 'Download Auto-Save'}</span>
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
              onClick={() => {
                const boundary = resolveBoundaryNote(orderedNotes, sortMode)
                if (boundary) selectNote(boundary)
              }}
              type="button"
            >
              Go
            </button>
          </div>
          <button className="topbar-search" onClick={() => void selectSourceFile()} type="button">
            {selectingSource ? 'Selecting...' : 'Select File'}
          </button>
          <button className="topbar-search" onClick={() => void reloadSource()} type="button">
            Reload
          </button>
          <button
            className="topbar-search topbar-search-strong"
            onClick={() => editorSession.openBranchEditor(currentContextNote ?? null)}
            type="button"
          >
            Branch
          </button>
          <button className="topbar-search" onClick={() => setSearchOpen(true)} type="button">
            Search
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
