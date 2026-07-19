export const CANONICAL_PCM_SAMPLE_RATE = 16_000
export const DEFAULT_PCM_FRAME_MS = 40
export const DEFAULT_PCM_PREROLL_MS = 500

export interface CanonicalPcmFrame {
  pcm16: Int16Array
  sequence: number
  startSample: number
  endSample: number
  startMs: number
  endMs: number
  containsPreRoll: boolean
  final: boolean
}

export interface PcmFrameAccumulatorOptions {
  frameMs?: number
  preRollMs?: number
  startSample?: number
  onFrame: (frame: CanonicalPcmFrame) => void
}

/**
 * Converts the worklet's arbitrary render quanta into canonical 16 kHz mono
 * PCM frames. Before beginLive(), only the newest bounded pre-roll is kept.
 * All timestamps derive from emitted sample indexes, never wall-clock time.
 */
export class PcmFrameAccumulator {
  private readonly frameSamples: number
  private readonly preRollCapacity: number
  private readonly preRoll: Int16Array
  private readonly onFrame: (frame: CanonicalPcmFrame) => void
  private preRollWrite = 0
  private preRollLength = 0
  private pending: number[] = []
  private live = false
  private stopped = false
  private sequence = 0
  private emittedSamples = 0
  private preRollSamplesPending = 0

  readonly startSample: number

  constructor(options: PcmFrameAccumulatorOptions) {
    const frameMs = options.frameMs ?? DEFAULT_PCM_FRAME_MS
    if (frameMs < 20 || frameMs > 40) throw new Error('PCM frames must be between 20 and 40 ms.')
    this.frameSamples = Math.round(CANONICAL_PCM_SAMPLE_RATE * frameMs / 1000)
    this.preRollCapacity = Math.max(0, Math.round(CANONICAL_PCM_SAMPLE_RATE * (options.preRollMs ?? DEFAULT_PCM_PREROLL_MS) / 1000))
    this.preRoll = new Int16Array(this.preRollCapacity)
    this.startSample = Math.max(0, Math.round(options.startSample ?? 0))
    this.onFrame = options.onFrame
  }

  push(samples: Int16Array): void {
    if (this.stopped || samples.length === 0) return
    if (!this.live) {
      this.pushPreRoll(samples)
      return
    }
    this.appendLive(samples)
  }

  beginLive(): void {
    if (this.stopped || this.live) return
    this.live = true
    const retained = this.orderedPreRoll()
    this.preRollSamplesPending = retained.length
    this.preRollLength = 0
    this.preRollWrite = 0
    this.appendLive(retained)
  }

  stop(): void {
    if (this.stopped) return
    if (!this.live) this.beginLive()
    this.stopped = true
    this.emitCompleteFrames()
    if (this.pending.length > 0) this.emit(this.pending.length, true)
  }

  get nextSampleIndex(): number {
    return this.startSample + this.emittedSamples + this.pending.length
  }

  private pushPreRoll(samples: Int16Array): void {
    if (this.preRollCapacity === 0) return
    for (const sample of samples) {
      this.preRoll[this.preRollWrite] = sample
      this.preRollWrite = (this.preRollWrite + 1) % this.preRollCapacity
      this.preRollLength = Math.min(this.preRollLength + 1, this.preRollCapacity)
    }
  }

  private orderedPreRoll(): Int16Array {
    const result = new Int16Array(this.preRollLength)
    if (this.preRollLength === 0) return result
    const oldest = (this.preRollWrite - this.preRollLength + this.preRollCapacity) % this.preRollCapacity
    for (let index = 0; index < this.preRollLength; index += 1) {
      result[index] = this.preRoll[(oldest + index) % this.preRollCapacity] ?? 0
    }
    return result
  }

  private appendLive(samples: Int16Array): void {
    for (const sample of samples) this.pending.push(sample)
    this.emitCompleteFrames()
  }

  private emitCompleteFrames(): void {
    while (this.pending.length >= this.frameSamples) this.emit(this.frameSamples, false)
  }

  private emit(length: number, final: boolean): void {
    const pcm16 = Int16Array.from(this.pending.splice(0, length))
    const startSample = this.startSample + this.emittedSamples
    const endSample = startSample + pcm16.length
    const containsPreRoll = this.preRollSamplesPending > 0
    this.preRollSamplesPending = Math.max(0, this.preRollSamplesPending - pcm16.length)
    this.emittedSamples += pcm16.length
    this.onFrame({
      pcm16,
      sequence: this.sequence,
      startSample,
      endSample,
      startMs: startSample / CANONICAL_PCM_SAMPLE_RATE * 1000,
      endMs: endSample / CANONICAL_PCM_SAMPLE_RATE * 1000,
      containsPreRoll,
      final,
    })
    this.sequence += 1
  }
}

export interface Pcm16Resampler {
  process: (input: Float32Array) => Int16Array
  flush: () => Int16Array
}

// Stateful area resampling adapted from ChiefMoa. Averaging each full source
// interval avoids the consonant loss caused by naive sample selection.
export function createPcm16Resampler(inputRate: number, outputRate = CANONICAL_PCM_SAMPLE_RATE): Pcm16Resampler {
  const sourceRate = Math.max(1, Number(inputRate) || 0)
  const targetRate = Math.max(1, Number(outputRate) || 0)
  const sourceSamplesPerOutput = sourceRate / targetRate
  let remaining = sourceSamplesPerOutput
  let weightedSum = 0
  let accumulatedWeight = 0

  const process = (input: Float32Array): Int16Array => {
    const output: number[] = []
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, Number(input[index]) || 0))
      let available = 1
      while (available > 1e-9) {
        const consumed = Math.min(available, remaining)
        weightedSum += sample * consumed
        accumulatedWeight += consumed
        available -= consumed
        remaining -= consumed
        if (remaining <= 1e-9) {
          output.push(pcm16Sample(weightedSum / Math.max(accumulatedWeight, 1e-9)))
          remaining = sourceSamplesPerOutput
          weightedSum = 0
          accumulatedWeight = 0
        }
      }
    }
    return Int16Array.from(output)
  }

  const flush = (): Int16Array => {
    if (accumulatedWeight <= 1e-9) return new Int16Array()
    const tail = Int16Array.of(pcm16Sample(weightedSum / accumulatedWeight))
    remaining = sourceSamplesPerOutput
    weightedSum = 0
    accumulatedWeight = 0
    return tail
  }

  return { process, flush }
}

export function pcm16Sample(value: number): number {
  const sample = Math.max(-1, Math.min(1, Number(value) || 0))
  return sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
}

export interface CanonicalPcmCapture {
  readonly sampleRate: typeof CANONICAL_PCM_SAMPLE_RATE
  beginLive: () => void
  stop: () => Promise<void>
}

export interface CanonicalPcmCaptureOptions extends PcmFrameAccumulatorOptions {
  workletUrl?: string
}

export function canonicalPcmCaptureAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext
  return Boolean(AudioContextConstructor && typeof AudioWorkletNode !== 'undefined')
}

/** Returns null when AudioWorklet capture is unavailable; MediaRecorder stays the compatibility path. */
export async function startCanonicalPcmCapture(
  stream: MediaStream,
  options: CanonicalPcmCaptureOptions,
): Promise<CanonicalPcmCapture | null> {
  if (!canonicalPcmCaptureAvailable()) return null
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext
  if (!AudioContextConstructor) return null

  const context = createCaptureAudioContext(AudioContextConstructor)
  if (!context.audioWorklet?.addModule) {
    await context.close()
    return null
  }

  try {
    const workletUrl = options.workletUrl ?? new URL('pcm16-capture-worklet.js', document.baseURI).toString()
    await context.audioWorklet.addModule(workletUrl)
    const accumulator = new PcmFrameAccumulator(options)
    const resampler = createPcm16Resampler(context.sampleRate)
    const source = context.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(context, 'branch-continue-pcm16-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const mute = context.createGain()
    mute.gain.value = 0
    let finalized = false
    let stopResolver: (() => void) | null = null

    const finalize = async () => {
      if (finalized) return
      finalized = true
      const tail = resampler.flush()
      if (tail.length > 0) accumulator.push(tail)
      accumulator.stop()
      worklet.port.close()
      worklet.disconnect()
      source.disconnect()
      mute.disconnect()
      await context.close()
      stopResolver?.()
    }

    worklet.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; stopped?: boolean }>) => {
      const samples = event.data?.samples
      if (samples instanceof Float32Array && samples.length > 0) {
        const pcm16 = resampler.process(samples)
        if (pcm16.length > 0) accumulator.push(pcm16)
      }
      if (event.data?.stopped) void finalize()
    }
    source.connect(worklet)
    worklet.connect(mute)
    mute.connect(context.destination)
    if (context.state === 'suspended') await context.resume()

    return {
      sampleRate: CANONICAL_PCM_SAMPLE_RATE,
      beginLive: () => accumulator.beginLive(),
      stop: () => new Promise<void>((resolve) => {
        if (finalized) {
          resolve()
          return
        }
        stopResolver = resolve
        worklet.port.postMessage({ command: 'stop' })
        window.setTimeout(() => void finalize(), 150)
      }),
    }
  } catch (error) {
    await context.close().catch(() => undefined)
    throw error
  }
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext

function createCaptureAudioContext(Constructor: AudioContextConstructor): AudioContext {
  try {
    return new Constructor({ latencyHint: 'interactive', sampleRate: CANONICAL_PCM_SAMPLE_RATE })
  } catch {
    return new Constructor({ latencyHint: 'interactive' })
  }
}

declare global {
  interface Window {
    webkitAudioContext?: AudioContextConstructor
  }
}
