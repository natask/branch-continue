import { useEffect, useState } from 'react'

interface GlobalAudioSnapshot {
  activeId: string | null
  currentTime: number
  duration: number
  error: string | null
  playing: boolean
}

interface PlayAudioInput {
  id: string
  blob?: Blob | null
  src: string
  startMs?: number
}

const listeners = new Set<() => void>()
let audio: HTMLAudioElement | null = null
let activeId: string | null = null
let activeObjectUrl: string | null = null
let snapshot: GlobalAudioSnapshot = {
  activeId: null,
  currentTime: 0,
  duration: 0,
  error: null,
  playing: false,
}

export function useGlobalAudioPlayer(): GlobalAudioSnapshot {
  const [state, setState] = useState(getGlobalAudioSnapshot)

  useEffect(() => {
    const listener = () => setState(getGlobalAudioSnapshot())
    listeners.add(listener)
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return state
}

export function getGlobalAudioSnapshot(): GlobalAudioSnapshot {
  if (!audio) return snapshot

  snapshot = {
    ...snapshot,
    activeId,
    currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : snapshot.currentTime,
    duration: resolveAudioDuration(audio) || snapshot.duration,
    playing: !audio.paused && !audio.ended,
  }
  return snapshot
}

export async function playGlobalAudio({ id, blob, src, startMs }: PlayAudioInput): Promise<void> {
  const player = ensureAudio()
  if (activeId !== id) {
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = blob ? URL.createObjectURL(blob) : null
    player.src = activeObjectUrl ?? src
    activeId = id
    snapshot = { ...snapshot, activeId: id, currentTime: 0, duration: 0, error: null, playing: false }
  }

  if (typeof startMs === 'number' && Number.isFinite(startMs)) {
    player.currentTime = Math.max(0, startMs / 1000)
  }

  try {
    await player.play()
    updateSnapshot({ playing: true, error: null })
  } catch (error) {
    updateSnapshot({ error: errorMessage(error), playing: false })
    throw error
  }
}

export function pauseGlobalAudio(): void {
  const player = ensureAudio()
  player.pause()
  updateSnapshot({ playing: false })
}

export function seekGlobalAudio(id: string, startMs: number): void {
  const player = ensureAudio()
  if (activeId !== id) return
  player.currentTime = Math.max(0, startMs / 1000)
  updateSnapshot({ currentTime: player.currentTime })
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio

  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('timeupdate', () => updateSnapshot({ currentTime: audio?.currentTime ?? 0 }))
  audio.addEventListener('durationchange', () => updateSnapshot({ duration: resolveAudioDuration(audio) }))
  audio.addEventListener('loadedmetadata', () => updateSnapshot({ duration: resolveAudioDuration(audio) }))
  audio.addEventListener('play', () => updateSnapshot({ playing: true, error: null }))
  audio.addEventListener('pause', () => updateSnapshot({ playing: false }))
  audio.addEventListener('ended', () => updateSnapshot({ playing: false }))
  audio.addEventListener('error', () => updateSnapshot({ error: 'Could not play this recording.', playing: false }))
  return audio
}

function updateSnapshot(patch: Partial<GlobalAudioSnapshot>): void {
  snapshot = {
    ...snapshot,
    activeId,
    ...patch,
  }
  for (const listener of listeners) listener()
}

function resolveAudioDuration(player: HTMLAudioElement | null): number {
  if (!player) return 0
  return Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
