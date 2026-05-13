import { describe, expect, it } from 'vitest'
import {
  appendAudioCaptureReference,
  extractVoiceTranscriptCues,
  appendVoiceTranscriptAfterAudioCaptureReference,
  appendVoiceTranscriptSegment,
} from '../src/ui/lib/voice-transcript'

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
})
