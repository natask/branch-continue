import { describe, expect, it } from 'vitest'
import {
  createAudioRecorderSessionCursor,
  hasRecognitionBeenInactive,
  hydrateAudioRecorderSessionCursor,
  isSameAudioRecordingRun,
  RECOGNITION_INACTIVITY_PAUSE_MS,
  resetAudioRecorderSessionCursor,
  shouldPauseForRecognitionInactivity,
  transitionAudioRecorderSessionBoundary,
} from '../src/ui/hooks/use-audio-note-recorder'
import { resolveAudioCaptureResumeSession } from '../src/core/audio/audio-store'

describe('audio recorder note session boundaries', () => {
  it('distinguishes uninterrupted recording runs even when a durable session resumes', () => {
    const active = { runId: 7, sessionId: 'voice-session-1', ownerSessionKey: 12 }

    expect(isSameAudioRecordingRun(active, { ...active })).toBe(true)
    expect(isSameAudioRecordingRun(active, { ...active, runId: 8 })).toBe(false)
    expect(isSameAudioRecordingRun(active, { ...active, sessionId: 'voice-session-2' })).toBe(false)
    expect(isSameAudioRecordingRun(active, { ...active, ownerSessionKey: '12' })).toBe(false)
    expect(isSameAudioRecordingRun(active, null)).toBe(false)
  })

  it('pauses only a non-final inactive segment from the active run', () => {
    const activeRun = { runId: 8, sessionId: 'voice-session-1', ownerSessionKey: 12 }
    const decision = (patch: Partial<Parameters<typeof shouldPauseForRecognitionInactivity>[0]> = {}) =>
      shouldPauseForRecognitionInactivity({
        captureRun: activeRun,
        activeRun,
        final: false,
        lastRecognitionMs: 0,
        capturedThroughMs: 60_000,
        ...patch,
      })

    expect(decision()).toBe(true)
    expect(decision({ final: true })).toBe(false)
    expect(decision({ capturedThroughMs: 59_999 })).toBe(false)
    expect(decision({ captureRun: { ...activeRun, runId: 7 } })).toBe(false)
    expect(decision({ captureRun: { ...activeRun, ownerSessionKey: 13 } })).toBe(false)
  })

  it('uses a one-minute transcription inactivity window', () => {
    expect(RECOGNITION_INACTIVITY_PAUSE_MS).toBe(60_000)
    expect(hasRecognitionBeenInactive(0, 59_999)).toBe(false)
    expect(hasRecognitionBeenInactive(0, 60_000)).toBe(true)
  })

  it('starts a fresh inactivity window when an older session resumes', () => {
    const resumedAtMs = 5 * 60_000

    expect(hasRecognitionBeenInactive(resumedAtMs, resumedAtMs + 30_000)).toBe(false)
    expect(hasRecognitionBeenInactive(resumedAtMs, resumedAtMs + 60_000)).toBe(true)
  })

  it('continues after the last persisted chunk when a note is reopened', () => {
    const metadata = {
      sessionId: 'voice-session-persisted',
      languageCode: 'en-US',
      segmentStartReason: 'start' as const,
      final: true,
    }
    const resume = resolveAudioCaptureResumeSession([
      {
        id: 'one', blob: new Blob(), mimeType: 'audio/webm', createdAt: '', durationMs: 30_000,
        metadata: { ...metadata, segmentIndex: 0, offsetMs: 0 },
      },
      {
        id: 'two', blob: new Blob(), mimeType: 'audio/webm', createdAt: '', durationMs: 12_500,
        metadata: { ...metadata, segmentIndex: 1, offsetMs: 30_000 },
      },
    ])

    expect(resume).toEqual({
      sessionId: 'voice-session-persisted',
      segmentIndex: 2,
      offsetMs: 42_500,
    })
  })

  it('hydrates a persisted voice session so reopening can continue it', () => {
    const cursor = createAudioRecorderSessionCursor()

    hydrateAudioRecorderSessionCursor(cursor, {
      sessionId: 'voice-session-persisted',
      segmentIndex: 4,
      offsetMs: 93_250,
    })

    expect(cursor).toEqual({
      sessionId: 'voice-session-persisted',
      hasSession: true,
      segmentIndex: 4,
      offsetMs: 93_250,
    })
  })

  it('preserves the session cursor when pausing and resuming the same note', () => {
    const cursor = createAudioRecorderSessionCursor()
    cursor.hasSession = true
    cursor.segmentIndex = 3
    cursor.offsetMs = 42_000
    const sessionId = cursor.sessionId

    const resetAfterStop = transitionAudioRecorderSessionBoundary(cursor, 7, 7, false)

    expect(resetAfterStop).toBe(false)
    expect(cursor).toEqual({
      sessionId,
      hasSession: true,
      segmentIndex: 3,
      offsetMs: 42_000,
    })
  })

  it('starts a fresh session at segment zero when a stopped note is branched', () => {
    const cursor = createAudioRecorderSessionCursor()
    cursor.hasSession = true
    cursor.segmentIndex = 2
    cursor.offsetMs = 31_500
    const parentSessionId = cursor.sessionId

    const resetAfterStop = transitionAudioRecorderSessionBoundary(cursor, 7, 8, false)

    expect(resetAfterStop).toBe(false)
    expect(cursor.sessionId).not.toBe(parentSessionId)
    expect(cursor.hasSession).toBe(false)
    expect(cursor.segmentIndex).toBe(0)
    expect(cursor.offsetMs).toBe(0)
  })

  it('keeps active segment metadata until it can stop before resetting', () => {
    const cursor = createAudioRecorderSessionCursor()
    cursor.hasSession = true
    cursor.segmentIndex = 1
    cursor.offsetMs = 30_000
    const parentSessionId = cursor.sessionId

    const resetAfterStop = transitionAudioRecorderSessionBoundary(cursor, 7, 8, true)

    expect(resetAfterStop).toBe(true)
    expect(cursor.sessionId).toBe(parentSessionId)
    expect(cursor.segmentIndex).toBe(1)
    expect(cursor.offsetMs).toBe(30_000)

    resetAudioRecorderSessionCursor(cursor)
    expect(cursor.sessionId).not.toBe(parentSessionId)
    expect(cursor.hasSession).toBe(false)
    expect(cursor.segmentIndex).toBe(0)
    expect(cursor.offsetMs).toBe(0)
  })
})
