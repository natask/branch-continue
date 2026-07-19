import { describe, expect, it } from 'vitest'
import { normalizeChirpTranscriptionResponse } from '../src/core/audio/chirp-transcription'
import { normalizeAudioTranscriptWords, toSessionTranscriptWords } from '../src/core/audio/audio-store'

describe('Chirp word timestamps', () => {
  it('normalizes the native response without trusting malformed timings', () => {
    expect(normalizeChirpTranscriptionResponse({
      transcript: ' Hello world. ',
      words: [
        { text: ' Hello ', startMs: 120.4, endMs: 510.4 },
        { text: 'world.', startMs: 550, endMs: 500 },
        { text: '', startMs: 900, endMs: 1_000 },
      ],
    })).toEqual({
      transcript: 'Hello world.',
      words: [
        { text: 'Hello', startMs: 120, endMs: 510 },
        { text: 'world.', startMs: 550, endMs: 550 },
      ],
    })
  })

  it('converts chunk-relative words to absolute session times', () => {
    expect(toSessionTranscriptWords([
      { text: 'first', startMs: 100, endMs: 400 },
      { text: 'last', startMs: 1_800, endMs: 2_400 },
    ], 30_000, 2_000)).toEqual([
      { text: 'first', startMs: 30_100, endMs: 30_400 },
      { text: 'last', startMs: 31_800, endMs: 32_000 },
    ])
  })

  it('keeps old or malformed persisted word data optional', () => {
    expect(normalizeAudioTranscriptWords(undefined)).toBeUndefined()
    expect(normalizeAudioTranscriptWords([{ text: 'valid', startMs: 10, endMs: 20 }, { nope: true }]))
      .toEqual([{ text: 'valid', startMs: 10, endMs: 20 }])
  })
})
