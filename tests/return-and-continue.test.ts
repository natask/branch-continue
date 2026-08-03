import { describe, expect, it, vi } from 'vitest'
import type { AudioCaptureRecord } from '../src/core/audio/audio-store'
import { returnAndContinueParentVoice } from '../src/ui/lib/return-and-continue'

function persistedParentSession(): AudioCaptureRecord[] {
  return [{
    id: 'parent-audio',
    blob: new Blob(),
    mimeType: 'audio/wav',
    createdAt: '2026-08-03T00:00:00.000Z',
    durationMs: 42_000,
    uri: 'recordings/parent-audio.wav',
    metadata: {
      sessionId: 'parent-session',
      segmentIndex: 2,
      offsetMs: 0,
      languageCode: 'en-US',
      segmentStartReason: 'resume',
      final: true,
    },
  }]
}

describe('return and continue parent voice note', () => {
  it('saves the child before opening and resuming the persisted parent session', async () => {
    const calls: string[] = []
    const resumeParentRecording = vi.fn(async () => { calls.push('resume-parent') })

    const result = await returnAndContinueParentVoice({
      parentBody: 'Parent note\n\nAudio recording: recordings/parent-audio.wav',
      stopChildRecording: async () => { calls.push('stop-child') },
      saveChildNote: async () => { calls.push('save-child'); return true },
      openParent: () => { calls.push('open-parent') },
      waitForParent: async () => { calls.push('parent-ready') },
      loadParentAudio: async () => { calls.push('load-parent-audio'); return persistedParentSession() },
      resumeParentRecording,
    })

    expect(result).toEqual({ kind: 'resumed' })
    expect(calls).toEqual([
      'stop-child',
      'save-child',
      'open-parent',
      'parent-ready',
      'load-parent-audio',
      'resume-parent',
    ])
    expect(resumeParentRecording).toHaveBeenCalledWith(
      { sessionId: 'parent-session', segmentIndex: 3, offsetMs: 42_000 },
      expect.objectContaining({ uri: 'recordings/parent-audio.wav' }),
    )
  })

  it('does not leave the child when its note cannot be saved', async () => {
    const openParent = vi.fn()
    const loadParentAudio = vi.fn()

    const result = await returnAndContinueParentVoice({
      parentBody: 'Audio recording: recordings/parent-audio.wav',
      stopChildRecording: async () => undefined,
      saveChildNote: async () => false,
      openParent,
      waitForParent: async () => undefined,
      loadParentAudio,
      resumeParentRecording: async () => undefined,
    })

    expect(result).toEqual({ kind: 'save-blocked' })
    expect(openParent).not.toHaveBeenCalled()
    expect(loadParentAudio).not.toHaveBeenCalled()
  })

  it('opens the parent but does not start a new recording when no persisted parent audio exists', async () => {
    const openParent = vi.fn()
    const resumeParentRecording = vi.fn()

    const result = await returnAndContinueParentVoice({
      parentBody: 'A parent note without captured audio.',
      stopChildRecording: async () => undefined,
      saveChildNote: async () => true,
      openParent,
      waitForParent: async () => undefined,
      loadParentAudio: async () => persistedParentSession(),
      resumeParentRecording,
    })

    expect(result).toEqual({ kind: 'no-parent-audio' })
    expect(openParent).toHaveBeenCalledOnce()
    expect(resumeParentRecording).not.toHaveBeenCalled()
  })
})
