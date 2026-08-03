import { useEffect, useState } from 'react'
import type { BranchDisposition } from '../../core/quicknote/types'
import './BranchControls.css'

interface BranchControlsProps {
  branchId: string
  parentLabel: string
  disposition: BranchDisposition | null
  recording: boolean
  returnDisabled: boolean
  onBackToSource: () => void
  onReturnAndContinue: () => Promise<void>
  onSetDisposition: (disposition: Exclude<BranchDisposition, 'handed-off'>) => Promise<string>
  onSendToSwitchboard: () => Promise<string>
}

export function BranchControls({
  branchId,
  parentLabel,
  disposition,
  recording,
  returnDisabled,
  onBackToSource,
  onReturnAndContinue,
  onSetDisposition,
  onSendToSwitchboard,
}: BranchControlsProps) {
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => setStatus(null), [branchId])

  const run = async (action: () => Promise<string>) => {
    setPending(true)
    setStatus(null)
    try {
      setStatus(await action())
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="branch-controls" aria-label="Current branch actions">
      <button className="branch-control branch-control-parent" onClick={onBackToSource} type="button">
        Back to source: {parentLabel}
      </button>
      <button
        className="branch-control branch-control-continue"
        onClick={() => void onReturnAndContinue()}
        disabled={returnDisabled}
        type="button"
      >
        Return &amp; continue
      </button>
      <span className="branch-control-status">Disposition: {disposition ?? 'open'}</span>
      <button
        className="branch-control"
        onClick={() => void run(() => onSetDisposition('retained'))}
        disabled={pending || recording}
        type="button"
      >
        Retain
      </button>
      <button
        className="branch-control"
        onClick={() => void run(() => onSetDisposition('discarded'))}
        disabled={pending || recording}
        type="button"
      >
        Discard
      </button>
      <button
        className="branch-control branch-control-handoff"
        onClick={() => void run(onSendToSwitchboard)}
        disabled={pending || recording}
        type="button"
      >
        Send to Switchboard
      </button>
      {status && <span className="branch-control-status" role="status">{status}</span>}
    </div>
  )
}
