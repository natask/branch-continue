import { describe, expect, it, vi } from 'vitest'
import {
  createVoiceNoteCommandActions,
  CREATE_VOICE_NOTE_LABEL,
  UPDATE_VOICE_NOTE_PROMPT_LABEL,
} from '../src/ui/lib/voice-note-command-actions'

describe('VoiceNote command palette actions', () => {
  it('exposes exactly the two supported VoiceNote commands', () => {
    const actions = createVoiceNoteCommandActions({
      recording: false,
      canUpdatePrompt: true,
      onCreate: vi.fn(),
      onUpdatePrompt: vi.fn(),
    })

    expect(actions.map((action) => action.label)).toEqual([
      CREATE_VOICE_NOTE_LABEL,
      UPDATE_VOICE_NOTE_PROMPT_LABEL,
    ])
  })

  it('disables creation while a session is recording', () => {
    const actions = createVoiceNoteCommandActions({
      recording: true,
      canUpdatePrompt: true,
      onCreate: vi.fn(),
      onUpdatePrompt: vi.fn(),
    })

    expect(actions[0]?.disabled).toBe(true)
    expect(actions[1]?.disabled).toBe(false)
  })
})
