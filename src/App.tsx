import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAgentRouter } from './core/agents/router'
import { createLocalAgentRuntime } from './core/agents/local-runtime'
import { useApp } from './ui/hooks/use-app'
import { useEditorSession } from './ui/hooks/use-editor-session'
import { SearchModal, type SearchCommandAction } from './ui/components/SearchModal'
import { TimeMachine } from './ui/components/TimeMachine'
import { Editor } from './ui/components/Editor'
import { FactoryPanel } from './ui/factory/FactoryPanel'
import { AgentLinkExperiment } from './ui/experiments/AgentLinkExperiment'
import { AgenticMarkdownPage } from './ui/agentic-markdown/AgenticMarkdownPage'
import { useAgentStation } from './ui/agent-station/use-agent-station'
import { createAgentServiceRuntime } from './ui/agent-runtime/agent-service-runtime'
import { createMasterOrchAgentRuntime } from './ui/agent-runtime/master-orch-runtime'
import {
  useAudioNoteRecorder,
  type AudioRecordingComplete,
  type AudioRecordingStart,
} from './ui/hooks/use-audio-note-recorder'
import { useFactoryWorkspace } from './ui/hooks/use-factory-workspace'
import {
  formatNotePosition,
  orderNotes,
  resolveBoundaryNote,
  type NoteSortMode,
} from './ui/lib/note-order'
import {
  appendAudioCaptureReference,
  cleanVoiceTranscriptSegment,
  upsertAudioCaptureReference,
} from './ui/lib/voice-transcript'
import {
  buildAgentResponseBody,
  extractLatestAgentPrompt,
  shortAgentTitle,
  type AgentLaunchSummary,
} from './ui/lib/agent-links'
import {
  normalizeVoiceRecordingConfig,
  persistVoiceRecordingConfig,
  resolveInitialVoiceRecordingConfig,
  type VoiceRecordingConfig,
} from './ui/lib/voice-recording-config'
import { shouldOpenCommandPalette } from './ui/lib/keyboard-shortcuts'
import { createVoiceNoteCommandActions } from './ui/lib/voice-note-command-actions'
import {
  createAudioCaptureId,
  extractAudioCaptureReferences,
  loadAudioCaptureSession,
  preallocateAudioCapture,
  resolveAudioCaptureResumeSession,
  registerAudioCaptureSessionSegment,
  saveAudioCapture,
  saveAudioCapturePeaks,
  saveAudioTranscriptSegment,
  type PreallocatedAudioCapture,
} from './core/audio/audio-store'
import { createSessionPeakAccumulator, SESSION_PEAKS_PER_SECOND } from './core/audio/audio-session'
import { transcribeAudioWithChirp } from './core/audio/chirp-transcription'
import type { QuickNoteSearchHit, SourceNote } from './core/quicknote/types'

const CARD_STACK_TUNER_KEY = 'branch-continue:show-card-stack-tuner'
const MOBILE_PREVIEW_KEY = 'branch-continue:mobile-preview'
const SCROLL_DIRECTION_KEY = 'branch-continue:scroll-direction:v1'
const NOTE_NAV_SCROLL_STEP_PX = 40

type SwipeUpNavTarget = 'previous' | 'next'
type WheelNavDirection = 'natural' | 'reverse'
type ScrollDirectionViewport = 'desktop' | 'mobile'
type WheelNavDirectionByViewport = Partial<Record<ScrollDirectionViewport, WheelNavDirection>>

export default function App() {
  if (isAgenticMarkdownRoute()) {
    return <AgenticMarkdownPage />
  }

  if (isAgentLinkExperimentRoute()) {
    return <AgentLinkExperiment />
  }

  return <SourceBackedApp />
}

function SourceBackedApp() {
  const app = useApp()
  const [isMobileDevice, setIsMobileDevice] = useState(() => isLikelyMobileDevice())
  const [mobilePreview, setMobilePreview] = useState(resolveInitialMobilePreview)
  const isMobile = isMobileDevice || mobilePreview
  const [showCardStackTuner, setShowCardStackTuner] = useState(resolveInitialCardStackTunerVisibility)

  useEffect(() => {
    const updateMobile = () => setIsMobileDevice(isLikelyMobileDevice())
    updateMobile()
    window.addEventListener('resize', updateMobile)
    return () => window.removeEventListener('resize', updateMobile)
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isMobileDevice) return
      const shortcut = event.metaKey || event.ctrlKey
      if (!shortcut || !event.shiftKey || event.key.toLowerCase() !== 'l') return
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      setShowCardStackTuner((current) => !current)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMobileDevice])

  useEffect(() => {
    try {
      window.localStorage.setItem(CARD_STACK_TUNER_KEY, showCardStackTuner ? '1' : '0')
    } catch {
      // Ignore persistence failures.
    }
  }, [showCardStackTuner])

  useEffect(() => {
    if (isMobileDevice && mobilePreview) {
      setMobilePreview(false)
      return
    }
    try {
      window.localStorage.setItem(MOBILE_PREVIEW_KEY, mobilePreview ? '1' : '0')
    } catch {
      // Ignore persistence failures.
    }
  }, [isMobileDevice, mobilePreview])

  useEffect(() => {
    if (isMobileDevice || import.meta.env.PROD) return
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      if (!shortcut || !event.shiftKey || event.key.toLowerCase() !== 'm') return
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      setMobilePreview((current) => !current)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMobileDevice])

  let content: ReactNode
  if (app.error) {
    content = <ErrorRecoveryScreen app={app} />
  } else if (!app.ready) {
    content = <StartupLoadingScreen app={app} />
  } else if (!app.sourceSelected) {
    content = (
      <SourceSelectionScreen
        selectingSource={app.selectingSource}
        selectSourceFile={app.selectSourceFile}
      />
    )
  } else {
    content = (
      <LoadedSourceApp
        app={app}
        isMobile={isMobile}
        isMobileDevice={isMobileDevice}
        mobilePreview={mobilePreview}
        setMobilePreview={setMobilePreview}
        showCardStackTuner={showCardStackTuner}
        setShowCardStackTuner={setShowCardStackTuner}
      />
    )
  }

  return <>{content}</>
}

function StartupLoadingScreen({ app }: { app: ReturnType<typeof useApp> }) {
  return (
    <div className="app">
      <div className="empty-panel">
        <div>
          <p className="empty-title">Restoring file session...</p>
          <div className="empty-actions">
            <button className="btn-primary" onClick={() => void app.selectSourceFile()} type="button">
              {app.selectingSource ? 'Selecting...' : 'Choose File'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoadedSourceApp({
  app,
  isMobile,
  isMobileDevice,
  mobilePreview,
  setMobilePreview,
  showCardStackTuner,
  setShowCardStackTuner,
}: {
  app: ReturnType<typeof useApp>
  isMobile: boolean
  isMobileDevice: boolean
  mobilePreview: boolean
  setMobilePreview: (value: boolean | ((current: boolean) => boolean)) => void
  showCardStackTuner: boolean
  setShowCardStackTuner: (value: boolean | ((current: boolean) => boolean)) => void
}) {
  const {
    notes,
    activeNoteId,
    activeNote,
    totalCount,
    sourcePath,
    selectingSource,
    selectNote,
    searchNotes,
    jumpToSearchHit,
    createNote,
    updateNote,
    selectSourceFile,
    reloadSource,
    canUndoFile,
    canRedoFile,
    undoFile,
    redoFile,
  } = app
  const [searchOpen, setSearchOpen] = useState(false)
  const [sortMode, setSortMode] = useState<NoteSortMode>(resolveInitialSortMode)
  const [wheelNavDirections, setWheelNavDirections] =
    useState<WheelNavDirectionByViewport>(resolveInitialWheelNavDirections)
  const swipeUpNavTarget: SwipeUpNavTarget = 'previous'
  const desktopWheelNavDirection = wheelNavDirections.desktop ?? 'natural'
  const mobileWheelNavDirection = wheelNavDirections.mobile ?? oppositeWheelNavDirection(desktopWheelNavDirection)
  const wheelNavDirection = isMobile ? mobileWheelNavDirection : desktopWheelNavDirection
  const editorWheelAccumRef = useRef(0)
  const beforeEditorBranchRef = useRef<() => Promise<boolean | void>>(async () => true)
  const afterEditorBranchRef = useRef<() => void>(() => {})
  // Set right before a branch stops the parent's recording; consumed once the
  // branch's new session key is live so the child branch can pick up recording
  // where the parent left off instead of requiring another button press.
  const pendingBranchAutoRecordRef = useRef(false)

  const editorSession = useEditorSession({
    sourceSelected: true,
    createNote,
    updateNote,
    beforeBranch: () => beforeEditorBranchRef.current(),
    afterBranch: () => afterEditorBranchRef.current(),
  })
  const editorSessionRef = useRef(editorSession)
  editorSessionRef.current = editorSession
  const audioSegmentQueueRef = useRef<Promise<void>>(Promise.resolve())
  // A pause/resume session has one canonical audio reference in the note.
  // Individual MediaRecorder chunks remain independently persisted so each
  // chunk can be transcribed reliably, but the note always points at the
  // first capture and receives timestamped transcript cues beneath it.
  const audioSessionReferenceRef = useRef(new Map<string, string>())
  // Reserved (id, uri) per new recording session so the note points at the
  // recording from the moment capture starts; segment 0 saves under this id,
  // keeping the early-inserted reference stable with no late body update.
  const preallocatedAudioCaptureRef = useRef(new Map<string, Promise<PreallocatedAudioCapture | null>>())
  // Levels captured live, so WebViews that cannot decode the saved container
  // still have a real waveform to draw.
  const sessionPeaksRef = useRef(createSessionPeakAccumulator())
  const editorBodyMirrorRef = useRef<{ sessionKey: number | null; body: string }>({
    sessionKey: null,
    body: '',
  })
  editorBodyMirrorRef.current = editorSession.editor
    ? { sessionKey: editorSession.editor.sessionKey, body: editorSession.editor.body }
    : { sessionKey: null, body: '' }
  const station = useAgentStation({ sourcePath })
  const agentRouter = useMemo(
    () =>
      createAgentRouter({
        runtimes: [
          createAgentServiceRuntime(),
          createMasterOrchAgentRuntime(station),
          createLocalAgentRuntime(),
        ],
      }),
    [station],
  )
  const [audioNoteMessage, setAudioNoteMessage] = useState<string | null>(null)
  const [audioTranscriptRefreshKey, setAudioTranscriptRefreshKey] = useState(0)
  const [voiceRecordingConfig, setVoiceRecordingConfig] = useState(resolveInitialVoiceRecordingConfig)
  const [voiceConfigOpen, setVoiceConfigOpen] = useState(false)
  const {
    packets: factoryPackets,
    summary: factorySummary,
    selectedPacket: factorySelectedPacket,
    open: factoryOpen,
    setOpen: setFactoryOpen,
    selectPacket: selectFactoryPacket,
    captureIntent: captureFactoryIntent,
    advancePacket: advanceFactoryPacket,
    resetWorkspace: resetFactoryWorkspace,
  } = useFactoryWorkspace()

  useEffect(() => {
    persistVoiceRecordingConfig(voiceRecordingConfig)
  }, [voiceRecordingConfig])

  const updateVoiceRecordingConfig = useCallback((patch: Partial<VoiceRecordingConfig>) => {
    setVoiceRecordingConfig((current) => normalizeVoiceRecordingConfig({ ...current, ...patch }))
  }, [])

  const selectVoiceCredentialFile = useCallback(async () => {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog')
      const selected = await dialog.open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Google ADC or service account JSON',
            extensions: ['json'],
          },
        ],
      })

      if (!selected || Array.isArray(selected)) return
      updateVoiceRecordingConfig({ serviceAccountKeyPath: selected })
      setAudioNoteMessage('Google credential path saved for this app.')
    } catch (error) {
      setAudioNoteMessage(`Could not select GCP key file: ${errorMessage(error)}`)
    }
  }, [updateVoiceRecordingConfig])

  const reserveAudioCaptureReference = useCallback((start: AudioRecordingStart) => {
    if (start.resumed) return
    const pending = preallocateAudioCapture(sourcePath, start.mimeType).catch(() => null)
    preallocatedAudioCaptureRef.current.set(start.sessionId, pending)
    void pending.then((preallocated) => {
      if (!preallocated) return
      const current = editorSessionRef.current.editor
      if (!current || current.sessionKey !== start.ownerSessionKey) return
      const baseBody = editorBodyMirrorRef.current.sessionKey === current.sessionKey
        ? editorBodyMirrorRef.current.body
        : current.body
      const nextBody = appendAudioCaptureReference(baseBody, preallocated.uri)
      if (nextBody === baseBody) return
      editorBodyMirrorRef.current = { sessionKey: current.sessionKey, body: nextBody }
      editorSessionRef.current.updateBody(nextBody)
    })
  }, [sourcePath])

  const processCompletedAudioSegment = useCallback(async (capture: AudioRecordingComplete) => {
    const preallocated = capture.segmentIndex === 0
      ? await (preallocatedAudioCaptureRef.current.get(capture.sessionId) ?? Promise.resolve(null))
      : null
    const id = preallocated?.id ?? createAudioCaptureId()
    const setCaptureMessage = (message: string) => {
      if (editorSessionRef.current.editor?.sessionKey === capture.ownerSessionKey) {
        setAudioNoteMessage(message)
      }
    }
    setCaptureMessage(`Saving voice segment ${capture.segmentIndex + 1}...`)

    let saved: Awaited<ReturnType<typeof saveAudioCapture>>
    try {
      saved = await saveAudioCapture({
        id,
        blob: capture.blob,
        mimeType: capture.mimeType,
        durationMs: capture.durationMs,
        createdAt: capture.stoppedAt,
        sourcePath,
        metadata: {
          sessionId: capture.sessionId,
          segmentIndex: capture.segmentIndex,
          offsetMs: capture.offsetMs,
          languageCode: capture.languageCode,
          segmentStartReason: capture.segmentStartReason,
          final: capture.final,
        },
      })
    } catch (error) {
      setCaptureMessage(`Audio captured, but local save failed: ${errorMessage(error)}`)
      return
    }

    const segmentPeaks = sessionPeaksRef.current.slice(capture.offsetMs, capture.durationMs)
    if (segmentPeaks.some((peak) => peak > 0)) {
      await saveAudioCapturePeaks({
        audio: saved,
        sourcePath,
        peaksPerSecond: SESSION_PEAKS_PER_SECOND,
        durationMs: capture.durationMs,
        peaks: segmentPeaks,
      }).catch(() => null)
    }
    if (capture.final) sessionPeaksRef.current.reset()

    const sessionReference = await registerAudioCaptureSessionSegment(saved, sourcePath)
    audioSessionReferenceRef.current.set(capture.sessionId, sessionReference)
    preallocatedAudioCaptureRef.current.delete(capture.sessionId)
    setAudioTranscriptRefreshKey((current) => current + 1)

    const current = editorSessionRef.current.editor
    if (current && current.sessionKey === capture.ownerSessionKey) {
      const baseBody = editorBodyMirrorRef.current.sessionKey === current.sessionKey
        ? editorBodyMirrorRef.current.body
        : current.body
      // The reference normally already exists from recording start; replace it
      // only if the persisted path diverged from the reserved one.
      const nextBody = preallocated && preallocated.uri !== sessionReference
        ? upsertAudioCaptureReference(baseBody, sessionReference)
        : appendAudioCaptureReference(baseBody, sessionReference)
      if (nextBody !== baseBody) {
        editorBodyMirrorRef.current = { sessionKey: current.sessionKey, body: nextBody }
        editorSessionRef.current.updateBody(nextBody)
      }
      setCaptureMessage(`Audio segment ${capture.segmentIndex + 1} saved to ${saved.uri}.`)
    } else if (!current) {
      setCaptureMessage(`Audio saved as ${saved.uri}. Open a note to paste this reference.`)
    } else {
      // A branch/navigation transition may stop the previous note's recorder.
      // Never attach that final parent segment to the newly opened note.
      // Its save status must not leak into the new note's empty recorder UI.
    }

    if (voiceRecordingConfig.transcriptionMode === 'off') return
    if (!chirpConfigReady(voiceRecordingConfig)) {
      setCaptureMessage(`Audio saved to ${saved.uri}. Choose a Chirp location/model to enable transcription.`)
      return
    }

    setCaptureMessage(`Transcribing voice segment ${capture.segmentIndex + 1} with Chirp 3...`)
    try {
      const transcription = await transcribeAudioWithChirp({
        blob: capture.blob,
        mimeType: capture.mimeType,
        config: voiceRecordingConfig,
      })
      const cleanTranscript = cleanVoiceTranscriptSegment(transcription.transcript)
      if (!cleanTranscript || cleanTranscript === '(no speech detected)') {
        setCaptureMessage(`Audio saved to ${saved.uri}. Chirp 3 did not detect speech.`)
        return
      }

      const savedTranscript = await saveAudioTranscriptSegment({
        sourcePath,
        audio: saved,
        text: cleanTranscript,
        offsetMs: capture.offsetMs,
        languageCode: 'auto',
        sessionId: capture.sessionId,
        segmentIndex: capture.segmentIndex,
        createdAt: new Date().toISOString(),
        durationMs: capture.durationMs,
        words: transcription.words,
      })
      // The raw transcript lives in its timed sidecar and the Raw/Ideas audio
      // views; do not pour dictation text into the user's editable note body.
      setAudioTranscriptRefreshKey((current) => current + 1)
      if (savedTranscript?.storage === 'file' && savedTranscript.transcriptUri) {
        setCaptureMessage(`Transcript saved to ${savedTranscript.transcriptUri}.`)
        return
      }
      setCaptureMessage('Transcript saved in app audio storage.')
    } catch (error) {
      setCaptureMessage(`Audio saved to ${saved.uri}. Transcription failed: ${errorMessage(error)}`)
    }
  }, [sourcePath, voiceRecordingConfig])

  const attachCompletedAudioToCurrentEditor = useCallback((capture: AudioRecordingComplete) => {
    audioSegmentQueueRef.current = audioSegmentQueueRef.current
      .catch(() => undefined)
      .then(() => processCompletedAudioSegment(capture))
    return audioSegmentQueueRef.current
  }, [processCompletedAudioSegment])

  const audioRecorder = useAudioNoteRecorder({
    sessionKey: editorSession.editor?.sessionKey ?? null,
    livePreview: true,
    onRecordingStart: reserveAudioCaptureReference,
    onRecordingComplete: attachCompletedAudioToCurrentEditor,
    onPcmFrame: (frame) => sessionPeaksRef.current.push(frame),
  })

  useEffect(() => {
    // Recorder messages describe one editor session. A branch or navigation
    // starts with a clean voice-note surface even when the previous save just
    // completed successfully.
    setAudioNoteMessage(null)
  }, [editorSession.editor?.sessionKey])

  beforeEditorBranchRef.current = async () => {
    pendingBranchAutoRecordRef.current = audioRecorder.recording
    await audioRecorder.stopAndWait()
    return true
  }
  afterEditorBranchRef.current = () => {
    if (!pendingBranchAutoRecordRef.current) return
    pendingBranchAutoRecordRef.current = false
    // A macrotask delay matters here: the recorder's own sessionKey-boundary
    // effect (use-audio-note-recorder.ts) clears presentation state for the
    // new session via a microtask, and starting synchronously would race it.
    window.setTimeout(() => void audioRecorder.start(undefined, { newSession: true }), 0)
  }

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
  const currentEditorNoteIndex = useMemo(
    () =>
      currentEditorNoteId
        ? orderedNotes.findIndex((note) => note.id === currentEditorNoteId)
        : -1,
    [currentEditorNoteId, orderedNotes],
  )
  const olderEditorNote =
    currentEditorNoteIndex > 0 ? orderedNotes[currentEditorNoteIndex - 1] ?? null : null
  const newerEditorNote =
    currentEditorNoteIndex >= 0 && currentEditorNoteIndex + 1 < orderedNotes.length
      ? orderedNotes[currentEditorNoteIndex + 1] ?? null
      : null

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
  const handleOpenRelativeEditorNote = useCallback(
    (direction: -1 | 1, focusBody = true) => {
      if (currentEditorNoteIndex < 0) return
      const nextNote = orderedNotes[currentEditorNoteIndex + direction]
      if (!nextNote) return
      selectNote(nextNote)
      editorSession.openNoteEditor(nextNote, { focusBody })
    },
    [currentEditorNoteIndex, editorSession, orderedNotes, selectNote],
  )
  const handleOpenOlderEditorNote = useCallback(() => {
    handleOpenRelativeEditorNote(-1, !isMobile)
  }, [handleOpenRelativeEditorNote, isMobile])
  const handleOpenNewerEditorNote = useCallback(() => {
    handleOpenRelativeEditorNote(1, !isMobile)
  }, [handleOpenRelativeEditorNote, isMobile])

  const handleBranch = useCallback(
    async (from: SourceNote) => {
      const canBranch = await beforeEditorBranchRef.current()
      if (canBranch === false) return
      const ok = await editorSessionRef.current.flushAutoSave()
      if (!ok) return
      editorSessionRef.current.openBranchEditor(from)
      afterEditorBranchRef.current()
    },
    [],
  )

  const handleCreateNewNote = useCallback(async () => {
    await audioRecorder.stopAndWait()
    const ok = await editorSessionRef.current.flushAutoSave()
    if (!ok) return
    editorSessionRef.current.openBranchEditor(null)
  }, [audioRecorder.stopAndWait])

  const handleCreateVoiceNote = useCallback(async () => {
    await audioRecorder.stopAndWait()
    const ok = await editorSessionRef.current.flushAutoSave()
    if (!ok) return
    editorSessionRef.current.openBranchEditor(currentContextNote ?? null)
    window.setTimeout(() => void audioRecorder.start(undefined, { newSession: true }), 0)
  }, [audioRecorder.start, audioRecorder.stopAndWait, currentContextNote])

  const handleUpdateVoiceNotePrompt = useCallback(() => {
    if (voiceRecordingConfig.transcriptionMode === 'off') {
      updateVoiceRecordingConfig({ transcriptionMode: 'chirp3' })
    }
    setVoiceConfigOpen(true)
    if (!editorSessionRef.current.editor && currentContextNote) {
      editorSessionRef.current.openNoteEditor(currentContextNote, { focusBody: false })
    }

    const focusPrompt = () => {
      const prompt = document.getElementById('voice-transcription-prompt')
      if (!(prompt instanceof HTMLTextAreaElement)) return
      prompt.focus()
      prompt.select()
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(focusPrompt))
    window.setTimeout(focusPrompt, 100)
  }, [currentContextNote, updateVoiceRecordingConfig, voiceRecordingConfig.transcriptionMode])

  const handleRunLatestAgentPrompt = useCallback(async () => {
    const current = editorSessionRef.current.editor
    const sourceBody = current?.body ?? currentContextNote?.body ?? ''
    const match = extractLatestAgentPrompt(sourceBody)
    if (!match) {
      setAudioNoteMessage('No @agent request found in the current note.')
      return
    }

    const ok = await editorSessionRef.current.flushAutoSave()
    if (!ok) return

    const sourceNote = editorSessionRef.current.editor?.source ?? currentContextNote
    if (!sourceNote) {
      setAudioNoteMessage('Save or open a source note before running an @agent request.')
      return
    }

    setAudioNoteMessage(`Running @${match.agent}: ${shortAgentTitle(match.prompt)}`)
    const result = await agentRouter.route({
      id: createAgentRequestId(),
      agentId: match.agent,
      prompt: match.prompt,
      source: sourceNote.sourcePath,
      context: {
        pageId: sourceNote.noteUid ?? sourceNote.id,
        anchorId: `note:${sourceNote.noteUid ?? sourceNote.id}:line:${match.lineIndex}`,
        threadId: `note-agent:${sourceNote.noteUid ?? sourceNote.id}:${match.lineIndex}`,
        quote: match.line.trim(),
        localContext: sourceBody.trim() || sourceNote.preview,
        documentText: sourceBody,
      },
      metadata: {
        source: 'source-backed-note',
        sourceNoteId: sourceNote.id,
        sourceNoteUid: sourceNote.noteUid,
        sourcePath: sourceNote.sourcePath,
        lineIndex: match.lineIndex,
      },
    })
    const launch = agentWorkResultToLaunchSummary(result, station.dashboardUrl)
    const response = await createNote({
      title: `@${match.agent}: ${shortAgentTitle(match.prompt)}`,
      tags: ['agent', match.agent],
      parentNoteId: sourceNote.noteUid ?? sourceNote.id,
      body: buildAgentResponseBody({
        agent: match.agent,
        prompt: match.prompt,
        sourceNote,
        sourceBody,
        launch,
      }),
    })

    selectNote(response)
    editorSessionRef.current.openNoteEditor(response)
    setAudioNoteMessage(
      launch.status === 'launched'
        ? `@${match.agent} request launched and linked.`
        : `@${match.agent} response note created; ${launch.reason ?? 'agent station is offline'}`,
    )
  }, [agentRouter, createNote, currentContextNote, selectNote, station.dashboardUrl])

  const handleCaptureCurrentFactoryIntent = useCallback(() => {
    const current = editorSessionRef.current.editor
    const intent = current?.body.trim() || currentContextNote?.body.trim() || currentContextNote?.preview.trim() || ''
    if (!intent) {
      setFactoryOpen(true)
      setAudioNoteMessage('Open a note or paste raw intent into the factory panel.')
      return
    }

    const count = captureFactoryIntent(intent)
    setAudioNoteMessage(
      count === 1
        ? 'Factory captured 1 work packet.'
        : `Factory captured ${count} work packets.`,
    )
  }, [captureFactoryIntent, currentContextNote, setFactoryOpen])

  const handleVoiceCapture = useCallback(async () => {
    if (audioRecorder.recording) return
    const currentBody = editorSessionRef.current.editor?.body ?? ''
    const references = extractAudioCaptureReferences(currentBody)
    const reference = references.find((candidate) => candidate.kind === 'file') ?? references[0]
    if (reference && audioRecorder.status === 'idle') {
      try {
        const records = await loadAudioCaptureSession(reference, sourcePath)
        const resumeSession = resolveAudioCaptureResumeSession(records)
        if (!resumeSession) {
          setAudioNoteMessage('This older voice note cannot be resumed yet, but it is still available to play.')
          return
        }
        await audioRecorder.start(undefined, { resumeSession })
        return
      } catch (error) {
        setAudioNoteMessage(`Could not resume this voice note: ${errorMessage(error)}`)
        return
      }
    }
    await audioRecorder.start()
  }, [audioRecorder.recording, audioRecorder.start, audioRecorder.status, sourcePath])

  const handleGoToBoundary = useCallback(() => {
    const boundary = resolveBoundaryNote(orderedNotes, sortMode)
    if (!boundary) return
    selectNote(boundary)
  }, [orderedNotes, selectNote, sortMode])

  const setWheelNavDirectionForViewport = useCallback(
    (viewport: ScrollDirectionViewport, direction: WheelNavDirection) => {
      setWheelNavDirections((current) => {
        if (current[viewport] === direction) return current
        return { ...current, [viewport]: direction }
      })
    },
    [],
  )

  const resetWheelNavDirections = useCallback(() => {
    setWheelNavDirections({})
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(SCROLL_DIRECTION_KEY, JSON.stringify(wheelNavDirections))
    } catch {
      // Ignore persistence failures.
    }
  }, [wheelNavDirections])

  useEffect(() => {
    editorWheelAccumRef.current = 0
  }, [wheelNavDirection])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!shouldOpenCommandPalette(event, { allowShiftX: true })) return
      event.preventDefault()
      setSearchOpen(true)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (editorSession.editor && editorSession.canUndo && shortcut && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        editorSession.handleUndo()
        return
      }

      if (editorSession.editor && editorSession.canRedo && shortcut && ((key === 'z' && event.shiftKey) || key === 'y')) {
        event.preventDefault()
        editorSession.handleRedo()
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

  const commandActions = useMemo<SearchCommandAction[]>(
    () => [
      ...station.actions,
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
      ...createVoiceNoteCommandActions({
        recording: audioRecorder.recording,
        canUpdatePrompt: Boolean(editorSession.editor || currentContextNote),
        onCreate: () => void handleCreateVoiceNote(),
        onUpdatePrompt: handleUpdateVoiceNotePrompt,
      }),
      {
        id: 'create-new-note',
        label: 'Create New Note',
        keywords: ['create', 'new', 'note', 'blank', 'independent'],
        group: 'Actions',
        run: () => void handleCreateNewNote(),
      },
      {
        id: 'branch-current-note',
        label: 'Branch Current Note',
        hint: '⌘↩',
        keywords: ['branch', 'split'],
        group: 'Actions',
        run: () => void editorSession.handleBranchFromEditor(),
      },
      {
        id: 'run-latest-agent-request',
        label: 'Run Latest @agent Request',
        hint: 'current note',
        keywords: ['agent', 'run', 'request', 'mention', 'launch'],
        group: 'Actions',
        disabled: !editorSession.editor && !currentContextNote,
        run: () => void handleRunLatestAgentPrompt(),
      },
      {
        id: 'open-software-factory',
        label: `Factory Status: ${factorySummary.active} Active`,
        keywords: ['factory', 'status', 'ongoing', 'work', 'tasks', 'agents'],
        group: 'Factory',
        run: () => setFactoryOpen(true),
      },
      {
        id: 'capture-current-note-as-factory-intent',
        label: 'Factory: Capture Current Note Intent',
        keywords: ['factory', 'capture', 'intent', 'thread', 'split'],
        group: 'Factory',
        disabled: !editorSession.editor && !currentContextNote,
        run: handleCaptureCurrentFactoryIntent,
      },
      {
        id: 'reset-factory-workspace',
        label: 'Factory: Reset Seed Packets',
        keywords: ['factory', 'reset', 'seed', 'packets'],
        group: 'Factory',
        run: resetFactoryWorkspace,
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
        id: 'open-older-note',
        label: 'Open Older Note',
        keywords: ['older', 'previous', 'back', 'note'],
        group: 'Navigation',
        disabled: !olderEditorNote,
        run: () => {
          if (!olderEditorNote) return
          handleOpenLinkedNote(olderEditorNote)
        },
      },
      {
        id: 'open-newer-note',
        label: 'Open Newer Note',
        keywords: ['newer', 'next', 'forward', 'note'],
        group: 'Navigation',
        disabled: !newerEditorNote,
        run: () => {
          if (!newerEditorNote) return
          handleOpenLinkedNote(newerEditorNote)
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
      ...(!isMobileDevice && !import.meta.env.PROD
        ? [
            {
              id: 'toggle-mobile-preview',
              label: `Mobile Preview: ${mobilePreview ? 'On' : 'Off'}${mobilePreview ? ' (current)' : ''}`,
              keywords: ['mobile', 'preview', 'simulate', 'phone', 'layout'],
              group: 'Settings',
              run: () => setMobilePreview((current) => !current),
            },
          ]
        : []),
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
        id: 'set-desktop-scroll-direction-natural',
        label: `Desktop Scroll Direction: Natural${desktopWheelNavDirection === 'natural' ? ' (current)' : ''}`,
        keywords: ['desktop', 'scroll', 'wheel', 'trackpad', 'direction', 'natural'],
        group: 'Settings',
        run: () => setWheelNavDirectionForViewport('desktop', 'natural'),
      },
      {
        id: 'set-desktop-scroll-direction-reverse',
        label: `Desktop Scroll Direction: Reverse${desktopWheelNavDirection === 'reverse' ? ' (current)' : ''}`,
        keywords: ['desktop', 'scroll', 'wheel', 'trackpad', 'direction', 'reverse', 'invert'],
        group: 'Settings',
        run: () => setWheelNavDirectionForViewport('desktop', 'reverse'),
      },
      {
        id: 'set-mobile-scroll-direction-natural',
        label: `Mobile Scroll Direction: Natural${mobileWheelNavDirection === 'natural' ? ' (current)' : ''}`,
        keywords: ['mobile', 'phone', 'scroll', 'swipe', 'wheel', 'trackpad', 'direction', 'natural'],
        group: 'Settings',
        run: () => setWheelNavDirectionForViewport('mobile', 'natural'),
      },
      {
        id: 'set-mobile-scroll-direction-reverse',
        label: `Mobile Scroll Direction: Reverse${mobileWheelNavDirection === 'reverse' ? ' (current)' : ''}`,
        keywords: ['mobile', 'phone', 'scroll', 'swipe', 'wheel', 'trackpad', 'direction', 'reverse', 'invert'],
        group: 'Settings',
        run: () => setWheelNavDirectionForViewport('mobile', 'reverse'),
      },
      {
        id: 'reset-scroll-directions',
        label: 'Reset Scroll Directions: Desktop Natural, Mobile Reverse',
        keywords: ['scroll', 'wheel', 'trackpad', 'direction', 'reset', 'default'],
        group: 'Settings',
        run: resetWheelNavDirections,
      },
      {
        id: 'toggle-card-stack-tuner',
        label: `${showCardStackTuner ? 'Hide' : 'Show'} Card Stack Tuner`,
        keywords: ['debug', 'leva', 'card stack', 'gesture', 'tune'],
        group: 'Settings',
        run: () => setShowCardStackTuner((current) => !current),
      },
      {
        id: 'close-editor',
        label: 'Close Editor',
        hint: 'Esc',
        keywords: ['close', 'editor', 'exit'],
        group: 'Editor',
        disabled: !editorSession.editor,
        run: () => editorSession.closeEditor(),
      },
      {
        id: 'editor-undo',
        label: 'Undo',
        hint: '⌘Z',
        keywords: ['undo', 'editor', 'history'],
        group: 'History',
        disabled: !editorSession.editor || !editorSession.canUndo,
        run: () => editorSession.handleUndo(),
      },
      {
        id: 'editor-redo',
        label: 'Redo',
        hint: '⌘⇧Z',
        keywords: ['redo', 'editor', 'history'],
        group: 'History',
        disabled: !editorSession.editor || !editorSession.canRedo,
        run: () => editorSession.handleRedo(),
      },
      {
        id: 'file-undo',
        label: 'Undo Last Saved Change',
        keywords: ['undo', 'file', 'saved', 'persistent', 'history'],
        group: 'History',
        disabled: Boolean(editorSession.editor) || !canUndoFile,
        run: () => void undoFile(),
      },
      {
        id: 'file-redo',
        label: 'Redo Last Saved Change',
        keywords: ['redo', 'file', 'saved', 'persistent', 'history'],
        group: 'History',
        disabled: Boolean(editorSession.editor) || !canRedoFile,
        run: () => void redoFile(),
      },
    ],
    [
      currentChildNotes,
      currentContextNote,
      currentParentNote,
      editorSession,
      audioRecorder.recording,
      audioRecorder.status,
      audioRecorder.mediaRecorderAvailable,
      audioRecorder.start,
      audioRecorder.stop,
      handleVoiceCapture,
      handleCreateNewNote,
      handleCreateVoiceNote,
      handleUpdateVoiceNotePrompt,
      handleRunLatestAgentPrompt,
      handleCaptureCurrentFactoryIntent,
      handleGoToBoundary,
      handleOpenLinkedNote,
      factorySummary.active,
      resetFactoryWorkspace,
      setFactoryOpen,
      olderEditorNote,
      newerEditorNote,
      orderedNotes.length,
      reloadSource,
      resetWheelNavDirections,
      selectingSource,
      selectSourceFile,
      station.actions,
      showCardStackTuner,
      isMobileDevice,
      mobilePreview,
      isMobile,
      sortMode,
      swipeUpNavTarget,
      wheelNavDirection,
      desktopWheelNavDirection,
      mobileWheelNavDirection,
      voiceRecordingConfig,
      updateVoiceRecordingConfig,
      canUndoFile,
      canRedoFile,
      undoFile,
      redoFile,
      setWheelNavDirectionForViewport,
      setMobilePreview,
    ],
  )

  return (
    <div className={`app${mobilePreview ? ' app-mobile-preview' : ''}`}>
      <header className="topbar">
        <div className="topbar-copy">
          <h1 className="topbar-title">Branch Continue</h1>
          <p className="topbar-path">{sourcePath}</p>
        </div>

        <div className="topbar-meta">
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
            <button className="topbar-search" onClick={() => void reloadSource()} type="button">
              Reload
            </button>
          )}
          <button
            className="topbar-search"
            onClick={() => setFactoryOpen(true)}
            type="button"
          >
            Factory {factorySummary.active}
          </button>
          <button
            className="topbar-search"
            onClick={() => setShowCardStackTuner((current) => !current)}
            type="button"
          >
            Tune: {showCardStackTuner ? 'On' : 'Off'}
          </button>
          <button className="topbar-search topbar-search-strong" onClick={() => void handleCreateNewNote()} type="button">
            New Note
          </button>
          <div className="topbar-voice-actions" role="group" aria-label="Create voice note">
            {!audioRecorder.recording && (
              <button
                className="topbar-search"
                onClick={() => void handleCreateVoiceNote()}
                disabled={audioRecorder.status === 'requesting' || audioRecorder.status === 'stopping' || !audioRecorder.mediaRecorderAvailable}
                type="button"
              >
                Voice Note
              </button>
            )}
            {audioRecorder.recording && (
              <button className="topbar-search" onClick={audioRecorder.stop} type="button">
                Pause
              </button>
            )}
          </div>
          <button className="topbar-search topbar-search-strong" onClick={() => setSearchOpen(true)} type="button">
            Commands
          </button>
        </div>
      </header>
      <section
        className="lineage-strip"
        style={
          !currentParentNote && currentChildNotes.length === 0
            ? { visibility: 'hidden' }
            : undefined
        }
      >
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

      <TimeMachine
        key={isMobile ? 'mobile-stack' : 'desktop-stack'}
        notes={notes}
        activeNoteId={activeNoteId}
        totalCount={totalCount}
        navigationEnabled={!searchOpen && !factoryOpen && !editorSession.editorOpen}
        swipeUpNavTarget={swipeUpNavTarget}
        wheelNavDirection={wheelNavDirection}
        isMobile={isMobile}
        showGestureTuner={showCardStackTuner && !editorSession.editorOpen}
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
      {station.element}
      <FactoryPanel
        open={factoryOpen}
        packets={factoryPackets}
        summary={factorySummary}
        selectedPacket={factorySelectedPacket}
        stationStatus={{
          configured: station.configured,
          availability: station.availability,
          dashboardUrl: station.dashboardUrl,
        }}
        onClose={() => setFactoryOpen(false)}
        onSelectPacket={selectFactoryPacket}
        onCaptureIntent={captureFactoryIntent}
        onAdvancePacket={advanceFactoryPacket}
        onReset={resetFactoryWorkspace}
      />

      {editorSession.editor && (
        <Editor
          session={editorSession}
          positionLabel={editorPositionLabel}
          isMobile={isMobile}
          canOpenOlderNote={Boolean(olderEditorNote)}
          canOpenNewerNote={Boolean(newerEditorNote)}
          audioRecorder={audioRecorder}
          audioNoteMessage={audioNoteMessage}
          audioTranscriptRefreshKey={audioTranscriptRefreshKey}
          voiceRecordingConfig={voiceRecordingConfig}
          voiceConfigOpen={voiceConfigOpen}
          sourcePath={sourcePath}
          onVoiceConfigOpenChange={setVoiceConfigOpen}
          onVoiceRecordingConfigChange={updateVoiceRecordingConfig}
          onVoiceCapture={handleVoiceCapture}
          onSelectVoiceCredentialFile={selectVoiceCredentialFile}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenOlderNote={handleOpenOlderEditorNote}
          onOpenNewerNote={handleOpenNewerEditorNote}
        />
      )}
    </div>
  )
}

function agentWorkResultToLaunchSummary(
  result: {
    status: 'completed' | 'launched' | 'failed'
    runtimeId: string
    response: string
    runUrl?: string
    externalId?: string
    error?: string
  },
  dashboardUrl: string,
): AgentLaunchSummary {
  if (result.status === 'launched') {
    return {
      status: 'launched',
      dashboardUrl,
      runUrl: result.runUrl,
      commentId: result.externalId,
      runId: result.runUrl?.split('#run-')[1],
    }
  }

  if (result.status === 'failed') {
    return {
      status: 'failed',
      dashboardUrl,
      reason: result.error ?? result.response,
    }
  }

  return {
    status: 'offline',
    dashboardUrl,
    reason: `Handled by ${result.runtimeId}.`,
  }
}

function createAgentRequestId(): string {
  return `request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function SourceSelectionScreen({
  selectingSource,
  selectSourceFile,
}: {
  selectingSource: boolean
  selectSourceFile: () => Promise<void>
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const station = useAgentStation({})
  const factoryWorkspace = useFactoryWorkspace()
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
        id: 'open-software-factory',
        label: `Factory Status: ${factoryWorkspace.summary.active} Active`,
        keywords: ['factory', 'status', 'ongoing', 'work', 'tasks', 'agents'],
        group: 'Factory',
        run: () => factoryWorkspace.setOpen(true),
      },
      {
        id: 'reset-factory-workspace',
        label: 'Factory: Reset Seed Packets',
        keywords: ['factory', 'reset', 'seed', 'packets'],
        group: 'Factory',
        run: factoryWorkspace.resetWorkspace,
      },
      ...station.actions,
    ],
    [factoryWorkspace, selectSourceFile, selectingSource, station.actions],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (shouldOpenCommandPalette(event)) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (!shortcut) return
      if (key === 'o' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void selectSourceFile()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectSourceFile])

  return (
    <div className="app">
      <div className="empty-panel">
        <div>
          <p className="empty-title">Select a source file to start.</p>
          <div className="empty-actions">
            <button className="btn-primary" onClick={() => void selectSourceFile()} type="button">
              {selectingSource ? 'Selecting...' : 'Choose File'}
            </button>
            <button className="btn-secondary" onClick={() => setSearchOpen(true)} type="button">
              Commands
            </button>
            <button className="btn-secondary" onClick={() => factoryWorkspace.setOpen(true)} type="button">
              Factory
            </button>
          </div>
        </div>
      </div>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={async () => []}
        onSelect={() => undefined}
        commandActions={commandActions}
      />
      {station.element}
      <FactoryPanel
        open={factoryWorkspace.open}
        packets={factoryWorkspace.packets}
        summary={factoryWorkspace.summary}
        selectedPacket={factoryWorkspace.selectedPacket}
        stationStatus={{
          configured: station.configured,
          availability: station.availability,
          dashboardUrl: station.dashboardUrl,
        }}
        onClose={() => factoryWorkspace.setOpen(false)}
        onSelectPacket={factoryWorkspace.selectPacket}
        onCaptureIntent={factoryWorkspace.captureIntent}
        onAdvancePacket={factoryWorkspace.advancePacket}
        onReset={factoryWorkspace.resetWorkspace}
      />
    </div>
  )
}

function ErrorRecoveryScreen({
  app,
}: {
  app: ReturnType<typeof useApp>
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const station = useAgentStation({ sourcePath: app.sourcePath })
  const factoryWorkspace = useFactoryWorkspace()
  const commandActions = useMemo<SearchCommandAction[]>(
    () => [
      ...station.actions,
      {
        id: 'open-software-factory',
        label: `Factory Status: ${factoryWorkspace.summary.active} Active`,
        keywords: ['factory', 'status', 'ongoing', 'work', 'tasks', 'agents'],
        group: 'Factory',
        run: () => factoryWorkspace.setOpen(true),
      },
      {
        id: 'reset-factory-workspace',
        label: 'Factory: Reset Seed Packets',
        keywords: ['factory', 'reset', 'seed', 'packets'],
        group: 'Factory',
        run: factoryWorkspace.resetWorkspace,
      },
      {
        id: 'select-source-file',
        label: app.selectingSource ? 'Select Source File (busy...)' : 'Select Source File',
        hint: '⌘O',
        keywords: ['open', 'file', 'source', 'recover'],
        group: 'Recovery',
        disabled: app.selectingSource,
        run: () => void app.selectSourceFile(),
      },
      {
        id: 'reload-source-file',
        label: 'Retry Reload Source File',
        keywords: ['reload', 'retry', 'refresh', 'source', 'recover'],
        group: 'Recovery',
        run: () => void app.reloadSource(),
      },
    ],
    [app, factoryWorkspace, station.actions],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (shouldOpenCommandPalette(event)) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (!shortcut) return
      if (key === 'o' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void app.selectSourceFile()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [app])

  return (
    <div className="app">
      <div className="error-screen">
        <div className="error-panel">
          <p className="error-title">File operation failed.</p>
          <pre className="error-text">{app.error}</pre>
          <p className="error-hint">
            Current source: <code>{app.sourcePath}</code>
          </p>
          <div className="error-actions">
            <button className="btn-primary" onClick={() => setSearchOpen(true)} type="button">
              Commands
            </button>
            <button className="btn-secondary" onClick={() => void app.reloadSource()} type="button">
              Retry Reload
            </button>
            <button className="btn-secondary" onClick={() => void app.selectSourceFile()} type="button">
              Choose File
            </button>
            <button className="btn-secondary" onClick={() => factoryWorkspace.setOpen(true)} type="button">
              Factory
            </button>
          </div>
        </div>
      </div>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={async () => []}
        onSelect={() => undefined}
        commandActions={commandActions}
      />
      {station.element}
      <FactoryPanel
        open={factoryWorkspace.open}
        packets={factoryWorkspace.packets}
        summary={factoryWorkspace.summary}
        selectedPacket={factoryWorkspace.selectedPacket}
        stationStatus={{
          configured: station.configured,
          availability: station.availability,
          dashboardUrl: station.dashboardUrl,
        }}
        onClose={() => factoryWorkspace.setOpen(false)}
        onSelectPacket={factoryWorkspace.selectPacket}
        onCaptureIntent={factoryWorkspace.captureIntent}
        onAdvancePacket={factoryWorkspace.advancePacket}
        onReset={factoryWorkspace.resetWorkspace}
      />
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function chirpConfigReady(config: VoiceRecordingConfig): boolean {
  return Boolean(config.location.trim())
}

function resolveInitialSortMode(): NoteSortMode {
  if (typeof window === 'undefined') return 'latest'
  const start = new URLSearchParams(window.location.search).get('start')
  return start?.toLowerCase() === 'oldest' ? 'oldest' : 'latest'
}

function resolveInitialWheelNavDirections(): WheelNavDirectionByViewport {
  if (typeof window === 'undefined') return {}

  const params = new URLSearchParams(window.location.search)
  const initial: WheelNavDirectionByViewport = {}
  const sharedDirection = parseWheelNavDirection(params.get('scroll-direction'))
  if (sharedDirection) {
    initial.desktop = sharedDirection
    initial.mobile = sharedDirection
  }

  const desktopDirection = parseWheelNavDirection(params.get('desktop-scroll-direction'))
  if (desktopDirection) initial.desktop = desktopDirection

  const mobileDirection = parseWheelNavDirection(params.get('mobile-scroll-direction'))
  if (mobileDirection) initial.mobile = mobileDirection

  if (initial.desktop || initial.mobile) return initial

  try {
    const stored = window.localStorage.getItem(SCROLL_DIRECTION_KEY)
    if (!stored) return {}

    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object') return {}

    const storedDirections: WheelNavDirectionByViewport = {}
    const record = parsed as Record<string, unknown>
    if (record.desktop === 'natural' || record.desktop === 'reverse') {
      storedDirections.desktop = record.desktop
    }
    if (record.mobile === 'natural' || record.mobile === 'reverse') {
      storedDirections.mobile = record.mobile
    }
    return storedDirections
  } catch {
    // Ignore persistence lookup failures.
  }

  return {}
}

function parseWheelNavDirection(value: string | null): WheelNavDirection | null {
  const normalized = value?.toLowerCase()
  if (normalized === 'natural' || normalized === 'normal') return 'natural'
  if (normalized === 'reverse' || normalized === 'reversed' || normalized === 'invert' || normalized === 'inverted') {
    return 'reverse'
  }
  return null
}

function oppositeWheelNavDirection(direction: WheelNavDirection): WheelNavDirection {
  return direction === 'natural' ? 'reverse' : 'natural'
}

function resolveInitialCardStackTunerVisibility(): boolean {
  if (typeof window === 'undefined') return false

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

  if (isLikelyMobileDevice() || resolveInitialMobilePreview()) return false
  return !import.meta.env.PROD
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
  const narrowViewport = window.matchMedia?.('(max-width: 760px)').matches ?? false
  return uaMobile || coarsePointer || narrowViewport
}

function isAgentLinkExperimentRoute(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('agent-links') === '1' || window.location.hash === '#agent-links'
}

function isAgenticMarkdownRoute(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return (
    params.get('agentic-markdown') === '1' ||
    window.location.hash === '#agentic-markdown' ||
    window.location.pathname.replace(/\/+$/, '') === '/agentic-markdown'
  )
}

function resolveInitialMobilePreview(): boolean {
  if (typeof window === 'undefined') return false

  const params = new URLSearchParams(window.location.search)
  const raw = params.get('mobile-preview') ?? params.get('mobile')
  const normalized = raw?.toLowerCase()

  if (normalized === '1' || normalized === 'true' || normalized === 'on') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'off') return false

  try {
    const stored = window.localStorage.getItem(MOBILE_PREVIEW_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {
    // Ignore persistence lookup failures.
  }

  return false
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
