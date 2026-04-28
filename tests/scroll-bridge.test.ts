import { describe, expect, it } from 'vitest'
import { canConsumeScrollDelta } from '../src/ui/lib/scroll-bridge'

describe('canConsumeScrollDelta', () => {
  it('allows downward vertical scroll when content extends below the viewport', () => {
    expect(
      canConsumeScrollDelta(
        {
          scrollTop: 24,
          scrollHeight: 400,
          clientHeight: 120,
          scrollLeft: 0,
          scrollWidth: 120,
          clientWidth: 120,
        },
        'y',
        14,
      ),
    ).toBe(true)
  })

  it('blocks downward vertical scroll when already at the bottom edge', () => {
    expect(
      canConsumeScrollDelta(
        {
          scrollTop: 280,
          scrollHeight: 400,
          clientHeight: 120,
          scrollLeft: 0,
          scrollWidth: 120,
          clientWidth: 120,
        },
        'y',
        20,
      ),
    ).toBe(false)
  })

  it('allows upward vertical scroll only when there is content above', () => {
    expect(
      canConsumeScrollDelta(
        {
          scrollTop: 12,
          scrollHeight: 320,
          clientHeight: 120,
          scrollLeft: 0,
          scrollWidth: 120,
          clientWidth: 120,
        },
        'y',
        -18,
      ),
    ).toBe(true)

    expect(
      canConsumeScrollDelta(
        {
          scrollTop: 0,
          scrollHeight: 320,
          clientHeight: 120,
          scrollLeft: 0,
          scrollWidth: 120,
          clientWidth: 120,
        },
        'y',
        -18,
      ),
    ).toBe(false)
  })

  it('uses the horizontal axis when the gesture is horizontal', () => {
    expect(
      canConsumeScrollDelta(
        {
          scrollTop: 0,
          scrollHeight: 120,
          clientHeight: 120,
          scrollLeft: 40,
          scrollWidth: 320,
          clientWidth: 160,
        },
        'x',
        -12,
      ),
    ).toBe(true)

    expect(
      canConsumeScrollDelta(
        {
          scrollTop: 0,
          scrollHeight: 120,
          clientHeight: 120,
          scrollLeft: 160,
          scrollWidth: 320,
          clientWidth: 160,
        },
        'x',
        12,
      ),
    ).toBe(false)
  })
})
