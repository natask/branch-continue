import { useRef, useState } from 'react'
import type { SwitchboardTaskRecord } from '../../core/intents/switchboard-task'
import type { BranchDisposition } from '../../core/quicknote/types'
import { SwitchboardTaskStatus } from './SwitchboardTaskStatus'
import './BranchControls.css'

type PendingAction = 'handoff' | 'refresh' | null

interface ActionStatus {
  branchId: string
  message: string
}

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
  switchboardTask: SwitchboardTaskRecord | null
  onRefreshSwitchboard: () => Promise<string>
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
  switchboardTask,
  onRefreshSwitchboard,
}: BranchControlsProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [dispositionPending, setDispositionPending] = useState(false)
  const [returnPending, setReturnPending] = useState(false)
  const [status, setStatus] = useState<ActionStatus | null>(null)
  const pendingRef = useRef(false)
  const branchIdRef = useRef(branchId)

  branchIdRef.current = branchId

  const runDisposition = async (action: () => Promise<string>) => {
    if (pendingRef.current) return
    pendingRef.current = true
    const actionBranchId = branchId
    setDispositionPending(true)
    setStatus({ branchId: actionBranchId, message: 'Saving branch disposition…' })
    try {
      const message = await action()
      if (branchIdRef.current === actionBranchId) setStatus({ branchId: actionBranchId, message })
    } catch (error) {
      if (branchIdRef.current === actionBranchId) {
        setStatus({
          branchId: actionBranchId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      pendingRef.current = false
      setDispositionPending(false)
    }
  }

  const runSwitchboardAction = async (
    kind: Exclude<PendingAction, null>,
    action: () => Promise<string>,
  ) => {
    if (pendingRef.current) return
    pendingRef.current = true
    const actionBranchId = branchId
    setPendingAction(kind)
    setStatus({
      branchId: actionBranchId,
      message: kind === 'handoff' ? 'Sending branch to Switchboard…' : 'Refreshing Switchboard status…',
    })
    try {
      const message = await action()
      if (branchIdRef.current === actionBranchId) setStatus({ branchId: actionBranchId, message })
    } catch (error) {
      if (branchIdRef.current === actionBranchId) {
        setStatus({
          branchId: actionBranchId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      pendingRef.current = false
      setPendingAction(null)
    }
  }

  const runReturnAndContinue = async () => {
    if (pendingRef.current) return
    pendingRef.current = true
    const actionBranchId = branchId
    setReturnPending(true)
    setStatus({ branchId: actionBranchId, message: 'Returning to the source note…' })
    try {
      await onReturnAndContinue()
      if (branchIdRef.current === actionBranchId) setStatus(null)
    } catch (error) {
      if (branchIdRef.current === actionBranchId) {
        setStatus({
          branchId: actionBranchId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      pendingRef.current = false
      setReturnPending(false)
    }
  }

  const pending = pendingAction !== null || dispositionPending || returnPending
  const visibleStatus = status?.branchId === branchId ? status.message : null

  return (
    <div className="branch-controls" role="group" aria-label="Current branch actions">
      <button className="branch-control branch-control-parent" onClick={onBackToSource} type="button">
        Back to source: {parentLabel}
      </button>
      <button
        className="branch-control branch-control-continue"
        onClick={() => void runReturnAndContinue()}
        disabled={returnDisabled || pending}
        type="button"
      >
        {returnPending ? 'Returning…' : 'Return & continue'}
      </button>
      <span className="branch-control-status">Disposition: {disposition ?? 'open'}</span>
      <button
        className="branch-control"
        onClick={() => void runDisposition(() => onSetDisposition('retained'))}
        disabled={pending || recording}
        type="button"
      >
        Retain
      </button>
      <button
        className="branch-control"
        onClick={() => void runDisposition(() => onSetDisposition('discarded'))}
        disabled={pending || recording}
        type="button"
      >
        Discard
      </button>
      <button
        className="branch-control branch-control-handoff"
        onClick={() => void runSwitchboardAction('handoff', onSendToSwitchboard)}
        disabled={pending || recording}
        type="button"
      >
        {pendingAction === 'handoff' ? 'Sending…' : 'Send to Switchboard'}
      </button>
      <span
        className="branch-control-action-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {visibleStatus ?? ''}
      </span>
      {switchboardTask && (
        <SwitchboardTaskStatus
          task={switchboardTask}
          refreshing={pendingAction === 'refresh'}
          refreshDisabled={pending}
          onRefresh={() => void runSwitchboardAction('refresh', onRefreshSwitchboard)}
        />
      )}
    </div>
  )
}
