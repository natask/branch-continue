import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from './ui/hooks/use-app'
import { useEditorSession } from './ui/hooks/use-editor-session'
import { SearchModal, type SearchCommandAction } from './ui/components/SearchModal'
import { TimeMachine } from './ui/components/TimeMachine'
import { Editor } from './ui/components/Editor'
import { AgentLinkExperiment } from './ui/experiments/AgentLinkExperiment'
import { useAgentStation } from './ui/agent-station/use-agent-station'
import { useAudioNoteRecorder, type AudioRecordingComplete } from './ui/hooks/use-audio-note-recorder'
import {
  formatNotePosition,
  orderNotes,
  resolveBoundaryNote,
  type NoteSortMode,
} from './ui/lib/note-order'
import {
  appendAudioCaptureReference,
  appendVoiceTranscriptAfterAudioCaptureReference,
  appendVoiceTranscriptSegment,
  cleanVoiceTranscriptSegment,
} from './ui/lib/voice-transcript'
import {
  PRIMARY_VOICE_LANGUAGE_OPTIONS,
  VOICE_LANGUAGE_OPTIONS,
  VOICE_TRANSCRIPTION_MODEL_OPTIONS,
  normalizeVoiceRecordingConfig,
  persistVoiceRecordingConfig,
  resolveInitialVoiceRecordingConfig,
  voiceLanguageLabel,
  voiceModelLabel,
  type VoiceRecordingConfig,
} from './ui/lib/voice-recording-config'
import { isCommandPaletteOpenShortcut } from './ui/lib/keyboard-shortcuts'
import {
  createAudioCaptureId,
  saveAudioCapture,
} from './core/audio/audio-store'
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
    content = <div className="loading">loading file session</div>
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

  const editorSession = useEditorSession({
    sourceSelected: true,
    createNote,
    updateNote,
  })
  const editorSessionRef = useRef(editorSession)
  editorSessionRef.current = editorSession
  const audioSegmentQueueRef = useRef<Promise<void>>(Promise.resolve())
  const editorBodyMirrorRef = useRef<{ sessionKey: number | null; body: string }>({
    sessionKey: null,
    body: '',
  })
  editorBodyMirrorRef.current = editorSession.editor
    ? { sessionKey: editorSession.editor.sessionKey, body: editorSession.editor.body }
    : { sessionKey: null, body: '' }
  const station = useAgentStation({ sourcePath })
  const [audioNoteMessage, setAudioNoteMessage] = useState<string | null>(null)
  const [voiceRecordingConfig, setVoiceRecordingConfig] = useState(resolveInitialVoiceRecordingConfig)
  const [voiceConfigOpen, setVoiceConfigOpen] = useState(false)

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
            name: 'GCP service account JSON',
            extensions: ['json'],
          },
        ],
      })

      if (!selected || Array.isArray(selected)) return
      updateVoiceRecordingConfig({ serviceAccountKeyPath: selected })
      setAudioNoteMessage('GCP service account key path saved for this app.')
    } catch (error) {
      setAudioNoteMessage(`Could not select GCP key file: ${errorMessage(error)}`)
    }
  }, [updateVoiceRecordingConfig])

  const applyTranscriptToCurrentEditor = useCallback((
    segment: string,
    options: { audioUri?: string; insertMode?: VoiceRecordingConfig['insertMode']; offsetMs?: number } = {},
  ) => {
    const cleanSegment = cleanVoiceTranscriptSegment(segment)
    if (!cleanSegment || cleanSegment === '(no speech detected)') {
      setAudioNoteMessage('Audio saved. Chirp 3 did not detect speech.')
      return
    }

    const current = editorSessionRef.current.editor
    if (!current) {
      setAudioNoteMessage('Transcript heard. Open a note to attach the next segment.')
      return
    }

    const baseBody = editorBodyMirrorRef.current.sessionKey === current.sessionKey
      ? editorBodyMirrorRef.current.body
      : current.body

    const replacedBody = options.insertMode === 'replace-selection'
      ? replaceSelectedEditorText(baseBody, cleanSegment, editorSessionRef.current.bodyRef.current)
      : null
    const nextBody = replacedBody ?? (
      options.audioUri
        ? appendVoiceTranscriptAfterAudioCaptureReference(baseBody, options.audioUri, cleanSegment, options.offsetMs)
        : appendVoiceTranscriptSegment(baseBody, cleanSegment)
    )
    editorBodyMirrorRef.current = { sessionKey: current.sessionKey, body: nextBody }
    editorSessionRef.current.updateBody(nextBody)
    setAudioNoteMessage(replacedBody ? 'Chirp 3 transcript replaced the selected note text.' : 'Chirp 3 transcript is under the audio link.')
  }, [])

  const processCompletedAudioSegment = useCallback(async (capture: AudioRecordingComplete) => {
    const id = createAudioCaptureId()
    setAudioNoteMessage(`Saving voice segment ${capture.segmentIndex + 1}...`)

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
      setAudioNoteMessage(`Audio captured, but local save failed: ${errorMessage(error)}`)
      return
    }

    const current = editorSessionRef.current.editor
    if (!current) {
      setAudioNoteMessage(`Audio saved as ${saved.uri}. Open a note to paste this reference.`)
      return
    }

    const baseBody = editorBodyMirrorRef.current.sessionKey === current.sessionKey
      ? editorBodyMirrorRef.current.body
      : current.body
    const nextBody = appendAudioCaptureReference(baseBody, saved.uri)
    editorBodyMirrorRef.current = { sessionKey: current.sessionKey, body: nextBody }
    editorSessionRef.current.updateBody(nextBody)
    setAudioNoteMessage(`Audio segment ${capture.segmentIndex + 1} saved to ${saved.uri}.`)

    if (voiceRecordingConfig.transcriptionMode === 'off') return
    if (!chirpConfigReady(voiceRecordingConfig)) {
      setAudioNoteMessage(`Audio saved to ${saved.uri}. Choose a Chirp location/model to enable transcription.`)
      return
    }

    setAudioNoteMessage(`Transcribing voice segment ${capture.segmentIndex + 1} with Chirp 3...`)
    try {
      const transcript = await transcribeAudioWithChirp({
        blob: capture.blob,
        mimeType: capture.mimeType,
        config: {
          ...voiceRecordingConfig,
          languageCode: capture.languageCode || voiceRecordingConfig.languageCode,
        },
      })
      applyTranscriptToCurrentEditor(transcript, {
        audioUri: saved.uri,
        insertMode: capture.segmentIndex === 0 ? voiceRecordingConfig.insertMode : 'append',
        offsetMs: capture.offsetMs,
      })
    } catch (error) {
      setAudioNoteMessage(`Audio saved to ${saved.uri}. Transcription failed: ${errorMessage(error)}`)
    }
  }, [applyTranscriptToCurrentEditor, sourcePath, voiceRecordingConfig])

  const attachCompletedAudioToCurrentEditor = useCallback((capture: AudioRecordingComplete) => {
    audioSegmentQueueRef.current = audioSegmentQueueRef.current
      .catch(() => undefined)
      .then(() => processCompletedAudioSegment(capture))
    return audioSegmentQueueRef.current
  }, [processCompletedAudioSegment])

  const audioRecorder = useAudioNoteRecorder({
    languageCode: voiceRecordingConfig.languageCode,
    livePreview: true,
    onRecordingComplete: attachCompletedAudioToCurrentEditor,
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
    (from: SourceNote) => {
      editorSession.openBranchEditor(from)
    },
    [editorSession],
  )

  const handleCreateNewNote = useCallback(async () => {
    const ok = await editorSessionRef.current.flushAutoSave()
    if (!ok) return
    editorSessionRef.current.openBranchEditor(null)
  }, [])

  const handleCreateVoiceNote = useCallback(async (languageCode?: string) => {
    const ok = await editorSessionRef.current.flushAutoSave()
    if (!ok) return
    editorSessionRef.current.openBranchEditor(null)
    window.setTimeout(() => void audioRecorder.start(languageCode, { newSession: true }), 0)
  }, [audioRecorder.start])

  const setVoiceLanguage = useCallback((languageCode: string) => {
    updateVoiceRecordingConfig({ languageCode })
    if (audioRecorder.recording && voiceRecordingConfig.languageCode !== languageCode) {
      audioRecorder.switchLanguage(languageCode)
    }
  }, [audioRecorder.recording, audioRecorder.switchLanguage, updateVoiceRecordingConfig, voiceRecordingConfig.languageCode])

  const handleVoiceLanguageCapture = useCallback((languageCode: string) => {
    setVoiceLanguage(languageCode)
    if (audioRecorder.recording) return
    void audioRecorder.start(languageCode)
  }, [audioRecorder.recording, audioRecorder.start, setVoiceLanguage])

  const handleVoiceNoteLanguageCapture = useCallback((languageCode: string) => {
    setVoiceLanguage(languageCode)
    if (audioRecorder.recording) return
    void handleCreateVoiceNote(languageCode)
  }, [audioRecorder.recording, handleCreateVoiceNote, setVoiceLanguage])

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
      if (!isCommandPaletteOpenShortcut(event, { allowShiftX: true })) return
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
      ...PRIMARY_VOICE_LANGUAGE_OPTIONS.map((option) => ({
        id: `capture-voice-${option.code}`,
        label: `${audioRecorder.recording
          ? 'Switch Voice Recording To'
          : audioRecorder.status === 'stopped'
            ? 'Continue Voice Recording In'
            : 'Start Voice Recording In'} ${option.label}`,
        hint: option.flag,
        keywords: ['voice', 'audio', 'record', 'transcribe', 'speech', option.label, option.code],
        group: 'Capture',
        disabled: !editorSession.editor || (!audioRecorder.recording && !audioRecorder.mediaRecorderAvailable),
        run: () => handleVoiceLanguageCapture(option.code),
      })),
      {
        id: 'stop-voice-recording',
        label: 'Stop Voice Recording',
        hint: voiceLanguageLabel(voiceRecordingConfig.languageCode),
        keywords: ['voice', 'audio', 'record', 'stop'],
        group: 'Capture',
        disabled: !audioRecorder.recording,
        run: () => audioRecorder.stop(),
      },
      {
        id: 'open-voice-recording-config',
        label: 'Open Voice Recording Settings Panel',
        hint: voiceRecordingConfig.transcriptionMode === 'off' ? 'audio only' : voiceModelLabel(voiceRecordingConfig.model),
        keywords: ['voice', 'audio', 'record', 'config', 'language', 'chirp', 'transcribe'],
        group: 'Voice Settings',
        disabled: !editorSession.editor,
        run: () => setVoiceConfigOpen(true),
      },
      ...VOICE_LANGUAGE_OPTIONS.map((option) => ({
        id: `set-voice-language-${option.code}`,
        label: `Recording Language: ${option.label}${voiceRecordingConfig.languageCode === option.code ? ' (current)' : ''}`,
        hint: option.code,
        keywords: ['voice', 'audio', 'record', 'language', option.label, option.code],
        group: 'Voice Settings',
        run: () => setVoiceLanguage(option.code),
      })),
      {
        id: 'set-voice-transcription-chirp3',
        label: `Voice Transcription: Google Chirp${voiceRecordingConfig.transcriptionMode === 'chirp3' ? ' (current)' : ''}`,
        keywords: ['voice', 'audio', 'record', 'transcribe', 'chirp', 'google'],
        group: 'Voice Settings',
        run: () => updateVoiceRecordingConfig({ transcriptionMode: 'chirp3' }),
      },
      {
        id: 'set-voice-transcription-off',
        label: `Voice Transcription: Save Audio Only${voiceRecordingConfig.transcriptionMode === 'off' ? ' (current)' : ''}`,
        keywords: ['voice', 'audio', 'record', 'transcribe', 'off', 'audio only'],
        group: 'Voice Settings',
        run: () => updateVoiceRecordingConfig({ transcriptionMode: 'off' }),
      },
      ...VOICE_TRANSCRIPTION_MODEL_OPTIONS.map((option) => ({
        id: `set-voice-model-${option.model}`,
        label: `Voice Model: ${option.label}${voiceRecordingConfig.model === option.model ? ' (current)' : ''}`,
        keywords: ['voice', 'audio', 'record', 'model', 'chirp', option.model, option.label],
        group: 'Voice Settings',
        run: () => updateVoiceRecordingConfig({ model: option.model }),
      })),
      {
        id: 'set-voice-transcript-target-append',
        label: `Voice Transcript Target: Under Audio Link${voiceRecordingConfig.insertMode === 'append' ? ' (current)' : ''}`,
        keywords: ['voice', 'audio', 'record', 'transcript', 'append', 'target'],
        group: 'Voice Settings',
        run: () => updateVoiceRecordingConfig({ insertMode: 'append' }),
      },
      {
        id: 'set-voice-transcript-target-replace-selection',
        label: `Voice Transcript Target: Replace Selection${voiceRecordingConfig.insertMode === 'replace-selection' ? ' (current)' : ''}`,
        keywords: ['voice', 'audio', 'record', 'transcript', 'replace', 'selection', 'target'],
        group: 'Voice Settings',
        run: () => updateVoiceRecordingConfig({ insertMode: 'replace-selection' }),
      },
      {
        id: 'choose-voice-credential-file',
        label: 'Choose Voice GCP Credential File',
        keywords: ['voice', 'audio', 'record', 'credential', 'gcp', 'google', 'key'],
        group: 'Voice Settings',
        run: () => selectVoiceCredentialFile(),
      },
      {
        id: 'create-new-note',
        label: 'Create New Note',
        keywords: ['create', 'new', 'note', 'blank', 'independent'],
        group: 'Actions',
        run: () => void handleCreateNewNote(),
      },
      {
        id: 'create-voice-note',
        label: audioRecorder.recording ? 'Stop Voice Note Recording' : `Create Voice Note In ${voiceLanguageLabel(voiceRecordingConfig.languageCode)}`,
        keywords: ['create', 'new', 'note', 'voice', 'record', 'dictate', 'transcribe'],
        group: 'Actions',
        disabled: !audioRecorder.recording && !audioRecorder.mediaRecorderAvailable,
        run: () => {
          if (audioRecorder.recording) {
            audioRecorder.stop()
            return
          }
          void handleCreateVoiceNote(voiceRecordingConfig.languageCode)
        },
      },
      ...PRIMARY_VOICE_LANGUAGE_OPTIONS.map((option) => ({
        id: `create-voice-note-${option.code}`,
        label: `Create Voice Note In ${option.label}`,
        hint: option.flag,
        keywords: ['create', 'new', 'note', 'voice', 'record', 'dictate', 'transcribe', option.label, option.code],
        group: 'Actions',
        disabled: audioRecorder.recording || !audioRecorder.mediaRecorderAvailable,
        run: () => handleVoiceNoteLanguageCapture(option.code),
      })),
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
      audioRecorder.recording,
      audioRecorder.status,
      audioRecorder.mediaRecorderAvailable,
      audioRecorder.start,
      audioRecorder.stop,
      handleVoiceLanguageCapture,
      handleVoiceNoteLanguageCapture,
      handleCreateNewNote,
      handleCreateVoiceNote,
      handleGoToBoundary,
      handleOpenLinkedNote,
      olderEditorNote,
      newerEditorNote,
      orderedNotes.length,
      reloadSource,
      resetWheelNavDirections,
      selectingSource,
      selectVoiceCredentialFile,
      selectSourceFile,
      setVoiceLanguage,
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
            onClick={() => setShowCardStackTuner((current) => !current)}
            type="button"
          >
            Tune: {showCardStackTuner ? 'On' : 'Off'}
          </button>
          <button className="topbar-search topbar-search-strong" onClick={() => void handleCreateNewNote()} type="button">
            New Note
          </button>
          <div className="topbar-voice-actions" role="group" aria-label="Create voice note">
            {PRIMARY_VOICE_LANGUAGE_OPTIONS.map((option) => {
              const active = voiceRecordingConfig.languageCode === option.code
              return (
                <button
                  key={option.code}
                  className={`voice-language-btn voice-language-btn--compact${active ? ' voice-language-btn--active' : ''}${active && audioRecorder.recording ? ' voice-language-btn--recording' : ''}`}
                  onClick={() => handleVoiceNoteLanguageCapture(option.code)}
                  disabled={audioRecorder.status === 'requesting' || audioRecorder.status === 'stopping' || !audioRecorder.mediaRecorderAvailable}
                  type="button"
                  title={`${audioRecorder.recording ? 'Switch voice recording to' : 'Create voice note in'} ${option.label}`}
                  aria-pressed={active}
                >
                  <span className="voice-language-flag" aria-hidden="true">{option.flag}</span>
                  <span className="voice-language-label">{option.shortLabel}</span>
                </button>
              )
            })}
            {audioRecorder.recording && (
              <button className="topbar-search" onClick={audioRecorder.stop} type="button">
                Stop
              </button>
            )}
          </div>
          <button className="topbar-search" onClick={() => setSearchOpen(true)} type="button">
            Search
          </button>
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
        navigationEnabled={!searchOpen && !editorSession.editorOpen}
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
      {!editorSession.editor && <CommandAccessBar onOpen={() => setSearchOpen(true)} />}
      {station.element}

      {editorSession.editor && (
        <Editor
          session={editorSession}
          positionLabel={editorPositionLabel}
          isMobile={isMobile}
          canOpenOlderNote={Boolean(olderEditorNote)}
          canOpenNewerNote={Boolean(newerEditorNote)}
          audioRecorder={audioRecorder}
          audioNoteMessage={audioNoteMessage}
          voiceRecordingConfig={voiceRecordingConfig}
          voiceConfigOpen={voiceConfigOpen}
          sourcePath={sourcePath}
          onVoiceConfigOpenChange={setVoiceConfigOpen}
          onVoiceRecordingConfigChange={updateVoiceRecordingConfig}
          onVoiceLanguageCapture={handleVoiceLanguageCapture}
          onSelectVoiceCredentialFile={selectVoiceCredentialFile}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenOlderNote={handleOpenOlderEditorNote}
          onOpenNewerNote={handleOpenNewerEditorNote}
        />
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
  const [searchOpen, setSearchOpen] = useState(false)
  const station = useAgentStation({})
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
      ...station.actions,
    ],
    [selectSourceFile, selectingSource, station.actions],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (isCommandPaletteOpenShortcut(event)) {
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
          <p className="empty-copy">
            Made with Love
          </p>
          <div className="empty-actions">
            <button className="btn-primary" onClick={() => void selectSourceFile()} type="button">
              {selectingSource ? 'Selecting...' : 'Choose File'}
            </button>
            <button className="btn-secondary" onClick={() => setSearchOpen(true)} type="button">
              Commands
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
      <CommandAccessBar onOpen={() => setSearchOpen(true)} />
      {station.element}
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
  const commandActions = useMemo<SearchCommandAction[]>(
    () => [
      ...station.actions,
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
    [app, station.actions],
  )

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (isCommandPaletteOpenShortcut(event)) {
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
      <CommandAccessBar onOpen={() => setSearchOpen(true)} />
      {station.element}
    </div>
  )
}

function CommandAccessBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="command-access-bar" role="navigation" aria-label="Command access">
      <button className="command-access-button" onClick={onOpen} type="button">
        <span>Commands</span>
        <kbd>⌘K</kbd>
      </button>
    </div>
  )
}

function replaceSelectedEditorText(
  body: string,
  replacement: string,
  textarea: HTMLTextAreaElement | null,
): string | null {
  if (!textarea || textarea.selectionStart === textarea.selectionEnd) return null
  if (textarea.value !== body) return null

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const nextBody = `${body.slice(0, start)}${replacement}${body.slice(end)}`
  const nextCaret = start + replacement.length
  window.requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(nextCaret, nextCaret)
  })
  return nextBody
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function chirpConfigReady(config: VoiceRecordingConfig): boolean {
  return Boolean(
    config.location.trim() &&
      config.model.trim(),
  )
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
