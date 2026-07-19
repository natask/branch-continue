import { describe, expect, it } from 'vitest'
import { clampTranscriptCuesToDuration, groupTimedTranscript } from '../src/ui/lib/timed-transcript'

describe('clampTranscriptCuesToDuration', () => {
  it('drops cues that start at or after the audio duration', () => {
    const cues = [
      { timeMs: 0, text: 'inside' },
      { timeMs: 4_999, text: 'still inside' },
      { timeMs: 5_000, text: 'past the end' },
      { timeMs: 9_000, text: 'way past the end' },
    ]

    expect(clampTranscriptCuesToDuration(cues, 5_000)).toEqual([
      { timeMs: 0, text: 'inside' },
      { timeMs: 4_999, text: 'still inside' },
    ])
  })

  it('leaves cues untouched when duration is unknown', () => {
    const cues = [{ timeMs: 0, text: 'a' }, { timeMs: 9_000, text: 'b' }]
    expect(clampTranscriptCuesToDuration(cues, 0)).toEqual(cues)
    expect(clampTranscriptCuesToDuration(cues, Number.NaN)).toEqual(cues)
  })
})

describe('timed transcript grouping', () => {
  it('breaks speech on a natural gap', () => {
    const blocks = groupTimedTranscript([{
      key: 'cue',
      timeMs: 0,
      text: 'one two three',
      words: [
        { text: 'one', startMs: 100, endMs: 400 },
        { text: 'two', startMs: 500, endMs: 800 },
        { text: 'three', startMs: 2_100, endMs: 2_400 },
      ],
    }])

    expect(blocks.map((block) => block.words.map((word) => word.text))).toEqual([
      ['one', 'two'],
      ['three'],
    ])
  })

  it('caps uninterrupted speech at 30 seconds', () => {
    const words = Array.from({ length: 35 }, (_, index) => ({
      text: `word-${index}`,
      startMs: index * 1_000,
      endMs: index * 1_000 + 500,
    }))
    const blocks = groupTimedTranscript([{ key: 'cue', timeMs: 0, text: '', words }])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.words).toHaveLength(30)
    expect(blocks[1]?.startMs).toBe(30_000)
  })

  it('estimates word positions for legacy chunk-only transcripts', () => {
    const blocks = groupTimedTranscript([{
      key: 'legacy',
      timeMs: 10_000,
      durationMs: 2_000,
      text: 'hello legacy transcript',
    }])

    expect(blocks[0]?.words.map((word) => word.startMs)).toEqual([10_000, 10_667, 11_333])
    expect(blocks[0]?.words.every((word) => word.approximate)).toBe(true)
  })
})
