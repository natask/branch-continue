import type { AudioCaptureRecord, AudioCaptureReference } from '../../core/audio/audio-store'
import {
  extractAudioCaptureReferences,
  resolveAudioCaptureResumeSession,
  type AudioCaptureResumeSession,
} from '../../core/audio/audio-store'

export type ReturnAndContinueResult =
  | { kind: 'resumed' }
  | { kind: 'save-blocked' }
  | { kind: 'no-parent-audio' }
  | { kind: 'parent-audio-not-resumable' }
  | { kind: 'failed'; error: unknown }

export interface ReturnAndContinueDependencies {
  parentBody: string
  stopChildRecording: () => Promise<void>
  saveChildNote: () => Promise<boolean>
  openParent: () => void
  waitForParent: () => Promise<void>
  loadParentAudio: (reference: AudioCaptureReference) => Promise<AudioCaptureRecord[]>
  resumeParentRecording: (session: AudioCaptureResumeSession, reference: AudioCaptureReference) => Promise<void>
}

/**
 * Leave a child capture deliberately and continue the persisted voice session
 * owned by its parent. Navigation alone intentionally does not use this path.
 */
export async function returnAndContinueParentVoice(
  dependencies: ReturnAndContinueDependencies,
): Promise<ReturnAndContinueResult> {
  try {
    await dependencies.stopChildRecording()
    if (!await dependencies.saveChildNote()) return { kind: 'save-blocked' }

    dependencies.openParent()
    await dependencies.waitForParent()

    const reference = preferredAudioReference(dependencies.parentBody)
    if (!reference) return { kind: 'no-parent-audio' }

    const records = await dependencies.loadParentAudio(reference)
    const resumeSession = resolveAudioCaptureResumeSession(records)
    if (!resumeSession) return { kind: 'parent-audio-not-resumable' }

    await dependencies.resumeParentRecording(resumeSession, reference)
    return { kind: 'resumed' }
  } catch (error) {
    return { kind: 'failed', error }
  }
}

export function preferredAudioReference(body: string): AudioCaptureReference | null {
  const references = extractAudioCaptureReferences(body)
  return references.find((candidate) => candidate.kind === 'file') ?? references[0] ?? null
}
