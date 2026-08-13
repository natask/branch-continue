import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { useWavesurfer } from '@wavesurfer/react'
import type WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import { getGlobalAudioSnapshot, pauseGlobalAudio, playGlobalAudio, useGlobalAudioPlayer } from '../lib/global-audio-player'
import { VOICE_SEEK_EVENT, type VoiceSeekDetail } from '../lib/voice-seek'
import { computeWaveformTickSpec, formatWaveformTickLabel } from '../lib/waveform-ticks'

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
  waveformHeight?: number
  /** Off for placeholder envelopes, which normalization would stretch to a solid block. */
  normalizeWaveform?: boolean
  /** Rest the playhead at the end of the session, e.g. right after recording. */
  restAtEnd?: boolean
}

export interface AudioPlayerMarker {
  timeMs: number
  durationMs?: number
  label: string
  /**
   * `span` tints a time range without text (its extent is the information);
   * `boundary` is a thin labeled tick. Defaults to boundary.
   */
  kind?: 'span' | 'boundary'
}

interface WaveformRegion {
  id: string
  startMs: number
  durationMs: number
  label: string
  kind: 'span' | 'boundary'
}

const BOUNDARY_MARKER_DURATION_MS = 240

const WAVEFORM_ZOOM_STEP = 24
const WAVEFORM_ZOOM_MAX = 192
const PINCH_ZOOM_SENSITIVITY = 0.8
const TAP_MAX_MOVE_PX = 10
const TAP_MAX_DURATION_MS = 650

export function AudioPlayer({
  id,
  src,
  blob,
  label = 'Voice recording',
  downloadName = 'branch-continue-voice.webm',
  showDownload = false,
  fallbackDurationMs,
  peaks = [],
  markers = [],
  waveformUnavailable = false,
  waveformHeight = 48,
  normalizeWaveform = true,
  restAtEnd = false,
}: AudioPlayerProps) {
  const regions = useMemo(() => RegionsPlugin.create(), [])
  const plugins = useMemo(() => [regions], [regions])
  const globalAudio = useGlobalAudioPlayer()
  const playerRef = useRef<HTMLDivElement | null>(null)
  const pointerPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pointerStartRef = useRef(new Map<number, { x: number; y: number; startedAt: number; moved: boolean }>())
  const pinchDistanceRef = useRef<number | null>(null)
  const pinchActiveRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const waveContainerRef = useRef<HTMLDivElement | null>(null)
  const waveformStageRef = useRef<HTMLDivElement | null>(null)
  const progressRef = useRef<HTMLSpanElement | null>(null)
  const playheadRef = useRef<HTMLSpanElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [waveformZoom, setWaveformZoom] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const isActive = globalAudio.activeId === id
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const playing = isActive && globalAudio.playing
  const displayDuration = duration > 0 ? duration : fallbackDurationMs && fallbackDurationMs > 0 ? fallbackDurationMs / 1000 : 0
  // The event-prop wrapper component races: an instance created with explicit
  // peaks and duration finishes init/decode/ready before the wrapper's
  // subscription effect runs, so a component listening via onReady may never
  // learn the instance exists. useWavesurfer returns the instance as state,
  // which cannot be missed; events are subscribed below with a direct read as
  // backup for anything that already fired.
  // Create options stay static so the instance survives data updates: segment
  // saves during recording swap src/peaks several times, and a destroy/create
  // cycle blanks the waveform for a frame each time. New data loads into the
  // existing instance below instead.
  const { wavesurfer } = useWavesurfer({
    container: waveContainerRef,
    height: waveformHeight,
    waveColor: 'rgba(232, 224, 214, 0.3)',
    // Playback belongs to the global audio element. Keep WaveSurfer's canvas
    // static and draw one compositor-backed playhead below; forcing this
    // separate media instance to seek on every animation frame flickers in
    // WKWebView when transcript regions are layered over the waveform.
    progressColor: 'rgba(232, 224, 214, 0.3)',
    cursorWidth: 0,
    barWidth: 2,
    barGap: 2,
    barRadius: 2,
    interact: false,
    dragToSeek: false,
    plugins,
  })
  const displayDurationRef = useRef(displayDuration)
  displayDurationRef.current = displayDuration

  useEffect(() => {
    if (!wavesurfer) return
    wavesurfer.setOptions({ normalize: normalizeWaveform })
    void wavesurfer
      .load(src, peaks.length > 0 ? peaks : undefined, displayDurationRef.current || undefined)
      .catch(() => {
        // A superseded load or an undecodable source still renders the
        // provided peaks; playback runs through the global audio element.
      })
  }, [normalizeWaveform, peaks, src, wavesurfer])
  const waveformRegions = useMemo<WaveformRegion[]>(
    () => markers.map((marker, index) => ({
      id: `marker-${index}-${marker.timeMs}`,
      startMs: marker.timeMs,
      durationMs: marker.kind === 'span'
        ? marker.durationMs ?? BOUNDARY_MARKER_DURATION_MS
        : BOUNDARY_MARKER_DURATION_MS,
      label: marker.label,
      kind: marker.kind ?? 'boundary',
    })),
    [markers],
  )
  const playAt = useCallback((nextTimeMs?: number) => {
    void playGlobalAudio({ id, blob, src, startMs: nextTimeMs }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    })
  }, [blob, id, src])

  const togglePlayback = useCallback(() => {
    const latestAudio = getGlobalAudioSnapshot()
    if (latestAudio.activeId === id && latestAudio.playing) {
      pauseGlobalAudio()
      return
    }

    playAt()
  }, [id, playAt])

  useEffect(() => {
    setDuration(0)
    setCurrentTime(0)
    setError(null)
  }, [src])

  const restAppliedForSrcRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    // Right after a recording, the seeker belongs at the point recording
    // reached, not back at zero. Apply before paint so the stopped player never
    // flashes a contradictory 0:00 frame while its cursor is moving to the end.
    // One-shot per source so later seeks win.
    if (!restAtEnd || displayDuration <= 0) return
    if (restAppliedForSrcRef.current === src) return
    restAppliedForSrcRef.current = src
    setCurrentTime(displayDuration)
  }, [displayDuration, restAtEnd, src])

  useEffect(() => {
    if (!wavesurfer) return undefined
    const applyDuration = (nextDuration: number) => {
      if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration)
    }
    const unsubscribes = [
      wavesurfer.on('decode', applyDuration),
      wavesurfer.on('ready', applyDuration),
      wavesurfer.on('timeupdate', (nextTime: number) => {
        if (!isActiveRef.current) setCurrentTime(nextTime)
      }),
      // Playback belongs to the global audio element; never let the silent
      // wavesurfer media play in parallel.
      wavesurfer.on('play', () => wavesurfer.pause()),
      wavesurfer.on('error', (nextError: Error) => {
        if (peaks.length === 0) setError(nextError.message || 'Could not draw this waveform.')
      }),
    ]
    applyDuration(wavesurfer.getDuration())
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [peaks.length, wavesurfer])

  useEffect(() => {
    if (!isActive) return
    const nextTime = globalAudio.currentTime
    setCurrentTime(nextTime)
  }, [globalAudio.currentTime, isActive])

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
        // Span extents are the information; text on every region collides
        // into an unreadable stack when blocks sit close together.
        content: region.kind === 'boundary' ? region.label : undefined,
        color: region.kind === 'span' ? 'rgba(232, 168, 76, 0.14)' : 'rgba(232, 168, 76, 0.32)',
        drag: false,
        resize: false,
      })
    }

    const unsubscribe = regions.on('region-clicked', (region, event) => {
      event.stopPropagation()
      playAt(region.start * 1000)
    })

    return () => {
      unsubscribe()
      regions.clearRegions()
    }
    // displayDuration re-places regions once the real duration is known; the
    // plugin positions them relative to the duration at add time.
  }, [displayDuration, playAt, regions, waveformRegions, wavesurfer])

  useLayoutEffect(() => {
    if (!wavesurfer) return
    try {
      wavesurfer.zoom(waveformZoom)
    } catch {
      // Zoom requires decoded data; before decode the fit view stays.
    }
  }, [waveformZoom, wavesurfer])

  useLayoutEffect(() => {
    const playhead = playheadRef.current
    const progress = progressRef.current
    const stage = waveformStageRef.current
    if (!playhead || !progress || !stage || displayDuration <= 0) return
    // Scroll first, then measure. Reading the old scroll offset during render
    // made the cursor disappear for one painted frame whenever playback crossed
    // the viewport margin, which looked like a periodic flicker in WKWebView.
    if (wavesurfer) keepPlayheadVisible(wavesurfer, currentTime)
    const playheadOffset = waveformPlayheadOffsetPx(
      currentTime,
      displayDuration,
      stage.clientWidth,
      waveformViewport(wavesurfer),
    )
    playhead.style.transform = `translate3d(${playheadOffset - 1}px, 0, 0)`
    progress.style.transform = `scaleX(${waveformProgressScale(playheadOffset, stage.clientWidth)})`
  }, [currentTime, displayDuration, waveformZoom, wavesurfer])

  useEffect(() => {
    // The ruler's resolution follows the zoom: re-register the timeline with
    // intervals computed for the current px-per-second, since the plugin only
    // reads explicit intervals at creation.
    if (!wavesurfer || displayDuration <= 0) return undefined
    const pxPerSec = waveformZoom > 0
      ? waveformZoom
      : (wavesurfer.getWidth() || 1) / displayDuration
    const spec = computeWaveformTickSpec(pxPerSec)
    const timeline = wavesurfer.registerPlugin(TimelinePlugin.create({
      height: 14,
      timeInterval: spec.tickSec,
      primaryLabelInterval: spec.labelSec,
      secondaryLabelInterval: 0,
      formatTimeCallback: (seconds) => formatWaveformTickLabel(seconds, spec.labelSec),
      style: { color: 'rgba(232, 224, 214, 0.55)' },
    }))
    return () => timeline.destroy()
  }, [displayDuration, waveformZoom, wavesurfer])

  const seekTo = useCallback((nextTimeMs: number) => {
    const seconds = Math.max(0, nextTimeMs / 1000)
    setCurrentTime(seconds)
    playAt(nextTimeMs)
  }, [playAt])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<VoiceSeekDetail>).detail
      if (detail?.id !== id) return
      seekTo(detail.timeMs)
    }

    window.addEventListener(VOICE_SEEK_EVENT, handler)
    return () => window.removeEventListener(VOICE_SEEK_EVENT, handler)
  }, [id, seekTo])

  const changeWaveformZoom = useCallback((delta: number) => {
    if (waveformUnavailable) return
    setWaveformZoom((current) => {
      const base = current === 0 && delta > 0 ? WAVEFORM_ZOOM_STEP : current
      const next = Math.max(0, Math.min(WAVEFORM_ZOOM_MAX, base + delta))
      return next < WAVEFORM_ZOOM_STEP / 2 ? 0 : next
    })
  }, [waveformUnavailable])

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
      changeWaveformZoom(WAVEFORM_ZOOM_STEP)
      return
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      changeWaveformZoom(-WAVEFORM_ZOOM_STEP)
      return
    }

    if (event.key === '0') {
      event.preventDefault()
      setWaveformZoom(0)
    }
  }, [changeWaveformZoom, togglePlayback, waveformUnavailable])

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
    pointerStartRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
      moved: false,
    })

    if (pointerPointsRef.current.size >= 2) {
      captureActivePointers(event.currentTarget, pointerPointsRef.current)
      pinchActiveRef.current = true
      suppressNextClickRef.current = true
    }
    pinchDistanceRef.current = distanceBetweenFirstTwoPointers(pointerPointsRef.current)
  }, [waveformUnavailable])

  const handleWaveformPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (waveformUnavailable || event.pointerType !== 'touch' || !pointerPointsRef.current.has(event.pointerId)) return

    pointerPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const start = pointerStartRef.current.get(event.pointerId)
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_MAX_MOVE_PX) {
      start.moved = true
      suppressNextClickRef.current = true
    }

    if (pointerPointsRef.current.size < 2) return

    const nextDistance = distanceBetweenFirstTwoPointers(pointerPointsRef.current)
    const previousDistance = pinchDistanceRef.current
    if (nextDistance === null || previousDistance === null) {
      pinchDistanceRef.current = nextDistance
      return
    }

    const delta = nextDistance - previousDistance
    if (Math.abs(delta) < 4) return
    pinchActiveRef.current = true
    suppressNextClickRef.current = true
    event.preventDefault()
    event.stopPropagation()
    changeWaveformZoom(delta * PINCH_ZOOM_SENSITIVITY)
    pinchDistanceRef.current = nextDistance
  }, [changeWaveformZoom, waveformUnavailable])

  const handleWaveformPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current.get(event.pointerId)
    const wasPinching = pinchActiveRef.current || pointerPointsRef.current.size >= 2
    pointerPointsRef.current.delete(event.pointerId)
    pointerStartRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pinchDistanceRef.current = distanceBetweenFirstTwoPointers(pointerPointsRef.current)
    if (pointerPointsRef.current.size === 0) {
      window.setTimeout(() => {
        pinchActiveRef.current = false
      }, 0)
    }

    if (
      event.pointerType === 'touch'
      && !wasPinching
      && start
      && !start.moved
      && Date.now() - start.startedAt <= TAP_MAX_DURATION_MS
    ) {
      suppressNextClickRef.current = true
      seekFromClientX(event.currentTarget, event.clientX, displayDuration, seekTo, waveformViewport(wavesurfer))
    }
  }, [displayDuration, seekTo, wavesurfer])

  const handleWaveformClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    if (waveformUnavailable || pinchActiveRef.current || isInteractiveTarget(event.target)) return
    seekFromClientX(event.currentTarget, event.clientX, displayDuration, seekTo, waveformViewport(wavesurfer))
  }, [displayDuration, seekTo, waveformUnavailable, wavesurfer])

  return (
    <div
      ref={playerRef}
      className="audio-player"
      tabIndex={0}
      role="group"
      aria-label={`${label} audio player. Space toggles playback. Wheel or pinch zooms the waveform.`}
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
          onClick={handleWaveformClick}
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
            <div ref={waveformStageRef} className="audio-player-waveform-stage">
              <div ref={waveContainerRef} />
              {displayDuration > 0 && (
                <>
                  <span ref={progressRef} className="audio-player-progress" aria-hidden="true" />
                  <span ref={playheadRef} className="audio-player-playhead" aria-hidden="true" />
                </>
              )}
            </div>
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

export function waveformPlayheadOffsetPx(
  currentTimeSeconds: number,
  durationSeconds: number,
  visibleWidthPx: number,
  viewport?: WaveformViewport | null,
): number {
  if (!durationSeconds) return 0
  const fraction = Math.max(0, Math.min(1, currentTimeSeconds / durationSeconds))
  if (viewport && viewport.renderedWidthPx > 0) {
    return fraction * viewport.renderedWidthPx - viewport.scrollPx
  }
  return fraction * Math.max(0, visibleWidthPx)
}

export function waveformProgressScale(playheadOffsetPx: number, visibleWidthPx: number): number {
  if (visibleWidthPx <= 0) return 0
  return Math.max(0, Math.min(1, playheadOffsetPx / visibleWidthPx))
}

function distanceBetweenFirstTwoPointers(points: Map<number, { x: number; y: number }>): number | null {
  if (points.size < 2) return null
  const [first, second] = Array.from(points.values())
  if (!first || !second) return null
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function captureActivePointers(element: HTMLDivElement, points: Map<number, { x: number; y: number }>): void {
  for (const pointerId of points.keys()) {
    try {
      if (!element.hasPointerCapture(pointerId)) element.setPointerCapture(pointerId)
    } catch {
      // Some WebViews only allow capture for the pointer currently dispatching.
    }
  }
}

export interface WaveformViewport {
  /** Horizontal scroll offset of the waveform, in pixels. */
  scrollPx: number
  /** Full rendered width of the waveform (>= visible width when zoomed). */
  renderedWidthPx: number
}

export function seekFromClientX(
  element: HTMLDivElement,
  clientX: number,
  durationSeconds: number,
  seekTo: (nextTimeMs: number) => void,
  viewport?: WaveformViewport | null,
): void {
  if (!durationSeconds) return
  const rect = element.getBoundingClientRect()
  const offsetX = clientX - rect.left
  // A zoomed waveform is wider than the container and scrolled, so the click
  // position must be mapped through the scroll offset, not the visible width.
  const fraction = viewport && viewport.renderedWidthPx > 0
    ? Math.max(0, Math.min(1, (viewport.scrollPx + offsetX) / viewport.renderedWidthPx))
    : Math.max(0, Math.min(1, offsetX / (rect.width || 1)))
  seekTo(fraction * durationSeconds * 1000)
}

function waveformViewport(wavesurfer: WaveSurfer | null): WaveformViewport | null {
  if (!wavesurfer) return null
  try {
    return {
      scrollPx: wavesurfer.getScroll(),
      renderedWidthPx: wavesurfer.getWrapper().scrollWidth,
    }
  } catch {
    return null
  }
}

function keepPlayheadVisible(wavesurfer: WaveSurfer, timeSeconds: number): void {
  const duration = wavesurfer.getDuration()
  if (!duration) return
  const renderedWidth = wavesurfer.getWrapper().scrollWidth
  const visibleWidth = wavesurfer.getWidth()
  if (!visibleWidth || renderedWidth <= visibleWidth + 1) return
  const playheadPx = (Math.min(timeSeconds, duration) / duration) * renderedWidth
  const scroll = wavesurfer.getScroll()
  const margin = Math.min(48, visibleWidth * 0.15)
  if (playheadPx >= scroll + margin && playheadPx <= scroll + visibleWidth - margin) return
  wavesurfer.setScroll(Math.max(0, playheadPx - visibleWidth / 2))
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
