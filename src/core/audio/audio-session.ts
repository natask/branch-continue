import type { AudioCaptureRecord, AudioCaptureSegmentStartReason } from './audio-store'

interface AudioData {
  channelData: Float32Array[]
  sampleRate: number
}

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
