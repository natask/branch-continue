import { describe, expect, it } from 'vitest'
import { audioCaptureUri, preallocateAudioCapture } from '../src/core/audio/audio-store'

describe('preallocateAudioCapture', () => {
  it('reserves an id whose reference matches what saving that id produces', async () => {
    // Outside the Tauri runtime captures land in IndexedDB, so the reserved
    // reference must be the same app-scheme uri saveAudioCapture would return.
    const preallocated = await preallocateAudioCapture('/notes/source.md', 'audio/webm;codecs=opus')

    expect(preallocated.id).toMatch(/^audio-/)
    expect(preallocated.uri).toBe(audioCaptureUri(preallocated.id))
  })

  it('reserves distinct ids per session', async () => {
    const first = await preallocateAudioCapture(undefined, 'audio/webm')
    const second = await preallocateAudioCapture(undefined, 'audio/webm')

    expect(first.id).not.toBe(second.id)
    expect(first.uri).not.toBe(second.uri)
  })
})
