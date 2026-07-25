import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { UseAudioNoteRecorderResult } from '../hooks/use-audio-note-recorder'
import type { UseEditorSessionResult } from '../hooks/use-editor-session'
import { type VoiceRecordingConfig } from '../lib/voice-recording-config'
import {
  resolveRecordingsPanelOpen,
  resolveVoiceContinueControl,
  type VoicePanelPreference,
} from '../lib/voice-panel-state'
import { parseVoiceTranscriptTime } from '../lib/voice-transcript'
import { extractAudioCaptureReferences } from '../../core/audio/audio-store'
import { formatElapsed, VoiceRecordingsPanel } from './VoiceRecordingsPanel'

type MobileNavTarget = 'older' | 'newer'

const MOBILE_NAV_REPEAT_DELAY_MS = 320
const MOBILE_NAV_REPEAT_INTERVAL_MS = 170

interface EditorProps {
  session: UseEditorSessionResult
  positionLabel: string
  isMobile: boolean
  canOpenOlderNote: boolean
  canOpenNewerNote: boolean
  audioRecorder: UseAudioNoteRecorderResult
  audioNoteMessage: string | null
  audioTranscriptRefreshKey: number
  liveVoicePeaks: () => number[]
  voiceRecordingConfig: VoiceRecordingConfig
  voiceConfigOpen: boolean
  sourcePath: string
  onVoiceConfigOpenChange: (open: boolean) => void
  onVoiceRecordingConfigChange: (patch: Partial<VoiceRecordingConfig>) => void
  onVoiceCapture: () => void
  onSelectVoiceCredentialFile: () => Promise<void>
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
  audioRecorder,
  audioNoteMessage,
  audioTranscriptRefreshKey,
  liveVoicePeaks,
  voiceRecordingConfig,
  voiceConfigOpen,
  sourcePath,
  onVoiceConfigOpenChange,
  onVoiceRecordingConfigChange,
  onVoiceCapture,
  onSelectVoiceCredentialFile,
  onOpenSearch,
  onOpenOlderNote,
  onOpenNewerNote,
}: EditorProps) {
  const editor = session.editor
  const shellRef = useRef<HTMLDivElement | null>(null)
  const navRepeatTimerRef = useRef<number | null>(null)
  const ignorePointerClickRef = useRef(false)
  const [panelPreference, setPanelPreference] = useState<VoicePanelPreference>('auto')
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
  const hasLinkedAudio = editor ? extractAudioCaptureReferences(editor.body).length > 0 : false
  const hasRecorderAudio = Boolean(audioRecorder.audioUrl || audioRecorder.audioBlob) || audioRecorder.status === 'stopped'
  const showRecordingsPanel = resolveRecordingsPanelOpen({
    preference: panelPreference,
    hasLinkedAudio,
    recorderActive: audioRecorder.recording || hasRecorderAudio,
    voiceConfigOpen,
  })
  const voiceControl = resolveVoiceContinueControl({
    status: audioRecorder.status,
    recording: audioRecorder.recording,
    hasLinkedAudio,
    mediaRecorderAvailable: audioRecorder.mediaRecorderAvailable,
    elapsedLabel: formatElapsed(audioRecorder.elapsedMs),
  })

  function handleVoiceControlClick() {
    // Toggling only reveals or hides an existing voice note; it never records.
    if (voiceControl.action === 'toggle-panel') {
      setPanelPreference(showRecordingsPanel ? 'closed' : 'open')
      return
    }
    setPanelPreference('open')
    onVoiceCapture()
  }

  const handleBodyRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      session.bodyRef.current = element
      if (element) resizeTextareaToContent(element)
    },
    [session.bodyRef],
  )

  useEffect(() => {
    if (!editor?.editing || !session.bodyRef.current) return
    resizeTextareaToContent(session.bodyRef.current)
  }, [editor?.body, editor?.editing, session.bodyRef])

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

  // Hiding the panel lasts for the note being read, not for every note after it.
  useEffect(() => {
    setPanelPreference('auto')
  }, [editor?.sessionKey])

  useEffect(() => {
    if (voiceConfigOpen) {
      setPanelPreference('open')
    }
  }, [voiceConfigOpen])

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return

    const root = document.documentElement
    const viewport = window.visualViewport
    const updateInset = () => {
      const rawInset = viewport ? window.innerHeight - viewport.height - viewport.offsetTop : 0
      root.style.setProperty('--editor-keyboard-inset', `${rawInset > 80 ? Math.round(rawInset) : 0}px`)
      window.setTimeout(() => scrollFocusedEditorControlIntoView(shellRef.current), 40)
    }
    const handleFocusIn = () => {
      window.setTimeout(() => scrollFocusedEditorControlIntoView(shellRef.current), 80)
    }

    updateInset()
    viewport?.addEventListener('resize', updateInset)
    viewport?.addEventListener('scroll', updateInset)
    window.addEventListener('resize', updateInset)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('selectionchange', handleFocusIn)
    document.addEventListener('input', handleFocusIn, true)
    return () => {
      viewport?.removeEventListener('resize', updateInset)
      viewport?.removeEventListener('scroll', updateInset)
      window.removeEventListener('resize', updateInset)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('selectionchange', handleFocusIn)
      document.removeEventListener('input', handleFocusIn, true)
      root.style.removeProperty('--editor-keyboard-inset')
    }
  }, [isMobile])

  if (!editor) return null

  return (
    <article className="note-editor">
      <div ref={shellRef} className="note-editor-shell">
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
              <button
                className={`recordings-stealth-toggle${showRecordingsPanel ? ' recordings-stealth-toggle--active' : ''}`}
                onClick={handleVoiceControlClick}
                disabled={voiceControl.disabled}
                type="button"
                aria-expanded={showRecordingsPanel}
                aria-label={voiceControl.hint}
                title={voiceControl.hint}
              >
                {audioRecorder.recording ? (
                  <span className="recordings-stealth-dot recordings-stealth-dot--active" />
                ) : (
                  <svg
                    className="recordings-stealth-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="2" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                  </svg>
                )}
                <span>{voiceControl.label}</span>
              </button>
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
        <div className={`note-editor-content${showRecordingsPanel ? ' note-editor-content--with-recordings' : ''}`}>
          <div className="note-editor-main">
            {editor.editing ? (
              <textarea
                ref={handleBodyRef}
                className="note-editor-body note-editor-body--edit"
                value={editor.body}
                onChange={(event) => session.updateBody(event.target.value)}
                onKeyDown={session.handleBodyKeyDown}
              />
            ) : (
              <ReadableNoteBody body={editor.body} sessionId={voiceSessionIdForBody(editor.body)} />
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

          {showRecordingsPanel && (
            <VoiceRecordingsPanel
              audioRecorder={audioRecorder}
              audioNoteMessage={audioNoteMessage}
              voiceRecordingConfig={voiceRecordingConfig}
              voiceConfigOpen={voiceConfigOpen}
              hasLinkedAudio={hasLinkedAudio}
              body={editor.body}
              sourcePath={sourcePath}
              audioTranscriptRefreshKey={audioTranscriptRefreshKey}
              liveVoicePeaks={liveVoicePeaks}
              onVoiceCapture={onVoiceCapture}
              onVoiceConfigOpenChange={onVoiceConfigOpenChange}
              onVoiceRecordingConfigChange={onVoiceRecordingConfigChange}
              onSelectVoiceCredentialFile={onSelectVoiceCredentialFile}
              onClose={() => {
                setPanelPreference('closed')
                onVoiceConfigOpenChange(false)
              }}
            />
          )}
        </div>
      </div>
    </article>
  )
}

function ReadableNoteBody({ body, sessionId }: { body: string; sessionId: string | null }) {
  const readableBody = body
    .split('\n')
    .filter((line) => !/^\s*Audio recording:\s+/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  const timestampPattern = /\[(\d+:\d{2}(?::\d{2})?)\]/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of readableBody.matchAll(timestampPattern)) {
    const label = match[1] ?? ''
    const timeMs = parseVoiceTranscriptTime(label)
    const startIndex = match.index ?? 0

    parts.push(readableBody.slice(lastIndex, startIndex))
    if (sessionId && timeMs !== null) {
      parts.push(
        <button
          key={`${startIndex}-${label}`}
          className="voice-transcript-time-link"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('branch-continue:voice-seek', {
              detail: { id: sessionId, timeMs },
            }))
          }}
          type="button"
        >
          [{label}]
        </button>,
      )
    } else {
      parts.push(match[0])
    }
    lastIndex = startIndex + match[0].length
  }

  parts.push(readableBody.slice(lastIndex))
  return <pre className="note-editor-body">{parts}</pre>
}

function voiceSessionIdForBody(body: string): string | null {
  const all = extractAudioCaptureReferences(body)
  const references = all.filter((reference) => reference.kind === 'file')
  const displayReferences = references.length > 0 ? references : all
  if (displayReferences.length === 0) return null
  return displayReferences.map((reference) => reference.key).join('|')
}




function resizeTextareaToContent(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.max(textarea.scrollHeight, 220)}px`
}

function scrollFocusedEditorControlIntoView(shell: HTMLDivElement | null): void {
  if (!shell) return
  const target = document.activeElement
  if (!(target instanceof HTMLElement) || !target.closest('.note-editor')) return

  const shellRect = shell.getBoundingClientRect()
  const targetRect = focusedControlRect(target)
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
  const visibleTop = Math.max(shellRect.top, viewportTop) + 18
  const visibleBottom = Math.min(shellRect.bottom, viewportBottom) - 28

  if (targetRect.bottom > visibleBottom) {
    shell.scrollBy({ top: targetRect.bottom - visibleBottom, behavior: 'smooth' })
    return
  }

  if (targetRect.top < visibleTop) {
    shell.scrollBy({ top: targetRect.top - visibleTop, behavior: 'smooth' })
  }
}

function focusedControlRect(target: HTMLElement): Pick<DOMRect, 'top' | 'bottom'> {
  const targetRect = target.getBoundingClientRect()
  if (!(target instanceof HTMLTextAreaElement)) return targetRect

  const style = window.getComputedStyle(target)
  const fontSize = Number.parseFloat(style.fontSize) || 16
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.9
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingRight = Number.parseFloat(style.paddingRight) || 0
  const availableWidth = Math.max(fontSize, target.clientWidth - paddingLeft - paddingRight)
  const charsPerLine = Math.max(1, Math.floor(availableWidth / Math.max(fontSize * 0.58, 1)))
  const textBeforeCaret = target.value.slice(0, target.selectionStart ?? 0)
  const visualLineIndex = textBeforeCaret.split('\n').reduce((count, line) => {
    return count + Math.max(1, Math.ceil(line.length / charsPerLine))
  }, 0) - 1
  const top = targetRect.top + paddingTop + Math.max(0, visualLineIndex) * lineHeight

  return { top, bottom: top + lineHeight }
}
