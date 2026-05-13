import { useCallback, useEffect, useMemo, useRef } from 'react'
import type React from 'react'
import type { UseAudioNoteRecorderResult } from '../hooks/use-audio-note-recorder'
import type { UseEditorSessionResult } from '../hooks/use-editor-session'
import {
  PRIMARY_VOICE_LANGUAGE_OPTIONS,
  VOICE_LANGUAGE_OPTIONS,
  VOICE_TRANSCRIPTION_MODEL_OPTIONS,
  voiceLanguageLabel,
  voiceModelLabel,
  type VoiceRecordingConfig,
} from '../lib/voice-recording-config'
import { parseVoiceTranscriptTime } from '../lib/voice-transcript'
import { extractAudioCaptureReferences } from '../../core/audio/audio-store'
import { AudioCaptureList } from './AudioCaptureList'
import { AudioPlayer } from './AudioPlayer'

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
  voiceRecordingConfig: VoiceRecordingConfig
  voiceConfigOpen: boolean
  sourcePath: string
  onVoiceConfigOpenChange: (open: boolean) => void
  onVoiceRecordingConfigChange: (patch: Partial<VoiceRecordingConfig>) => void
  onVoiceLanguageCapture: (languageCode: string) => void
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
  voiceRecordingConfig,
  voiceConfigOpen,
  sourcePath,
  onVoiceConfigOpenChange,
  onVoiceRecordingConfigChange,
  onVoiceLanguageCapture,
  onSelectVoiceCredentialFile,
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
  const audioButtonBusy = audioRecorder.status === 'requesting' || audioRecorder.status === 'stopping'
  const audioButtonDisabled = audioButtonBusy || !audioRecorder.mediaRecorderAvailable
  const hasLinkedAudio = editor ? extractAudioCaptureReferences(editor.body).length > 0 : false
  const voiceLanguageActionLabel = audioRecorder.recording
    ? 'Switch recording to'
    : audioRecorder.status === 'stopped' || hasLinkedAudio
      ? 'Continue voice in'
      : 'Start voice in'

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
              <div className="voice-recorder-menu">
                <div className="voice-language-controls" role="group" aria-label="Voice recording language">
                  {PRIMARY_VOICE_LANGUAGE_OPTIONS.map((option) => {
                    const active = voiceRecordingConfig.languageCode === option.code
                    return (
                      <button
                        key={option.code}
                        className={`voice-language-btn${active ? ' voice-language-btn--active' : ''}${active && audioRecorder.recording ? ' voice-language-btn--recording' : ''}`}
                        onClick={() => onVoiceLanguageCapture(option.code)}
                        disabled={audioButtonDisabled}
                        type="button"
                        title={audioRecorder.mediaRecorderAvailable ? `${voiceLanguageActionLabel} ${option.label}` : 'Audio recording is unavailable'}
                        aria-pressed={active}
                      >
                        <span className="voice-language-flag" aria-hidden="true">{option.flag}</span>
                        <span className="voice-language-label">{option.shortLabel}</span>
                      </button>
                    )
                  })}
                </div>
                {audioRecorder.recording && (
                  <button
                    className="btn-secondary voice-recorder-stop"
                    onClick={audioRecorder.stop}
                    disabled={audioRecorder.status === 'stopping'}
                    type="button"
                  >
                    Stop
                  </button>
                )}
                {voiceConfigOpen && (
                  <div className="voice-recorder-config-menu" role="menu" aria-label="Voice recording config">
                    <div className="voice-recorder-config-kicker">Voice recording settings</div>
                    <label className="voice-recorder-field">
                      <span>Language</span>
                      <select
                        value={voiceRecordingConfig.languageCode}
                        onChange={(event) => {
                          const nextLanguageCode = event.target.value
                          onVoiceRecordingConfigChange({ languageCode: nextLanguageCode })
                          audioRecorder.switchLanguage(nextLanguageCode)
                        }}
                      >
                        {VOICE_LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="voice-recorder-field">
                      <span>Transcriber</span>
                      <select
                        value={voiceRecordingConfig.transcriptionMode}
                        onChange={(event) => onVoiceRecordingConfigChange({ transcriptionMode: event.target.value as VoiceRecordingConfig['transcriptionMode'] })}
                      >
                        <option value="chirp3">Google Chirp</option>
                        <option value="off">Save audio only</option>
                      </select>
                    </label>
                    {voiceRecordingConfig.transcriptionMode === 'chirp3' && (
                      <div className="voice-recorder-native-grid">
                        <label className="voice-recorder-field">
                          <span>Project</span>
                          <input
                            value={voiceRecordingConfig.projectId}
                            onChange={(event) => onVoiceRecordingConfigChange({ projectId: event.target.value })}
                            placeholder="gcp-project-id"
                          />
                        </label>
                        <label className="voice-recorder-field">
                          <span>Location</span>
                          <input
                            value={voiceRecordingConfig.location}
                            onChange={(event) => onVoiceRecordingConfigChange({ location: event.target.value })}
                            placeholder="us"
                          />
                        </label>
                        <label className="voice-recorder-field">
                          <span>Speech model</span>
                          <select
                            value={voiceRecordingConfig.model}
                            onChange={(event) => onVoiceRecordingConfigChange({ model: event.target.value })}
                          >
                            {VOICE_TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                              <option key={option.model} value={option.model}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="voice-recorder-field voice-recorder-field--wide">
                          <span>Fallback key path</span>
                          <div className="voice-recorder-file-row">
                            <input
                              value={voiceRecordingConfig.serviceAccountKeyPath}
                              onChange={(event) => onVoiceRecordingConfigChange({ serviceAccountKeyPath: event.target.value })}
                              placeholder="optional if app was built with a key"
                            />
                            <button className="btn-secondary" onClick={() => void onSelectVoiceCredentialFile()} type="button">
                              Choose
                            </button>
                          </div>
                        </label>
                      </div>
                    )}
                    <label className="voice-recorder-field voice-recorder-field--wide">
                      <span>Transcript target</span>
                      <select
                        value={voiceRecordingConfig.insertMode}
                        onChange={(event) => onVoiceRecordingConfigChange({ insertMode: event.target.value as VoiceRecordingConfig['insertMode'] })}
                      >
                        <option value="append">Put transcript under audio link</option>
                        <option value="replace-selection">Overwrite selected note text</option>
                      </select>
                    </label>
                    <p className="voice-recorder-config-note">
                      {voiceRecordingConfig.transcriptionMode === 'off'
                        ? 'Audio will be saved beside this org file in recordings/ and linked without transcription.'
                        : `Audio will be saved beside this org file in recordings/, then ${voiceModelLabel(voiceRecordingConfig.model)} will transcribe ${voiceLanguageLabel(voiceRecordingConfig.languageCode)} and place editable text under the audio link. Use the English/Amharic flags to start or switch recordings.`}
                    </p>
                    <div className="voice-recorder-menu-actions">
                      <button className="btn-secondary" onClick={() => onVoiceConfigOpenChange(false)} type="button">
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
        {(audioRecorder.status !== 'idle' || audioNoteMessage) && (
          <div className="voice-recorder-panel" aria-live="polite">
            <div className="voice-recorder-panel-row">
              <span className={`voice-recorder-dot${audioRecorder.recording ? ' voice-recorder-dot--active' : ''}`} />
              <span>{voiceRecorderStatusLabel(audioRecorder)}</span>
              <span>{voiceLanguageLabel(voiceRecordingConfig.languageCode)}</span>
              <span>{formatElapsed(audioRecorder.elapsedMs)}</span>
              {voiceRecordingConfig.transcriptionMode === 'off' && !audioRecorder.speechRecognitionAvailable && (
                <span className="voice-recorder-muted">live preview unavailable</span>
              )}
            </div>
            {audioRecorder.interimTranscript && (
              <p className="voice-recorder-interim">{audioRecorder.interimTranscript}</p>
            )}
            {audioRecorder.finalTranscript && (
              <p className="voice-recorder-muted">Local preview: {audioRecorder.finalTranscript}</p>
            )}
            {audioRecorder.error && <p className="voice-recorder-error">{audioRecorder.error}</p>}
            {audioNoteMessage && <p className="voice-recorder-muted">{audioNoteMessage}</p>}
            {audioRecorder.audioUrl && !hasLinkedAudio && (
              <div className="voice-recorder-playback">
                <AudioPlayer
                  id="latest-captured-segment"
                  src={audioRecorder.audioUrl}
                  blob={audioRecorder.audioBlob}
                  mimeType={audioRecorder.mimeType ?? undefined}
                  label="Latest captured segment"
                  downloadName={audioDownloadName(audioRecorder.mimeType)}
                  showDownload
                  fallbackDurationMs={audioRecorder.elapsedMs}
                />
                <button className="btn-secondary" onClick={audioRecorder.clear} type="button">
                  Clear
                </button>
              </div>
            )}
          </div>
        )}
        {hasLinkedAudio && <AudioCaptureList body={editor.body} sourcePath={sourcePath} />}

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
    </article>
  )
}

function ReadableNoteBody({ body, sessionId }: { body: string; sessionId: string | null }) {
  const timestampPattern = /\[(\d+:\d{2}(?::\d{2})?)\]/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  for (const match of body.matchAll(timestampPattern)) {
    const label = match[1] ?? ''
    const timeMs = parseVoiceTranscriptTime(label)
    const startIndex = match.index ?? 0

    parts.push(body.slice(lastIndex, startIndex))
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

  parts.push(body.slice(lastIndex))
  return <pre className="note-editor-body">{parts}</pre>
}

function voiceSessionIdForBody(body: string): string | null {
  const all = extractAudioCaptureReferences(body)
  const references = all.filter((reference) => reference.kind === 'file')
  const displayReferences = references.length > 0 ? references : all
  if (displayReferences.length === 0) return null
  return displayReferences.map((reference) => reference.key).join('|')
}

function voiceRecorderStatusLabel(recorder: UseAudioNoteRecorderResult): string {
  if (recorder.status === 'requesting') return 'requesting microphone'
  if (recorder.status === 'recording') return 'recording voice'
  if (recorder.status === 'stopping') return 'stopping recording'
  if (recorder.status === 'stopped') return 'recording saved locally'
  if (recorder.status === 'error') return 'recording error'
  return 'ready to record'
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function audioDownloadName(mimeType: string | null): string {
  if (mimeType?.includes('mp4') || mimeType?.includes('aac')) return 'branch-continue-voice.m4a'
  return 'branch-continue-voice.webm'
}
