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
let activeSrc: string | null = null
let activeBlob: Blob | null = null
let pendingSeek: { id: string; seconds: number } | null = null
let pendingPlayId: string | null = null
let animationFrame: number | null = null
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
  const nextBlob = blob ?? null
  const sourceChanged = activeId !== id || activeSrc !== src || activeBlob !== nextBlob
  if (sourceChanged) {
    player.pause()
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = blob ? URL.createObjectURL(blob) : null
    activeSrc = src
    activeBlob = nextBlob
    player.src = activeObjectUrl ?? src
    activeId = id
    pendingSeek = null
    pendingPlayId = null
    snapshot = { ...snapshot, activeId: id, currentTime: 0, duration: 0, error: null, playing: false }
    // Explicit load matters in WKWebView after replacing a blob URL on the
    // same logical player. Merely assigning src can leave the old media loaded.
    player.load()
  }

  if (typeof startMs === 'number' && Number.isFinite(startMs)) {
    pendingSeek = { id, seconds: Math.max(0, startMs / 1000) }
    applyPendingSeek(player)
  }

  if (pendingSeek?.id === id) {
    pendingPlayId = id
    return
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
  pendingPlayId = null
  const player = ensureAudio()
  player.pause()
  updateSnapshot({ playing: false })
}

export function seekGlobalAudio(id: string, startMs: number): void {
  const player = ensureAudio()
  if (activeId !== id) return
  pendingSeek = { id, seconds: Math.max(0, startMs / 1000) }
  applyPendingSeek(player)
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio

  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('timeupdate', () => updateSnapshot({ currentTime: audio?.currentTime ?? 0 }))
  for (const eventName of ['durationchange', 'loadedmetadata', 'loadeddata', 'canplay', 'progress']) {
    audio.addEventListener(eventName, () => {
      const applied = applyPendingSeek(audio!)
      updateSnapshot({ duration: resolveAudioDuration(audio), currentTime: audio?.currentTime ?? 0 })
      if (applied) void playAfterPendingSeek(audio!)
    })
  }
  audio.addEventListener('seeked', () => updateSnapshot({ currentTime: audio?.currentTime ?? 0 }))
  audio.addEventListener('play', () => {
    updateSnapshot({ playing: true, error: null })
    startAnimationUpdates()
  })
  audio.addEventListener('pause', () => {
    updateSnapshot({ playing: false })
    stopAnimationUpdates()
  })
  audio.addEventListener('ended', () => updateSnapshot({ playing: false }))
  audio.addEventListener('error', () => updateSnapshot({ error: 'Could not play this recording.', playing: false }))
  return audio
}

function applyPendingSeek(player: HTMLAudioElement): boolean {
  const request = pendingSeek
  if (!request || request.id !== activeId) return false

  const duration = resolveAudioDuration(player)
  const seekable = player.seekable
  const hasSeekableMedia = seekable.length > 0
  // HAVE_METADATA is 1. Avoid reaching through the global HTMLMediaElement
  // constructor because a few embedded WebViews do not expose it reliably.
  const metadataReady = player.readyState >= 1 || duration > 0
  if (!metadataReady && !hasSeekableMedia) return false

  let target = duration > 0 ? Math.min(request.seconds, duration) : request.seconds
  if (hasSeekableMedia) {
    const exactTargetIsSeekable = Array.from({ length: seekable.length }, (_, index) => index)
      .some((index) => target >= seekable.start(index) && target <= seekable.end(index))
    if (!exactTargetIsSeekable) return false
  }

  try {
    player.currentTime = target
  } catch {
    // Some WebViews expose metadata before the media becomes seekable. Keep
    // the request and retry it from loadeddata/canplay/progress.
    return false
  }
  if (Math.abs(player.currentTime - target) > 0.05) {
    // A few WebViews accept the assignment before seekability exists but
    // silently leave currentTime unchanged. Retain it for the next media event.
    return false
  }
  pendingSeek = null
  updateSnapshot({ currentTime: player.currentTime, duration })
  return true
}

async function playAfterPendingSeek(player: HTMLAudioElement): Promise<void> {
  if (!activeId || pendingPlayId !== activeId || pendingSeek) return
  pendingPlayId = null
  try {
    await player.play()
  } catch (error) {
    updateSnapshot({ error: errorMessage(error), playing: false })
  }
}

function startAnimationUpdates(): void {
  if (animationFrame !== null || typeof requestAnimationFrame !== 'function') return
  const update = () => {
    if (!audio || audio.paused || audio.ended) {
      animationFrame = null
      return
    }
    updateSnapshot({ currentTime: audio.currentTime })
    animationFrame = requestAnimationFrame(update)
  }
  animationFrame = requestAnimationFrame(update)
}

function stopAnimationUpdates(): void {
  if (animationFrame === null || typeof cancelAnimationFrame !== 'function') return
  cancelAnimationFrame(animationFrame)
  animationFrame = null
}

/** Test-only lifecycle reset; exported so media behavior can be verified with a fake Audio element. */
export function resetGlobalAudioPlayerForTests(): void {
  stopAnimationUpdates()
  audio?.pause()
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl)
  audio = null
  activeId = null
  activeObjectUrl = null
  activeSrc = null
  activeBlob = null
  pendingSeek = null
  pendingPlayId = null
  snapshot = { activeId: null, currentTime: 0, duration: 0, error: null, playing: false }
  listeners.clear()
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
