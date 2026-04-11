import { useMemo, type WheelEvent as ReactWheelEvent } from 'react'
import type { UseEditorSessionResult } from '../hooks/use-editor-session'

interface EditorProps {
  session: UseEditorSessionResult
  positionLabel: string
}

export function Editor({ session, positionLabel }: EditorProps) {
  const editor = session.editor
  const saveIndicatorTitle = useMemo(
    () =>
      session.autoSaveEnabled
        ? 'Auto-save on - double-click to toggle'
        : 'Auto-save off - double-click to toggle',
    [session.autoSaveEnabled],
  )

  if (!editor) return null

  const handleBodyWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.currentTarget.scrollTop += event.deltaY
    event.currentTarget.scrollLeft += event.deltaX
  }

  return (
    <article className="note-editor">
      <div className="note-editor-shell">
        <div className="note-editor-header">
          <div className="note-editor-title-area">
            {editor.title ? (
              editor.editing && editor.editingTitle ? (
                <input
                  ref={session.titleInputRef}
                  className="note-editor-title-input"
                  value={editor.title}
                  onChange={(event) => session.updateTitle(event.target.value)}
                  onBlur={session.stopTitleEdit}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      session.submitTitleEdit()
                    }
                  }}
                />
              ) : (
                <h2
                  className={`note-editor-title ${editor.editing ? 'note-editor-title--editable' : ''}`}
                  onClick={editor.editing ? session.beginTitleEdit : undefined}
                >
                  {editor.title}
                </h2>
              )
            ) : (
              <>
                {editor.timestamp &&
                  (editor.editing && editor.editingTimestamp ? (
                    <input
                      ref={session.timestampInputRef}
                      className="note-editor-timestamp-input note-editor-timestamp-input--promoted"
                      value={editor.timestamp}
                      onChange={(event) => session.updateTimestamp(event.target.value)}
                      onBlur={session.stopTimestampEdit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          session.submitTimestampEdit()
                        }
                        if (event.key === 'Backspace' && !event.currentTarget.value) {
                          event.preventDefault()
                          session.moveTimestampEditToTitle()
                        }
                      }}
                    />
                  ) : (
                    <h2
                      className="note-editor-timestamp note-editor-timestamp--promoted"
                      onClick={editor.editing ? session.beginTimestampEdit : undefined}
                    >
                      {editor.timestamp}
                    </h2>
                  ))}
                {editor.editing && !editor.editingTitle && (
                  <span className="note-editor-add-title" onClick={session.beginTitleEdit}>
                    + add title
                  </span>
                )}
                {editor.editing && editor.editingTitle && (
                  <input
                    ref={session.titleInputRef}
                    className="note-editor-title-input"
                    value={editor.title}
                    placeholder=""
                    onChange={(event) => session.updateTitle(event.target.value)}
                    onBlur={session.stopTitleEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        session.finishTitleEditToTags()
                      }
                    }}
                  />
                )}
              </>
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
            {editor.editing && (
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
            <button className="btn-primary" onClick={() => void session.handleBranchFromEditor()} type="button">
              Branch
            </button>
            <button className="btn-secondary" onClick={session.closeEditor} type="button">
              Close
            </button>
          </div>
        </div>

        {editor.title && editor.timestamp && (
          <div className="note-editor-timestamp-row note-editor-timestamp-row--demoted">
            {editor.editing && editor.editingTimestamp ? (
              <input
                ref={session.timestampInputRef}
                className="note-editor-timestamp-input"
                value={editor.timestamp}
                onChange={(event) => session.updateTimestamp(event.target.value)}
                onBlur={session.stopTimestampEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    session.submitTimestampEdit()
                  }
                  if (event.key === 'Backspace' && !event.currentTarget.value) {
                    event.preventDefault()
                    session.moveTimestampEditToTitle()
                  }
                }}
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
            ref={session.bodyRef}
            className="note-editor-body note-editor-body--edit"
            value={editor.body}
            onChange={(event) => session.updateBody(event.target.value)}
            onKeyDown={session.handleBodyKeyDown}
            onWheel={handleBodyWheel}
          />
        ) : (
          <pre className="note-editor-body" onWheel={handleBodyWheel}>
            {editor.body}
          </pre>
        )}
      </div>
    </article>
  )
}
