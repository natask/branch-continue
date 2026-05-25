import { useEffect, useMemo, useState } from 'react'
import {
  extractAudioCaptureReferences,
  loadAudioCaptureReference,
  loadAudioTranscriptSegments,
  type AudioCaptureRecord,
  type AudioTranscriptSegment,
} from '../../core/audio/audio-store'
import { buildAudioSessionBlob, type AudioSessionSegment } from '../../core/audio/audio-session'
import { extractVoiceTranscriptCues, type VoiceTranscriptCue } from '../lib/voice-transcript'
import { AudioPlayer } from './AudioPlayer'

interface LoadedAudioSession {
  durationMs: number
  mimeType: string
  segmentCount: number
  segments: AudioSessionSegment[]
  switchCount: number
  blob: Blob
  peaks: number[][]
  url: string
  waveformUnavailable?: boolean
}

interface LoadedTranscriptCue {
  key: string
  timeMs: number
  label: string
  text: string
  sourceLabel: string
}

interface AudioCaptureListProps {
  body: string
  sourcePath: string
  refreshKey?: number
}

export function AudioCaptureList({ body, sourcePath, refreshKey = 0 }: AudioCaptureListProps) {
  const references = useMemo(() => {
    const all = extractAudioCaptureReferences(body)
    const fileReferences = all.filter((reference) => reference.kind === 'file')
    return fileReferences.length > 0 ? fileReferences : all
  }, [body])
  const referencesKey = useMemo(() => references.map((reference) => reference.key).join('|'), [references])
  const playerId = referencesKey
  const inlineTranscriptCues = useMemo(
    () => transcriptCuesFromInlineBody(body, references.map((reference) => reference.uri)),
    [body, references],
  )
  const [session, setSession] = useState<LoadedAudioSession | null>(null)
  const [transcriptCues, setTranscriptCues] = useState<LoadedTranscriptCue[]>(inlineTranscriptCues)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []

    setWarning(null)
    setSession(null)
    setTranscriptCues(inlineTranscriptCues)

    if (references.length === 0) return undefined

    void (async () => {
      try {
        const records: AudioCaptureRecord[] = []
        for (const reference of references) {
          const record = await loadAudioCaptureReference(reference, sourcePath)
          if (!record) continue
          records.push(record)
        }

        const loadedTranscriptCues = mergeTranscriptCues(
          (await loadAudioTranscriptSegments(records, sourcePath)).map(transcriptCueFromSegment),
          inlineTranscriptCues,
        )

        let sessionBlob = await buildAudioSessionBlob(records).catch((nextError) => {
          const fallbackLabel = records.length > 1 ? 'first saved segment' : 'original recording'
          if (!cancelled) setWarning(`Waveform unavailable; playing ${fallbackLabel}. ${errorMessage(nextError)}`)
          return null
        })
        let waveformUnavailable = false
        if (!sessionBlob && records[0]) {
          const record = records[0]
          waveformUnavailable = true
          sessionBlob = {
            blob: record.blob,
            mimeType: record.mimeType,
            durationMs: record.durationMs,
            peaks: [],
            segments: fallbackSegments([record]),
          }
        }
        if (!sessionBlob) return
        const url = URL.createObjectURL(sessionBlob.blob)
        urls.push(url)

        if (!cancelled) {
          setTranscriptCues(loadedTranscriptCues)
          setSession({
            durationMs: sessionBlob.durationMs,
            mimeType: sessionBlob.mimeType,
            segmentCount: waveformUnavailable ? 1 : records.length,
            segments: sessionBlob.segments,
            switchCount: sessionBlob.segments.filter((segment) => segment.segmentStartReason === 'language-switch').length,
            blob: sessionBlob.blob,
            peaks: sessionBlob.peaks,
            url,
            waveformUnavailable,
          })
        }
      } catch (nextError) {
        if (!cancelled) setWarning(`Audio waveform unavailable: ${nextError instanceof Error ? nextError.message : String(nextError)}`)
      }
    })()

    return () => {
      cancelled = true
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [inlineTranscriptCues, references, referencesKey, refreshKey, sourcePath])

  if (references.length === 0) return null

  return (
    <div className="audio-capture-list" aria-label="Attached voice recordings">
      <div className="audio-capture-list-title">Voice session</div>
      {warning && <p className="audio-capture-muted">{warning}</p>}
      {!session && !warning && <p className="audio-capture-muted">Loading audio session...</p>}
      {session && (
        <AudioPlayer
          src={session.url}
          id={playerId}
          blob={session.blob}
          mimeType={session.mimeType}
          label={sessionLabel(session.segmentCount, session.switchCount)}
          downloadName={audioDownloadName(session.mimeType)}
          fallbackDurationMs={session.durationMs}
          peaks={session.peaks}
          waveformUnavailable={session.waveformUnavailable}
          waveformHeight={92}
          markers={session.segments
            .filter((segment) => segment.segmentStartReason === 'language-switch' || segment.segmentStartReason === 'manual')
            .map((segment) => ({
              timeMs: segment.startMs,
              durationMs: Math.min(segment.durationMs, 1_500),
              label: segment.segmentStartReason === 'manual'
                ? 'Resume'
                : segment.languageCode ? `Switch ${segment.languageCode}` : 'Switch',
            }))}
          showDownload
        />
      )}
      <TranscriptDetail cues={transcriptCues} playerId={playerId} />
    </div>
  )
}

function TranscriptDetail({ cues, playerId }: { cues: LoadedTranscriptCue[]; playerId: string }) {
  if (cues.length === 0) {
    return (
      <div className="audio-transcript-detail audio-transcript-detail--empty">
        <div className="audio-transcript-detail-head">
          <span>Transcript</span>
          <span>sidecar</span>
        </div>
        <p className="audio-capture-muted">No transcript sidecar yet. Audio can still be replayed and downloaded.</p>
      </div>
    )
  }

  return (
    <div className="audio-transcript-detail">
      <div className="audio-transcript-detail-head">
        <span>Transcript</span>
        <span>{cues.length} cue{cues.length === 1 ? '' : 's'}</span>
      </div>
      <ol className="audio-transcript-cues">
        {cues.map((cue) => (
          <li key={cue.key} className="audio-transcript-cue">
            <button
              className="audio-transcript-cue-time"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('branch-continue:voice-seek', {
                  detail: { id: playerId, timeMs: cue.timeMs },
                }))
              }}
              type="button"
              title={`Seek to ${cue.label}`}
            >
              {cue.label}
            </button>
            <p>{cue.text}</p>
            <span>{cue.sourceLabel}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function fallbackSegments(records: AudioCaptureRecord[]): AudioSessionSegment[] {
  return records.map((record, index) => ({
    index,
    startMs: record.metadata?.offsetMs ?? 0,
    durationMs: record.durationMs,
    label: `Segment ${index + 1}`,
    languageCode: record.metadata?.languageCode,
    segmentStartReason: record.metadata?.segmentStartReason,
  }))
}

function transcriptCueFromSegment(segment: AudioTranscriptSegment): LoadedTranscriptCue {
  return {
    key: segment.id,
    timeMs: segment.offsetMs,
    label: segment.label,
    text: segment.text,
    sourceLabel: segment.transcriptUri ? `sidecar · ${fileLabel(segment.transcriptUri)}` : 'app storage',
  }
}

function transcriptCuesFromInlineBody(body: string, audioUris: string[]): LoadedTranscriptCue[] {
  const uriSet = new Set(audioUris)
  return extractVoiceTranscriptCues(body)
    .filter((cue) => uriSet.has(cue.uri))
    .map(inlineCueToLoadedCue)
}

function inlineCueToLoadedCue(cue: VoiceTranscriptCue): LoadedTranscriptCue {
  return {
    key: `inline:${cue.uri}:${cue.timeMs}:${cue.text}`,
    timeMs: cue.timeMs,
    label: cue.label,
    text: cue.text,
    sourceLabel: 'note body',
  }
}

function mergeTranscriptCues(
  sidecarCues: LoadedTranscriptCue[],
  inlineCues: LoadedTranscriptCue[],
): LoadedTranscriptCue[] {
  const merged = new Map<string, LoadedTranscriptCue>()
  for (const cue of inlineCues) merged.set(transcriptCueKey(cue), cue)
  for (const cue of sidecarCues) merged.set(transcriptCueKey(cue), cue)
  return Array.from(merged.values()).sort((a, b) => a.timeMs - b.timeMs || a.text.localeCompare(b.text))
}

function transcriptCueKey(cue: LoadedTranscriptCue): string {
  return `${cue.timeMs}:${cue.text.toLowerCase()}`
}

function fileLabel(path: string): string {
  const normalized = path.split('\\').join('/')
  return normalized.split('/').pop() || path
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sessionLabel(segmentCount: number, switchCount: number): string {
  if (switchCount > 0) return `Voice session · ${switchCount} language switch${switchCount === 1 ? '' : 'es'}`
  if (segmentCount > 1) return 'Voice session · auto chunked'
  return 'Voice session'
}

function audioDownloadName(mimeType: string): string {
  if (mimeType.includes('wav')) return 'branch-continue-voice-session.wav'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'branch-continue-voice-session.m4a'
  return 'branch-continue-voice-session.webm'
}
