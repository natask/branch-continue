import { describe, expect, it } from 'vitest'
import { voiceRecordButtonLabel } from '../src/ui/components/VoiceRecordingsPanel'

describe('voice recordings panel actions', () => {
  it('offers a new voice note for a clean branched note', () => {
    expect(voiceRecordButtonLabel({ recording: false, status: 'idle' }, false)).toBe('Create new voice note')
  })

  it('continues the voice note already linked to the current note', () => {
    expect(voiceRecordButtonLabel({ recording: false, status: 'idle' }, true)).toBe('Continue voice note')
    expect(voiceRecordButtonLabel({ recording: false, status: 'stopped' }, false)).toBe('Continue voice note')
  })

  it('offers pause while recording', () => {
    expect(voiceRecordButtonLabel({ recording: true, status: 'recording' }, false)).toBe('Pause')
  })
})
