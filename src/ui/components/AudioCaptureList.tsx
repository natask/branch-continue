import { useEffect, useMemo, useState } from 'react'
import {
  extractAudioCaptureReferences,
  loadAudioCaptureReference,
  type AudioCaptureRecord,
} from '../../core/audio/audio-store'
import { buildAudioSessionBlob, type AudioSessionSegment } from '../../core/audio/audio-session'
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

interface AudioCaptureListProps {
  body: string
  sourcePath: string
}

export function AudioCaptureList({ body, sourcePath }: AudioCaptureListProps) {
  const references = useMemo(() => {
    const all = extractAudioCaptureReferences(body)
    const fileReferences = all.filter((reference) => reference.kind === 'file')
    return fileReferences.length > 0 ? fileReferences : all
  }, [body])
  const [session, setSession] = useState<LoadedAudioSession | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []

    setWarning(null)
    setSession(null)

    if (references.length === 0) return undefined

    void (async () => {
      try {
        const records: AudioCaptureRecord[] = []
        for (const reference of references) {
          const record = await loadAudioCaptureReference(reference, sourcePath)
          if (!record) continue
          records.push(record)
        }

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
  }, [references.map((reference) => reference.key).join('|'), sourcePath])

  if (references.length === 0) return null

  return (
    <div className="audio-capture-list" aria-label="Attached voice recordings">
      <div className="audio-capture-list-title">Voice session</div>
      {warning && <p className="audio-capture-muted">{warning}</p>}
      {!session && !warning && <p className="audio-capture-muted">Loading audio session...</p>}
      {session && (
        <AudioPlayer
          src={session.url}
          id={references.map((reference) => reference.key).join('|')}
          blob={session.blob}
          mimeType={session.mimeType}
          label={sessionLabel(session.segmentCount, session.switchCount)}
          downloadName={audioDownloadName(session.mimeType)}
          fallbackDurationMs={session.durationMs}
          peaks={session.peaks}
          waveformUnavailable={session.waveformUnavailable}
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
