import { describe, expect, it } from 'vitest'
import {
  resolveRecordingsPanelOpen,
  resolveVoiceContinueControl,
  shouldResumeStoredVoiceSession,
} from '../src/ui/lib/voice-panel-state'

const closedPanel = {
  preference: 'auto' as const,
  hasLinkedAudio: false,
  recorderActive: false,
  voiceConfigOpen: false,
}

const idleControl = {
  status: 'idle' as const,
  recording: false,
  hasLinkedAudio: false,
  mediaRecorderAvailable: true,
  elapsedLabel: '0:00',
}

describe('recordings panel visibility', () => {
  it('stays hidden for a note without a voice note', () => {
    expect(resolveRecordingsPanelOpen(closedPanel)).toBe(false)
  })

  it('opens on its own when the note body references audio', () => {
    expect(resolveRecordingsPanelOpen({ ...closedPanel, hasLinkedAudio: true })).toBe(true)
  })

  it('opens on its own once the recorder holds a take', () => {
    expect(resolveRecordingsPanelOpen({ ...closedPanel, recorderActive: true })).toBe(true)
  })

  it('honours an explicit hide even for a note with audio', () => {
    expect(resolveRecordingsPanelOpen({
      ...closedPanel,
      preference: 'closed',
      hasLinkedAudio: true,
      recorderActive: true,
    })).toBe(false)
  })

  it('honours an explicit show for a note without audio', () => {
    expect(resolveRecordingsPanelOpen({ ...closedPanel, preference: 'open' })).toBe(true)
  })

  it('shows the panel whenever settings are open', () => {
    expect(resolveRecordingsPanelOpen({ ...closedPanel, preference: 'closed', voiceConfigOpen: true })).toBe(true)
  })
})

describe('top panel voice control', () => {
  it('starts a voice note on a note that has none', () => {
    expect(resolveVoiceContinueControl(idleControl)).toMatchObject({ action: 'start', label: 'Start', disabled: false })
  })

  it('continues the one session a note already owns', () => {
    expect(resolveVoiceContinueControl({ ...idleControl, hasLinkedAudio: true }))
      .toMatchObject({ action: 'continue', label: 'Continue' })
  })

  it('continues after a pause even before the reference lands in the body', () => {
    expect(resolveVoiceContinueControl({ ...idleControl, status: 'stopped' }))
      .toMatchObject({ action: 'continue', label: 'Continue' })
  })

  it('shows elapsed time and defers to the panel while recording', () => {
    expect(resolveVoiceContinueControl({
      ...idleControl,
      status: 'recording',
      recording: true,
      hasLinkedAudio: true,
      elapsedLabel: '1:07',
    })).toMatchObject({ action: 'toggle-panel', label: '1:07', disabled: false })
  })

  it('locks out clicks while the recorder settles', () => {
    expect(resolveVoiceContinueControl({ ...idleControl, status: 'requesting' }))
      .toMatchObject({ label: 'Starting', disabled: true })
    expect(resolveVoiceContinueControl({ ...idleControl, status: 'stopping', recording: true }))
      .toMatchObject({ action: 'toggle-panel', disabled: false })
  })

  it('still reveals a stored voice note when recording is unavailable', () => {
    expect(resolveVoiceContinueControl({ ...idleControl, mediaRecorderAvailable: false, hasLinkedAudio: true }))
      .toMatchObject({ action: 'toggle-panel', label: 'Voice note', disabled: false })
    expect(resolveVoiceContinueControl({ ...idleControl, mediaRecorderAvailable: false }))
      .toMatchObject({ label: 'Unavailable', disabled: true })
  })
})

describe('stored voice session resume', () => {
  it('never resumes a note without an audio reference', () => {
    expect(shouldResumeStoredVoiceSession({
      hasReference: false,
      status: 'idle',
      recorderNoteSessionKey: null,
      editorNoteSessionKey: 4,
    })).toBe(false)
  })

  it('reloads the session for a note opened fresh', () => {
    expect(shouldResumeStoredVoiceSession({
      hasReference: true,
      status: 'idle',
      recorderNoteSessionKey: null,
      editorNoteSessionKey: 4,
    })).toBe(true)
  })

  it('keeps the live cursor when the paused session belongs to this note', () => {
    expect(shouldResumeStoredVoiceSession({
      hasReference: true,
      status: 'stopped',
      recorderNoteSessionKey: 4,
      editorNoteSessionKey: 4,
    })).toBe(false)
  })

  it('reloads rather than appending when the pause belongs to another note', () => {
    expect(shouldResumeStoredVoiceSession({
      hasReference: true,
      status: 'stopped',
      recorderNoteSessionKey: 3,
      editorNoteSessionKey: 4,
    })).toBe(true)
  })

  it('reloads after a failed take so the note keeps one session', () => {
    expect(shouldResumeStoredVoiceSession({
      hasReference: true,
      status: 'error',
      recorderNoteSessionKey: 4,
      editorNoteSessionKey: 4,
    })).toBe(true)
  })

  it('does nothing while a recording is already in flight', () => {
    for (const status of ['recording', 'requesting', 'stopping'] as const) {
      expect(shouldResumeStoredVoiceSession({
        hasReference: true,
        status,
        recorderNoteSessionKey: 4,
        editorNoteSessionKey: 4,
      })).toBe(false)
    }
  })
})
