import { useCallback, useEffect, useRef, useState } from 'react'
import fixWebmDuration from 'fix-webm-duration'
import {
  canonicalPcmCaptureAvailable,
  startCanonicalPcmCapture,
  type CanonicalPcmCapture,
  type CanonicalPcmFrame,
} from '../../core/audio/pcm-capture'

export type AudioRecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'stopped' | 'error'

export interface AudioRecordingComplete {
  blob: Blob
  mimeType: string
  durationMs: number
  sessionId: string
  startedAt: string
  stoppedAt: string
  languageCode: string
  segmentIndex: number
  offsetMs: number
  segmentStartReason: AudioRecordingSegmentStartReason
  final: boolean
  ownerSessionKey: string | number | null
}

export type AudioRecordingSegmentStartReason = 'start' | 'auto' | 'manual' | 'language-switch'

export interface AudioRecordingStart {
  sessionId: string
  mimeType: string
  resumed: boolean
  ownerSessionKey: string | number | null
}

export interface AudioRecorderResumeSession {
  sessionId: string
  segmentIndex: number
  offsetMs: number
}

interface AudioRecorderStartOptions {
  newSession?: boolean
  resumeSession?: AudioRecorderResumeSession
}

// Keep transcription and waveform navigation blocks small enough to scan.
// Natural speech gaps can create smaller presentation groups, but no raw
// recognition segment should span more than thirty seconds.
const MAX_TRANSCRIPTION_SEGMENT_MS = 30_000

interface UseAudioNoteRecorderOptions {
  /**
   * Identity of the note/editor that owns this recording session. Pause and
   * resume may reuse a session only while this key remains unchanged.
   */
  sessionKey?: string | number | null
  languageCode?: string
  livePreview?: boolean
  /**
   * Fires as soon as capture is actually running (microphone granted and the
   * recorder started), before any audio segment completes. Lets the owner
   * reserve the recording's note reference with no visible late update.
   */
  onRecordingStart?: (start: AudioRecordingStart) => void
  onFinalTranscript?: (segment: string) => void
  onRecordingComplete?: (capture: AudioRecordingComplete) => void | Promise<void>
  /** Canonical 16 kHz PCM frames for a future streaming transcription consumer. */
  onPcmFrame?: (frame: CanonicalPcmFrame) => void
}

export interface UseAudioNoteRecorderResult {
  status: AudioRecorderStatus
  recording: boolean
  elapsedMs: number
  interimTranscript: string
  finalTranscript: string
  error: string | null
  audioUrl: string | null
  audioBlob: Blob | null
  mimeType: string | null
  speechRecognitionAvailable: boolean
  mediaRecorderAvailable: boolean
  pcmCaptureAvailable: boolean
  diagnostic: string | null
  start: (languageCode?: string, options?: AudioRecorderStartOptions) => Promise<void>
  switchLanguage: (languageCode: string) => void
  stop: () => void
  stopAndWait: () => Promise<void>
  clear: () => void
}

export function useAudioNoteRecorder({
  sessionKey = null,
  languageCode,
  livePreview = false,
  onRecordingStart,
  onFinalTranscript,
  onRecordingComplete,
  onPcmFrame,
}: UseAudioNoteRecorderOptions = {}): UseAudioNoteRecorderResult {
  const [status, setStatus] = useState<AudioRecorderStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [mimeType, setMimeType] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null)
  const recordingRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const segmentTimerRef = useRef<number | null>(null)
  const sessionCursorRef = useRef(createAudioRecorderSessionCursor(sessionKey))
  const sessionBoundaryKeyRef = useRef<string | number | null>(sessionKey)
  const presentationSessionKeyRef = useRef<string | number | null>(sessionKey)
  const resetSessionAfterStopRef = useRef(false)
  const segmentStartedAtRef = useRef(0)
  const segmentStartedAtIsoRef = useRef<string | null>(null)
  const segmentLanguageCodeRef = useRef(resolveLanguageCode(languageCode))
  const segmentStartReasonRef = useRef<AudioRecordingSegmentStartReason>('start')
  const nextSegmentStartReasonRef = useRef<AudioRecordingSegmentStartReason>('auto')
  const startedAtRef = useRef(0)
  const startedAtIsoRef = useRef<string | null>(null)
  const elapsedTimerRef = useRef<number | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const languageCodeRef = useRef(languageCode)
  const livePreviewRef = useRef(livePreview)
  const onRecordingStartRef = useRef(onRecordingStart)
  const onFinalTranscriptRef = useRef(onFinalTranscript)
  const onRecordingCompleteRef = useRef(onRecordingComplete)
  const completionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const stopWaitersRef = useRef<Array<() => void>>([])
  const startGenerationRef = useRef(0)
  const pcmCaptureRef = useRef<CanonicalPcmCapture | null>(null)
  const pcmCaptureGenerationRef = useRef(0)
  const pcmSessionNextSampleRef = useRef(0)
  const onPcmFrameRef = useRef(onPcmFrame)

  if (!Object.is(sessionBoundaryKeyRef.current, sessionKey)) {
    const previousSessionKey = sessionBoundaryKeyRef.current
    sessionBoundaryKeyRef.current = sessionKey
    startGenerationRef.current += 1
    resetSessionAfterStopRef.current = transitionAudioRecorderSessionBoundary(
      sessionCursorRef.current,
      previousSessionKey,
      sessionKey,
      recordingRef.current,
    )
    if (!recordingRef.current) pcmSessionNextSampleRef.current = 0
  }

  languageCodeRef.current = languageCode
  livePreviewRef.current = livePreview
  onRecordingStartRef.current = onRecordingStart
  onFinalTranscriptRef.current = onFinalTranscript
  onRecordingCompleteRef.current = onRecordingComplete
  onPcmFrameRef.current = onPcmFrame

  const stopPcmCapture = useCallback(() => {
    pcmCaptureGenerationRef.current += 1
    const capture = pcmCaptureRef.current
    pcmCaptureRef.current = null
    if (capture) void capture.stop()
  }, [])

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current === null) return
    window.clearInterval(elapsedTimerRef.current)
    elapsedTimerRef.current = null
  }, [])

  const stopSegmentTimer = useCallback(() => {
    if (segmentTimerRef.current === null) return
    window.clearTimeout(segmentTimerRef.current)
    segmentTimerRef.current = null
  }, [])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const stopSpeechRecognition = useCallback(() => {
    const recognition = speechRecognitionRef.current
    speechRecognitionRef.current = null
    if (!recognition) return
    recognition.onend = null
    recognition.onerror = null
    recognition.onresult = null
    try {
      recognition.stop()
    } catch {
      // Browsers throw if recognition is already stopped.
    }
  }, [])

  const cleanupRecording = useCallback(() => {
    recordingRef.current = false
    stopRequestedRef.current = false
    stopSegmentTimer()
    stopElapsedTimer()
    stopSpeechRecognition()
    stopPcmCapture()
    cleanupStream()
    mediaRecorderRef.current = null
  }, [cleanupStream, stopElapsedTimer, stopPcmCapture, stopSegmentTimer, stopSpeechRecognition])

  const clear = useCallback(() => {
    if (recordingRef.current) return
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    setStatus('idle')
    setElapsedMs(0)
    setInterimTranscript('')
    setFinalTranscript('')
    setError(null)
    setAudioUrl(null)
    setAudioBlob(null)
    setMimeType(null)
  }, [])

  const startSpeechRecognition = useCallback(() => {
    if (!livePreviewRef.current) return

    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Constructor) return

    const recognition = new Constructor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = resolveLanguageCode(languageCodeRef.current)

    recognition.onresult = (event) => {
      const finalSegments: string[] = []
      let interim = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript?.trim() ?? ''
        if (!transcript) continue

        if (result.isFinal) {
          finalSegments.push(transcript)
        } else {
          interim = `${interim} ${transcript}`.trim()
        }
      }

      if (finalSegments.length > 0) {
        const segment = finalSegments.join(' ')
        setFinalTranscript((current) => (current ? `${current}\n${segment}` : segment))
        onFinalTranscriptRef.current?.(segment)
      }

      setInterimTranscript(interim)
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'service-not-allowed') return
      setError(`Speech recognition: ${event.error}`)
    }

    recognition.onend = () => {
      if (!recordingRef.current) return
      try {
        recognition.start()
      } catch {
        // Recognition can be temporarily locked after an onend callback.
      }
    }

    speechRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      speechRecognitionRef.current = null
    }
  }, [])

  const start = useCallback(async (nextLanguageCode?: string, options: AudioRecorderStartOptions = {}) => {
    if (recordingRef.current) return
    const startGeneration = startGenerationRef.current + 1
    startGenerationRef.current = startGeneration
    const requestedOwnerSessionKey = sessionBoundaryKeyRef.current
    if (nextLanguageCode) languageCodeRef.current = nextLanguageCode
    const cursor = sessionCursorRef.current
    if (options.resumeSession && !options.newSession) {
      hydrateAudioRecorderSessionCursor(cursor, options.resumeSession)
    }
    const continueSession = cursor.hasSession
      && (status === 'stopped' || Boolean(options.resumeSession))
      && !options.newSession

    setStatus('requesting')
    setError(null)
    setDiagnostic(null)
    setInterimTranscript('')
    setFinalTranscript('')
    setAudioBlob(null)
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
      setAudioUrl(null)
    }

    try {
      await requestNativeMicrophonePermission()
      assertMediaRecorderAvailable()
      const stream = await getAudioStream()
      if (
        startGeneration !== startGenerationRef.current
        || !Object.is(requestedOwnerSessionKey, sessionBoundaryKeyRef.current)
      ) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      const preferredMimeType = pickAudioMimeType()

      if (isAndroidTauriRuntime() && !preferredMimeType) {
        setDiagnostic('Android WebView did not report a preferred MediaRecorder MIME type; using the platform default recorder.')
      }

      streamRef.current = stream
      recordingRef.current = true
      stopRequestedRef.current = false
      if (!continueSession) {
        resetAudioRecorderSessionCursor(cursor)
        pcmSessionNextSampleRef.current = 0
      }

      // MediaRecorder remains the persisted/batch-Chirp source. Consumers that
      // opt into PCM receive a ChiefMoa-style canonical stream in parallel;
      // unsupported WebViews simply continue on the established recorder.
      if (onPcmFrameRef.current && canonicalPcmCaptureAvailable()) {
        const generation = pcmCaptureGenerationRef.current + 1
        pcmCaptureGenerationRef.current = generation
        void startCanonicalPcmCapture(stream, {
          startSample: pcmSessionNextSampleRef.current,
          onFrame: (frame) => {
            pcmSessionNextSampleRef.current = Math.max(pcmSessionNextSampleRef.current, frame.endSample)
            onPcmFrameRef.current?.(frame)
          },
        }).then((capture) => {
          if (!capture) return
          if (generation !== pcmCaptureGenerationRef.current || !recordingRef.current) {
            void capture.stop()
            return
          }
          pcmCaptureRef.current = capture
          capture.beginLive()
        }).catch(() => {
          // Capability and runtime failures deliberately fall back to the
          // existing MediaRecorder batch path.
        })
      }
      segmentStartReasonRef.current = continueSession ? 'manual' : 'start'
      nextSegmentStartReasonRef.current = 'auto'
      cursor.hasSession = true
      const startedAt = new Date()
      startedAtRef.current = startedAt.getTime() - cursor.offsetMs
      startedAtIsoRef.current = startedAt.toISOString()
      setElapsedMs(cursor.offsetMs)

      const startRecorderSegment = () => {
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream)
        const segmentIndex = cursor.segmentIndex
        const segmentOffsetMs = cursor.offsetMs
        const segmentStartedAt = new Date()
        const segmentLanguageCode = resolveLanguageCode(languageCodeRef.current)
        const segmentStartReason = segmentStartReasonRef.current
        const ownerSessionKey = sessionBoundaryKeyRef.current

        chunksRef.current = []
        mediaRecorderRef.current = recorder
        segmentStartedAtRef.current = segmentStartedAt.getTime()
        segmentStartedAtIsoRef.current = segmentStartedAt.toISOString()
        segmentLanguageCodeRef.current = segmentLanguageCode
        setMimeType(recorder.mimeType || preferredMimeType || 'audio/webm')

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        }

        recorder.onerror = (event) => {
          stopRequestedRef.current = true
          stopSegmentTimer()
          setError(event instanceof ErrorEvent ? event.message : 'Audio recorder failed.')
        }

        recorder.onstop = () => {
          stopSegmentTimer()
          const stoppedAt = new Date()
          const durationMs = segmentStartedAtRef.current ? Date.now() - segmentStartedAtRef.current : 0
          const type = recorder.mimeType || preferredMimeType || 'audio/webm'
          const rawBlob = new Blob(chunksRef.current, { type })
          const isFinal = stopRequestedRef.current
          const captureStartedAtIso = segmentStartedAtIsoRef.current
          const captureLanguageCode = segmentLanguageCodeRef.current
          const captureSessionId = cursor.sessionId

          if (rawBlob.size > 0 && durationMs > 0) {
            const fixedBlobPromise = normalizeRecordedBlobDuration(rawBlob, durationMs)
            completionQueueRef.current = completionQueueRef.current
              .catch(() => undefined)
              .then(async () => {
                const blob = await fixedBlobPromise
                // Persist an old note's final segment after navigation without
                // leaking its playback state into the newly opened note.
                if (Object.is(ownerSessionKey, sessionBoundaryKeyRef.current)) {
                  const url = URL.createObjectURL(blob)
                  if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
                  audioUrlRef.current = url
                  setAudioBlob(blob)
                  setAudioUrl(url)
                  setMimeType(type)
                }
                await onRecordingCompleteRef.current?.({
                  blob,
                  mimeType: type,
                  durationMs,
                  sessionId: captureSessionId,
                  startedAt: captureStartedAtIso ?? new Date(stoppedAt.getTime() - durationMs).toISOString(),
                  stoppedAt: stoppedAt.toISOString(),
                  languageCode: captureLanguageCode,
                  segmentIndex,
                  offsetMs: segmentOffsetMs,
                  segmentStartReason,
                  final: isFinal,
                  ownerSessionKey,
                })
              })
            void completionQueueRef.current.catch((nextError) => {
              setError(errorMessage(nextError))
            })
          }

          cursor.offsetMs = segmentOffsetMs + Math.max(0, durationMs)
          cursor.segmentIndex = segmentIndex + 1

          if (isFinal) {
            setElapsedMs(Date.now() - startedAtRef.current)
            cleanupRecording()
            if (resetSessionAfterStopRef.current) {
              resetSessionAfterStopRef.current = false
              resetAudioRecorderSessionCursor(cursor)
              pcmSessionNextSampleRef.current = 0
              setElapsedMs(0)
              setStatus('idle')
            } else {
              setStatus('stopped')
            }
            const resolveStopWaiters = () => {
              const waiters = stopWaitersRef.current.splice(0)
              for (const resolve of waiters) resolve()
            }
            void completionQueueRef.current.then(resolveStopWaiters, resolveStopWaiters)
            return
          }

          if (recordingRef.current) {
            segmentStartReasonRef.current = nextSegmentStartReasonRef.current
            nextSegmentStartReasonRef.current = 'auto'
            startRecorderSegment()
          }
        }

        recorder.start(1000)
        segmentTimerRef.current = window.setTimeout(() => {
          if (recorder.state === 'recording') {
            nextSegmentStartReasonRef.current = 'auto'
            recorder.stop()
          }
        }, MAX_TRANSCRIPTION_SEGMENT_MS)
      }

      onRecordingStartRef.current?.({
        sessionId: cursor.sessionId,
        mimeType: preferredMimeType || 'audio/webm',
        resumed: continueSession,
        ownerSessionKey: sessionBoundaryKeyRef.current,
      })
      startRecorderSegment()
      startSpeechRecognition()
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current)
      }, 500)
      setStatus('recording')
    } catch (nextError) {
      if (startGeneration !== startGenerationRef.current) return
      cleanupRecording()
      setStatus('error')
      setError(errorMessage(nextError))
      setDiagnostic(recordingDiagnostic(nextError))
    }
  }, [cleanupRecording, startSpeechRecognition, status])

  const switchLanguage = useCallback((nextLanguageCode: string) => {
    const normalizedLanguageCode = resolveLanguageCode(nextLanguageCode)
    languageCodeRef.current = normalizedLanguageCode

    if (!recordingRef.current) return

    stopSpeechRecognition()
    startSpeechRecognition()
  }, [startSpeechRecognition, stopSpeechRecognition])

  const stop = useCallback(() => {
    if (!recordingRef.current) return
    setStatus('stopping')
    stopRequestedRef.current = true
    stopSegmentTimer()
    stopElapsedTimer()
    stopSpeechRecognition()
    stopPcmCapture()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      cleanupRecording()
      setStatus('stopped')
      const waiters = stopWaitersRef.current.splice(0)
      for (const resolve of waiters) resolve()
      return
    }

    recorder.stop()
  }, [cleanupRecording, stopElapsedTimer, stopPcmCapture, stopSegmentTimer, stopSpeechRecognition])

  const stopAndWait = useCallback(async () => {
    if (!recordingRef.current) {
      await completionQueueRef.current.catch(() => undefined)
      return
    }
    await new Promise<void>((resolve) => {
      stopWaitersRef.current.push(resolve)
      stop()
    })
  }, [stop])

  useEffect(() => {
    // Changing notes (including creating a branch) is an explicit recording
    // boundary. Finish an active segment so it remains valid, then clear every
    // presentation field owned by the previous note. Stable keys intentionally
    // preserve pause/resume and its latest playback blob.
    if (Object.is(presentationSessionKeyRef.current, sessionKey)) return
    presentationSessionKeyRef.current = sessionKey
    const nextSessionKey = sessionKey

    void stopAndWait().finally(() => {
      if (!Object.is(sessionBoundaryKeyRef.current, nextSessionKey) || recordingRef.current) return
      clear()
    })
  }, [clear, sessionKey, stopAndWait])

  useEffect(
    () => () => {
      cleanupRecording()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    },
    [cleanupRecording],
  )

  return {
    status,
    recording: status === 'recording' || status === 'requesting' || status === 'stopping',
    elapsedMs,
    interimTranscript,
    finalTranscript,
    error,
    audioUrl,
    audioBlob,
    mimeType,
    speechRecognitionAvailable: livePreview && typeof window !== 'undefined' && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
    mediaRecorderAvailable: maybeBrowserAudioRecordingAvailable(),
    pcmCaptureAvailable: canonicalPcmCaptureAvailable(),
    diagnostic,
    start,
    switchLanguage,
    stop,
    stopAndWait,
    clear,
  }
}

export interface AudioRecorderSessionCursor {
  sessionId: string
  hasSession: boolean
  segmentIndex: number
  offsetMs: number
}

export function createAudioRecorderSessionCursor(_sessionKey?: string | number | null): AudioRecorderSessionCursor {
  return {
    sessionId: createAudioSessionId(),
    hasSession: false,
    segmentIndex: 0,
    offsetMs: 0,
  }
}

export function resetAudioRecorderSessionCursor(cursor: AudioRecorderSessionCursor): void {
  cursor.sessionId = createAudioSessionId()
  cursor.hasSession = false
  cursor.segmentIndex = 0
  cursor.offsetMs = 0
}

export function hydrateAudioRecorderSessionCursor(
  cursor: AudioRecorderSessionCursor,
  session: AudioRecorderResumeSession,
): void {
  cursor.sessionId = session.sessionId
  cursor.hasSession = true
  cursor.segmentIndex = Math.max(0, session.segmentIndex)
  cursor.offsetMs = Math.max(0, session.offsetMs)
}

/**
 * Applies a note identity transition to a recorder cursor. Active recordings
 * return `true` so the caller can stop first and reset after MediaRecorder has
 * emitted the segment using the old session metadata.
 */
export function transitionAudioRecorderSessionBoundary(
  cursor: AudioRecorderSessionCursor,
  previousSessionKey: string | number | null,
  nextSessionKey: string | number | null,
  recording: boolean,
): boolean {
  if (Object.is(previousSessionKey, nextSessionKey)) return false
  if (recording) return true
  resetAudioRecorderSessionCursor(cursor)
  return false
}

function resolveLanguageCode(languageCode: string | undefined): string {
  if (languageCode?.trim()) return languageCode.trim()
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language
  return 'en-US'
}

function createAudioSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `voice-session-${crypto.randomUUID()}`
  }

  return `voice-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function normalizeRecordedBlobDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes('webm')) return blob
  return fixWebmDuration(blob, durationMs, { logger: false })
}

function pickAudioMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

function maybeBrowserAudioRecordingAvailable(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof MediaRecorder === 'undefined') return isAndroidTauriRuntime()
  return Boolean(navigator.mediaDevices?.getUserMedia || legacyGetUserMedia()) || isAndroidTauriRuntime()
}

function assertMediaRecorderAvailable(): void {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Audio recording is unavailable in this WebView.')
  }
}

async function getAudioStream(): Promise<MediaStream> {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia({ audio: true })
  }

  const legacy = legacyGetUserMedia()
  if (!legacy) throw new Error('Audio recording is unavailable in this WebView.')

  return new Promise((resolve, reject) => {
    legacy.call(navigator, { audio: true }, resolve, reject)
  })
}

function legacyGetUserMedia(): ((constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, error: (error: unknown) => void) => void) | null {
  const legacyNavigator = navigator as Navigator & {
    getUserMedia?: (constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, error: (error: unknown) => void) => void
    webkitGetUserMedia?: (constraints: MediaStreamConstraints, success: (stream: MediaStream) => void, error: (error: unknown) => void) => void
  }
  return legacyNavigator.getUserMedia ?? legacyNavigator.webkitGetUserMedia ?? null
}

async function requestNativeMicrophonePermission(): Promise<void> {
  if (!isAndroidTauriRuntime()) {
    await assertMacosMicrophoneNotDenied()
    return
  }

  try {
    const core = await import('@tauri-apps/api/core')
    if (!core.isTauri()) return

    const result = await core.invoke<{ microphone?: unknown }>('android_request_microphone_permission')
    const state = normalizePermissionState(result?.microphone)
    if (state && state !== 'granted') {
      throw new Error('Microphone permission was not granted. Enable microphone access for Branch Continue in Android app settings, then try recording again.')
    }
  } catch (nextError) {
    if (isMissingNativePermissionBridgeError(nextError)) return
    throw nextError
  }
}

const MACOS_MICROPHONE_DENIED_MESSAGE =
  'Microphone access is disabled for Branch Continue. Enable it in System Settings > Privacy & Security > Microphone, then try recording again.'

/**
 * On macOS the OS-level grant can be revoked (or invalidated by a re-signed
 * build) while getUserMedia only reports a generic failure; ask the shell for
 * the real TCC state so the user gets an actionable message.
 */
async function assertMacosMicrophoneNotDenied(): Promise<void> {
  if (typeof navigator === 'undefined' || !/mac/i.test(navigator.userAgent)) return
  try {
    const core = await import('@tauri-apps/api/core')
    if (!core.isTauri()) return
    const result = await core.invoke<{ microphone?: unknown }>('microphone_permission_state')
    if (normalizePermissionState(result?.microphone) === 'denied') {
      throw new Error(MACOS_MICROPHONE_DENIED_MESSAGE)
    }
  } catch (error) {
    if (error instanceof Error && error.message === MACOS_MICROPHONE_DENIED_MESSAGE) throw error
    // Older shells lack the command; let getUserMedia surface its own error.
  }
}

function isAndroidTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  if (!/android/i.test(window.navigator.userAgent)) return false

  const global = globalThis as typeof globalThis & { isTauri?: unknown }
  const win = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }
  return Boolean(global.isTauri || win.__TAURI__ || win.__TAURI_INTERNALS__)
}

function normalizePermissionState(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim().toLowerCase().replace(/_/g, '-') || null
}

function isMissingNativePermissionBridgeError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return (
    message.includes('android_request_microphone_permission') &&
    (message.includes('not found') || message.includes('unknown command'))
  ) || message.includes('android microphone permission is only available on android')
}

function recordingDiagnostic(error: unknown): string | null {
  if (!isAndroidTauriRuntime()) return null
  const message = errorMessage(error)
  const normalized = message.toLowerCase()
  if (normalized.includes('permission') || normalized.includes('notallowed') || normalized.includes('denied')) {
    return 'Android note: the WebView must grant both RECORD_AUDIO and MODIFY_AUDIO_SETTINGS. If this app shell was installed before this fix, reinstall the Android shell APK; OTA updates cannot add Android manifest permissions.'
  }

  if (normalized.includes('mediarecorder') || normalized.includes('not supported')) {
    return 'Android note: this device WebView may need an updated Android System WebView/Chrome to support MediaRecorder.'
  }

  return 'Android note: if OS microphone permission is already allowed, reinstall the latest Android shell so the WebView microphone permission bridge and manifest are current.'
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone permission was denied.'
    }
    if (error.name === 'NotFoundError') return 'No microphone was found on this device.'
    if (error.name === 'NotReadableError') return 'The microphone is already in use or cannot be opened by this WebView.'
  }

  return error instanceof Error ? error.message : String(error)
}
