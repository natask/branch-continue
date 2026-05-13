import { describe, expect, it } from 'vitest'
import {
  CHIRP_2_MODEL,
  CHIRP_3_MODEL,
  normalizeVoiceRecordingConfig,
  voiceModelLabel,
} from '../src/ui/lib/voice-recording-config'

describe('voice recording config', () => {
  it('defaults to the explicit Chirp 3 model', () => {
    expect(normalizeVoiceRecordingConfig({}).model).toBe(CHIRP_3_MODEL)
  })

  it('keeps the legacy Chirp 2 model when selected explicitly', () => {
    expect(normalizeVoiceRecordingConfig({ model: CHIRP_2_MODEL }).model).toBe(CHIRP_2_MODEL)
  })

  it('migrates the old native transcription mode to explicit Chirp mode', () => {
    expect(normalizeVoiceRecordingConfig({ transcriptionMode: 'native' }).transcriptionMode).toBe('chirp3')
  })

  it('normalizes unknown speech models back to Chirp 3', () => {
    expect(normalizeVoiceRecordingConfig({ model: 'latest' }).model).toBe(CHIRP_3_MODEL)
  })

  it('labels the Speech-to-Text model ID', () => {
    expect(voiceModelLabel(CHIRP_3_MODEL)).toBe('Chirp 3 (Speech-to-Text V2)')
  })
})
