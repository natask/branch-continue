export const VOICE_SEEK_EVENT = 'branch-continue:voice-seek'

export interface VoiceSeekDetail {
  id: string
  timeMs: number
}

export function dispatchVoiceSeek(target: EventTarget, id: string, timeMs: number): void {
  target.dispatchEvent(new CustomEvent<VoiceSeekDetail>(VOICE_SEEK_EVENT, {
    detail: { id, timeMs },
  }))
}
