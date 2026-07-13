import { useMemo, useState, type FormEvent } from 'react'
import {
  WORK_PACKET_PHASES,
  type FactoryStateSummary,
  type WorkPacket,
  type WorkPacketKind,
  type WorkPacketPhase,
  type WorkPacketStatus,
} from '../../core/factory/work-packets'

interface FactoryPanelProps {
  open: boolean
  packets: WorkPacket[]
  summary: FactoryStateSummary
  selectedPacket: WorkPacket | null
  stationStatus: {
    configured: boolean
    availability: string
    dashboardUrl: string
  }
  onClose: () => void
  onSelectPacket: (packetId: string) => void
  onCaptureIntent: (intent: string) => number
  onAdvancePacket: (packetId: string) => void
  onReset: () => void
}

export function FactoryPanel({
  open,
  packets,
  summary,
  selectedPacket,
  stationStatus,
  onClose,
  onSelectPacket,
  onCaptureIntent,
  onAdvancePacket,
  onReset,
}: FactoryPanelProps) {
  const [draft, setDraft] = useState('')
  const activePackets = useMemo(
    () => packets.filter((packet) => packet.status === 'open' || packet.status === 'running' || packet.status === 'blocked'),
    [packets],
  )
  const recallPackets = useMemo(
    () => packets.filter((packet) => packet.kind === 'drill' || packet.kind === 'knowledge' || packet.kind === 'question'),
    [packets],
  )

  if (!open) return null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const count = onCaptureIntent(draft)
    if (count > 0) setDraft('')
  }

  return (
    <aside className="factory-panel" aria-label="Software factory status">
      <div className="factory-panel-header">
        <div>
          <p className="factory-kicker">Software Factory</p>
          <h2>Ongoing Work</h2>
        </div>
        <button className="factory-close" onClick={onClose} type="button" aria-label="Close factory panel">
          x
        </button>
      </div>

      <div className="factory-summary-grid" aria-label="Factory summary">
        <FactorySummaryCell label="active" value={summary.active} />
        <FactorySummaryCell label="blocked" value={summary.blocked} />
        <FactorySummaryCell label="verified" value={summary.verified} />
        <FactorySummaryCell label="done" value={summary.done} />
      </div>

      <div className="factory-runtime">
        <span>Master Orch</span>
        <strong>{stationStatus.configured ? stationStatus.availability : 'not configured'}</strong>
        <a href={stationStatus.dashboardUrl} target="_blank" rel="noreferrer">
          Dashboard
        </a>
      </div>

      <form className="factory-capture" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Raw intent"
          rows={4}
        />
        <div className="factory-capture-actions">
          <button className="btn-secondary" onClick={onReset} type="button">
            Reset Seed
          </button>
          <button className="btn-primary" disabled={!draft.trim()} type="submit">
            Capture
          </button>
        </div>
      </form>

      <div className="factory-layout">
        <section className="factory-list" aria-label="Active factory packets">
          <div className="factory-section-title">
            <span>Current</span>
            <small>{activePackets.length} open</small>
          </div>
          {activePackets.map((packet) => (
            <button
              key={packet.id}
              className={`factory-packet-row${selectedPacket?.id === packet.id ? ' factory-packet-row--active' : ''}`}
              onClick={() => onSelectPacket(packet.id)}
              type="button"
            >
              <span className={`factory-kind factory-kind--${packet.kind}`}>{kindLabel(packet.kind)}</span>
              <strong>{packet.title}</strong>
              <em>{phaseLabel(packet.phase)} / {statusLabel(packet.status)}</em>
            </button>
          ))}
          {activePackets.length === 0 && <p className="factory-empty">No open packets.</p>}

          <div className="factory-section-title factory-section-title--recall">
            <span>Recall</span>
            <small>{recallPackets.length} items</small>
          </div>
          {recallPackets.slice(0, 4).map((packet) => (
            <button
              key={`recall-${packet.id}`}
              className={`factory-packet-row factory-packet-row--recall${selectedPacket?.id === packet.id ? ' factory-packet-row--active' : ''}`}
              onClick={() => onSelectPacket(packet.id)}
              type="button"
            >
              <span className={`factory-kind factory-kind--${packet.kind}`}>{kindLabel(packet.kind)}</span>
              <strong>{packet.title}</strong>
              <em>{packet.nextAction}</em>
            </button>
          ))}
        </section>

        <section className="factory-detail" aria-label="Selected factory packet">
          {selectedPacket ? (
            <>
              <div className="factory-detail-head">
                <span className={`factory-kind factory-kind--${selectedPacket.kind}`}>{kindLabel(selectedPacket.kind)}</span>
                <span className={`factory-status factory-status--${selectedPacket.status}`}>{statusLabel(selectedPacket.status)}</span>
              </div>
              <h3>{selectedPacket.title}</h3>
              <p>{selectedPacket.summary}</p>
              <FactoryPhaseRail phase={selectedPacket.phase} />
              <div className="factory-next">
                <span>Next</span>
                <strong>{selectedPacket.nextAction}</strong>
              </div>
              <FactoryDetailList title="Acceptance" items={selectedPacket.acceptanceCriteria} />
              <FactoryDetailList title="Verification" items={selectedPacket.verification} />
              <FactoryDetailList title="Evidence" items={selectedPacket.evidence.length > 0 ? selectedPacket.evidence : ['No evidence attached yet.']} />
              <button
                className="btn-primary factory-advance"
                onClick={() => onAdvancePacket(selectedPacket.id)}
                disabled={selectedPacket.phase === 'done'}
                type="button"
              >
                Advance Phase
              </button>
            </>
          ) : (
            <p className="factory-empty">Select a packet to inspect it.</p>
          )}
        </section>
      </div>
    </aside>
  )
}

function FactorySummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="factory-summary-cell">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function FactoryPhaseRail({ phase }: { phase: WorkPacketPhase }) {
  const currentIndex = WORK_PACKET_PHASES.indexOf(phase)
  return (
    <div className="factory-phase-rail" aria-label={`Current phase: ${phaseLabel(phase)}`}>
      {WORK_PACKET_PHASES.map((candidate, index) => (
        <span
          key={candidate}
          className={`factory-phase-dot${index <= currentIndex ? ' factory-phase-dot--active' : ''}`}
          title={phaseLabel(candidate)}
        />
      ))}
    </div>
  )
}

function FactoryDetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="factory-detail-list">
      <span>{title}</span>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function kindLabel(kind: WorkPacketKind): string {
  switch (kind) {
    case 'implementation':
      return 'Build'
    case 'workflow':
      return 'Flow'
    case 'status':
      return 'Status'
    case 'knowledge':
      return 'Know'
    case 'drill':
      return 'Drill'
    case 'question':
      return 'Ask'
    case 'decision':
      return 'Decide'
  }
}

function phaseLabel(phase: WorkPacketPhase): string {
  return phase.replace('-', ' ')
}

function statusLabel(status: WorkPacketStatus): string {
  return status
}
