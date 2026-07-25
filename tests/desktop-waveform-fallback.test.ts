import { describe, expect, it, vi } from 'vitest'
import {
  buildFallbackAudioSession,
  createPlaceholderPeaks,
  createSessionPeakAccumulator,
  peakCountForDurationMs,
  resamplePeaks,
  SESSION_PEAKS_PER_SECOND,
} from '../src/core/audio/audio-session'
import { fallbackWaveformWarning } from '../src/ui/components/AudioCaptureList'
import type { AudioCaptureRecord } from '../src/core/audio/audio-store'
import type { CanonicalPcmFrame } from '../src/core/audio/pcm-capture'

const SAMPLES_PER_PEAK = 16_000 / SESSION_PEAKS_PER_SECOND

function webmRecord(overrides: Partial<AudioCaptureRecord> = {}): AudioCaptureRecord {
  return {
    id: 'audio-1',
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
    mimeType: 'audio/webm;codecs=opus',
    createdAt: '2026-07-25T00:00:00.000Z',
    durationMs: 0,
    storage: 'file',
    ...overrides,
  }
}

function pcmFrame(sequence: number, startSample: number, amplitude: number, length = SAMPLES_PER_PEAK): CanonicalPcmFrame {
  const pcm16 = Int16Array.from(new Array(length).fill(amplitude))
  return {
    pcm16,
    sequence,
    startSample,
    endSample: startSample + pcm16.length,
    startMs: (startSample / 16_000) * 1000,
    endMs: ((startSample + pcm16.length) / 16_000) * 1000,
    containsPreRoll: false,
    final: false,
  }
}

describe('placeholder peaks', () => {
  it('sizes the strip at one peak per 50 ms', () => {
    expect(createPlaceholderPeaks(1_000)).toHaveLength(20)
    expect(createPlaceholderPeaks(2_500)).toHaveLength(50)
    expect(peakCountForDurationMs(60_000)).toBe(1_200)
  })

  it('keeps one visible peak for sub-frame durations and none without a duration', () => {
    expect(createPlaceholderPeaks(10)).toHaveLength(1)
    expect(createPlaceholderPeaks(0)).toEqual([])
    expect(createPlaceholderPeaks(Number.NaN)).toEqual([])
  })

  it('uses one modest constant amplitude', () => {
    const peaks = createPlaceholderPeaks(500)

    expect(new Set(peaks).size).toBe(1)
    expect(peaks[0]).toBeGreaterThan(0)
    expect(peaks[0]).toBeLessThan(1)
  })
})

describe('resamplePeaks', () => {
  it('keeps the loudest sample of each collapsed block', () => {
    expect(resamplePeaks([0, 0.9, 0.1, 0.2], 2)).toEqual([0.9, 0.2])
  })

  it('stretches a short envelope onto a longer strip', () => {
    expect(resamplePeaks([0.4, 0.8], 4)).toEqual([0.4, 0.4, 0.8, 0.8])
  })
})

describe('buildFallbackAudioSession', () => {
  it('sums segment durations and concatenates peaks in order', async () => {
    const records = [
      webmRecord({ id: 'a', storage: 'indexed-db', durationMs: 1_000 }),
      webmRecord({ id: 'b', storage: 'indexed-db', durationMs: 500 }),
    ]

    const session = await buildFallbackAudioSession(records, {
      storedPeaks: [
        { audioUri: 'a', peaksPerSecond: SESSION_PEAKS_PER_SECOND, durationMs: 1_000, peaks: new Array(20).fill(0.6) },
        null,
      ],
      probeDurationMs: async () => 0,
    })

    expect(session?.durationMs).toBe(1_500)
    expect(session?.segments.map((segment) => segment.startMs)).toEqual([0, 1_000])
    expect(session?.peaks[0]).toHaveLength(30)
    expect(session?.peaks[0]?.slice(0, 20)).toEqual(new Array(20).fill(0.6))
    expect(session?.peaks[0]?.slice(20)).toEqual(createPlaceholderPeaks(500))
    expect(session?.placeholderPeaks).toBe(false)
  })

  it('plays the original blob and marks a fully placeholder envelope', async () => {
    const record = webmRecord({ storage: 'indexed-db', durationMs: 800 })

    const session = await buildFallbackAudioSession([record], { probeDurationMs: async () => 0 })

    expect(session?.blob).toBe(record.blob)
    expect(session?.mimeType).toBe('audio/webm;codecs=opus')
    expect(session?.placeholderPeaks).toBe(true)
    expect(session?.peaks[0]).toEqual(createPlaceholderPeaks(800))
  })

  it('recovers file-backed segment durations from consecutive offsets and probes only the last', async () => {
    const metadata = (segmentIndex: number, offsetMs: number) => ({
      sessionId: 'voice-session-1',
      segmentIndex,
      offsetMs,
      languageCode: 'en-US',
      segmentStartReason: 'start' as const,
      final: false,
    })
    const records = [
      webmRecord({ id: 'a', metadata: metadata(0, 0) }),
      webmRecord({ id: 'b', metadata: metadata(1, 2_000) }),
    ]
    const probeDurationMs = vi.fn(async () => 3_000)

    const session = await buildFallbackAudioSession(records, { probeDurationMs })

    expect(probeDurationMs).toHaveBeenCalledOnce()
    expect(session?.segments.map((segment) => segment.durationMs)).toEqual([2_000, 3_000])
    expect(session?.durationMs).toBe(5_000)
    expect(session?.peaks[0]).toHaveLength(100)
  })

  it('reports a zero duration when nothing can date the recording', async () => {
    const session = await buildFallbackAudioSession([webmRecord()], { probeDurationMs: async () => 0 })

    expect(session?.durationMs).toBe(0)
    expect(session?.peaks).toEqual([])
  })

  it('caps very long sessions so the waveform stays cheap to render', async () => {
    const session = await buildFallbackAudioSession(
      [webmRecord({ storage: 'indexed-db', durationMs: 3_600_000 })],
      { probeDurationMs: async () => 0 },
    )

    expect(session?.peaks[0]).toHaveLength(20_000)
  })

  it('returns nothing without records', async () => {
    expect(await buildFallbackAudioSession([])).toBeNull()
  })
})

describe('createSessionPeakAccumulator', () => {
  it('buckets PCM frames into per-segment envelopes at recorder offsets', () => {
    const accumulator = createSessionPeakAccumulator()
    accumulator.push(pcmFrame(0, 0, 0x4000))
    accumulator.push(pcmFrame(1, SAMPLES_PER_PEAK, 0x2000))

    expect(accumulator.slice(0, 100)).toEqual([0.5, 0.25])
    expect(accumulator.slice(50, 50)).toEqual([0.25])
  })

  it('pads a segment that outlasts the captured frames', () => {
    const accumulator = createSessionPeakAccumulator()
    accumulator.push(pcmFrame(0, 0, 0x4000))

    expect(accumulator.slice(0, 150)).toEqual([0.5, 0, 0])
  })

  it('keeps resumed segments on the same session timeline', () => {
    const accumulator = createSessionPeakAccumulator()
    accumulator.push(pcmFrame(0, 0, 0x4000))
    accumulator.push(pcmFrame(0, SAMPLES_PER_PEAK * 2, 0x2000))

    expect(accumulator.slice(0, 150)).toEqual([0.5, 0, 0.25])
  })

  it('drops the previous envelope when a new session restarts sample indexing', () => {
    const accumulator = createSessionPeakAccumulator()
    accumulator.push(pcmFrame(0, 0, 0x4000))
    accumulator.push(pcmFrame(0, 0, 0x1000))

    expect(accumulator.slice(0, 50)).toEqual([0.125])
  })
})

describe('fallbackWaveformWarning', () => {
  it('only calls the waveform unavailable when there is no duration to draw', () => {
    expect(fallbackWaveformWarning(1, { durationMs: 0, placeholderPeaks: true }, new Error('decode failed')))
      .toContain('Waveform unavailable')
    expect(fallbackWaveformWarning(1, { durationMs: 4_000, placeholderPeaks: true }, new Error('decode failed')))
      .not.toContain('Waveform unavailable')
  })

  it('names the segment that playback covers in a multi-chunk session', () => {
    expect(fallbackWaveformWarning(3, { durationMs: 4_000, placeholderPeaks: false }, null))
      .toContain('first saved segment')
  })
})
