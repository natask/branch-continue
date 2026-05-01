import { useMemo } from 'react'
import {
  CardStack3D,
  type CardStackRenderState,
} from '@natnaelkahssay/card-stack-3d'
import type { SourceNote } from '../../core/quicknote/types'
import { orderNotes } from '../lib/note-order'

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

  return (
    <CardStack3D<SourceNote>
      items={sorted}
      activeId={activeNoteId}
      totalCount={totalCount}
      navigationEnabled={navigationEnabled}
      swipeUpNavTarget={swipeUpNavTarget}
      wheelNavDirection={wheelNavDirection}
      isMobile={isMobile}
      showGestureTuner={showGestureTuner}
      storageKeyPrefix="branch-continue:stack-controls:v4"
      tunerFontStorageKeyPrefix="branch-continue:tuner-font-px"
      empty={
        <div className="tm-empty">
          <p>No notes yet. Capture something to start the stack.</p>
        </div>
      }
      onSelect={onSelect}
      onOpen={onOpen}
      onBranch={onBranch}
      renderCard={renderSourceNoteCard}
    />
  )
}

function renderSourceNoteCard(entry: SourceNote, state: CardStackRenderState) {
  return (
    <>
      {entry.title && (
        <div className="tm-card-titlebar">
          <span className="tm-card-name">{entry.title}</span>
          {entry.timestamp && <span className="tm-card-date">{entry.timestamp}</span>}
        </div>
      )}

      <div className="tm-card-body">
        <div {...state.scrollProps}>
          <p className="tm-card-preview">{entry.body || entry.preview}</p>
        </div>
        <span className="tm-card-meta">
          L{entry.startLine}-L{entry.endLine}
          {entry.parentNoteId ? ' • branched' : ''}
        </span>
      </div>
    </>
  )
}
