import { describe, expect, it } from 'vitest'
import { layoutLiveWaveformBars } from '../src/ui/components/LiveRecordingWaveform'

describe('live recording waveform layout', () => {
  it('pins the newest peak at the cursor and flows history left', () => {
    const bars = layoutLiveWaveformBars([0.2, 0.5, 0.9], 300, 0)

    expect(bars[0]).toEqual({ x: 300, amplitude: 0.9 })
    expect(bars[1]).toEqual({ x: 296, amplitude: 0.5 })
    expect(bars[2]).toEqual({ x: 292, amplitude: 0.2 })
  })

  it('advances the strip continuously within a bucket', () => {
    const midBucket = layoutLiveWaveformBars([0.5], 300, 25)
    expect(midBucket[0]!.x).toBe(298)
  })

  it('drops bars that have slid past the left edge', () => {
    const peaks = new Array(200).fill(0.4)
    const bars = layoutLiveWaveformBars(peaks, 40, 0)

    expect(bars.length).toBeLessThan(peaks.length)
    expect(bars.every((bar) => bar.x >= -4)).toBe(true)
  })

  it('clamps amplitudes into the unit range', () => {
    const bars = layoutLiveWaveformBars([2.5, -1], 100, 0)
    expect(bars[0]!.amplitude).toBe(0)
    expect(bars[1]!.amplitude).toBe(1)
  })
})
