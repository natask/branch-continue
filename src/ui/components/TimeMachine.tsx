// Time Machine — Apple-style 3D perspective card stack navigator

import { useState, useCallback, useEffect, useRef } from 'react'
import type { PageMeta } from '../../core/page/types'

interface TimeMachineProps {
  pages: PageMeta[]
  activePageId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const month = d.toLocaleString('en', { month: 'short' })
  const day = d.getDate()
  const time = d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${month} ${day} · ${time}`
}

export function TimeMachine({ pages, activePageId, onSelect, onClose }: TimeMachineProps) {
  // Sort: newest first (front of stack)
  const sorted = [...pages].sort((a, b) => b.createdAt - a.createdAt)

  const activeIndex = sorted.findIndex((p) => p.id === activePageId)
  const [focusIndex, setFocusIndex] = useState(activeIndex >= 0 ? activeIndex : 0)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollAccumRef = useRef(0)

  // Scroll navigation with accumulator for smooth trackpad
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      e.preventDefault()
      scrollAccumRef.current += e.deltaY

      if (Math.abs(scrollAccumRef.current) > 40) {
        const delta = scrollAccumRef.current > 0 ? 1 : -1
        setFocusIndex((prev) => Math.max(0, Math.min(sorted.length - 1, prev + delta)))
        scrollAccumRef.current = 0
      }
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [sorted.length])

  // Arrow keys + Enter navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setFocusIndex((prev) => Math.max(0, prev - 1))
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        setFocusIndex((prev) => Math.min(sorted.length - 1, prev + 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (sorted[focusIndex]) {
          onSelect(sorted[focusIndex].id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusIndex, sorted, onSelect])

  const handleCardClick = useCallback(
    (id: string, index: number) => {
      if (index === focusIndex) {
        onSelect(id)
      } else {
        setFocusIndex(index)
      }
    },
    [focusIndex, onSelect],
  )

  if (sorted.length === 0) return null

  // Placeholder "text lines" — varying widths for visual texture
  const lineWidths = [88, 94, 55, 80, 42, 91, 68, 50, 76, 38]

  return (
    <div className="tm-overlay" ref={containerRef} onClick={onClose}>
      <div className="tm-scene" onClick={(e) => e.stopPropagation()}>
        {sorted.map((page, index) => {
          const offset = index - focusIndex
          const isFocused = index === focusIndex
          const isActive = page.id === activePageId
          const isChild = !!page.parentPageId

          // Only render cards within visible range
          if (Math.abs(offset) > 7) return null

          // 3D position — diagonal recession toward top-left
          const tx = offset * -125 + (isChild ? 25 : 0)
          const ty = offset * -80
          const tz = offset * -240
          const scale = Math.max(0.35, 1 - Math.abs(offset) * 0.07)
          const opacity = Math.max(0.06, 1 - Math.abs(offset) * 0.2)
          const blur = Math.min(8, Math.abs(offset) * 1.8)

          return (
            <div
              key={page.id}
              className={`tm-card ${isFocused ? 'tm-card-focused' : ''}`}
              style={{
                transform: `translate3d(${tx}px, ${ty}px, ${tz}px) scale(${scale})`,
                opacity,
                filter: blur > 0.5 ? `blur(${blur}px)` : 'none',
                zIndex: 100 - Math.abs(offset),
              }}
              onClick={() => handleCardClick(page.id, index)}
            >
              <div className="tm-card-titlebar">
                <span className="tm-card-name">{page.title || 'Untitled'}</span>
                <span className="tm-card-date">{formatDate(page.createdAt)}</span>
              </div>
              <div className="tm-card-body">
                {isChild && <span className="tm-branch-indicator">&#8627; branch</span>}
                <div className="tm-card-lines">
                  {lineWidths.map((w, i) => (
                    <div key={i} className="tm-card-line" style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
              {isActive && <div className="tm-card-badge">current</div>}
            </div>
          )
        })}
      </div>

      <div className="tm-counter">
        {focusIndex + 1} / {sorted.length}
      </div>
      <div className="tm-hint">scroll to navigate &middot; enter to select &middot; esc to close</div>
    </div>
  )
}
