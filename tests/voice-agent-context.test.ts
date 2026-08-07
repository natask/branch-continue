import { describe, expect, it } from 'vitest'
import {
  appendRecognizedVoiceContext,
  mergeRecognizedVoiceTranscript,
} from '../src/ui/lib/voice-agent-context'

describe('recognized voice agent context', () => {
  it('orders persisted segments and does not duplicate the live recognition copy', () => {
    const transcript = mergeRecognizedVoiceTranscript([
      { text: 'Second thought.', offsetMs: 30_000, segmentIndex: 1 },
      { text: 'First thought.', offsetMs: 0, segmentIndex: 0 },
    ], 'First thought. Second thought.')

    expect(transcript).toBe('First thought. Second thought.')
  })

  it('adds recognized speech to the agent document without changing the note body', () => {
    const note = 'Audio recording: recordings/note.wav'
    const context = appendRecognizedVoiceContext(note, 'A durable spoken idea.')

    expect(context).toContain(note)
    expect(context).toContain('Recognized voice transcript:\n\nA durable spoken idea.')
    expect(note).not.toContain('A durable spoken idea.')
  })
})
