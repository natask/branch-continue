import { describe, expect, it } from 'vitest'
import {
  appendAudioCaptureReference,
  extractVoiceTranscriptCues,
  appendVoiceTranscriptAfterAudioCaptureReference,
  appendVoiceTranscriptSegment,
} from '../src/ui/lib/voice-transcript'
import { formatTimedTranscriptForClipboard, joinTimedTranscriptWords } from '../src/ui/lib/timed-transcript'

describe('voice transcript helpers', () => {
  it('starts an editable transcript section for an empty note', () => {
    expect(appendVoiceTranscriptSegment('', ' hello   world ')).toBe('Voice transcript:\nhello world')
  })

  it('appends transcript segments without duplicating the heading', () => {
    const first = appendVoiceTranscriptSegment('Existing note', 'first sentence')
    const second = appendVoiceTranscriptSegment(first, 'second sentence')

    expect(second).toBe('Existing note\n\nVoice transcript:\nfirst sentence\nsecond sentence')
  })

  it('adds a stable local audio reference once', () => {
    const uri = 'recordings/audio-123.webm'
    const first = appendAudioCaptureReference('Existing note', uri)

    expect(first).toBe('Existing note\n\nAudio recording: [audio-123.webm](recordings/audio-123.webm)')
    expect(appendAudioCaptureReference(first, uri)).toBe(first)
  })

  it('collapses legacy duplicate chunk references to one canonical recording', () => {
    const body = [
      'Existing note',
      '',
      'Audio recording: [audio-123.webm](recordings/audio-123.webm)',
      'Voice transcript:',
      '[0:00] first chunk',
      'Audio recording: [audio-124.webm](recordings/audio-124.webm)',
      '[0:05] second chunk',
    ].join('\n')

    expect(appendAudioCaptureReference(body, 'recordings/audio-123.webm')).toBe(
      [
        'Existing note',
        '',
        'Audio recording: [audio-123.webm](recordings/audio-123.webm)',
        'Voice transcript:',
        '[0:00] first chunk',
        '[0:05] second chunk',
      ].join('\n'),
    )
  })

  it('places a Chirp transcript directly under its audio link', () => {
    const body = appendAudioCaptureReference('Existing note', 'recordings/audio-123.webm')

    expect(appendVoiceTranscriptAfterAudioCaptureReference(body, 'recordings/audio-123.webm', ' hello   again ')).toBe(
      'Existing note\n\nAudio recording: [audio-123.webm](recordings/audio-123.webm)\nVoice transcript:\nhello again',
    )
  })

  it('extends the existing transcript section for the same audio link', () => {
    const body = appendVoiceTranscriptAfterAudioCaptureReference(
      appendAudioCaptureReference('Existing note', 'recordings/audio-123.webm'),
      'recordings/audio-123.webm',
      'first segment',
    )

    expect(appendVoiceTranscriptAfterAudioCaptureReference(body, 'recordings/audio-123.webm', 'second segment')).toBe(
      'Existing note\n\nAudio recording: [audio-123.webm](recordings/audio-123.webm)\nVoice transcript:\nfirst segment\nsecond segment',
    )
  })

  it('formats timestamped transcript segments', () => {
    const body = appendVoiceTranscriptAfterAudioCaptureReference(
      appendAudioCaptureReference('Existing note', 'recordings/audio-123.webm'),
      'recordings/audio-123.webm',
      'hello again',
      45_000,
    )

    expect(body).toBe(
      'Existing note\n\nAudio recording: [audio-123.webm](recordings/audio-123.webm)\nVoice transcript:\n[0:45] hello again',
    )
  })

  it('extracts clickable transcript cues by audio uri', () => {
    const body = 'Audio recording: [audio-123.webm](recordings/audio-123.webm)\nVoice transcript:\n[1:02] hello again'

    expect(extractVoiceTranscriptCues(body)).toEqual([
      {
        uri: 'recordings/audio-123.webm',
        timeMs: 62_000,
        label: '1:02',
        text: 'hello again',
      },
    ])
  })

  it('formats the entire raw session as timestamped, punctuation-aware blocks', () => {
    expect(formatTimedTranscriptForClipboard([
      {
        key: 'first',
        startMs: 1_250,
        endMs: 2_500,
        words: [
          { text: 'Hello', startMs: 1_250, endMs: 1_600 },
          { text: ',', startMs: 1_600, endMs: 1_650 },
          { text: 'world', startMs: 1_650, endMs: 2_100 },
          { text: '!', startMs: 2_100, endMs: 2_200 },
        ],
      },
      {
        key: 'second',
        startMs: 62_000,
        endMs: 63_000,
        words: [{ text: 'Next thought.', startMs: 62_000, endMs: 63_000 }],
      },
    ])).toBe('[0:01] Hello, world!\n\n[1:02] Next thought.')
  })

  it('joins transcript punctuation and paired delimiters without stray spaces', () => {
    expect(joinTimedTranscriptWords([
      { text: 'I' }, { text: "'m" }, { text: 'testing' }, { text: '(' },
      { text: 'carefully' }, { text: ')' }, { text: '.' },
    ])).toBe("I'm testing (carefully).")
  })
})
