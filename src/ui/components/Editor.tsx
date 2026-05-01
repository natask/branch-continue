import { useCallback, useEffect, useMemo, useRef } from 'react'
import type React from 'react'
import type { UseEditorSessionResult } from '../hooks/use-editor-session'

type MobileNavTarget = 'older' | 'newer'

const MOBILE_NAV_REPEAT_DELAY_MS = 320
const MOBILE_NAV_REPEAT_INTERVAL_MS = 170

interface EditorProps {
  session: UseEditorSessionResult
  positionLabel: string
  isMobile: boolean
  canOpenOlderNote: boolean
  canOpenNewerNote: boolean
  onOpenSearch: () => void
  onOpenOlderNote: () => void
  onOpenNewerNote: () => void
}

export function Editor({
  session,
  positionLabel,
  isMobile,
  canOpenOlderNote,
  canOpenNewerNote,
  onOpenSearch,
  onOpenOlderNote,
  onOpenNewerNote,
}: EditorProps) {
  const editor = session.editor
  const navRepeatTimerRef = useRef<number | null>(null)
  const ignorePointerClickRef = useRef(false)
  const navStateRef = useRef({
    older: onOpenOlderNote,
    newer: onOpenNewerNote,
    canOlder: canOpenOlderNote,
    canNewer: canOpenNewerNote,
  })
  navStateRef.current = {
    older: onOpenOlderNote,
    newer: onOpenNewerNote,
    canOlder: canOpenOlderNote,
    canNewer: canOpenNewerNote,
  }
  const saveIndicatorTitle = useMemo(
    () =>
      session.autoSaveEnabled
        ? 'Auto-save on - double-click to toggle'
        : 'Auto-save off - double-click to toggle',
    [session.autoSaveEnabled],
  )

  const handleBodyRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      session.bodyRef.current = element
    },
    [session.bodyRef],
  )

  function stopMobileNavRepeat() {
    if (navRepeatTimerRef.current === null) return
    window.clearTimeout(navRepeatTimerRef.current)
    navRepeatTimerRef.current = null
  }

  function runMobileNav(target: MobileNavTarget) {
    const nav = navStateRef.current
    if (target === 'older') {
      if (!nav.canOlder) return false
      nav.older()
      return true
    }
    if (!nav.canNewer) return false
    nav.newer()
    return true
  }

  function cancelMobileNavRepeat() {
    stopMobileNavRepeat()
    ignorePointerClickRef.current = false
  }

  function startMobileNavRepeat(target: MobileNavTarget, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !runMobileNav(target)) return
    event.preventDefault()
    ignorePointerClickRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    stopMobileNavRepeat()

    const repeat = () => {
      if (!runMobileNav(target)) {
        stopMobileNavRepeat()
        return
      }
      navRepeatTimerRef.current = window.setTimeout(repeat, MOBILE_NAV_REPEAT_INTERVAL_MS)
    }

    navRepeatTimerRef.current = window.setTimeout(repeat, MOBILE_NAV_REPEAT_DELAY_MS)
  }

  function handleMobileNavClick(target: MobileNavTarget) {
    if (ignorePointerClickRef.current) {
      ignorePointerClickRef.current = false
      return
    }
    runMobileNav(target)
  }

  useEffect(() => () => stopMobileNavRepeat(), [])

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return

    const root = document.documentElement
    const viewport = window.visualViewport
    const updateInset = () => {
      const rawInset = viewport ? window.innerHeight - viewport.height - viewport.offsetTop : 0
      root.style.setProperty('--editor-keyboard-inset', `${rawInset > 80 ? Math.round(rawInset) : 0}px`)
    }

    updateInset()
    viewport?.addEventListener('resize', updateInset)
    viewport?.addEventListener('scroll', updateInset)
    window.addEventListener('resize', updateInset)
    return () => {
      viewport?.removeEventListener('resize', updateInset)
      viewport?.removeEventListener('scroll', updateInset)
      window.removeEventListener('resize', updateInset)
      root.style.removeProperty('--editor-keyboard-inset')
    }
  }, [isMobile])

  if (!editor) return null

  return (
    <article className="note-editor">
      <div className="note-editor-shell">
        <div className="note-editor-header">
          <div className="note-editor-title-area">
            {editor.editing && editor.editingTitle ? (
              <input
                ref={session.titleInputRef}
                className="note-editor-title-input"
                value={editor.title}
                onChange={(event) => session.updateTitle(event.target.value)}
                onBlur={session.stopTitleEdit}
                onKeyDown={session.handleTitleKeyDown}
              />
            ) : editor.title ? (
              <h2
                className={`note-editor-title ${editor.editing ? 'note-editor-title--editable' : ''}`}
                onClick={editor.editing ? session.beginTitleEdit : undefined}
              >
                {editor.title}
              </h2>
            ) : (
              editor.editing && (
                <span className="note-editor-add-title" onClick={session.beginTitleEdit}>
                  + add title
                </span>
              )
            )}
          </div>

          <div className="note-editor-actions">
            <button
              className={`save-icon-btn ${
                session.saveError
                  ? 'save-icon--error'
                  : session.saving || editor.dirty
                    ? 'save-icon--unsaved'
                    : 'save-icon--saved'
              }${!session.autoSaveEnabled ? ' save-icon--autosave-off' : ''}`}
              onDoubleClick={session.toggleAutoSave}
              onClick={session.handleSaveIndicatorClick}
              type="button"
              title={saveIndicatorTitle}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {!session.autoSaveEnabled && <span className="save-icon-slash" />}
            </button>
            {editor.editing && !isMobile && (
              <>
                <button
                  className="btn-icon"
                  onClick={session.handleUndo}
                  disabled={!session.canUndo}
                  type="button"
                  title="Undo"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
                <button
                  className="btn-icon"
                  onClick={session.handleRedo}
                  disabled={!session.canRedo}
                  type="button"
                  title="Redo"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
                  </svg>
                </button>
              </>
            )}
            <button
              className={`btn-icon ${!editor.editing ? 'btn-icon--active' : ''}`}
              onClick={session.toggleEdit}
              type="button"
              title={editor.editing ? 'Switch to read mode' : 'Switch to edit mode'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <div className="note-editor-branch-close">
              <button className="btn-secondary" onClick={onOpenSearch} type="button">
                {isMobile ? 'Search' : 'Commands'}
              </button>
              <button className="btn-primary" onClick={() => void session.handleBranchFromEditor()} type="button">
                Branch
              </button>
              <button className="btn-secondary" onClick={session.closeEditor} type="button">
                Close
              </button>
            </div>
          </div>
        </div>

        {editor.timestamp && (
          <div className="note-editor-timestamp-row note-editor-timestamp-row--demoted">
            {editor.editing && editor.editingTimestamp ? (
              <input
                ref={session.timestampInputRef}
                className="note-editor-timestamp-input"
                value={editor.timestamp}
                onChange={(event) => session.updateTimestamp(event.target.value)}
                onBlur={session.stopTimestampEdit}
                onKeyDown={session.handleTimestampKeyDown}
              />
            ) : (
              <span
                className="note-editor-timestamp note-editor-timestamp--demoted"
                onClick={editor.editing ? session.beginTimestampEdit : undefined}
              >
                {editor.timestamp}
              </span>
            )}
          </div>
        )}

        <div className="note-editor-tagline">
          {editor.tags.map((tag, index) =>
            editor.editing && editor.editingTagIndex === index ? (
              <input
                key={index}
                className="tm-tag-edit-input"
                value={editor.editingTagValue}
                onChange={(event) => session.updateEditingTagValue(event.target.value)}
                onKeyDown={session.handleEditingTagKeyDown}
                onBlur={session.commitTagEdit}
                autoFocus
                size={Math.max(3, editor.editingTagValue.length + 1)}
              />
            ) : (
              <span
                key={index}
                className="tm-tag tm-tag--inline"
                onClick={() => editor.editing && session.startEditingTag(index)}
              >
                {tag}
                {editor.editing && (
                  <button
                    className="tm-tag-delete"
                    onClick={(event) => {
                      event.stopPropagation()
                      session.removeTag(tag)
                    }}
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                  >
                    &times;
                  </button>
                )}
              </span>
            ),
          )}
          {editor.editing && (
            <input
              ref={session.tagInputRef}
              className="note-editor-tag-input"
              value={editor.tagInput}
              onChange={(event) => session.handleTagInputChange(event.target.value)}
              onKeyDown={session.handleTagInputKeyDown}
              placeholder=""
              size={Math.max(4, (editor.tagInput?.length || 0) + 2)}
            />
          )}
          <span className="note-editor-position">{positionLabel}</span>
        </div>

        {session.saveError && <p className="status-error">{session.saveError}</p>}

        {editor.editing ? (
          <textarea
            ref={handleBodyRef}
            className="note-editor-body note-editor-body--edit"
            value={editor.body}
            onChange={(event) => session.updateBody(event.target.value)}
            onKeyDown={session.handleBodyKeyDown}
          />
        ) : (
          <pre className="note-editor-body">
            {editor.body}
          </pre>
        )}

        {isMobile && (
          <div className="note-editor-mobile-nav" aria-label="Note navigation">
            <button
              className="btn-secondary note-editor-mobile-nav-btn"
              onPointerDown={(event) => startMobileNavRepeat('older', event)}
              onPointerUp={stopMobileNavRepeat}
              onPointerCancel={cancelMobileNavRepeat}
              onLostPointerCapture={stopMobileNavRepeat}
              onClick={() => handleMobileNavClick('older')}
              disabled={!canOpenOlderNote}
              type="button"
            >
              Older
            </button>
            <button
              className="btn-primary note-editor-mobile-nav-btn note-editor-mobile-nav-search"
              onClick={onOpenSearch}
              type="button"
            >
              Search Notes
            </button>
            <button
              className="btn-secondary note-editor-mobile-nav-btn"
              onPointerDown={(event) => startMobileNavRepeat('newer', event)}
              onPointerUp={stopMobileNavRepeat}
              onPointerCancel={cancelMobileNavRepeat}
              onLostPointerCapture={stopMobileNavRepeat}
              onClick={() => handleMobileNavClick('newer')}
              disabled={!canOpenNewerNote}
              type="button"
            >
              Newer
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
