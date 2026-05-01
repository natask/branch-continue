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
import {
  cardLinePosition,
  cardRotationFromOrientation,
  sphericalDirection,
} from '../lib/card-stack-3d'
import {
  closestScrollableElement,
  elementCanConsumeScrollDelta,
} from '../lib/scroll-bridge'

const TOUCH_NAV_MIN_DISTANCE_PX = 10
const TOUCH_NAV_MAX_DURATION_MS = 2400
const SWIPE_LOCK_THRESHOLD_PX = 6
const GESTURE_DRAG_PX_PER_CARD_MOBILE = 96
const GESTURE_DRAG_PX_PER_CARD_DESKTOP = 92
const GESTURE_WHEEL_PX_PER_CARD_MOBILE = 96
const GESTURE_WHEEL_PX_PER_CARD_DESKTOP = 80
const GESTURE_MOMENTUM_PROJECTION_MS = 240
const GESTURE_MOMENTUM_MAX_CARD_DELTA = 12
const GESTURE_WHEEL_SETTLE_DELAY_MS = 90
const SCENE_MOTION_BASE_MS = 220
const SCENE_MOTION_PER_CARD_MS = 48
const SCENE_MOTION_MAX_MS = 520
// Camera/stack controls changed semantics on 2026-04-27: card orientation is
// absolute and independent from the card-line axis. Ignore older saved poses.
const STACK_CONTROLS_KEY_DESKTOP = 'branch-continue:stack-controls:v4:desktop'
const STACK_CONTROLS_KEY_MOBILE = 'branch-continue:stack-controls:v4:mobile'
const TUNER_FONT_KEY_LEGACY = 'branch-continue:tuner-font-px'
const TUNER_FONT_KEY_DESKTOP = 'branch-continue:tuner-font-px:desktop'
const TUNER_FONT_KEY_MOBILE = 'branch-continue:tuner-font-px:mobile'
const TUNER_FONT_MIN = 6
const TUNER_FONT_MAX = 24
const TUNER_FONT_DEFAULT_DESKTOP = 11
const TUNER_FONT_DEFAULT_MOBILE = 6.8
const TUNER_RESIZE_SENSITIVITY = 0.05
const CARD_SCROLLBAR_MOUSE_HIT_SLOP_PX = 14
const CARD_SCROLLBAR_TOUCH_HIT_SLOP_PX = 24

type SwipeAxis = 'x' | 'y'

type StackControlKey =
  | 'camTheta'
  | 'camPhi'
  | 'camRadius'
  | 'cardGap'
  | 'lineTheta'
  | 'linePhi'
  | 'cardLeftRight'
  | 'cardFrontBack'
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
    id: 'focus',
    label: 'Focus Pos',
    hint: 'drag: X + Y offset',
    x: { key: 'focusX', min: -400, max: 400, step: 1, label: 'X' },
    y: { key: 'focusY', min: -300, max: 300, step: 1, label: 'Y', invert: true },
  },
  {
    id: 'card',
    label: 'Card',
    hint: 'drag: left/right + front/back',
    x: { key: 'cardLeftRight', min: -180, max: 180, step: 1, label: 'left/right' },
    y: { key: 'cardFrontBack', min: -90, max: 90, step: 1, label: 'front/back', invert: true },
  },
  {
    id: 'line',
    label: 'Card Line',
    hint: 'drag: stack azimuth + elevation',
    x: { key: 'lineTheta', min: -180, max: 180, step: 1, label: 'azimuth' },
    y: { key: 'linePhi', min: -90, max: 90, step: 1, label: 'elevation', invert: true },
  },
  {
    id: 'tightness',
    label: 'Tightness',
    hint: 'drag: blur/fade + min scale',
    x: { key: 'falloffBalance', min: 0, max: 1, step: 0.05, label: 'blur/fade' },
    y: { key: 'minScale', min: 0.72, max: 1, step: 0.01, label: 'min scale', invert: true },
  },
  {
    id: 'depth',
    label: 'Depth',
    hint: 'drag: sink + falloff',
    x: { key: 'sinkY', min: 0, max: 120, step: 1, label: 'sink' },
    y: { key: 'falloff', min: 0, max: 2.5, step: 0.05, label: 'falloff', invert: true },
  },
]

interface TimeMachineProps {
  notes: SourceNote[]
  activeNoteId: string | null
  totalCount: number
  navigationEnabled: boolean
  swipeUpNavTarget: 'previous' | 'next'
  wheelNavDirection: 'natural' | 'reverse'
  isMobile: boolean
  showGestureTuner: boolean
  onSelect: (note: SourceNote) => void
  onOpen: (note: SourceNote) => void
  onBranch: (from: SourceNote) => void
}

interface GestureSwipeState {
  originX: number
  originY: number
  lastX: number
  lastY: number
  lastMoveTime: number
  startTime: number
  originSceneIndex: number
  locked: SwipeAxis | null
  moved: boolean
}

export function TimeMachine({
  notes,
  activeNoteId,
  totalCount,
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
  const touchRef = useRef<GestureSwipeState | null>(null)
  const pointerSwipeRef = useRef<
    | (GestureSwipeState & {
        pointerId: number
      })
    | null
  >(null)
  const gestureActiveRef = useRef(false)
  const wheelSettleTimeoutRef = useRef<number | null>(null)
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
  const sceneIndexRef = useRef(activeIndex)
  const focusIndexRef = useRef(activeIndex)
  const [focusIndex, setFocusIndexState] = useState(activeIndex)
  const [sceneIndex, setSceneIndexState] = useState(activeIndex)
  const [sceneMotionMs, setSceneMotionMs] = useState(SCENE_MOTION_BASE_MS)
  const [controls, setControlsState] = useState<Record<StackControlKey, number>>(() =>
    loadStackControls(isMobile),
  )
  const [tunerFontPx, setTunerFontPx] = useState<number>(() => loadTunerFontPx(isMobile))
  const [suppressSceneTransitions, setSuppressSceneTransitions] = useState(false)
  const [suppressGestureTransitions, setSuppressGestureTransitions] = useState(false)
  useEffect(() => {
    try {
      window.localStorage.setItem(getTunerFontStorageKey(isMobile), String(tunerFontPx))
    } catch {
      // Ignore persistence failures.
    }
  }, [isMobile, tunerFontPx])
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
    cardLeftRight,
    cardFrontBack,
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
    cardLeftRight,
    cardFrontBack,
    focusX,
    focusY,
    sinkY,
    falloff,
    falloffBalance,
    minScale,
  }

  // Card line direction (unit vector from spherical coords)
  const lineDirection = sphericalDirection(lineTheta, linePhi)

  // Focal length (lens) is independent of camRadius (dolly distance).
  // Coupling them cancels out apparent-size change and breaks the Cam Dist slider.
  const focalLength = isMobile ? 480 : 960

  // Single falloff intensity drives all three, balance shifts weight between blur and opacity
  const scaleFalloff = 0.07 * falloff
  const opacityFalloff = 0.16 * falloff * (1 - falloffBalance * 0.5)
  const blurFalloff = 1.2 * falloff * (0.5 + falloffBalance)
  const dragPxPerCard = isMobile ? GESTURE_DRAG_PX_PER_CARD_MOBILE : GESTURE_DRAG_PX_PER_CARD_DESKTOP
  const wheelPxPerCard = isMobile ? GESTURE_WHEEL_PX_PER_CARD_MOBILE : GESTURE_WHEEL_PX_PER_CARD_DESKTOP
  const sceneTransitionsSuppressed = suppressSceneTransitions || suppressGestureTransitions

  const setSceneIndex = (nextIndex: number) => {
    sceneIndexRef.current = nextIndex
    setSceneIndexState(nextIndex)
  }

  const selectNoteIndex = (index: number) => {
    const nextIndex = clamp(index, 0, sorted.length - 1)
    const nextNote = sorted[nextIndex]
    if (!nextNote) return nextIndex
    if (focusIndexRef.current !== nextIndex) {
      focusIndexRef.current = nextIndex
      setFocusIndexState(nextIndex)
      onSelect(nextNote)
    }
    return nextIndex
  }

  const syncFocusToScene = (nextSceneIndex: number) => {
    selectNoteIndex(Math.round(nextSceneIndex))
  }

  const clearWheelSettleTimeout = () => {
    if (wheelSettleTimeoutRef.current === null) return
    window.clearTimeout(wheelSettleTimeoutRef.current)
    wheelSettleTimeoutRef.current = null
  }

  const applySceneIndex = (nextSceneIndex: number) => {
    const nextIndex = clamp(nextSceneIndex, 0, sorted.length - 1)
    setSceneIndex(nextIndex)
    return nextIndex
  }

  const settleSceneAt = (targetSceneIndex: number) => {
    clearWheelSettleTimeout()
    const currentScene = sceneIndexRef.current
    const nextScene = clamp(targetSceneIndex, 0, sorted.length - 1)
    gestureActiveRef.current = false
    setSuppressGestureTransitions(false)
    setSceneMotionMs(sceneMotionDurationMs(Math.abs(nextScene - currentScene)))
    setSceneIndex(nextScene)
    selectNoteIndex(Math.round(nextScene))
  }

  const focusNote = (index: number) => {
    settleSceneAt(index)
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

    setSuppressSceneTransitions(true)
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

    setSuppressSceneTransitions(false)
    tunerDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const handleTunerResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    setSuppressSceneTransitions(true)
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
    setSuppressSceneTransitions(false)
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
    if (!showGestureTuner && suppressSceneTransitions) {
      setSuppressSceneTransitions(false)
    }
  }, [showGestureTuner, suppressSceneTransitions])

  useEffect(() => clearWheelSettleTimeout, [])

  useEffect(() => {
    if (!suppressSceneTransitions) return
    const reset = () => setSuppressSceneTransitions(false)
    window.addEventListener('pointerup', reset)
    window.addEventListener('pointercancel', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointerup', reset)
      window.removeEventListener('pointercancel', reset)
      window.removeEventListener('blur', reset)
    }
  }, [suppressSceneTransitions])

  useEffect(() => {
    focusIndexRef.current = activeIndex
    setFocusIndexState(activeIndex)
    if (!gestureActiveRef.current) {
      setSceneIndex(activeIndex)
    }
  }, [activeIndex])

  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const handler = (event: WheelEvent) => {
      const verticalGesture = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      const dominantDelta = verticalGesture ? event.deltaY : event.deltaX
      if (dominantDelta === 0) return
      const axis: SwipeAxis = verticalGesture ? 'y' : 'x'

      const scrollTarget = closestScrollableElement(event.target, '.tm-card-scroll')
      if (scrollTarget && elementCanConsumeScrollDelta(scrollTarget, axis, dominantDelta)) {
        return
      }

      event.preventDefault()

      const normalizedDelta =
        wheelNavDirection === 'natural' ? dominantDelta : dominantDelta * -1
      gestureActiveRef.current = true
      setSuppressGestureTransitions(true)
      const nextScene = applySceneIndex(
        sceneIndexRef.current +
          gestureDeltaToCardDelta(
            normalizedDelta,
            axis,
            swipeUpNavTarget,
            wheelPxPerCard,
          ),
      )
      syncFocusToScene(nextScene)
      clearWheelSettleTimeout()
      wheelSettleTimeoutRef.current = window.setTimeout(() => {
        wheelSettleTimeoutRef.current = null
        settleSceneAt(Math.round(sceneIndexRef.current))
      }, GESTURE_WHEEL_SETTLE_DELAY_MS)
    }

    element.addEventListener('wheel', handler, { passive: false })
    return () => element.removeEventListener('wheel', handler)
  }, [navigationEnabled, sorted, swipeUpNavTarget, wheelNavDirection, wheelPxPerCard])

  // Full-surface touch swipe navigation on mobile (except card text scroll and controls).
  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      if (
        isSwipeGestureBlockedTarget(e.target, {
          clientX: touch.clientX,
          clientY: touch.clientY,
          pointerType: 'touch',
        })
      ) {
        return
      }

      const startTime = Date.now()
      touchRef.current = {
        originX: touch.clientX,
        originY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        lastMoveTime: startTime,
        startTime,
        originSceneIndex: sceneIndexRef.current,
        locked: null,
        moved: false,
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const state = touchRef.current
      const touch = e.touches[0]
      if (!state || !touch) return

      const dx = touch.clientX - state.originX
      const dy = touch.clientY - state.originY
      state.lastX = touch.clientX
      state.lastY = touch.clientY
      state.lastMoveTime = Date.now()

      if (!state.locked && (Math.abs(dx) > SWIPE_LOCK_THRESHOLD_PX || Math.abs(dy) > SWIPE_LOCK_THRESHOLD_PX)) {
        state.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (!state.locked) return

      e.preventDefault()
      gestureActiveRef.current = true
      setSuppressGestureTransitions(true)
      const nextScene = applySceneIndex(
        state.originSceneIndex +
          gestureDeltaToCardDelta(
            state.locked === 'y' ? dy : dx,
            state.locked,
            swipeUpNavTarget,
            dragPxPerCard,
          ),
      )
      syncFocusToScene(nextScene)
      state.moved = true
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
      const axis = state.locked ?? (Math.abs(totalY) >= Math.abs(totalX) ? 'y' : 'x')
      const totalDelta = axis === 'y' ? totalY : totalX
      const releaseDelta = axis === 'y' ? touch.clientY - state.lastY : touch.clientX - state.lastX

      if (!state.moved) {
        if (Math.abs(totalDelta) < TOUCH_NAV_MIN_DISTANCE_PX || elapsed > TOUCH_NAV_MAX_DURATION_MS) return
      }

      const totalVelocity = totalDelta / Math.max(1, elapsed)
      const releaseVelocity = releaseDelta / Math.max(1, now - state.lastMoveTime)
      const velocity = Math.abs(releaseVelocity) >= Math.abs(totalVelocity) ? releaseVelocity : totalVelocity
      const releaseScene = state.moved
        ? sceneIndexRef.current
        : clamp(
            state.originSceneIndex +
              gestureDeltaToCardDelta(totalDelta, axis, swipeUpNavTarget, dragPxPerCard),
            0,
            sorted.length - 1,
          )
      const projectedScene = clamp(
        releaseScene +
          clampMagnitude(
            gestureDeltaToCardDelta(
              velocity * GESTURE_MOMENTUM_PROJECTION_MS,
              axis,
              swipeUpNavTarget,
              dragPxPerCard,
            ),
            GESTURE_MOMENTUM_MAX_CARD_DELTA,
          ),
        0,
        sorted.length - 1,
      )
      settleSceneAt(Math.round(projectedScene))
    }

    const onTouchCancel = () => {
      if (touchRef.current?.moved) {
        settleSceneAt(Math.round(sceneIndexRef.current))
      }
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
  }, [dragPxPerCard, navigationEnabled, sorted, swipeUpNavTarget])

  // Mouse/pen drag navigation on desktop so swipe speed can be tested without phone launch.
  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      if (event.button !== 0) return
      if (
        isSwipeGestureBlockedTarget(event.target, {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerType: event.pointerType,
        })
      ) {
        return
      }

      suppressCardClickRef.current = false
      const startTime = Date.now()
      pointerSwipeRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastMoveTime: startTime,
        startTime,
        originSceneIndex: sceneIndexRef.current,
        locked: null,
        moved: false,
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = pointerSwipeRef.current
      if (!state || state.pointerId !== event.pointerId) return

      const dx = event.clientX - state.originX
      const dy = event.clientY - state.originY
      state.lastX = event.clientX
      state.lastY = event.clientY
      state.lastMoveTime = Date.now()

      if (!state.locked && (Math.abs(dx) > SWIPE_LOCK_THRESHOLD_PX || Math.abs(dy) > SWIPE_LOCK_THRESHOLD_PX)) {
        state.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (!state.locked) return

      event.preventDefault()
      gestureActiveRef.current = true
      setSuppressGestureTransitions(true)
      const nextScene = applySceneIndex(
        state.originSceneIndex +
          gestureDeltaToCardDelta(
            state.locked === 'y' ? dy : dx,
            state.locked,
            swipeUpNavTarget,
            dragPxPerCard,
          ),
      )
      syncFocusToScene(nextScene)
      state.moved = true
    }

    const onPointerUp = (event: PointerEvent) => {
      const state = pointerSwipeRef.current
      if (!state || state.pointerId !== event.pointerId) return
      pointerSwipeRef.current = null

      const now = Date.now()
      const elapsed = now - state.startTime
      const totalX = event.clientX - state.originX
      const totalY = event.clientY - state.originY
      const axis = state.locked ?? (Math.abs(totalY) >= Math.abs(totalX) ? 'y' : 'x')
      const totalDelta = axis === 'y' ? totalY : totalX
      const releaseDelta = axis === 'y' ? event.clientY - state.lastY : event.clientX - state.lastX

      if (state.moved) {
        suppressCardClickRef.current = true
      }

      if (!state.moved) {
        if (Math.abs(totalDelta) < TOUCH_NAV_MIN_DISTANCE_PX || elapsed > TOUCH_NAV_MAX_DURATION_MS) return
      }

      const totalVelocity = totalDelta / Math.max(1, elapsed)
      const releaseVelocity = releaseDelta / Math.max(1, now - state.lastMoveTime)
      const velocity = Math.abs(releaseVelocity) >= Math.abs(totalVelocity) ? releaseVelocity : totalVelocity
      const releaseScene = state.moved
        ? sceneIndexRef.current
        : clamp(
            state.originSceneIndex +
              gestureDeltaToCardDelta(totalDelta, axis, swipeUpNavTarget, dragPxPerCard),
            0,
            sorted.length - 1,
          )
      const projectedScene = clamp(
        releaseScene +
          clampMagnitude(
            gestureDeltaToCardDelta(
              velocity * GESTURE_MOMENTUM_PROJECTION_MS,
              axis,
              swipeUpNavTarget,
              dragPxPerCard,
            ),
            GESTURE_MOMENTUM_MAX_CARD_DELTA,
          ),
        0,
        sorted.length - 1,
      )
      settleSceneAt(Math.round(projectedScene))
    }

    const onPointerCancel = (event: PointerEvent) => {
      const state = pointerSwipeRef.current
      if (!state || state.pointerId !== event.pointerId) return
      pointerSwipeRef.current = null
      if (state.moved) {
        settleSceneAt(Math.round(sceneIndexRef.current))
      }
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
  }, [dragPxPerCard, navigationEnabled, sorted, swipeUpNavTarget])

  const handleCardBodyPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const element = event.currentTarget
    if (!isCardScrollBarAreaPointer(element, event.clientX, event.clientY, event.pointerType)) {
      return
    }

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

  return (
    <div className="tm-layout">
      <section className="tm-stage" ref={containerRef}>
        <div className="tm-counter">
          {displayPosition} / {totalDisplayCount}
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
                onPointerDown={() => setSuppressSceneTransitions(true)}
                onPointerUp={() => setSuppressSceneTransitions(false)}
                onPointerCancel={() => setSuppressSceneTransitions(false)}
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
                onPointerDown={() => setSuppressSceneTransitions(true)}
                onPointerUp={() => setSuppressSceneTransitions(false)}
                onPointerCancel={() => setSuppressSceneTransitions(false)}
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
          className={`tm-scene ${sceneTransitionsSuppressed ? 'tm-scene-tuning' : ''}`}
          style={{
            perspective: `${focalLength}px`,
            perspectiveOrigin: `calc(50% + ${focusX}px) calc(53% + ${focusY}px)`,
            ['--tm-motion-duration' as string]: `${sceneMotionMs}ms`,
          }}
        >
          <div
            className="tm-world"
            style={{
              // Camera orbit stays in world space around the focused card. Do not
              // remap this through the stack axis, or the viewpoint rotates when
              // the user changes the card-line control.
              transform:
                `translate3d(0px, 0px, ${-camRadius}px)` +
                ` rotateX(${-camPhi}deg)` +
                ` rotateY(${camTheta - 90}deg)`,
            }}
          >
          {sorted.map((entry, index) => {
            const offset = index - sceneIndex
            if (Math.abs(offset) > 7) return null

            const isFocused = index === focusIndex

            // Card center stays strictly on the theta/phi line with cardGap spacing.
            const [lineX, lineY, lineZ] = cardLinePosition(offset, cardGap, lineDirection)
            // CSS uses +Y downward; scene math uses +Y upward.
            const cardWorldX = lineX
            const cardWorldY = -lineY + (isFocused ? 0 : sinkY)
            const cardWorldZ = lineZ

            const focusScale = isMobile ? 1.01 : 1.03
            const scale = isFocused
              ? focusScale
              : Math.max(minScale, 1 - Math.abs(offset) * scaleFalloff)
            const opacity = Math.max(0.1, 1 - Math.abs(offset) * opacityFalloff)
            const blur = isFocused ? 0 : Math.min(6, Math.max(0.8, Math.abs(offset) * blurFalloff))
            // Card orientation is independent from the card-line axis. The line
            // controls only where centers sit; this controls the plane itself.
            const { rotYDeg: cardRotY, rotXDeg: cardRotX } = cardRotationFromOrientation(
              cardLeftRight,
              cardFrontBack,
            )
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
                  filter: isFocused ? 'none' : `blur(${blur}px)`,
                  // Cards in front (negative offset) render above; focused floats above only cards behind.
                  zIndex: isFocused ? 100 : offset < 0 ? 100 + Math.abs(offset) : 100 - offset,
                  pointerEvents: 'auto',
                }}
                onClick={(event) => {
                  if (suppressCardClickRef.current) {
                    suppressCardClickRef.current = false
                    event.preventDefault()
                    return
                  }

                  if (!isMobile || isFocused) {
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
                <div className="tm-card-surface">
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
    cardGap: isMobile ? 112 : 97,
    lineTheta: isMobile ? -63 : -14,
    linePhi: isMobile ? 27 : 22,
    cardLeftRight: 0,
    cardFrontBack: 0,
    camTheta: isMobile ? 66 : 88,
    camPhi: isMobile ? -8 : 7,
    camRadius: isMobile ? 600 : 120,
    focusX: isMobile ? 0 : 41,
    focusY: isMobile ? 0 : 7,
    sinkY: isMobile ? 8 : 37,
    falloff: isMobile ? 0.92 : 1.4,
    falloffBalance: isMobile ? 0.56 : 0.5,
    minScale: isMobile ? 0.92 : 0.82,
  }
}

function loadTunerFontPx(isMobile: boolean): number {
  const fallback = isMobile ? TUNER_FONT_DEFAULT_MOBILE : TUNER_FONT_DEFAULT_DESKTOP
  if (typeof window === 'undefined') return fallback
  try {
    for (const key of getTunerFontStorageKeys(isMobile)) {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = parseFloat(raw)
      if (!Number.isFinite(parsed)) continue
      return Math.min(TUNER_FONT_MAX, Math.max(TUNER_FONT_MIN, parsed))
    }
    return fallback
  } catch {
    return fallback
  }
}

function getTunerFontStorageKey(isMobile: boolean): string {
  return isMobile ? TUNER_FONT_KEY_MOBILE : TUNER_FONT_KEY_DESKTOP
}

function getTunerFontStorageKeys(isMobile: boolean): readonly string[] {
  return isMobile
    ? [TUNER_FONT_KEY_MOBILE]
    : [TUNER_FONT_KEY_DESKTOP, TUNER_FONT_KEY_LEGACY]
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

function clampMagnitude(value: number, limit: number): number {
  return clamp(value, -limit, limit)
}

function gestureDeltaToCardDelta(
  deltaPx: number,
  axis: SwipeAxis,
  swipeUpNavTarget: 'previous' | 'next',
  pxPerCard: number,
): number {
  if (pxPerCard <= 0) return 0
  if (axis === 'x') return -deltaPx / pxPerCard
  const verticalSign = swipeUpNavTarget === 'previous' ? -1 : 1
  return (deltaPx * verticalSign) / pxPerCard
}

function sceneMotionDurationMs(distanceCards: number): number {
  const rounded = Math.round(distanceCards)
  return clamp(
    SCENE_MOTION_BASE_MS + rounded * SCENE_MOTION_PER_CARD_MS,
    SCENE_MOTION_BASE_MS,
    SCENE_MOTION_MAX_MS,
  )
}

function isInteractiveEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const interactiveSelector = 'input, textarea, select, [contenteditable="true"], [role="textbox"]'
  return target.closest(interactiveSelector) !== null
}

function isSwipeGestureBlockedTarget(
  target: EventTarget | null,
  point?: { clientX: number; clientY: number; pointerType: string },
): boolean {
  if (!(target instanceof HTMLElement)) return false

  const cardScroll = target.closest<HTMLElement>('.tm-card-scroll')
  if (cardScroll) {
    if (!point) return true
    return isCardScrollBarAreaPointer(
      cardScroll,
      point.clientX,
      point.clientY,
      point.pointerType,
    )
  }

  const selector =
    '.tm-gesture-tuner, input, textarea, select, [contenteditable="true"], [role="textbox"], input[type="range"]'
  return target.closest(selector) !== null
}

function isCardScrollBarAreaPointer(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  pointerType: string,
): boolean {
  const rect = element.getBoundingClientRect()
  const hitSlop =
    pointerType === 'touch' ? CARD_SCROLLBAR_TOUCH_HIT_SLOP_PX : CARD_SCROLLBAR_MOUSE_HIT_SLOP_PX
  const canScrollY = element.scrollHeight - element.clientHeight > 1
  const canScrollX = element.scrollWidth - element.clientWidth > 1
  const inVerticalGutter =
    canScrollY &&
    clientX >= rect.right - hitSlop &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  const inHorizontalGutter =
    canScrollX &&
    clientY >= rect.bottom - hitSlop &&
    clientY <= rect.bottom &&
    clientX >= rect.left &&
    clientX <= rect.right

  return inVerticalGutter || inHorizontalGutter
}
