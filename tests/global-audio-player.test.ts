import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGlobalAudioSnapshot,
  playGlobalAudio,
  resetGlobalAudioPlayerForTests,
} from '../src/ui/lib/global-audio-player'

class FakeAudio extends EventTarget {
  src = ''
  preload = ''
  currentTime = 0
  duration = Number.NaN
  readyState = 0
  paused = true
  ended = false
  loadCalls = 0
  playCalls = 0
  seekable = {
    length: 0,
    start: () => 0,
    end: () => 0,
  }

  load(): void {
    this.loadCalls += 1
  }

  async play(): Promise<void> {
    this.playCalls += 1
    this.paused = false
    this.dispatchEvent(new Event('play'))
  }

  pause(): void {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

let instances: FakeAudio[]

beforeEach(() => {
  instances = []
  vi.stubGlobal('Audio', class extends FakeAudio {
    constructor() {
      super()
      instances.push(this)
    }
  })
})

afterEach(() => {
  resetGlobalAudioPlayerForTests()
  vi.unstubAllGlobals()
})

describe('global audio source and pending seeks', () => {
  it('reloads a changed source even when the canonical player id stays stable', async () => {
    await playGlobalAudio({ id: 'session', src: 'first.wav' })
    await playGlobalAudio({ id: 'session', src: 'second.wav' })

    expect(instances).toHaveLength(1)
    expect(instances[0]?.src).toBe('second.wav')
    expect(instances[0]?.loadCalls).toBe(2)
  })

  it('keeps the first click seek pending until metadata becomes available', async () => {
    await playGlobalAudio({ id: 'session', src: 'session.wav', startMs: 7_250 })
    const player = instances[0]!
    expect(player.currentTime).toBe(0)
    expect(player.playCalls).toBe(0)

    player.readyState = 1
    player.duration = 20
    player.dispatchEvent(new Event('loadedmetadata'))

    expect(player.currentTime).toBe(7.25)
    expect(player.playCalls).toBe(1)
    expect(getGlobalAudioSnapshot().currentTime).toBe(7.25)
  })

  it('waits for the exact requested point in progressively buffered media', async () => {
    await playGlobalAudio({ id: 'session', src: 'session.wav', startMs: 50_000 })
    const player = instances[0]!
    player.readyState = 1
    player.duration = 60
    player.seekable = { length: 1, start: () => 0, end: () => 10 }
    player.dispatchEvent(new Event('loadedmetadata'))

    expect(player.currentTime).toBe(0)
    expect(player.playCalls).toBe(0)

    player.seekable = { length: 1, start: () => 0, end: () => 60 }
    player.dispatchEvent(new Event('progress'))

    expect(player.currentTime).toBe(50)
    expect(player.playCalls).toBe(1)
  })
})
