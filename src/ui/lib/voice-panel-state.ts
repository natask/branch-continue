import type { AudioRecorderStatus } from '../hooks/use-audio-note-recorder'

/**
 * How the reader has treated the recordings panel inside the current editor
 * session. `auto` lets the note decide; an explicit show/hide wins until the
 * note is reopened.
 */
export type VoicePanelPreference = 'auto' | 'open' | 'closed'

export interface VoicePanelVisibilityInput {
  preference: VoicePanelPreference
  hasLinkedAudio: boolean
  recorderActive: boolean
  voiceConfigOpen: boolean
}

/** A note that already owns a voice note surfaces it without an extra click. */
export function resolveRecordingsPanelOpen({
  preference,
  hasLinkedAudio,
  recorderActive,
  voiceConfigOpen,
}: VoicePanelVisibilityInput): boolean {
  if (voiceConfigOpen) return true
  if (preference === 'open') return true
  if (preference === 'closed') return false
  return hasLinkedAudio || recorderActive
}

export type VoiceContinueAction = 'toggle-panel' | 'continue' | 'start'

export interface VoiceContinueControl {
  action: VoiceContinueAction
  label: string
  hint: string
  disabled: boolean
}

export interface VoiceContinueControlInput {
  status: AudioRecorderStatus
  recording: boolean
  hasLinkedAudio: boolean
  mediaRecorderAvailable: boolean
  elapsedLabel: string
}

/**
 * The single voice control on the editor's top panel. It continues the one
 * session a note may own; it never offers a second one.
 */
export function resolveVoiceContinueControl({
  status,
  recording,
  hasLinkedAudio,
  mediaRecorderAvailable,
  elapsedLabel,
}: VoiceContinueControlInput): VoiceContinueControl {
  if (recording) {
    return {
      action: 'toggle-panel',
      label: elapsedLabel,
      hint: 'Show or hide the voice note being recorded',
      disabled: false,
    }
  }

  if (status === 'requesting' || status === 'stopping') {
    return {
      action: 'toggle-panel',
      label: status === 'requesting' ? 'Starting' : 'Pausing',
      hint: 'The recorder is still settling',
      disabled: true,
    }
  }

  if (!mediaRecorderAvailable) {
    return {
      action: 'toggle-panel',
      label: hasLinkedAudio ? 'Voice note' : 'Unavailable',
      hint: hasLinkedAudio
        ? 'Play this voice note; recording is unavailable here'
        : 'Recording is unavailable in this runtime',
      disabled: !hasLinkedAudio,
    }
  }

  if (hasLinkedAudio || status === 'stopped') {
    return {
      action: 'continue',
      label: 'Continue',
      hint: 'Continue this voice note',
      disabled: false,
    }
  }

  return {
    action: 'start',
    label: 'Start',
    hint: 'Start a voice note for this note',
    disabled: false,
  }
}

export interface StoredVoiceSessionResumeInput {
  hasReference: boolean
  status: AudioRecorderStatus
  recorderNoteSessionKey: number | null
  editorNoteSessionKey: number | null
}

/**
 * Decides whether continuing must rehydrate the session from disk. The recorder
 * keeps a live cursor only for the note it last recorded, so any other note
 * with an audio reference has to reload its own session rather than append to
 * whatever the recorder is still holding.
 */
export function shouldResumeStoredVoiceSession({
  hasReference,
  status,
  recorderNoteSessionKey,
  editorNoteSessionKey,
}: StoredVoiceSessionResumeInput): boolean {
  if (!hasReference) return false
  if (status === 'recording' || status === 'requesting' || status === 'stopping') return false
  const holdsLiveCursor = status === 'stopped'
    && recorderNoteSessionKey !== null
    && recorderNoteSessionKey === editorNoteSessionKey
  return !holdsLiveCursor
}
