import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { SourceNote } from '../../core/quicknote/types'
import { findNoteIndex, orderNotes } from '../lib/note-order'

const NOTE_NAV_SCROLL_STEP_PX = 40
const TOUCH_NAV_STEP_PX = 14
const TOUCH_NAV_MIN_DISTANCE_PX = 10
const TOUCH_NAV_MAX_DURATION_MS = 2400
const TOUCH_NAV_MAX_STEP_COUNT = 80
const TOUCH_NAV_MOMENTUM_THRESHOLD = 0.12
const TOUCH_NAV_MOMENTUM_SCALE = 40
const SWIPE_LOCK_THRESHOLD_PX = 6
const STACK_CONTROLS_KEY_DESKTOP = 'branch-continue:stack-controls:desktop'
const STACK_CONTROLS_KEY_MOBILE = 'branch-continue:stack-controls:mobile'
const TUNER_FONT_KEY = 'branch-continue:tuner-font-px'
const TUNER_FONT_MIN = 7
const TUNER_FONT_MAX = 24
const TUNER_FONT_DEFAULT_DESKTOP = 11
const TUNER_FONT_DEFAULT_MOBILE = 9
const TUNER_RESIZE_SENSITIVITY = 0.05

type StackControlKey =
  | 'camTheta'
  | 'camPhi'
  | 'camRadius'
  | 'cardGap'
  | 'lineTheta'
  | 'linePhi'
  | 'focusX'
  | 'focusY'
  | 'sinkY'
  | 'falloff'
  | 'falloffBalance'
  | 'minScale'

interface GestureAxisConfig {
  key: StackControlKey
  min: number
  max: number
  step: number
  label: string
  invert?: boolean
}

interface GesturePadConfig {
  id: string
  label: string
  hint: string
  x: GestureAxisConfig
  y: GestureAxisConfig
}

const GESTURE_PADS: readonly GesturePadConfig[] = [
  {
    id: 'camera',
    label: 'Camera',
    hint: 'drag: azimuth + elevation',
    x: { key: 'camTheta', min: -180, max: 180, step: 1, label: 'azimuth' },
    y: { key: 'camPhi', min: -90, max: 90, step: 1, label: 'elevation', invert: true },
  },
  {
    id: 'line',
    label: 'Card Line',
    hint: 'drag: line azimuth + elevation',
    x: { key: 'lineTheta', min: -180, max: 180, step: 1, label: 'azimuth' },
    y: { key: 'linePhi', min: -90, max: 90, step: 1, label: 'elevation', invert: true },
  },
  {
    id: 'focus',
    label: 'Focus Pos',
    hint: 'drag: X + Y offset',
    x: { key: 'focusX', min: -400, max: 400, step: 1, label: 'X' },
    y: { key: 'focusY', min: -300, max: 300, step: 1, label: 'Y', invert: true },
  },
  {
    id: 'depth',
    label: 'Depth',
    hint: 'drag: sink + falloff',
    x: { key: 'sinkY', min: 0, max: 120, step: 1, label: 'sink' },
    y: { key: 'falloff', min: 0, max: 2.5, step: 0.05, label: 'falloff', invert: true },
  },
  {
    id: 'tightness',
    label: 'Tightness',
    hint: 'drag: blur/fade + min scale',
    x: { key: 'falloffBalance', min: 0, max: 1, step: 0.05, label: 'blur/fade' },
    y: { key: 'minScale', min: 0.72, max: 1, step: 0.01, label: 'min scale', invert: true },
  },
]

// Spherical to Cartesian: theta = azimuth (XZ plane), phi = elevation from XZ plane
function sphericalDir(thetaDeg: number, phiDeg: number): [number, number, number] {
  const t = (thetaDeg * Math.PI) / 180
  const p = (phiDeg * Math.PI) / 180
  const cosP = Math.cos(p)
  return [Math.cos(t) * cosP, Math.sin(p), Math.sin(t) * cosP]
}

interface TimeMachineProps {
  notes: SourceNote[]
  activeNoteId: string | null
  totalCount: number
  recentering: boolean
  navigationEnabled: boolean
  swipeUpNavTarget: 'previous' | 'next'
  wheelNavDirection: 'natural' | 'reverse'
  isMobile: boolean
  showGestureTuner: boolean
  onSelect: (note: SourceNote) => void
  onOpen: (note: SourceNote) => void
  onBranch: (from: SourceNote) => void
}

export function TimeMachine({
  notes,
  activeNoteId,
  totalCount,
  recentering,
  navigationEnabled,
  swipeUpNavTarget,
  wheelNavDirection,
  isMobile,
  showGestureTuner,
  onSelect,
  onOpen,
  onBranch,
}: TimeMachineProps) {
  const sorted = useMemo(() => orderNotes(notes).reverse(), [notes])
  const activeIndex = Math.max(0, findNoteIndex(sorted, activeNoteId))
  const containerRef = useRef<HTMLDivElement>(null)
  const wheelAccumRef = useRef(0)
  const touchRef = useRef<{
    originX: number
    originY: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    lastMoveTime: number
    startTime: number
    locked: 'x' | 'y' | null
    navIndex: number
    moved: boolean
  } | null>(null)
  const pointerSwipeRef = useRef<{
    pointerId: number
    originX: number
    originY: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    lastMoveTime: number
    startTime: number
    locked: 'x' | 'y' | null
    navIndex: number
    moved: boolean
  } | null>(null)
  const bodyDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startScrollTop: number
    startScrollLeft: number
    moved: boolean
  } | null>(null)
  const suppressBodyClickRef = useRef(false)
  const suppressCardClickRef = useRef(false)
  const tunerDragRef = useRef<{ pointerId: number; padId: string } | null>(null)
  const tunerResizeRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPx: number
  } | null>(null)
  const [focusIndex, setFocusIndex] = useState(activeIndex)
  const [controls, setControlsState] = useState<Record<StackControlKey, number>>(() =>
    loadStackControls(isMobile),
  )
  const [tunerFontPx, setTunerFontPx] = useState<number>(() => loadTunerFontPx(isMobile))
  useEffect(() => {
    try {
      window.localStorage.setItem(TUNER_FONT_KEY, String(tunerFontPx))
    } catch {
      // Ignore persistence failures.
    }
  }, [tunerFontPx])
  useEffect(() => {
    try {
      window.localStorage.setItem(
        isMobile ? STACK_CONTROLS_KEY_MOBILE : STACK_CONTROLS_KEY_DESKTOP,
        JSON.stringify(controls),
      )
    } catch {
      // Ignore persistence failures.
    }
  }, [controls, isMobile])
  const setControls = (patch: Partial<Record<StackControlKey, number>>) => {
    setControlsState((current) => ({ ...current, ...patch }))
  }
  const resetControls = () => setControlsState(defaultStackControls(isMobile))

  const {
    camTheta,
    camPhi,
    camRadius,
    cardGap,
    lineTheta,
    linePhi,
    focusX,
    focusY,
    sinkY,
    falloff,
    falloffBalance,
    minScale,
  } = controls

  const controlValues: Record<StackControlKey, number> = {
    camTheta,
    camPhi,
    camRadius,
    cardGap,
    lineTheta,
    linePhi,
    focusX,
    focusY,
    sinkY,
    falloff,
    falloffBalance,
    minScale,
  }

  // Card line direction (unit vector from spherical coords)
  const [lineDirX, lineDirY, lineDirZ] = sphericalDir(lineTheta, linePhi)

  // Focal length (lens) is independent of camRadius (dolly distance).
  // Coupling them cancels out apparent-size change and breaks the Cam Dist slider.
  const focalLength = isMobile ? 480 : 960

  // Single falloff intensity drives all three, balance shifts weight between blur and opacity
  const scaleFalloff = 0.07 * falloff
  const opacityFalloff = 0.16 * falloff * (1 - falloffBalance * 0.5)
  const blurFalloff = 1.2 * falloff * (0.5 + falloffBalance)

  const focusNote = (index: number) => {
    const nextIndex = clamp(index, 0, sorted.length - 1)
    const nextNote = sorted[nextIndex]
    if (!nextNote) return
    setFocusIndex(nextIndex)
    onSelect(nextNote)
  }

  const handleGesturePadPoint = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pad: GesturePadConfig,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const xRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const yRatio = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    const yNormalized = pad.y.invert ? 1 - yRatio : yRatio

    setControls({
      [pad.x.key]: roundToStep(fromRatio(xRatio, pad.x.min, pad.x.max), pad.x.step),
      [pad.y.key]: roundToStep(fromRatio(yNormalized, pad.y.min, pad.y.max), pad.y.step),
    })
  }

  const handleGesturePadPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pad: GesturePadConfig,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    tunerDragRef.current = { pointerId: event.pointerId, padId: pad.id }
    event.currentTarget.setPointerCapture(event.pointerId)
    handleGesturePadPoint(event, pad)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleGesturePadPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pad: GesturePadConfig,
  ) => {
    const active = tunerDragRef.current
    if (!active || active.pointerId !== event.pointerId || active.padId !== pad.id) return

    handleGesturePadPoint(event, pad)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleGesturePadPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
    pad: GesturePadConfig,
  ) => {
    const active = tunerDragRef.current
    if (!active || active.pointerId !== event.pointerId || active.padId !== pad.id) return

    tunerDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const handleTunerResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    tunerResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPx: tunerFontPx,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleTunerResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = tunerResizeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    const diag = (dx + dy) / 2
    const next = clamp(
      active.startPx + diag * TUNER_RESIZE_SENSITIVITY,
      TUNER_FONT_MIN,
      TUNER_FONT_MAX,
    )
    setTunerFontPx(next)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleTunerResizePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = tunerResizeRef.current
    if (!active || active.pointerId !== event.pointerId) return
    tunerResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const handleTunerResizeDoubleClick = () => {
    setTunerFontPx(isMobile ? TUNER_FONT_DEFAULT_MOBILE : TUNER_FONT_DEFAULT_DESKTOP)
  }

  useEffect(() => {
    setFocusIndex(activeIndex)
  }, [activeIndex])

  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const handler = (event: WheelEvent) => {
      event.preventDefault()

      const verticalGesture = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      const dominantDelta = verticalGesture ? event.deltaY : event.deltaX
      wheelAccumRef.current += dominantDelta

      const accumulated = wheelAccumRef.current
      const normalizedAccum = wheelNavDirection === 'natural' ? accumulated : accumulated * -1
      if (Math.abs(normalizedAccum) < NOTE_NAV_SCROLL_STEP_PX) return

      const stepCount = Math.trunc(Math.abs(normalizedAccum) / NOTE_NAV_SCROLL_STEP_PX)
      const consumedNormalized = Math.sign(normalizedAccum) * stepCount * NOTE_NAV_SCROLL_STEP_PX
      const consumedRaw = wheelNavDirection === 'natural' ? consumedNormalized : consumedNormalized * -1
      wheelAccumRef.current = accumulated - consumedRaw

      let direction: number
      if (verticalGesture) {
        direction = verticalSwipeDirection(normalizedAccum, swipeUpNavTarget)
      } else {
        direction = normalizedAccum > 0 ? 1 : -1
      }

      focusNote(focusIndex + direction * stepCount)
    }

    element.addEventListener('wheel', handler, { passive: false })
    return () => element.removeEventListener('wheel', handler)
  }, [focusIndex, navigationEnabled, onSelect, sorted, swipeUpNavTarget, wheelNavDirection])

  // Full-surface touch swipe navigation on mobile (except card text scroll and controls).
  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      if (isSwipeGestureBlockedTarget(e.target)) return

      const startTime = Date.now()
      touchRef.current = {
        originX: touch.clientX,
        originY: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        lastMoveTime: startTime,
        startTime,
        locked: null,
        navIndex: focusIndex,
        moved: false,
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const state = touchRef.current
      const touch = e.touches[0]
      if (!state || !touch) return

      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY
      state.lastX = touch.clientX
      state.lastY = touch.clientY
      state.lastMoveTime = Date.now()

      if (!state.locked && (Math.abs(dx) > SWIPE_LOCK_THRESHOLD_PX || Math.abs(dy) > SWIPE_LOCK_THRESHOLD_PX)) {
        state.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (!state.locked) return

      e.preventDefault()

      const stepDelta = state.locked === 'y' ? touch.clientY - state.startY : touch.clientX - state.startX
      const stepCount = Math.trunc(Math.abs(stepDelta) / TOUCH_NAV_STEP_PX)
      if (stepCount <= 0) return

      const direction =
        state.locked === 'y'
          ? verticalSwipeDirection(stepDelta, swipeUpNavTarget)
          : stepDelta < 0
            ? 1
            : -1
      const nextIndex = clamp(state.navIndex + direction * stepCount, 0, sorted.length - 1)
      if (nextIndex === state.navIndex) return

      const nextNote = sorted[nextIndex]
      if (!nextNote) return

      state.navIndex = nextIndex
      state.moved = true
      setFocusIndex(nextIndex)
      onSelect(nextNote)

      // Keep stepping while finger keeps moving.
      state.startX = touch.clientX
      state.startY = touch.clientY
    }

    const onTouchEnd = (e: TouchEvent) => {
      const state = touchRef.current
      touchRef.current = null
      if (!state) return

      const touch = e.changedTouches[0]
      if (!touch) return

      const now = Date.now()
      const elapsed = now - state.startTime
      const totalX = touch.clientX - state.originX
      const totalY = touch.clientY - state.originY
      const vertical = Math.abs(totalY) >= Math.abs(totalX)
      const totalDelta = vertical ? totalY : totalX
      const releaseDelta = vertical ? touch.clientY - state.lastY : touch.clientX - state.lastX

      if (!state.moved) {
        if (Math.abs(totalDelta) < TOUCH_NAV_MIN_DISTANCE_PX || elapsed > TOUCH_NAV_MAX_DURATION_MS) return
      }

      const totalVelocity = Math.abs(totalDelta) / Math.max(1, elapsed)
      const releaseVelocity = Math.abs(releaseDelta) / Math.max(1, now - state.lastMoveTime)
      const velocity = Math.max(totalVelocity, releaseVelocity)
      const momentumBoost =
        velocity > TOUCH_NAV_MOMENTUM_THRESHOLD
          ? Math.round((velocity - TOUCH_NAV_MOMENTUM_THRESHOLD) * TOUCH_NAV_MOMENTUM_SCALE)
          : 0

      const baseStepCount = state.moved ? 0 : Math.max(1, Math.trunc(Math.abs(totalDelta) / TOUCH_NAV_STEP_PX))
      const stepCount = clamp(
        baseStepCount + momentumBoost,
        state.moved ? 0 : 1,
        TOUCH_NAV_MAX_STEP_COUNT,
      )
      if (stepCount <= 0) return

      const direction = vertical
        ? verticalSwipeDirection(totalDelta, swipeUpNavTarget)
        : totalDelta < 0
          ? 1
          : -1
      focusNote(state.navIndex + direction * stepCount)
    }

    const onTouchCancel = () => {
      touchRef.current = null
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [focusIndex, navigationEnabled, onSelect, sorted, swipeUpNavTarget])

  // Mouse/pen drag navigation on desktop so swipe speed can be tested without phone launch.
  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      if (event.button !== 0) return
      if (isSwipeGestureBlockedTarget(event.target)) return

      suppressCardClickRef.current = false
      const startTime = Date.now()
      pointerSwipeRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastMoveTime: startTime,
        startTime,
        locked: null,
        navIndex: focusIndex,
        moved: false,
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = pointerSwipeRef.current
      if (!state || state.pointerId !== event.pointerId) return

      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.lastMoveTime = Date.now()

      if (!state.locked && (Math.abs(dx) > SWIPE_LOCK_THRESHOLD_PX || Math.abs(dy) > SWIPE_LOCK_THRESHOLD_PX)) {
        state.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (!state.locked) return

      event.preventDefault()

      const stepDelta = state.locked === 'y' ? event.clientY - state.startY : event.clientX - state.startX
      const stepCount = Math.trunc(Math.abs(stepDelta) / TOUCH_NAV_STEP_PX)
      if (stepCount <= 0) return

      const direction =
        state.locked === 'y'
          ? verticalSwipeDirection(stepDelta, swipeUpNavTarget)
          : stepDelta < 0
            ? 1
            : -1
      const nextIndex = clamp(state.navIndex + direction * stepCount, 0, sorted.length - 1)
      if (nextIndex === state.navIndex) return

      const nextNote = sorted[nextIndex]
      if (!nextNote) return

      state.navIndex = nextIndex
      state.moved = true
      setFocusIndex(nextIndex)
      onSelect(nextNote)

      state.startX = event.clientX
      state.startY = event.clientY
    }

    const onPointerUp = (event: PointerEvent) => {
      const state = pointerSwipeRef.current
      if (!state || state.pointerId !== event.pointerId) return
      pointerSwipeRef.current = null

      const now = Date.now()
      const elapsed = now - state.startTime
      const totalX = event.clientX - state.originX
      const totalY = event.clientY - state.originY
      const vertical = Math.abs(totalY) >= Math.abs(totalX)
      const totalDelta = vertical ? totalY : totalX
      const releaseDelta = vertical ? event.clientY - state.lastY : event.clientX - state.lastX

      if (state.moved) {
        suppressCardClickRef.current = true
      }

      if (!state.moved) {
        if (Math.abs(totalDelta) < TOUCH_NAV_MIN_DISTANCE_PX || elapsed > TOUCH_NAV_MAX_DURATION_MS) return
      }

      const totalVelocity = Math.abs(totalDelta) / Math.max(1, elapsed)
      const releaseVelocity = Math.abs(releaseDelta) / Math.max(1, now - state.lastMoveTime)
      const velocity = Math.max(totalVelocity, releaseVelocity)
      const momentumBoost =
        velocity > TOUCH_NAV_MOMENTUM_THRESHOLD
          ? Math.round((velocity - TOUCH_NAV_MOMENTUM_THRESHOLD) * TOUCH_NAV_MOMENTUM_SCALE)
          : 0

      const baseStepCount = state.moved ? 0 : Math.max(1, Math.trunc(Math.abs(totalDelta) / TOUCH_NAV_STEP_PX))
      const stepCount = clamp(
        baseStepCount + momentumBoost,
        state.moved ? 0 : 1,
        TOUCH_NAV_MAX_STEP_COUNT,
      )
      if (stepCount <= 0) return

      const direction = vertical
        ? verticalSwipeDirection(totalDelta, swipeUpNavTarget)
        : totalDelta < 0
          ? 1
          : -1
      focusNote(state.navIndex + direction * stepCount)
    }

    const onPointerCancel = (event: PointerEvent) => {
      const state = pointerSwipeRef.current
      if (!state || state.pointerId !== event.pointerId) return
      pointerSwipeRef.current = null
    }

    element.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [focusIndex, navigationEnabled, onSelect, sorted, swipeUpNavTarget])

  const handleCardBodyPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.pointerType === 'touch') return

    const element = event.currentTarget
    bodyDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollTop: element.scrollTop,
      startScrollLeft: element.scrollLeft,
      moved: false,
    }
    element.dataset.dragging = 'true'
    element.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleCardBodyPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const dragState = bodyDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const deltaX = event.clientX - dragState.startX
    const deltaY = event.clientY - dragState.startY
    if (!dragState.moved && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      dragState.moved = true
    }

    event.currentTarget.scrollLeft = dragState.startScrollLeft - deltaX
    event.currentTarget.scrollTop = dragState.startScrollTop - deltaY
    event.preventDefault()
    event.stopPropagation()
  }

  const finishCardBodyDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const dragState = bodyDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (dragState.moved) {
      suppressBodyClickRef.current = true
      event.preventDefault()
    }

    bodyDragRef.current = null
    delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.stopPropagation()
  }

  const cancelCardBodyDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const dragState = bodyDragRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    bodyDragRef.current = null
    delete event.currentTarget.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.stopPropagation()
  }

  const handleCardBodyClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressBodyClickRef.current) return

    suppressBodyClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  useEffect(() => {
    if (!navigationEnabled) return undefined

    const handler = (event: KeyboardEvent) => {
      if (isInteractiveEventTarget(event.target)) return

      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        const current = sorted[focusIndex]
        if (current) onBranch(current)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const current = sorted[focusIndex]
        if (current) onOpen(current)
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        focusNote(focusIndex - 1)
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        focusNote(focusIndex + 1)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusIndex, navigationEnabled, onBranch, onOpen, onSelect, sorted])

  if (sorted.length === 0) {
    return (
      <div className="empty-panel">
        <p className="empty-title">No notes yet.</p>
      </div>
    )
  }

  const totalDisplayCount = totalCount || sorted.length
  const displayPosition = Math.min(Math.max(focusIndex + 1, 1), totalDisplayCount)
  const focusedNote = sorted[focusIndex] ?? null

  return (
    <div className="tm-layout">
      <section className="tm-stage" ref={containerRef}>
        <div className="tm-counter">
          {displayPosition} / {totalDisplayCount}
        </div>
        <div className="tm-stage-actions">
          <span className="tm-window-status">{recentering ? 'Refreshing' : 'Live'}</span>
          <button
            className="tm-branch-button"
            onClick={() => {
              if (!focusedNote) return
              onBranch(focusedNote)
            }}
            type="button"
          >
            Branch
          </button>
        </div>

        {showGestureTuner && (
          <section
            className="tm-gesture-tuner"
            aria-label="Card stack gesture tuner"
            style={{ ['--tune-font' as string]: `${tunerFontPx.toFixed(2)}px` }}
          >
            <p className="tm-gesture-title">Stack Gestures</p>
            <div className="tm-gesture-grid">
              {GESTURE_PADS.map((pad) => {
                const xValue = controlValues[pad.x.key]
                const yValue = controlValues[pad.y.key]
                const xRatio = toRatio(xValue, pad.x.min, pad.x.max)
                const yRaw = toRatio(yValue, pad.y.min, pad.y.max)
                const yRatio = pad.y.invert ? 1 - yRaw : yRaw

                return (
                  <button
                    key={pad.id}
                    className="tm-gesture-pad"
                    type="button"
                    onPointerDown={(event) => handleGesturePadPointerDown(event, pad)}
                    onPointerMove={(event) => handleGesturePadPointerMove(event, pad)}
                    onPointerUp={(event) => handleGesturePadPointerUp(event, pad)}
                    onPointerCancel={(event) => handleGesturePadPointerUp(event, pad)}
                  >
                    <span className="tm-gesture-pad-label">{pad.label}</span>
                    <span className="tm-gesture-pad-hint">{pad.x.label} / {pad.y.label}</span>
                    <span
                      className="tm-gesture-pad-dot"
                      style={{
                        left: `${xRatio * 100}%`,
                        top: `${yRatio * 100}%`,
                      }}
                    />
                  </button>
                )
              })}
            </div>
            <label className="tm-gesture-slider">
              <span className="tm-gesture-slider-label">Spacing</span>
              <input
                type="range"
                min={20}
                max={400}
                step={1}
                value={cardGap}
                onChange={(e) => setControls({ cardGap: parseFloat(e.currentTarget.value) })}
              />
              <span className="tm-gesture-slider-value">{cardGap}px</span>
            </label>
            <label className="tm-gesture-slider">
              <span className="tm-gesture-slider-label">Cam Dist</span>
              <input
                type="range"
                min={100}
                max={3000}
                step={10}
                value={camRadius}
                onChange={(e) => setControls({ camRadius: parseFloat(e.currentTarget.value) })}
              />
              <span className="tm-gesture-slider-value">{camRadius}</span>
            </label>
            <button
              className="tm-gesture-reset"
              type="button"
              onClick={resetControls}
              title="Reset to code defaults"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              className="tm-gesture-resize"
              aria-label="Drag to resize tuner; double-click to reset"
              title={`Drag to resize (${tunerFontPx.toFixed(1)}px) — double-click to reset`}
              onPointerDown={handleTunerResizePointerDown}
              onPointerMove={handleTunerResizePointerMove}
              onPointerUp={handleTunerResizePointerUp}
              onPointerCancel={handleTunerResizePointerUp}
              onDoubleClick={handleTunerResizeDoubleClick}
            />
          </section>
        )}

        <div
          className="tm-scene"
          style={{
            perspective: `${focalLength}px`,
            perspectiveOrigin: `calc(50% + ${focusX}px) calc(53% + ${focusY}px)`,
          }}
        >
          <div
            className="tm-world"
            style={{
              transform:
                `translate3d(0px, 0px, ${-camRadius}px)` +
                ` rotateX(${-camPhi}deg)` +
                ` rotateY(${camTheta - 90}deg)`,
            }}
          >
          {sorted.map((entry, index) => {
            const offset = index - focusIndex
            if (Math.abs(offset) > 7) return null

            const isFocused = index === focusIndex

            // Card 3D world position along the line direction. CSS Y is down, so negate.
            const cardWorldX = offset * cardGap * lineDirX
            const cardWorldY = -offset * cardGap * lineDirY + (isFocused ? 0 : sinkY)
            const cardWorldZ = offset * cardGap * lineDirZ

            const focusScale = isMobile ? 1.01 : 1.03
            const scale = isFocused
              ? focusScale
              : Math.max(minScale, 1 - Math.abs(offset) * scaleFalloff)
            const opacity = Math.max(0.1, 1 - Math.abs(offset) * opacityFalloff)
            const blur = Math.min(6, Math.abs(offset) * blurFalloff)

            // Each card tilts with the line direction (true orientation, not billboarded).
            const cardRotY = lineTheta
            const cardRotX = -linePhi

            return (
              <div
                key={entry.id}
                className={`tm-card ${isFocused ? 'tm-card-focused' : ''}`}
                role="button"
                tabIndex={0}
                style={{
                  transform:
                    `translate3d(${cardWorldX}px, ${cardWorldY}px, ${cardWorldZ}px)` +
                    ` rotateY(${cardRotY}deg)` +
                    ` rotateX(${cardRotX}deg)` +
                    ` scale(${scale})`,
                  opacity,
                  filter: blur > 0.5 ? `blur(${blur}px)` : 'none',
                  // Cards in front (negative offset) render above; focused floats above only cards behind.
                  zIndex: isFocused ? 100 : offset < 0 ? 100 + Math.abs(offset) : 100 - offset,
                  pointerEvents: offset < 0 ? 'none' : 'auto',
                }}
                onClick={(event) => {
                  if (suppressCardClickRef.current) {
                    suppressCardClickRef.current = false
                    event.preventDefault()
                    return
                  }

                  if (isFocused) {
                    onOpen(entry)
                    return
                  }
                  focusNote(index)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    if (isFocused) {
                      onOpen(entry)
                    } else {
                      focusNote(index)
                    }
                  }
                }}
              >
                {entry.title && (
                  <div className="tm-card-titlebar">
                    <span className="tm-card-name">{entry.title}</span>
                    {entry.timestamp && <span className="tm-card-date">{entry.timestamp}</span>}
                  </div>
                )}

                <div className="tm-card-body">
                  <div
                    className="tm-card-scroll"
                    onPointerDown={handleCardBodyPointerDown}
                    onPointerMove={handleCardBodyPointerMove}
                    onPointerUp={finishCardBodyDrag}
                    onPointerCancel={cancelCardBodyDrag}
                    onClickCapture={handleCardBodyClickCapture}
                  >
                    <p className="tm-card-preview">{entry.body || entry.preview}</p>
                  </div>
                  <span className="tm-card-meta">
                    L{entry.startLine}-L{entry.endLine}
                    {entry.parentNoteId ? ' • branched' : ''}
                  </span>
                </div>
              </div>
            )
          })}
          </div>
        </div>

      </section>
    </div>
  )
}

function defaultStackControls(isMobile: boolean): Record<StackControlKey, number> {
  return {
    cardGap: isMobile ? 112 : 230,
    lineTheta: 0,
    linePhi: 0,
    camTheta: 90,
    camPhi: isMobile ? -8 : -14,
    camRadius: isMobile ? 600 : 1200,
    focusX: 0,
    focusY: 0,
    sinkY: isMobile ? 8 : 24,
    falloff: 0.92,
    falloffBalance: 0.56,
    minScale: isMobile ? 0.92 : 0.88,
  }
}

function loadTunerFontPx(isMobile: boolean): number {
  const fallback = isMobile ? TUNER_FONT_DEFAULT_MOBILE : TUNER_FONT_DEFAULT_DESKTOP
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(TUNER_FONT_KEY)
    if (!raw) return fallback
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(TUNER_FONT_MAX, Math.max(TUNER_FONT_MIN, parsed))
  } catch {
    return fallback
  }
}

function loadStackControls(isMobile: boolean): Record<StackControlKey, number> {
  const fallback = defaultStackControls(isMobile)
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(
      isMobile ? STACK_CONTROLS_KEY_MOBILE : STACK_CONTROLS_KEY_DESKTOP,
    )
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<StackControlKey, number>>
    const merged: Record<StackControlKey, number> = { ...fallback }
    for (const key of Object.keys(fallback) as StackControlKey[]) {
      const value = parsed[key]
      if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value
    }
    return merged
  } catch {
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function toRatio(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return clamp((value - min) / (max - min), 0, 1)
}

function fromRatio(ratio: number, min: number, max: number): number {
  return min + clamp(ratio, 0, 1) * (max - min)
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

function verticalSwipeDirection(delta: number, swipeUpNavTarget: 'previous' | 'next'): number {
  const upDirection = swipeUpNavTarget === 'previous' ? 1 : -1
  return delta < 0 ? upDirection : upDirection * -1
}

function isInteractiveEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const interactiveSelector = 'input, textarea, select, [contenteditable="true"], [role="textbox"]'
  return target.closest(interactiveSelector) !== null
}

function isSwipeGestureBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const selector =
    '.tm-gesture-tuner, input, textarea, select, [contenteditable="true"], [role="textbox"], input[type="range"]'
  return target.closest(selector) !== null
}
