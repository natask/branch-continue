import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from './ui/hooks/use-app'
import { Editor } from './ui/components/Editor'
import { SearchModal } from './ui/components/SearchModal'
import { TimeMachine } from './ui/components/TimeMachine'

export default function App() {
  const {
    ready,
    error,
    pages,
    activePageId,
    activeContent,
    activeTitle,
    createPage,
    selectPage,
    updateContent,
    updateTitle,
    branchPage,
    searchPages,
  } = useApp()

  const [searchOpen, setSearchOpen] = useState(false)
  const [timeMachineOpen, setTimeMachineOpen] = useState(false)
  const [branchToast, setBranchToast] = useState(false)
  const emptyRef = useRef<HTMLDivElement>(null)

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K — search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
        return
      }

      // Escape — close search, or toggle Time Machine
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          return
        }
        if (timeMachineOpen) {
          setTimeMachineOpen(false)
          return
        }
        if (pages.length > 0) {
          setTimeMachineOpen(true)
        }
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, timeMachineOpen, pages.length])

  // Auto-focus empty state
  useEffect(() => {
    if (ready && !activePageId && emptyRef.current) {
      emptyRef.current.focus()
    }
  }, [ready, activePageId])

  const handleSearchSelect = useCallback(
    (id: string) => {
      selectPage(id)
      setSearchOpen(false)
      setTimeMachineOpen(false)
    },
    [selectPage],
  )

  const handleTimeMachineSelect = useCallback(
    (id: string) => {
      selectPage(id)
      setTimeMachineOpen(false)
    },
    [selectPage],
  )

  const handleBranch = useCallback(async () => {
    await branchPage()
    setBranchToast(true)
    setTimeout(() => setBranchToast(false), 1400)
  }, [branchPage])

  // Empty state: first keystroke creates a page
  const handleEmptyKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const char = e.key
        await createPage()
        await updateContent(char)
      }
    },
    [createPage, updateContent],
  )

  if (error) {
    return (
      <div className="loading">
        <div style={{ textAlign: 'center', maxWidth: 500 }}>
          <p style={{ marginBottom: 8 }}>Database failed to initialize.</p>
          <pre
            style={{
              textAlign: 'left',
              fontSize: '0.75rem',
              background: '#131825',
              padding: 12,
              borderRadius: 6,
              overflow: 'auto',
              marginBottom: 12,
              color: '#5a6580',
            }}
          >
            {error}
          </pre>
          <button
            className="btn-create"
            onClick={async () => {
              const dbs = await indexedDB.databases()
              for (const db of dbs) {
                if (db.name) indexedDB.deleteDatabase(db.name)
              }
              window.location.reload()
            }}
          >
            Clear Data &amp; Reload
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return <div className="loading">loading</div>
  }

  return (
    <div className="app">
      {activePageId ? (
        <Editor
          title={activeTitle}
          content={activeContent}
          onTitleChange={updateTitle}
          onContentChange={updateContent}
          onBranch={handleBranch}
        />
      ) : (
        <div className="empty-state" ref={emptyRef} tabIndex={0} onKeyDown={handleEmptyKeyDown}>
          <h1>Branch Continue</h1>
          <p>start typing to create a page</p>
        </div>
      )}

      {/* Shortcut hints — editor mode only */}
      {activePageId && !timeMachineOpen && !searchOpen && (
        <div className="editor-hints">
          <span>
            <kbd>&#x21E7;&#x21B5;</kbd> branch
          </span>
          <span>
            <kbd>esc</kbd> pages
          </span>
          <span>
            <kbd>&#x2318;K</kbd> search
          </span>
        </div>
      )}

      {/* Branch toast */}
      {branchToast && <div className="branch-toast">branched</div>}

      {/* Time Machine navigator */}
      {timeMachineOpen && (
        <TimeMachine
          pages={pages}
          activePageId={activePageId}
          onSelect={handleTimeMachineSelect}
          onClose={() => setTimeMachineOpen(false)}
        />
      )}

      {/* Search */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={searchPages}
        onSelect={handleSearchSelect}
      />
    </div>
  )
}
