export const CREATE_VOICE_NOTE_LABEL = 'Create VoiceNote'
export const UPDATE_VOICE_NOTE_PROMPT_LABEL = 'Update VoiceNote Prompt'

export interface VoiceNoteCommandAction {
  id: string
  label: string
  keywords: string[]
  group: string
  disabled?: boolean
  run: () => void
}

interface VoiceNoteCommandActionOptions {
  recording: boolean
  canUpdatePrompt: boolean
  onCreate: () => void
  onUpdatePrompt: () => void
}

/** The complete command-palette surface for VoiceNote. */
export function createVoiceNoteCommandActions({
  recording,
  canUpdatePrompt,
  onCreate,
  onUpdatePrompt,
}: VoiceNoteCommandActionOptions): VoiceNoteCommandAction[] {
  return [
    {
      id: 'create-voice-note',
      label: CREATE_VOICE_NOTE_LABEL,
      keywords: ['create', 'voice', 'audio', 'record', 'dictate', 'transcribe'],
      group: 'Actions',
      disabled: recording,
      run: onCreate,
    },
    {
      id: 'update-voice-note-prompt',
      label: UPDATE_VOICE_NOTE_PROMPT_LABEL,
      keywords: ['voice', 'audio', 'transcription', 'prompt', 'chirp', 'settings'],
      group: 'Actions',
      disabled: !canUpdatePrompt,
      run: onUpdatePrompt,
    },
  ]
}
