import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import WavesurferPlayer from '@wavesurfer/react'
import type WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { pauseGlobalAudio, playGlobalAudio, useGlobalAudioPlayer } from '../lib/global-audio-player'

interface AudioPlayerProps {
  id: string
  src: string
  blob?: Blob | null
  mimeType?: string
  label?: string
  downloadName?: string
  showDownload?: boolean
  fallbackDurationMs?: number
  peaks?: number[][]
  markers?: AudioPlayerMarker[]
  waveformUnavailable?: boolean
}

export interface AudioPlayerMarker {
  timeMs: number
  durationMs?: number
  label: string
}

interface WaveformRegion {
  id: string
  startMs: number
  durationMs: number
  label: string
}

const WAVEFORM_ZOOM_STEP = 24
const WAVEFORM_ZOOM_MAX = 192
const PINCH_ZOOM_SENSITIVITY = 0.8

export function AudioPlayer({
  id,
  src,
  blob,
  mimeType,
  label = 'Voice recording',
  downloadName = 'branch-continue-voice.webm',
  showDownload = false,
  fallbackDurationMs,
  peaks = [],
  markers = [],
  waveformUnavailable = false,
}: AudioPlayerProps) {
  const regions = useMemo(() => RegionsPlugin.create(), [src])
  const plugins = useMemo(() => [regions], [regions])
  const globalAudio = useGlobalAudioPlayer()
  const playerRef = useRef<HTMLDivElement | null>(null)
  const pointerPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistanceRef = useRef<number | null>(null)
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [waveformZoom, setWaveformZoom] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const isActive = globalAudio.activeId === id
  const playing = isActive && globalAudio.playing
  const displayDuration = duration > 0 ? duration : fallbackDurationMs && fallbackDurationMs > 0 ? fallbackDurationMs / 1000 : 0
  const waveformRegions = useMemo<WaveformRegion[]>(
    () => markers.map((marker, index) => ({
      id: `marker-${index}-${marker.timeMs}`,
      startMs: marker.timeMs,
      durationMs: marker.durationMs ?? 240,
      label: marker.label,
    })),
    [markers],
  )
  const waveformZoomLabel = waveformZoom === 0 ? 'Fit' : `${Math.round(waveformZoom)} px/s`

  const playAt = useCallback((nextTimeMs?: number) => {
    void playGlobalAudio({ id, blob, src, startMs: nextTimeMs }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    })
  }, [blob, id, src])

  const togglePlayback = useCallback(() => {
    if (playing) {
      pauseGlobalAudio()
      return
    }

    playAt()
  }, [playAt, playing])

  useEffect(() => {
    setDuration(0)
    setCurrentTime(0)
    setError(null)
    setWavesurfer(null)
  }, [src])

  useEffect(() => {
    if (!isActive) return
    const nextTime = globalAudio.currentTime
    setCurrentTime(nextTime)
    if (wavesurfer && Math.abs(wavesurfer.getCurrentTime() - nextTime) > 0.35) {
      wavesurfer.setTime(nextTime)
    }
  }, [globalAudio.currentTime, isActive, wavesurfer])

  useEffect(() => {
    if (!isActive || globalAudio.duration <= 0) return
    setDuration(globalAudio.duration)
  }, [globalAudio.duration, isActive])

  useEffect(() => {
    if (!wavesurfer) return undefined
    regions.clearRegions()

    for (const region of waveformRegions) {
      const start = Math.max(0, region.startMs / 1000)
      const end = Math.max(start + 0.05, start + region.durationMs / 1000)
      regions.addRegion({
        id: region.id,
        start,
        end,
        content: region.label,
        color: 'rgba(232, 168, 76, 0.24)',
        drag: false,
        resize: false,
      })
    }

    const unsubscribe = regions.on('region-clicked', (region, event) => {
      event.stopPropagation()
      wavesurfer.setTime(region.start)
      playAt(region.start * 1000)
    })

    return () => {
      unsubscribe()
      regions.clearRegions()
    }
  }, [playAt, regions, waveformRegions, wavesurfer])

  useEffect(() => {
    if (!wavesurfer) return
    wavesurfer.zoom(waveformZoom)
  }, [waveformZoom, wavesurfer])

  const seekTo = useCallback((nextTimeMs: number) => {
    const seconds = Math.max(0, nextTimeMs / 1000)
    wavesurfer?.setTime(seconds)
    setCurrentTime(seconds)
    playAt(nextTimeMs)
  }, [playAt, wavesurfer])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; timeMs: number }>).detail
      if (detail?.id !== id) return
      seekTo(detail.timeMs)
    }

    window.addEventListener('branch-continue:voice-seek', handler)
    return () => window.removeEventListener('branch-continue:voice-seek', handler)
  }, [id, seekTo])

  const handleReady = useCallback((nextWavesurfer: WaveSurfer, nextDuration: number) => {
    setWavesurfer(nextWavesurfer)
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration)
    }
  }, [])

  const handleDecode = useCallback((_wavesurfer: WaveSurfer, nextDuration: number) => {
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setDuration(nextDuration)
    }
  }, [])

  const handleTimeUpdate = useCallback((_wavesurfer: WaveSurfer, nextTime: number) => {
    if (!isActive) setCurrentTime(nextTime)
  }, [isActive])

  const handleWaveformError = useCallback((_wavesurfer: WaveSurfer, nextError: Error) => {
    if (peaks.length === 0) setError(nextError.message || 'Could not draw this waveform.')
  }, [peaks.length])

  const stopWaveformPlayback = useCallback((nextWavesurfer: WaveSurfer) => {
    nextWavesurfer.pause()
  }, [])

  const changeWaveformZoom = useCallback((delta: number) => {
    if (waveformUnavailable) return
    setWaveformZoom((current) => {
      const base = current === 0 && delta > 0 ? WAVEFORM_ZOOM_STEP : current
      const next = Math.max(0, Math.min(WAVEFORM_ZOOM_MAX, base + delta))
      return next < WAVEFORM_ZOOM_STEP / 2 ? 0 : next
    })
  }, [waveformUnavailable])

  const updateWaveformZoom = useCallback((direction: -1 | 1) => {
    changeWaveformZoom(direction * WAVEFORM_ZOOM_STEP)
  }, [changeWaveformZoom])

  const fitWaveform = useCallback(() => {
    setWaveformZoom(0)
  }, [])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return

    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault()
      togglePlayback()
      return
    }

    if (waveformUnavailable) return
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      updateWaveformZoom(1)
      return
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      updateWaveformZoom(-1)
      return
    }

    if (event.key === '0') {
      event.preventDefault()
      fitWaveform()
    }
  }, [fitWaveform, togglePlayback, updateWaveformZoom, waveformUnavailable])

  const handleWheelZoom = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (waveformUnavailable || isInteractiveTarget(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    playerRef.current?.focus()
    changeWaveformZoom(event.deltaY < 0 ? WAVEFORM_ZOOM_STEP : -WAVEFORM_ZOOM_STEP)
  }, [changeWaveformZoom, waveformUnavailable])

  const handleWaveformPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    playerRef.current?.focus()
    if (waveformUnavailable || event.pointerType !== 'touch') return

    pointerPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture(event.pointerId)
    pinchDistanceRef.current = distanceBetweenFirstTwoPointers(pointerPointsRef.current)
  }, [waveformUnavailable])

  const handleWaveformPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (waveformUnavailable || event.pointerType !== 'touch' || !pointerPointsRef.current.has(event.pointerId)) return

    pointerPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const nextDistance = distanceBetweenFirstTwoPointers(pointerPointsRef.current)
    const previousDistance = pinchDistanceRef.current
    if (nextDistance === null || previousDistance === null) {
      pinchDistanceRef.current = nextDistance
      return
    }

    const delta = nextDistance - previousDistance
    if (Math.abs(delta) < 4) return
    event.preventDefault()
    event.stopPropagation()
    changeWaveformZoom(delta * PINCH_ZOOM_SENSITIVITY)
    pinchDistanceRef.current = nextDistance
  }, [changeWaveformZoom, waveformUnavailable])

  const handleWaveformPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointerPointsRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pinchDistanceRef.current = distanceBetweenFirstTwoPointers(pointerPointsRef.current)
  }, [])

  return (
    <div
      ref={playerRef}
      className="audio-player"
      tabIndex={0}
      role="group"
      aria-label={`${label} audio player. Space toggles playback. Plus and minus zoom the waveform.`}
      onKeyDown={handleKeyDown}
    >
      <div className="audio-player-toolbar">
        <button
          className="audio-player-toggle"
          onClick={togglePlayback}
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        {!waveformUnavailable && (
          <div className="audio-player-zoom" aria-label="Waveform zoom controls" role="group">
            <button
              className="audio-player-zoom-btn"
              onClick={() => updateWaveformZoom(-1)}
              disabled={waveformZoom === 0}
              type="button"
              aria-label="Zoom waveform out"
            >
              -
            </button>
            <button
              className="audio-player-zoom-fit"
              onClick={fitWaveform}
              disabled={waveformZoom === 0}
              type="button"
              aria-label="Fit waveform to player width"
              title={`Waveform zoom: ${waveformZoomLabel}`}
            >
              {waveformZoomLabel}
            </button>
            <button
              className="audio-player-zoom-btn"
              onClick={() => updateWaveformZoom(1)}
              disabled={waveformZoom >= WAVEFORM_ZOOM_MAX}
              type="button"
              aria-label="Zoom waveform in"
            >
              +
            </button>
          </div>
        )}
        {showDownload && (
          <a className="audio-player-download" href={src} download={downloadName} title="Download">
            Download
          </a>
        )}
      </div>
      <div className="audio-player-main">
        <div
          className="audio-player-waveform"
          aria-label={`Seek ${label}`}
          onWheel={handleWheelZoom}
          onPointerDown={handleWaveformPointerDown}
          onPointerMove={handleWaveformPointerMove}
          onPointerUp={handleWaveformPointerEnd}
          onPointerCancel={handleWaveformPointerEnd}
        >
          {waveformUnavailable ? (
            <div className="audio-player-fallback-waveform">
              <input
                className="audio-player-range"
                type="range"
                min={0}
                max={displayDuration || 0}
                step={0.1}
                value={displayDuration > 0 ? Math.min(currentTime, displayDuration) : 0}
                onChange={(event) => seekTo(Number(event.currentTarget.value) * 1000)}
                disabled={displayDuration <= 0}
                aria-label={`Seek ${label}`}
              />
            </div>
          ) : (
            <WavesurferPlayer
              key={src}
              url={src}
              blobMimeType={mimeType}
              duration={displayDuration || undefined}
              peaks={peaks.length > 0 ? peaks : undefined}
              minPxPerSec={waveformZoom > 0 ? waveformZoom : undefined}
              height={48}
              waveColor="rgba(232, 224, 214, 0.3)"
              progressColor="rgba(232, 168, 76, 0.78)"
              cursorColor="rgba(232, 168, 76, 0.92)"
              cursorWidth={2}
              barWidth={2}
              barGap={2}
              barRadius={2}
              normalize
              dragToSeek
              plugins={plugins}
              onReady={handleReady}
              onDecode={handleDecode}
              onTimeupdate={handleTimeUpdate}
              onInteraction={(_wavesurfer, nextTime) => seekTo(nextTime * 1000)}
              onPlay={stopWaveformPlayback}
              onError={handleWaveformError}
            />
          )}
        </div>
        <div className="audio-player-foot">
          <span className="audio-player-label">{label}</span>
          <time className="audio-player-time">
            {formatTime(currentTime)} / {formatTime(displayDuration)}
          </time>
        </div>
        {error && <p className="audio-player-error">{error}</p>}
      </div>
    </div>
  )
}

function distanceBetweenFirstTwoPointers(points: Map<number, { x: number; y: number }>): number | null {
  if (points.size < 2) return null
  const [first, second] = Array.from(points.values())
  if (!first || !second) return null
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function isInteractiveTarget(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button, a, input, select, textarea, [contenteditable="true"]'))
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`
}
