import { describe, expect, it, vi } from 'vitest'
import { remapRecorderTimeToAssembledTime } from '../src/core/audio/audio-session'
import { seekFromClientX } from '../src/ui/components/AudioPlayer'
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

  it('remaps recorder wall-clock gaps onto the assembled WAV timeline', () => {
    // The second chunk began at wall-clock 7s, but follows a 3s decoded first
    // chunk directly in the assembled file. A word 200ms into it seeks to 3.2s.
    expect(remapRecorderTimeToAssembledTime(7_200, 7_000, 3_000)).toBe(3_200)
  })
})
