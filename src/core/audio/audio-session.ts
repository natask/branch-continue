import type { AudioCapturePeaks, AudioCaptureRecord, AudioCaptureSegmentStartReason } from './audio-store'
import { CANONICAL_PCM_SAMPLE_RATE, type CanonicalPcmFrame } from './pcm-capture'

interface AudioData {
  channelData: Float32Array[]
  sampleRate: number
}

/** Envelope resolution used by both record-time capture and placeholder peaks. */
export const SESSION_PEAKS_PER_SECOND = 20
const MS_PER_SESSION_PEAK = 1000 / SESSION_PEAKS_PER_SECOND
const PLACEHOLDER_PEAK_AMPLITUDE = 0.35
const MAX_SESSION_PEAKS = 20_000
const DURATION_PROBE_TIMEOUT_MS = 4_000

export interface AudioSessionSegment {
  index: number
  startMs: number
  durationMs: number
  label: string
  languageCode?: string
  segmentStartReason?: AudioCaptureSegmentStartReason
}

export interface AudioSessionBlob {
  blob: Blob
  mimeType: string
  durationMs: number
  peaks: number[][]
  segments: AudioSessionSegment[]
}

/** Build the note's canonical mono WAV directly from capture PCM. */
export async function buildCanonicalPcmWav(
  frames: CanonicalPcmFrame[],
  existingBlob?: Blob | null,
): Promise<AudioSessionBlob | null> {
  if (frames.length === 0 && !existingBlob) return null
  const existing = existingBlob ? parseCanonicalPcmWav(await existingBlob.arrayBuffer()) : new Int16Array()
  const frameEnd = frames.reduce((end, frame) => Math.max(end, frame.endSample), 0)
  const samples = new Int16Array(Math.max(existing.length, frameEnd))
  samples.set(existing.subarray(0, samples.length))
  for (const frame of frames) {
    if (frame.startSample >= samples.length) continue
    samples.set(frame.pcm16.subarray(0, samples.length - frame.startSample), frame.startSample)
  }
  if (samples.length === 0) return null
  const wav = encodeCanonicalPcmWav(samples)
  return {
    blob: new Blob([wav], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    durationMs: Math.round(samples.length / CANONICAL_PCM_SAMPLE_RATE * 1000),
    peaks: [],
    segments: [],
  }
}

function encodeCanonicalPcmWav(samples: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.byteLength)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.byteLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, CANONICAL_PCM_SAMPLE_RATE, true)
  view.setUint32(28, CANONICAL_PCM_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.byteLength, true)
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, samples[index] ?? 0, true)
  return buffer
}

function parseCanonicalPcmWav(buffer: ArrayBuffer): Int16Array {
  const view = new DataView(buffer)
  if (view.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return new Int16Array()
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const kind = readAscii(view, offset, 4)
    const length = view.getUint32(offset + 4, true)
    if (kind === 'data') {
      const sampleCount = Math.max(0, Math.min(length, view.byteLength - offset - 8) >> 1)
      const samples = new Int16Array(sampleCount)
      for (let index = 0; index < sampleCount; index += 1) samples[index] = view.getInt16(offset + 8 + index * 2, true)
      return samples
    }
    offset += 8 + length + (length % 2)
  }
  return new Int16Array()
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index))
  return value
}

/**
 * Translate a timestamp persisted against the recorder's wall-clock session
 * into the gap-free decoded WAV assembled for playback.
 */
export function remapRecorderTimeToAssembledTime(
  timeMs: number,
  recorderSegmentStartMs: number,
  assembledSegmentStartMs: number,
): number {
  const withinSegmentMs = Math.max(0, timeMs - recorderSegmentStartMs)
  return Math.max(0, Math.round(assembledSegmentStartMs + withinSegmentMs))
}

type AudioBufferToWav = (buffer: AudioBuffer, options?: { float32?: boolean }) => ArrayBuffer

export async function buildAudioSessionBlob(records: AudioCaptureRecord[]): Promise<AudioSessionBlob | null> {
  if (records.length === 0) return null

  const context = createAudioContext()
  try {
    const buffers = await Promise.all(records.map((record) => decodeRecord(record, context)))
    const sessionBuffer = concatenateAudioBuffers(context, buffers)
    const wavBuffer = await encodeAudioBufferAsWav(sessionBuffer)
    const durationMs = Math.round((sessionBuffer.length / sessionBuffer.sampleRate) * 1000)
    const peaks = exportAudioPeaks(sessionBuffer)
    let offsetMs = 0
    const segments = records.map((record, index) => {
      const buffer = buffers[index]!
      const duration = Math.round((buffer.length / buffer.sampleRate) * 1000)
      const segment = segmentFromRecord(record, index, offsetMs, duration)
      offsetMs += duration
      return segment
    })

    return {
      blob: new Blob([wavBuffer], { type: 'audio/wav' }),
      mimeType: 'audio/wav',
      durationMs,
      peaks,
      segments,
    }
  } finally {
    await context.close().catch(() => undefined)
  }
}

export interface FallbackAudioSession extends AudioSessionBlob {
  /** True when no segment had recorded levels, so the wave is a neutral outline. */
  placeholderPeaks: boolean
}

export interface BuildFallbackAudioSessionOptions {
  /** Stored envelopes aligned with `records`, as loaded from the peaks sidecars. */
  storedPeaks?: (AudioCapturePeaks | null | undefined)[]
  probeDurationMs?: (record: AudioCaptureRecord) => Promise<number>
}

/**
 * Assemble a playable session without decoding any audio. WKWebView cannot
 * decode WebM/Opus, but wavesurfer only needs explicit peaks plus a duration to
 * render the full waveform, ruler and playhead, so the original blob stays the
 * playback source while the envelope comes from sidecars or a placeholder.
 */
export async function buildFallbackAudioSession(
  records: AudioCaptureRecord[],
  options: BuildFallbackAudioSessionOptions = {},
): Promise<FallbackAudioSession | null> {
  const first = records[0]
  if (!first) return null

  const probeDurationMs = options.probeDurationMs ?? probeRecordDurationMs
  const durations: number[] = []
  for (const [index, record] of records.entries()) {
    const stored = options.storedPeaks?.[index] ?? null
    const known = knownSegmentDurationMs(records, index, stored)
    durations.push(known > 0 ? known : Math.max(0, Math.round(await probeDurationMs(record).catch(() => 0))))
  }

  const segments: AudioSessionSegment[] = []
  let peaks: number[] = []
  let offsetMs = 0
  let placeholderPeaks = true

  for (const [index, record] of records.entries()) {
    const durationMs = durations[index] ?? 0
    const stored = options.storedPeaks?.[index] ?? null
    const length = peakCountForDurationMs(durationMs)
    if (stored && stored.peaks.length > 0) {
      placeholderPeaks = false
      peaks = peaks.concat(resamplePeaks(stored.peaks, length))
    } else {
      peaks = peaks.concat(createPlaceholderPeaks(durationMs))
    }
    segments.push(segmentFromRecord(record, index, offsetMs, durationMs))
    offsetMs += durationMs
  }

  return {
    blob: first.blob,
    mimeType: first.mimeType,
    durationMs: offsetMs,
    peaks: peaks.length > 0 ? [downsamplePeaks(peaks, MAX_SESSION_PEAKS)] : [],
    segments,
    placeholderPeaks,
  }
}

/** A flat strip at a modest amplitude: readable as "audio here" without faking detail. */
export function createPlaceholderPeaks(durationMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return []
  return new Array(peakCountForDurationMs(durationMs)).fill(PLACEHOLDER_PEAK_AMPLITUDE)
}

export function peakCountForDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(1, Math.round(durationMs / MS_PER_SESSION_PEAK))
}

export function resamplePeaks(peaks: number[], targetLength: number): number[] {
  if (targetLength <= 0) return []
  if (peaks.length === 0) return new Array(targetLength).fill(0)
  if (peaks.length === targetLength) return [...peaks]

  const ratio = peaks.length / targetLength
  const resampled: number[] = []
  for (let index = 0; index < targetLength; index += 1) {
    const start = Math.min(peaks.length - 1, Math.floor(index * ratio))
    const end = Math.min(peaks.length, Math.max(start + 1, Math.floor((index + 1) * ratio)))
    let peak = 0
    for (let source = start; source < end; source += 1) peak = Math.max(peak, peaks[source] ?? 0)
    resampled.push(peak)
  }
  return resampled
}

export function downsamplePeaks(peaks: number[], maxLength: number): number[] {
  if (maxLength <= 0 || peaks.length <= maxLength) return peaks
  return resamplePeaks(peaks, maxLength)
}

export interface SessionPeakAccumulator {
  push: (frame: CanonicalPcmFrame) => void
  /** Envelope for one persisted segment, in session-absolute recorder time. */
  slice: (offsetMs: number, durationMs: number) => number[]
  /** The whole session envelope so far, for live rendering while recording. */
  peaks: () => number[]
  reset: () => void
}

/**
 * Collects the recording's amplitude envelope from the canonical PCM stream so
 * it can be saved beside the audio. Frame sample indexes are session-absolute
 * across pause/resume, so buckets line up with the recorder's segment offsets.
 */
export function createSessionPeakAccumulator(peaksPerSecond = SESSION_PEAKS_PER_SECOND): SessionPeakAccumulator {
  const samplesPerPeak = Math.max(1, Math.round(CANONICAL_PCM_SAMPLE_RATE / peaksPerSecond))
  const msPerPeak = 1000 / peaksPerSecond
  let peaks: number[] = []

  return {
    push(frame) {
      // A new recording session restarts sample indexing at zero; drop the
      // previous session's envelope instead of merging the two.
      if (frame.sequence === 0 && frame.startSample === 0) peaks = []
      for (let index = 0; index < frame.pcm16.length; index += 1) {
        const bucket = Math.floor((frame.startSample + index) / samplesPerPeak)
        const value = Math.min(1, Math.abs(frame.pcm16[index] ?? 0) / 0x8000)
        peaks[bucket] = Math.max(peaks[bucket] ?? 0, value)
      }
    },
    slice(offsetMs, durationMs) {
      const length = peakCountForDurationMs(durationMs)
      if (length === 0) return []
      const start = Math.max(0, Math.floor(Math.max(0, offsetMs) / msPerPeak))
      return Array.from({ length }, (_, index) => peaks[start + index] ?? 0)
    },
    peaks() {
      return peaks
    },
    reset() {
      peaks = []
    },
  }
}

function knownSegmentDurationMs(
  records: AudioCaptureRecord[],
  index: number,
  stored: AudioCapturePeaks | null,
): number {
  const record = records[index]
  if (record && record.durationMs > 0) return Math.round(record.durationMs)
  if (stored && stored.durationMs > 0) return Math.round(stored.durationMs)

  // File-backed records carry no duration, but consecutive segment offsets do:
  // each segment starts where the previous one ended.
  const offsetMs = record?.metadata?.offsetMs
  const nextOffsetMs = records[index + 1]?.metadata?.offsetMs
  if (typeof offsetMs === 'number' && typeof nextOffsetMs === 'number' && nextOffsetMs > offsetMs) {
    return Math.round(nextOffsetMs - offsetMs)
  }
  return 0
}

/** Media elements report duration for containers their AudioContext cannot decode. */
async function probeRecordDurationMs(record: AudioCaptureRecord): Promise<number> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return 0

  const element = document.createElement('audio')
  const url = URL.createObjectURL(record.blob)
  try {
    return await new Promise<number>((resolve) => {
      const finish = (durationMs: number) => {
        window.clearTimeout(timeout)
        element.removeAttribute('src')
        resolve(durationMs)
      }
      const timeout = window.setTimeout(() => finish(0), DURATION_PROBE_TIMEOUT_MS)
      element.addEventListener('loadedmetadata', () => {
        finish(Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : 0)
      }, { once: true })
      element.addEventListener('error', () => finish(0), { once: true })
      element.preload = 'metadata'
      element.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function exportAudioPeaks(buffer: AudioBuffer, maxLength = 1_200): number[][] {
  const samplesPerPeak = Math.max(1, Math.ceil(buffer.length / maxLength))
  const peakCount = Math.ceil(buffer.length / samplesPerPeak)
  const peaks: number[][] = []

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel)
    const channelPeaks: number[] = []

    for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
      const start = peakIndex * samplesPerPeak
      const end = Math.min(source.length, start + samplesPerPeak)
      let peak = 0

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(source[sampleIndex] ?? 0))
      }

      channelPeaks.push(peak)
    }

    peaks.push(channelPeaks)
  }

  return peaks
}

function createAudioContext(): AudioContext {
  const Constructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Constructor) throw new Error('Audio decoding is unavailable in this WebView.')
  return new Constructor()
}

async function decodeRecord(record: AudioCaptureRecord, context: AudioContext): Promise<AudioBuffer> {
  const bytes = await record.blob.arrayBuffer()
  try {
    return await context.decodeAudioData(bytes.slice(0))
  } catch (nativeError) {
    if (!isWebmRecord(record)) throw nativeError
    const decodeWebm = (await import('@audio/decode-webm')).default
    return audioDataToAudioBuffer(context, await decodeWebm(bytes.slice(0)))
  }
}

function isWebmRecord(record: AudioCaptureRecord): boolean {
  const mimeType = record.mimeType.toLowerCase()
  return mimeType.includes('webm') || Boolean(record.path?.toLowerCase().endsWith('.webm') || record.relativePath?.toLowerCase().endsWith('.webm'))
}

function audioDataToAudioBuffer(context: AudioContext, data: AudioData): AudioBuffer {
  const channelCount = Math.max(1, data.channelData.length)
  const frameCount = data.channelData[0]?.length ?? 0
  const buffer = context.createBuffer(channelCount, frameCount, data.sampleRate)

  for (let channel = 0; channel < channelCount; channel += 1) {
    const source = data.channelData[Math.min(channel, data.channelData.length - 1)]
    if (source) buffer.copyToChannel(source, channel)
  }

  return buffer
}

function concatenateAudioBuffers(context: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
  const sampleRate = buffers[0]?.sampleRate ?? context.sampleRate
  const channelCount = Math.max(...buffers.map((buffer) => buffer.numberOfChannels), 1)
  const frameCount = buffers.reduce((total, buffer) => total + buffer.length, 0)
  const sessionBuffer = context.createBuffer(channelCount, frameCount, sampleRate)
  let offset = 0

  for (const buffer of buffers) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1)
      sessionBuffer.copyToChannel(buffer.getChannelData(sourceChannel), channel, offset)
    }
    offset += buffer.length
  }

  return sessionBuffer
}

async function encodeAudioBufferAsWav(buffer: AudioBuffer): Promise<ArrayBuffer> {
  const module = await import('audiobuffer-to-wav') as unknown as { default?: AudioBufferToWav } | AudioBufferToWav
  const toWav = typeof module === 'function' ? module : module.default
  if (!toWav) throw new Error('WAV encoder did not load.')
  return toWav(buffer)
}

function segmentFromRecord(
  record: AudioCaptureRecord,
  index: number,
  startMs: number,
  durationMs = record.durationMs,
): AudioSessionSegment {
  return {
    index,
    startMs,
    durationMs,
    label: `Segment ${index + 1}`,
    languageCode: record.metadata?.languageCode,
    segmentStartReason: record.metadata?.segmentStartReason,
  }
}
