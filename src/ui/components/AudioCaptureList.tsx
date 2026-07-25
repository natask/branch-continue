import { useEffect, useMemo, useState } from 'react'
import {
  extractAudioCaptureReferences,
  loadAudioCaptureSession,
  loadAudioTranscriptSegments,
  type AudioCaptureRecord,
  type AudioTranscriptSegment,
} from '../../core/audio/audio-store'
import { buildAudioSessionBlob, remapRecorderTimeToAssembledTime, type AudioSessionSegment } from '../../core/audio/audio-session'
import { useGlobalAudioPlayer } from '../lib/global-audio-player'
import { dispatchVoiceSeek } from '../lib/voice-seek'
import {
  buildTranscriptEvidenceBlocks,
  formatTranscriptRange,
  type TranscriptEvidenceBlock,
} from '../lib/audio-transcript-processing'
import {
  clampTranscriptCuesToDuration,
  formatTimedTranscriptForClipboard,
  formatTimedTranscriptTime,
  groupTimedTranscript,
  type TimedTranscriptBlock,
  type TimedTranscriptWord,
} from '../lib/timed-transcript'
import { extractVoiceTranscriptCues, type VoiceTranscriptCue } from '../lib/voice-transcript'
import { AudioPlayer } from './AudioPlayer'

interface LoadedAudioSession {
  durationMs: number
  mimeType: string
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
  durationMs?: number
  words?: TimedTranscriptWord[]
}

interface AudioCaptureListProps {
  body: string
  sourcePath: string
  refreshKey?: number
  showTitle?: boolean
}

export function AudioCaptureList({ body, sourcePath, refreshKey = 0, showTitle = true }: AudioCaptureListProps) {
  const references = useMemo(() => {
    const all = extractAudioCaptureReferences(body)
    const fileReferences = all.filter((reference) => reference.kind === 'file')
    // A note owns one logical voice note. Its session index can point to many
    // physical chunks, but additional body references must not become a
    // second merged recording.
    return (fileReferences.length > 0 ? fileReferences : all).slice(0, 1)
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
  // A mistimed remap (or a stale legacy inline cue) can anchor transcript text
  // past the end of the real waveform; drop anything the audio can't back up.
  const cuesWithAudio = useMemo(
    () => (session ? clampTranscriptCuesToDuration(transcriptCues, session.durationMs) : transcriptCues),
    [transcriptCues, session],
  )
  const transcriptBlocks = useMemo(() => groupTimedTranscript(cuesWithAudio), [cuesWithAudio])
  const evidenceBlocks = useMemo(() => buildTranscriptEvidenceBlocks(cuesWithAudio.map((cue) => ({
    key: cue.key,
    text: cue.text,
    startMs: cue.timeMs,
    endMs: typeof cue.durationMs === 'number' ? cue.timeMs + cue.durationMs : undefined,
    words: cue.words,
  }))), [cuesWithAudio])

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
        const loadedUris = new Set<string>()
        for (const reference of references) {
          const sessionRecords = await loadAudioCaptureSession(reference, sourcePath)
          for (const record of sessionRecords) {
            const uri = record.uri ?? record.relativePath ?? record.path ?? record.id
            if (loadedUris.has(uri)) continue
            loadedUris.add(uri)
            records.push(record)
          }
        }

        const transcriptSegments = await loadAudioTranscriptSegments(records, sourcePath)

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
        const loadedTranscriptCues = mergeTranscriptCues(
          transcriptSegments.map((segment) => transcriptCueFromSegment(
            segment,
            records,
            sessionBlob.segments,
          )),
          inlineTranscriptCues,
        )
        const url = URL.createObjectURL(sessionBlob.blob)
        urls.push(url)

        if (!cancelled) {
          setTranscriptCues(loadedTranscriptCues)
          setSession({
            durationMs: sessionBlob.durationMs,
            mimeType: sessionBlob.mimeType,
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
    <div className="audio-capture-list" aria-label="Voice note">
      {showTitle && <div className="audio-capture-list-title">Voice note</div>}
      {warning && <p className="audio-capture-muted">{warning}</p>}
      {!session && !warning && <p className="audio-capture-muted">Loading audio session...</p>}
      {session && (
        <AudioPlayer
          src={session.url}
          id={playerId}
          blob={session.blob}
          mimeType={session.mimeType}
          label={sessionLabel(session.switchCount)}
          downloadName={audioDownloadName(session.mimeType)}
          fallbackDurationMs={session.durationMs}
          peaks={session.peaks}
          waveformUnavailable={session.waveformUnavailable}
          waveformHeight={92}
          markers={[
            ...transcriptBlocks.map((block) => ({
              timeMs: block.startMs,
              durationMs: Math.max(240, block.endMs - block.startMs),
              label: formatTimedTranscriptTime(block.startMs),
            })),
            ...session.segments
              .filter((segment) => segment.segmentStartReason === 'language-switch' || segment.segmentStartReason === 'manual')
              .map((segment) => ({
              timeMs: segment.startMs,
              durationMs: Math.min(segment.durationMs, 1_500),
              label: segment.segmentStartReason === 'manual'
                ? 'Resume'
                : segment.languageCode ? `Switch ${segment.languageCode}` : 'Switch',
              })),
          ]}
          showDownload
        />
      )}
      <TranscriptDetail blocks={transcriptBlocks} evidenceBlocks={evidenceBlocks} playerId={playerId} />
    </div>
  )
}

function TranscriptDetail({
  blocks,
  evidenceBlocks,
  playerId,
}: {
  blocks: TimedTranscriptBlock[]
  evidenceBlocks: TranscriptEvidenceBlock[]
  playerId: string
}) {
  const audio = useGlobalAudioPlayer()
  const [view, setView] = useState<'raw' | 'ideas'>('raw')
  const [copyStatus, setCopyStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  async function handleCopyTranscript() {
    const transcript = formatTimedTranscriptForClipboard(blocks)
    if (!transcript) return
    try {
      await copyPlainText(transcript)
      setCopyStatus({ kind: 'success', message: 'Transcript copied.' })
    } catch (error) {
      setCopyStatus({ kind: 'error', message: `Could not copy transcript. ${errorMessage(error)}` })
    }
  }

  if (blocks.length === 0) {
    return (
      <div className="audio-transcript-detail audio-transcript-detail--empty">
        <div className="audio-transcript-detail-head">
          <span>Transcript</span>
        </div>
        <p className="audio-capture-muted">No transcript yet. Audio can still be played and downloaded.</p>
      </div>
    )
  }

  return (
    <div className="audio-transcript-detail">
      <div className="audio-transcript-detail-head">
        <div className="audio-transcript-tabs" role="tablist" aria-label="Transcript view">
          <button className={view === 'raw' ? 'audio-transcript-tab audio-transcript-tab--active' : 'audio-transcript-tab'} onClick={() => setView('raw')} role="tab" aria-selected={view === 'raw'} type="button">Raw</button>
          <button className={view === 'ideas' ? 'audio-transcript-tab audio-transcript-tab--active' : 'audio-transcript-tab'} onClick={() => setView('ideas')} role="tab" aria-selected={view === 'ideas'} type="button">Ideas</button>
        </div>
        <div className="audio-transcript-detail-actions">
          <span>{view === 'raw' ? `${blocks.length} speech block${blocks.length === 1 ? '' : 's'}` : `${evidenceBlocks.length} linked idea${evidenceBlocks.length === 1 ? '' : 's'}`}</span>
          <button className="btn-secondary" onClick={() => void handleCopyTranscript()} type="button">
            Copy transcript
          </button>
        </div>
      </div>
      {copyStatus && (
        <p
          className={copyStatus.kind === 'error' ? 'voice-recorder-error' : 'audio-capture-muted'}
          role={copyStatus.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {copyStatus.message}
        </p>
      )}
      {view === 'raw' ? <ol className="audio-transcript-cues">
        {blocks.map((block) => (
          <li key={block.key} className="audio-transcript-cue">
            <button
              className="audio-transcript-cue-time"
              onClick={() => seekVoiceSession(playerId, block.startMs)}
              type="button"
              title={`Seek to ${formatTimedTranscriptTime(block.startMs)}`}
            >
              {formatTimedTranscriptTime(block.startMs)}
            </button>
            <p className="audio-transcript-words">
              {block.words.map((word, index) => {
                const active = audio.activeId === playerId
                  && audio.currentTime * 1000 >= word.startMs
                  && audio.currentTime * 1000 < Math.max(word.startMs + 80, word.endMs)
                return (
                  <button
                    key={`${word.startMs}:${index}:${word.text}`}
                    className={`audio-transcript-word${active ? ' audio-transcript-word--active' : ''}`}
                    onClick={() => seekVoiceSession(playerId, word.startMs)}
                    type="button"
                    title={`${word.approximate ? 'Estimated ' : ''}${formatTimedTranscriptTime(word.startMs)}`}
                    aria-current={active ? 'true' : undefined}
                  >
                    {word.text}
                  </button>
                )
              })}
            </p>
            {block.words.some((word) => word.approximate) && <span>approximate timing</span>}
          </li>
        ))}
      </ol> : <ol className="audio-transcript-cues audio-transcript-ideas">
        {evidenceBlocks.map((idea) => (
          <li key={idea.id} className="audio-transcript-cue audio-transcript-idea">
            <button
              className="audio-transcript-cue-time"
              onClick={() => seekVoiceSession(playerId, idea.startMs)}
              type="button"
              title={`Play supporting audio at ${formatTranscriptRange(idea.startMs, idea.endMs)}`}
            >
              {formatTranscriptRange(idea.startMs, idea.endMs)}
            </button>
            <div>
              <button className="audio-transcript-idea-title" onClick={() => seekVoiceSession(playerId, idea.startMs)} type="button">
                {idea.title}
              </button>
              <p>{idea.text}</p>
            </div>
          </li>
        ))}
      </ol>}
    </div>
  )
}

function fallbackSegments(records: AudioCaptureRecord[]): AudioSessionSegment[] {
  let assembledStartMs = 0
  return records.map((record, index) => {
    const segment = {
      index,
      startMs: assembledStartMs,
      durationMs: record.durationMs,
      label: `Segment ${index + 1}`,
      languageCode: record.metadata?.languageCode,
      segmentStartReason: record.metadata?.segmentStartReason,
    }
    assembledStartMs += record.durationMs
    return segment
  })
}

function transcriptCueFromSegment(
  segment: AudioTranscriptSegment,
  records: AudioCaptureRecord[],
  assembledSegments: AudioSessionSegment[],
): LoadedTranscriptCue {
  const timestamped = segment as AudioTranscriptSegment & { words?: TimedTranscriptWord[] }
  const recordIndex = records.findIndex((record) => {
    const uri = record.uri ?? record.relativePath ?? record.path ?? record.id
    return uri === segment.audioUri || record.metadata?.segmentIndex === segment.segmentIndex
  })
  const record = recordIndex >= 0 ? records[recordIndex] : undefined
  const assembled = recordIndex >= 0 ? assembledSegments[recordIndex] : undefined
  const recorderStartMs = record?.metadata?.offsetMs ?? segment.offsetMs
  const mapTime = (timeMs: number) => assembled
    ? remapRecorderTimeToAssembledTime(timeMs, recorderStartMs, assembled.startMs)
    : timeMs
  return {
    key: segment.id,
    timeMs: mapTime(segment.offsetMs),
    label: segment.label,
    text: segment.text,
    sourceLabel: segment.transcriptUri ? `sidecar · ${fileLabel(segment.transcriptUri)}` : 'app storage',
    durationMs: segment.durationMs,
    words: timestamped.words?.map((word) => ({
      ...word,
      startMs: mapTime(word.startMs),
      endMs: mapTime(word.endMs),
    })),
  }
}

function seekVoiceSession(playerId: string, timeMs: number): void {
  dispatchVoiceSeek(window, playerId, timeMs)
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

function sessionLabel(switchCount: number): string {
  if (switchCount > 0) return `Voice session · ${switchCount} language switch${switchCount === 1 ? '' : 'es'}`
  return 'Voice session'
}

function audioDownloadName(mimeType: string): string {
  if (mimeType.includes('wav')) return 'branch-continue-voice-session.wav'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'branch-continue-voice-session.m4a'
  return 'branch-continue-voice-session.webm'
}

async function copyPlainText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Desktop webviews and non-secure browser contexts can deny the modern
      // API. Fall through to the selection-based clipboard path.
    }
  }

  if (typeof document === 'undefined') throw new Error('Clipboard is unavailable.')
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    if (!document.execCommand('copy')) throw new Error('The clipboard rejected the copy request.')
  } finally {
    textarea.remove()
  }
}
