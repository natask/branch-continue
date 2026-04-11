import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useControls, folder } from 'leva'
import type { SourceNote } from '../../core/quicknote/types'
import { findNoteIndex, orderNotes } from '../lib/note-order'

interface TimeMachineProps {
  notes: SourceNote[]
  activeNoteId: string | null
  totalCount: number
  recentering: boolean
  navigationEnabled: boolean
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
  onSelect,
  onOpen,
  onBranch,
}: TimeMachineProps) {
  const sorted = useMemo(() => orderNotes(notes).reverse(), [notes])
  const activeIndex = Math.max(0, findNoteIndex(sorted, activeNoteId))
  const containerRef = useRef<HTMLDivElement>(null)
  const wheelAccumRef = useRef(0)
  const touchRef = useRef<{
    startX: number
    startY: number
    startTime: number
    locked: 'x' | 'y' | null
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
  const [focusIndex, setFocusIndex] = useState(activeIndex)

  const {
    spreadAngle, spreadDistance,
    liftAngle, liftDistance, focusScale, sinkY,
    falloff, falloffBalance, minScale,
  } = useControls('Card Stack', {
    Spread: folder({
      spreadAngle: { value: -30, min: -90, max: 90, step: 1, label: 'Angle (°)' },
      spreadDistance: { value: 153, min: 20, max: 400, step: 1, label: 'Distance' },
    }),
    'Focused Lift': folder({
      liftAngle: { value: -53, min: -180, max: 180, step: 1, label: 'Angle (°)' },
      liftDistance: { value: 80, min: 0, max: 300, step: 1, label: 'Distance' },
      focusScale: { value: 1.04, min: 0.5, max: 1.5, step: 0.01, label: 'Scale' },
    }),
    'Pile Sink': folder({
      sinkY: { value: 32, min: -100, max: 200, step: 1, label: 'Push Down' },
    }),
    Falloff: folder({
      falloff: { value: 1.0, min: 0, max: 3, step: 0.05, label: 'Intensity' },
      falloffBalance: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Blur vs Fade' },
      minScale: { value: 0.85, min: 0.3, max: 1.0, step: 0.01, label: 'Min Scale' },
    }),
  })

  // Derive coupled values from polar controls
  const spreadRad = (spreadAngle * Math.PI) / 180
  const spreadX = Math.cos(spreadRad) * spreadDistance
  const spreadY = Math.sin(spreadRad) * spreadDistance

  const liftRad = (liftAngle * Math.PI) / 180
  const liftX = Math.cos(liftRad) * liftDistance
  const liftY = Math.sin(liftRad) * liftDistance

  // Single falloff intensity drives all three, balance shifts weight between blur and opacity
  const scaleFalloff = 0.07 * falloff
  const opacityFalloff = 0.18 * falloff * (1 - falloffBalance * 0.5)
  const blurFalloff = 1.6 * falloff * (0.5 + falloffBalance)

  const focusNote = (index: number) => {
    const nextIndex = clamp(index, 0, sorted.length - 1)
    const nextNote = sorted[nextIndex]
    if (!nextNote) return
    setFocusIndex(nextIndex)
    onSelect(nextNote)
  }

  useEffect(() => {
    setFocusIndex(activeIndex)
  }, [activeIndex])

  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const handler = (event: WheelEvent) => {
      const target = event.target
      const cardScroll =
        target instanceof HTMLElement ? target.closest('.tm-card-scroll') as HTMLDivElement | null : null

      if (cardScroll && element.contains(cardScroll) && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        cardScroll.scrollTop += event.deltaY
        cardScroll.scrollLeft += event.deltaX
        return
      }

      event.preventDefault()

      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      wheelAccumRef.current += delta

      if (Math.abs(wheelAccumRef.current) < 40) return

      const direction = wheelAccumRef.current > 0 ? 1 : -1
      wheelAccumRef.current = 0
      focusNote(focusIndex + direction)
    }

    element.addEventListener('wheel', handler, { passive: false })
    return () => element.removeEventListener('wheel', handler)
  }, [focusIndex, navigationEnabled, onSelect, sorted])

  // Touch swipe navigation for mobile
  useEffect(() => {
    const element = containerRef.current
    if (!element || !navigationEnabled) return

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      // Ignore touches inside scrollable card body
      const target = e.target
      if (target instanceof HTMLElement && target.closest('.tm-card-scroll')) return
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        locked: null,
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const state = touchRef.current
      const touch = e.touches[0]
      if (!state || !touch) return

      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY

      // Lock axis after 8px of movement
      if (!state.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        state.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }

      // Prevent page scroll when swiping horizontally through cards
      if (state.locked === 'x') {
        e.preventDefault()
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      const state = touchRef.current
      touchRef.current = null
      if (!state) return

      const touch = e.changedTouches[0]
      if (!touch) return

      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY
      const elapsed = Date.now() - state.startTime

      // Use the dominant axis; require minimum 30px swipe within 500ms
      const dominant = Math.abs(dx) > Math.abs(dy) ? dx : -dy
      if (Math.abs(dominant) < 30 || elapsed > 500) return

      const direction = dominant < 0 ? 1 : -1
      focusNote(focusIndex + direction)
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
    }
  }, [focusIndex, navigationEnabled, onSelect, sorted])

  const handleCardBodyPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

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

        <div className="tm-scene" style={{ perspective: 'none' }}>
          {sorted.map((entry, index) => {
            const offset = index - focusIndex
            if (Math.abs(offset) > 7) return null

            const isFocused = index === focusIndex

            // Pile positions: cards collapse inward where the focused card was
            // sign: -1 for cards before focus, +1 for cards after
            const collapseGap = isFocused ? 0 : Math.sign(offset) * -0.35
            const effectiveOffset = offset + collapseGap

            const tx = effectiveOffset * spreadX + (isFocused ? liftX : 0)
            const ty = effectiveOffset * spreadY + (isFocused ? liftY : sinkY)
            const scale = isFocused
              ? focusScale
              : Math.max(minScale, 1 - Math.abs(offset) * scaleFalloff)
            const opacity = Math.max(0.08, 1 - Math.abs(offset) * opacityFalloff)
            const blur = Math.min(8, Math.abs(offset) * blurFalloff)

            return (
              <div
                key={entry.id}
                className={`tm-card ${isFocused ? 'tm-card-focused' : ''}`}
                role="button"
                tabIndex={0}
                style={{
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                  opacity,
                  filter: blur > 0.5 ? `blur(${blur}px)` : 'none',
                  // Cards in front (offset > 0) stack above focused; cards behind stack below
                  // Cards in front (negative offset) render above; focused floats above only the cards behind it
                  zIndex: isFocused ? 100 : offset < 0 ? 100 + Math.abs(offset) : 100 - offset,
                  pointerEvents: offset < 0 ? 'none' : 'auto',
                }}
                onClick={() => {
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
                  <span className="tm-card-meta">L{entry.startLine}-L{entry.endLine}</span>
                </div>
              </div>
            )
          })}
        </div>

      </section>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
