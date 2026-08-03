import { describe, expect, it } from 'vitest'
import { buildCanonicalPcmWav } from '../src/core/audio/audio-session'
import {
  encodeAudioCaptureFileMetadata,
  mergeAudioTranscriptSegment,
  parseAudioCaptureFileMetadata,
  resolveAudioCaptureResumeSession,
  resolveFileAudioDurationMs,
  type AudioCaptureMetadata,
  type AudioTranscriptSegment,
  type SaveAudioCaptureInput,
} from '../src/core/audio/audio-store'
import type { CanonicalPcmFrame } from '../src/core/audio/pcm-capture'

describe('canonical note audio file', () => {
  it('rewrites resumed PCM into one WAV timeline', async () => {
    const first = await buildCanonicalPcmWav([frame(0, [100, 200])])
    const resumed = await buildCanonicalPcmWav([frame(2, [300, 400])], first?.blob)

    expect(resumed?.mimeType).toBe('audio/wav')
    expect(resumed?.blob.size).toBe(44 + 4 * 2)
    expect(resumed?.durationMs).toBe(0)
    const bytes = new DataView(await resumed!.blob.arrayBuffer())
    expect([0, 1, 2, 3].map((index) => bytes.getInt16(44 + index * 2, true))).toEqual([100, 200, 300, 400])
  })

  it('accumulates transcript slices against the same audio URI', () => {
    const first = transcript(0, 0, 'First thought.')
    const second = transcript(1, 30_000, 'Second thought.')
    const merged = mergeAudioTranscriptSegment(first, second)

    expect(merged.audioUri).toBe('recordings/note.wav')
    expect(merged.text).toBe('First thought. Second thought.')
    expect(merged.segmentIndex).toBe(1)
  })

  it('recovers the canonical WAV offset after restart and appends resumed PCM', async () => {
    const initialSamples = new Array(16_000).fill(100)
    const first = await buildCanonicalPcmWav([frame(0, initialSamples)])
    const bytes = new Uint8Array(await first!.blob.arrayBuffer())
    const durationMs = resolveFileAudioDurationMs(bytes, 'audio/wav')
    const resume = resolveAudioCaptureResumeSession([{
      id: 'note',
      blob: first!.blob,
      mimeType: 'audio/wav',
      createdAt: '',
      durationMs,
      metadata: captureMetadata,
    }])

    expect(resume).toEqual({ sessionId: 'voice-session-1', segmentIndex: 1, offsetMs: 1_000 })

    const resumed = await buildCanonicalPcmWav([
      frame(Math.round(resume!.offsetMs / 1_000 * 16_000), [300, 400]),
    ], first!.blob)
    const resumedBytes = new DataView(await resumed!.blob.arrayBuffer())

    expect(resumed!.blob.size).toBe(44 + (16_000 + 2) * 2)
    expect(resumedBytes.getInt16(44, true)).toBe(100)
    expect(resumedBytes.getInt16(44 + 16_000 * 2, true)).toBe(300)
  })

  it('round-trips the bounded desktop sidecar and Android metadataJson shapes', () => {
    const input: SaveAudioCaptureInput = {
      id: 'note',
      blob: new Blob(),
      mimeType: 'audio/wav',
      createdAt: '2026-08-03T12:00:00.000Z',
      durationMs: 42_125,
      metadata: captureMetadata,
    }
    const sidecarBytes = encodeAudioCaptureFileMetadata(input)

    const desktop = parseAudioCaptureFileMetadata(new TextDecoder().decode(sidecarBytes))
    const android = parseAudioCaptureFileMetadata(new TextDecoder().decode(sidecarBytes))

    expect(desktop).toEqual({
      metadata: captureMetadata,
      durationMs: 42_125,
      createdAt: '2026-08-03T12:00:00.000Z',
    })
    expect(android).toEqual(desktop)
    expect(parseAudioCaptureFileMetadata(JSON.stringify({
      ...captureMetadata,
      durationMs: Number.POSITIVE_INFINITY,
    }))).toEqual({ metadata: captureMetadata })
  })
})

const captureMetadata: AudioCaptureMetadata = {
  sessionId: 'voice-session-1',
  segmentIndex: 0,
  offsetMs: 0,
  languageCode: 'en-US',
  segmentStartReason: 'start',
  final: true,
}

function frame(startSample: number, samples: number[]): CanonicalPcmFrame {
  return {
    pcm16: Int16Array.from(samples),
    sequence: 0,
    startSample,
    endSample: startSample + samples.length,
    startMs: 0,
    endMs: 0,
    containsPreRoll: false,
    final: true,
  }
}

function transcript(segmentIndex: number, offsetMs: number, text: string): AudioTranscriptSegment {
  return {
    id: 'transcript:recordings/note.wav',
    audioUri: 'recordings/note.wav',
    text,
    offsetMs,
    label: '00:00',
    createdAt: new Date(0).toISOString(),
    languageCode: 'auto',
    sessionId: 'voice-session-1',
    segmentIndex,
    durationMs: 30_000,
  }
}
