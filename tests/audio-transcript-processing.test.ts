import { describe, expect, it } from 'vitest'
import {
  buildTranscriptEvidenceBlocks,
  formatTranscriptRange,
} from '../src/ui/lib/audio-transcript-processing'

describe('audio transcript processing', () => {
  it('creates extractive idea blocks with timestamp evidence', () => {
    const blocks = buildTranscriptEvidenceBlocks([
      { key: 'a', startMs: 1_000, endMs: 6_000, text: 'The waveform should reveal where speech occurs.' },
      { key: 'b', startMs: 6_200, endMs: 9_000, text: 'Each word should seek into the audio.' },
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      startMs: 1_000,
      endMs: 9_000,
      title: 'The waveform should reveal where speech occurs.',
      text: 'The waveform should reveal where speech occurs. Each word should seek into the audio.',
      cueKeys: ['a', 'b'],
    })
  })

  it('breaks on silence and never allows cue starts to span over 30 seconds', () => {
    const blocks = buildTranscriptEvidenceBlocks([
      { key: 'a', startMs: 0, endMs: 2_000, text: 'First thought.' },
      { key: 'b', startMs: 7_000, endMs: 9_000, text: 'After a pause.' },
      { key: 'c', startMs: 38_000, endMs: 40_000, text: 'After the maximum interval.' },
    ])

    expect(blocks.map((block) => block.startMs)).toEqual([0, 7_000, 38_000])
  })

  it('preserves real word timings and uses the honest cue timestamp as fallback', () => {
    const blocks = buildTranscriptEvidenceBlocks([
      {
        key: 'timed',
        startMs: 10_000,
        endMs: 12_000,
        text: 'timed words',
        words: [
          { text: 'timed', startMs: 10_100, endMs: 10_500 },
          { text: 'words', startMs: 10_600, endMs: 11_000 },
        ],
      },
      { key: 'cue-only', startMs: 12_200, text: 'cue fallback' },
    ])

    expect(blocks[0]?.words).toEqual([
      expect.objectContaining({ text: 'timed', startMs: 10_100, timing: 'word' }),
      expect.objectContaining({ text: 'words', startMs: 10_600, timing: 'word' }),
      expect.objectContaining({ text: 'cue', startMs: 12_200, timing: 'cue' }),
      expect.objectContaining({ text: 'fallback', startMs: 12_200, timing: 'cue' }),
    ])
  })

  it('formats timestamp ranges for short and long recordings', () => {
    expect(formatTranscriptRange(2_000, 32_000)).toBe('0:02–0:32')
    expect(formatTranscriptRange(3_661_000, 3_662_000)).toBe('1:01:01–1:01:02')
  })
})
