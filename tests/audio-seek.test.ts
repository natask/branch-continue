import { describe, expect, it, vi } from 'vitest'
import { remapRecorderTimeToAssembledTime } from '../src/core/audio/audio-session'
import {
  seekFromClientX,
  waveformPlayheadOffsetPx,
  waveformProgressScale,
} from '../src/ui/components/AudioPlayer'
import { dispatchVoiceSeek, VOICE_SEEK_EVENT, type VoiceSeekDetail } from '../src/ui/lib/voice-seek'

describe('voice seek interactions', () => {
  it('dispatches one exact word seek event', () => {
    const target = new EventTarget()
    const details: VoiceSeekDetail[] = []
    target.addEventListener(VOICE_SEEK_EVENT, (event) => {
      details.push((event as CustomEvent<VoiceSeekDetail>).detail)
    })

    dispatchVoiceSeek(target, 'voice-session', 12_345)

    expect(details).toEqual([{ id: 'voice-session', timeMs: 12_345 }])
  })

  it('turns one waveform click into one seek callback', () => {
    const seek = vi.fn()
    const element = {
      getBoundingClientRect: () => ({ left: 100, width: 400 }),
    } as HTMLDivElement

    seekFromClientX(element, 300, 20, seek)

    expect(seek).toHaveBeenCalledOnce()
    expect(seek).toHaveBeenCalledWith(10_000)
  })

  it('maps clicks through the scroll offset when the waveform is zoomed', () => {
    const seek = vi.fn()
    const element = {
      getBoundingClientRect: () => ({ left: 100, width: 400 }),
    } as HTMLDivElement

    // 20s rendered at 4000px, scrolled 1800px in: a click 200px into the
    // 400px-wide view sits at pixel 2000 = exactly half the recording.
    seekFromClientX(element, 300, 20, seek, { scrollPx: 1_800, renderedWidthPx: 4_000 })

    expect(seek).toHaveBeenCalledOnce()
    expect(seek).toHaveBeenCalledWith(10_000)
  })

  it('positions one playhead without seeking and repainting the waveform', () => {
    expect(waveformPlayheadOffsetPx(10, 20, 400)).toBe(200)
    expect(waveformPlayheadOffsetPx(10, 20, 400, { scrollPx: 1_800, renderedWidthPx: 4_000 })).toBe(200)
    expect(waveformProgressScale(200, 400)).toBe(0.5)
    expect(waveformProgressScale(500, 400)).toBe(1)
  })

  it('remaps recorder wall-clock gaps onto the assembled WAV timeline', () => {
    // The second chunk began at wall-clock 7s, but follows a 3s decoded first
    // chunk directly in the assembled file. A word 200ms into it seeks to 3.2s.
    expect(remapRecorderTimeToAssembledTime(7_200, 7_000, 3_000)).toBe(3_200)
  })
})
