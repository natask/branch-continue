import { describe, expect, it } from 'vitest'
import { computeWaveformTickSpec, formatWaveformTickLabel } from '../src/ui/lib/waveform-ticks'

describe('waveform tick spec', () => {
  it('uses sub-second ticks at the maximum zoom', () => {
    // 192 px/s is the player's zoom ceiling: 100ms ticks are 19px apart and
    // 500ms labels are 96px apart, both above the readability floors.
    expect(computeWaveformTickSpec(192)).toEqual({ tickSec: 0.1, labelSec: 0.5 })
  })

  it('coarsens ticks as the zoom decreases', () => {
    expect(computeWaveformTickSpec(48)).toEqual({ tickSec: 0.5, labelSec: 2 })
    expect(computeWaveformTickSpec(14)).toEqual({ tickSec: 1, labelSec: 10 })
    expect(computeWaveformTickSpec(2)).toEqual({ tickSec: 10, labelSec: 60 })
  })

  it('handles fit-to-width resolutions for long recordings', () => {
    // A one-hour recording fit into ~700px is ~0.2 px/s.
    const spec = computeWaveformTickSpec(0.2)
    expect(spec.tickSec).toBe(120)
    expect(spec.labelSec % spec.tickSec).toBe(0)
    expect(spec.labelSec * 0.2).toBeGreaterThanOrEqual(72)
  })

  it('always labels on a whole multiple of the tick step', () => {
    for (const pxPerSec of [0.05, 0.5, 3, 7, 20, 60, 120, 192]) {
      const spec = computeWaveformTickSpec(pxPerSec)
      expect(Math.round(spec.labelSec * 1000) % Math.round(spec.tickSec * 1000)).toBe(0)
      expect(spec.labelSec).toBeGreaterThanOrEqual(spec.tickSec)
    }
  })

  it('formats labels to match the label resolution', () => {
    expect(formatWaveformTickLabel(0, 1)).toBe('0:00')
    expect(formatWaveformTickLabel(90, 30)).toBe('1:30')
    expect(formatWaveformTickLabel(3723, 60)).toBe('1:02:03')
    expect(formatWaveformTickLabel(1.5, 0.5)).toBe('0:01.5')
    expect(formatWaveformTickLabel(2.0000001, 0.5)).toBe('0:02.0')
  })
})
