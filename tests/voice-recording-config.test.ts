import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_TRANSCRIPTION_PROMPT,
  normalizeVoiceRecordingConfig,
} from '../src/ui/lib/voice-recording-config'

describe('voice recording config', () => {
  it('migrates the old native transcription mode to explicit Chirp mode', () => {
    expect(normalizeVoiceRecordingConfig({ transcriptionMode: 'native' }).transcriptionMode).toBe('chirp3')
  })

  it('replaces an older saved prompt without keeping its text in the codebase', () => {
    expect(normalizeVoiceRecordingConfig({ transcriptionPrompt: 'old prompt' }).transcriptionPrompt)
      .toBe(DEFAULT_VOICE_TRANSCRIPTION_PROMPT)
  })

  it('preserves an edited prompt after the current schema migration', () => {
    expect(normalizeVoiceRecordingConfig({ schemaVersion: 2, transcriptionPrompt: 'My language prompt.' }).transcriptionPrompt)
      .toBe('My language prompt.')
  })

  it('uses a restrained language and technical-context prompt', () => {
    expect(DEFAULT_VOICE_TRANSCRIPTION_PROMPT).toContain('English and Amharic')
    expect(DEFAULT_VOICE_TRANSCRIPTION_PROMPT).toContain('only to resolve ambiguous words')
    expect(DEFAULT_VOICE_TRANSCRIPTION_PROMPT).toContain('do not invent technical vocabulary')
  })
})
