import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceNote } from '../../core/quicknote/types'
import { findNoteIndex, orderNotes, type NoteSortMode } from '../lib/note-order'

interface TimeMachineProps {
  notes: SourceNote[]
  activeNoteId: string | null
  sortMode: NoteSortMode
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
  sortMode,
  totalCount,
  recentering,
  navigationEnabled,
  onSelect,
  onOpen,
  onBranch,
}: TimeMachineProps) {
  const sorted = useMemo(() => orderNotes(notes, sortMode), [notes, sortMode])
  const activeIndex = Math.max(0, findNoteIndex(sorted, activeNoteId))
  const containerRef = useRef<HTMLDivElement>(null)
  const wheelAccumRef = useRef(0)
  const [focusIndex, setFocusIndex] = useState(activeIndex)

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
      const target = event.target as HTMLElement | null
      if (target?.closest('.tm-card-scroll')) return

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

  return (
    <div className="tm-layout">
      <section className="tm-stage" ref={containerRef}>
        <div className="tm-counter">
          {Math.min(focusIndex + 1, totalCount || sorted.length)} / {totalCount || sorted.length}
        </div>
        <div className="tm-stage-actions">
          <span className="tm-window-status">{recentering ? 'Refreshing' : 'Live'}</span>
        </div>

        <div className="tm-scene">
          {sorted.map((entry, index) => {
            const offset = index - focusIndex
            if (Math.abs(offset) > 7) return null

            const isFocused = index === focusIndex
            const tx = offset * 132
            const ty = offset * -78
            const tz = offset * -240
            const scale = Math.max(0.36, 1 - Math.abs(offset) * 0.07)
            const opacity = Math.max(0.08, 1 - Math.abs(offset) * 0.18)
            const blur = Math.min(8, Math.abs(offset) * 1.6)

            return (
              <div
                key={entry.id}
                className={`tm-card ${isFocused ? 'tm-card-focused' : ''}`}
                role="button"
                tabIndex={0}
                style={{
                  transform: `translate3d(${tx}px, ${ty}px, ${tz}px) scale(${scale})`,
                  opacity,
                  filter: blur > 0.5 ? `blur(${blur}px)` : 'none',
                  zIndex: 100 - Math.abs(offset),
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
                    onWheel={(event) => {
                      event.stopPropagation()
                    }}
                  >
                    <p className="tm-card-preview">{entry.body || entry.preview}</p>
                  </div>
                  <span className="tm-card-meta">L{entry.startLine}-L{entry.endLine}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="tm-hint">scroll cards · arrows navigate · enter opens</div>
      </section>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
