import { useCallback, useEffect, useRef, useState } from 'react'
import fixWebmDuration from 'fix-webm-duration'

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
}

export type AudioRecordingSegmentStartReason = 'start' | 'auto' | 'manual' | 'language-switch'

interface AudioRecorderStartOptions {
  newSession?: boolean
}

const MAX_TRANSCRIPTION_SEGMENT_MS = 45_000

interface UseAudioNoteRecorderOptions {
  languageCode?: string
  livePreview?: boolean
  onFinalTranscript?: (segment: string) => void
  onRecordingComplete?: (capture: AudioRecordingComplete) => void | Promise<void>
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
  start: (languageCode?: string, options?: AudioRecorderStartOptions) => Promise<void>
  switchLanguage: (languageCode: string) => void
  stop: () => void
  clear: () => void
}

export function useAudioNoteRecorder({
  languageCode,
  livePreview = false,
  onFinalTranscript,
  onRecordingComplete,
}: UseAudioNoteRecorderOptions = {}): UseAudioNoteRecorderResult {
  const [status, setStatus] = useState<AudioRecorderStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [mimeType, setMimeType] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null)
  const recordingRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const segmentTimerRef = useRef<number | null>(null)
  const segmentIndexRef = useRef(0)
  const segmentOffsetMsRef = useRef(0)
  const segmentStartedAtRef = useRef(0)
  const segmentStartedAtIsoRef = useRef<string | null>(null)
  const segmentLanguageCodeRef = useRef(resolveLanguageCode(languageCode))
  const segmentStartReasonRef = useRef<AudioRecordingSegmentStartReason>('start')
  const nextSegmentStartReasonRef = useRef<AudioRecordingSegmentStartReason>('auto')
  const sessionIdRef = useRef(createAudioSessionId())
  const hasSessionRef = useRef(false)
  const startedAtRef = useRef(0)
  const startedAtIsoRef = useRef<string | null>(null)
  const elapsedTimerRef = useRef<number | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const languageCodeRef = useRef(languageCode)
  const livePreviewRef = useRef(livePreview)
  const onFinalTranscriptRef = useRef(onFinalTranscript)
  const onRecordingCompleteRef = useRef(onRecordingComplete)
  const completionQueueRef = useRef<Promise<void>>(Promise.resolve())

  languageCodeRef.current = languageCode
  livePreviewRef.current = livePreview
  onFinalTranscriptRef.current = onFinalTranscript
  onRecordingCompleteRef.current = onRecordingComplete

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
    cleanupStream()
    mediaRecorderRef.current = null
  }, [cleanupStream, stopElapsedTimer, stopSegmentTimer, stopSpeechRecognition])

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
    if (nextLanguageCode) languageCodeRef.current = nextLanguageCode
    const browserRecorderAvailable = browserAudioRecordingAvailable()
    const continueSession = hasSessionRef.current && status === 'stopped' && !options.newSession

    setStatus('requesting')
    setError(null)
    setInterimTranscript('')
    setFinalTranscript('')
    setAudioBlob(null)
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
      setAudioUrl(null)
    }

    if (!browserRecorderAvailable) {
      setStatus('error')
      setError('Microphone capture requires WebView MediaRecorder support on this platform.')
      return
    }

    try {
      await requestNativeMicrophonePermission()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMimeType = pickAudioMimeType()

      streamRef.current = stream
      recordingRef.current = true
      stopRequestedRef.current = false
      if (!continueSession) {
        segmentIndexRef.current = 0
        segmentOffsetMsRef.current = 0
        sessionIdRef.current = createAudioSessionId()
      }
      segmentStartReasonRef.current = continueSession ? 'manual' : 'start'
      nextSegmentStartReasonRef.current = 'auto'
      hasSessionRef.current = true
      const startedAt = new Date()
      startedAtRef.current = startedAt.getTime() - segmentOffsetMsRef.current
      startedAtIsoRef.current = startedAt.toISOString()
      setElapsedMs(segmentOffsetMsRef.current)

      const startRecorderSegment = () => {
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream)
        const segmentIndex = segmentIndexRef.current
        const segmentOffsetMs = segmentOffsetMsRef.current
        const segmentStartedAt = new Date()
        const segmentLanguageCode = resolveLanguageCode(languageCodeRef.current)
        const segmentStartReason = segmentStartReasonRef.current

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
          const captureSessionId = sessionIdRef.current

          if (rawBlob.size > 0 && durationMs > 0) {
            const fixedBlobPromise = normalizeRecordedBlobDuration(rawBlob, durationMs)
            completionQueueRef.current = completionQueueRef.current
              .catch(() => undefined)
              .then(async () => {
                const blob = await fixedBlobPromise
                const url = URL.createObjectURL(blob)
                if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
                audioUrlRef.current = url
                setAudioBlob(blob)
                setAudioUrl(url)
                setMimeType(type)
                void onRecordingCompleteRef.current?.({
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
                })
              })
            void completionQueueRef.current.catch((nextError) => {
              setError(errorMessage(nextError))
            })
          }

          segmentOffsetMsRef.current = segmentOffsetMs + Math.max(0, durationMs)
          segmentIndexRef.current = segmentIndex + 1

          if (isFinal) {
            setElapsedMs(Date.now() - startedAtRef.current)
            setStatus('stopped')
            cleanupRecording()
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

      startRecorderSegment()
      startSpeechRecognition()
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current)
      }, 500)
      setStatus('recording')
    } catch (nextError) {
      cleanupRecording()
      setStatus('error')
      setError(errorMessage(nextError))
    }
  }, [cleanupRecording, startSpeechRecognition, status])

  const switchLanguage = useCallback((nextLanguageCode: string) => {
    const normalizedLanguageCode = resolveLanguageCode(nextLanguageCode)
    languageCodeRef.current = normalizedLanguageCode

    if (!recordingRef.current) return

    stopSpeechRecognition()
    startSpeechRecognition()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return

    nextSegmentStartReasonRef.current = 'language-switch'
    stopSegmentTimer()
    try {
      recorder.stop()
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }, [startSpeechRecognition, stopSegmentTimer, stopSpeechRecognition])

  const stop = useCallback(() => {
    if (!recordingRef.current) return
    setStatus('stopping')
    stopRequestedRef.current = true
    stopSegmentTimer()
    stopElapsedTimer()
    stopSpeechRecognition()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      cleanupRecording()
      setStatus('stopped')
      return
    }

    recorder.stop()
  }, [cleanupRecording, stopElapsedTimer, stopSegmentTimer, stopSpeechRecognition])

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
    mediaRecorderAvailable: browserAudioRecordingAvailable(),
    start,
    switchLanguage,
    stop,
    clear,
  }
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

function browserAudioRecordingAvailable(): boolean {
  if (typeof navigator === 'undefined' || typeof MediaRecorder === 'undefined') return false
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

async function requestNativeMicrophonePermission(): Promise<void> {
  if (!isAndroidTauriRuntime()) return

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

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone permission was denied. Enable microphone access for Branch Continue in system settings, then try recording again.'
    }
    if (error.name === 'NotFoundError') return 'No microphone was found on this device.'
    if (error.name === 'NotReadableError') return 'The microphone is already in use or cannot be opened by this WebView.'
  }

  return error instanceof Error ? error.message : String(error)
}
