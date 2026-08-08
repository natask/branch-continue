import { useLayoutEffect, useRef, useState } from 'react'
import type { SwitchboardTaskRecord } from '../../core/intents/switchboard-task'
import type { BranchDisposition } from '../../core/quicknote/types'
import {
  useSwitchboardAutoRefresh,
  type SwitchboardAutoRefreshResult,
} from '../hooks/use-switchboard-auto-refresh'
import { SwitchboardTaskStatus } from './SwitchboardTaskStatus'
import './BranchControls.css'

type PendingAction = 'handoff' | 'refresh' | null

interface ActionStatus {
  branchId: string
  message: string
}

interface BranchControlsProps {
  branchId: string
  branchUid: string
  sourcePath: string
  parentLabel: string
  disposition: BranchDisposition | null
  recording: boolean
  returnDisabled: boolean
  onBackToSource: () => void
  onReturnAndContinue: () => Promise<void>
  onSetDisposition: (disposition: Exclude<BranchDisposition, 'handed-off'>) => Promise<string>
  onSendToSwitchboard: () => Promise<string>
  switchboardTask: SwitchboardTaskRecord | null
  autoRefreshEnabled: boolean
  onRefreshSwitchboard: () => Promise<string>
  onAutoRefreshSwitchboard: (
    task: SwitchboardTaskRecord,
    signal: AbortSignal,
  ) => Promise<SwitchboardAutoRefreshResult>
}

export function BranchControls({
  branchId,
  branchUid,
  sourcePath,
  parentLabel,
  disposition,
  recording,
  returnDisabled,
  onBackToSource,
  onReturnAndContinue,
  onSetDisposition,
  onSendToSwitchboard,
  switchboardTask,
  autoRefreshEnabled,
  onRefreshSwitchboard,
  onAutoRefreshSwitchboard,
}: BranchControlsProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [dispositionPending, setDispositionPending] = useState(false)
  const [returnPending, setReturnPending] = useState(false)
  const [status, setStatus] = useState<ActionStatus | null>(null)
  const pendingRef = useRef(false)
  const branchIdRef = useRef(branchId)

  useLayoutEffect(() => {
    branchIdRef.current = branchId
  }, [branchId])

  const pending = pendingAction !== null || dispositionPending || returnPending
  const autoRefresh = useSwitchboardAutoRefresh({
    branchUid,
    sourcePath,
    task: switchboardTask,
    enabled: autoRefreshEnabled && switchboardTask !== null && !pending,
    onAutoRefresh: onAutoRefreshSwitchboard,
  })

  const runDisposition = async (action: () => Promise<string>) => {
    if (pendingRef.current) return
    autoRefresh.cancel()
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
    autoRefresh.cancel()
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
    autoRefresh.cancel()
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

  const visibleStatus = status?.branchId === branchId ? status.message : null
  const automaticStatus = switchboardTask
    ? switchboardStatusAnnouncement(switchboardTask)
    : null

  return (
    <div className="branch-controls" role="group" aria-label="Current branch actions">
      <button
        className="branch-control branch-control-parent"
        onClick={() => {
          autoRefresh.cancel()
          onBackToSource()
        }}
        type="button"
      >
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
        disabled={pending || recording || !autoRefreshEnabled}
        type="button"
      >
        {pendingAction === 'handoff' ? 'Sending…' : 'Send to Switchboard'}
      </button>
      <span
        className="branch-control-action-status"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {visibleStatus && <span>{visibleStatus}</span>}
        {automaticStatus && (
          <span className="branch-control-auto-announcement">{automaticStatus}</span>
        )}
      </span>
      {switchboardTask && (
        <SwitchboardTaskStatus
          task={switchboardTask}
          refreshing={pendingAction === 'refresh'}
          refreshDisabled={pending || !autoRefreshEnabled}
          autoRefreshState={autoRefresh.state}
          onRefresh={() => void runSwitchboardAction('refresh', onRefreshSwitchboard)}
        />
      )}
    </div>
  )
}

function switchboardStatusAnnouncement(task: SwitchboardTaskRecord): string {
  const phase = task.projection?.phase ?? 'admitted'
  const terminal = task.projection?.pollingTerminal === true
  const refreshError = task.refreshError
    ?? (task as SwitchboardTaskRecord & { statusError?: string }).statusError
  return [
    `Switchboard task ${phase}.`,
    terminal ? 'Automatic updates stopped.' : '',
    refreshError ? `Status error: ${refreshError}` : '',
  ].filter(Boolean).join(' ')
}
