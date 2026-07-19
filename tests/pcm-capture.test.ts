import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PCM_SAMPLE_RATE,
  PcmFrameAccumulator,
  createPcm16Resampler,
} from '../src/core/audio/pcm-capture'

describe('canonical PCM capture', () => {
  it('evicts old pre-roll and drains the retained samples in order', () => {
    const frames: Int16Array[] = []
    const accumulator = new PcmFrameAccumulator({
      preRollMs: 1,
      onFrame: (frame) => frames.push(frame.pcm16),
    })

    accumulator.push(Int16Array.from({ length: 20 }, (_, index) => index))
    accumulator.beginLive()
    accumulator.push(Int16Array.of(20, 21))
    accumulator.stop()

    expect(Array.from(frames[0] ?? [])).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ])
  })

  it('uses exact sample indexes for frame timestamps and flushes the stop tail', () => {
    const frames: Array<{ start: number; end: number; final: boolean }> = []
    const accumulator = new PcmFrameAccumulator({
      frameMs: 20,
      preRollMs: 0,
      startSample: 1_600,
      onFrame: (frame) => frames.push({ start: frame.startSample, end: frame.endSample, final: frame.final }),
    })

    accumulator.beginLive()
    accumulator.push(new Int16Array(700))
    accumulator.stop()

    expect(frames).toEqual([
      { start: 1_600, end: 1_920, final: false },
      { start: 1_920, end: 2_240, final: false },
      { start: 2_240, end: 2_300, final: true },
    ])
    expect(accumulator.nextSampleIndex).toBe(2_300)
    expect((frames[0]!.start / CANONICAL_PCM_SAMPLE_RATE) * 1000).toBe(100)
  })

  it('continues sample time across pause/resume without including the pause', () => {
    const indexes: number[] = []
    const first = new PcmFrameAccumulator({
      frameMs: 20,
      preRollMs: 0,
      onFrame: (frame) => indexes.push(frame.startSample),
    })
    first.beginLive()
    first.push(new Int16Array(320))
    first.stop()

    const resumed = new PcmFrameAccumulator({
      frameMs: 20,
      preRollMs: 0,
      startSample: first.nextSampleIndex,
      onFrame: (frame) => indexes.push(frame.startSample),
    })
    resumed.beginLive()
    resumed.push(new Int16Array(320))
    resumed.stop()

    expect(indexes).toEqual([0, 320])
    expect(resumed.nextSampleIndex).toBe(640)
  })

  it('area-resamples to PCM16 and preserves a partial source tail', () => {
    const resampler = createPcm16Resampler(48_000, 16_000)
    expect(Array.from(resampler.process(Float32Array.of(1, 1, 1, -1, -1, -1)))).toEqual([32_767, -32_768])
    expect(resampler.process(Float32Array.of(0.5)).length).toBe(0)
    expect(Array.from(resampler.flush())).toEqual([16_384])
  })
})
