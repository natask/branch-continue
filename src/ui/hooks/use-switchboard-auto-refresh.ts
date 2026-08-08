import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SwitchboardTaskRecord } from '../../core/intents/switchboard-task'
import {
  createSwitchboardPollingController,
  isSwitchboardPollingSupersededError,
  isSwitchboardPollingTargetEligible,
  SwitchboardPollingSupersededError,
  type SwitchboardPollingController,
  type SwitchboardPollingLifecycleEnvironment,
  type SwitchboardPollingSnapshot,
  type SwitchboardPollingTarget,
} from '../lib/switchboard-polling'

export type SwitchboardAutoRefreshState =
  | 'active'
  | 'checking'
  | 'backoff'
  | 'paused'
  | 'terminal'

export interface SwitchboardAutoRefreshResult {
  task: SwitchboardTaskRecord
  changed: boolean
}

interface UseSwitchboardAutoRefreshOptions {
  branchUid: string
  sourcePath: string
  task: SwitchboardTaskRecord | null
  enabled: boolean
  /** Performs one bounded Switchboard GET and applies it to the pinned note. */
  onAutoRefresh(
    task: SwitchboardTaskRecord,
    signal: AbortSignal,
  ): Promise<SwitchboardAutoRefreshResult>
}

interface SwitchboardAutoRefresh {
  state: SwitchboardAutoRefreshState
  /** Synchronously aborts and generation-retires the current polling cycle. */
  cancel(): void
}

/**
 * Owns the browser lifecycle around the pure GET-only polling controller.
 * Recording state is intentionally absent: only a mounted, receipt-bound
 * Switchboard status surface can create a target.
 */
export function useSwitchboardAutoRefresh({
  branchUid,
  sourcePath,
  task,
  enabled,
  onAutoRefresh,
}: UseSwitchboardAutoRefreshOptions): SwitchboardAutoRefresh {
  const initialTarget = buildPollingTarget(task, sourcePath, branchUid)
  const [state, setState] = useState<SwitchboardAutoRefreshState>(() => (
    initialTarget?.pollingTerminal
      ? 'terminal'
      : enabled && initialTarget && browserPollingAvailable() ? 'active' : 'paused'
  ))
  const controllerRef = useRef<SwitchboardPollingController | null>(null)
  const mountedRef = useRef(false)
  const enabledRef = useRef(enabled)
  const taskRef = useRef(task)
  const onAutoRefreshRef = useRef(onAutoRefresh)

  useLayoutEffect(() => {
    enabledRef.current = enabled
    taskRef.current = task
    onAutoRefreshRef.current = onAutoRefresh
  }, [enabled, onAutoRefresh, task])

  const setCurrentState = useCallback((next: SwitchboardAutoRefreshState) => {
    if (mountedRef.current) setState(next)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const lifecycle = createBrowserPollingLifecycle()
    const controller = createSwitchboardPollingController<SwitchboardAutoRefreshResult>({
      timers: {
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      lifecycle,
      fetchStatus: async (target, context) => {
        const currentTask = taskRef.current
        if (!context.isCurrent() || !currentTask || !taskMatchesTarget(currentTask, target)) {
          throw new SwitchboardPollingSupersededError()
        }
        setCurrentState('checking')
        try {
          return await onAutoRefreshRef.current(currentTask, context.signal)
        } catch (error) {
          if (context.isCurrent() && isSwitchboardPollingSupersededError(error)) {
            setCurrentState('backoff')
          }
          throw error
        }
      },
      applyStatus: (target, result, context) => {
        if (!context.isCurrent() || !taskMatchesTarget(result.task, target)) {
          throw new SwitchboardPollingSupersededError()
        }
        if (typeof result.changed !== 'boolean') {
          throw new Error('Switchboard automatic refresh returned an invalid change flag.')
        }
        const phase = result.task.projection?.phase ?? 'admitted'
        const pollingTerminal = result.task.projection?.pollingTerminal === true
        setCurrentState(pollingTerminal ? 'terminal' : result.changed ? 'active' : 'backoff')
        return { phase, pollingTerminal, changed: result.changed }
      },
      applyError: (_target, _error, context) => {
        if (context.isCurrent()) setCurrentState('backoff')
      },
    })
    controllerRef.current = controller

    const syncLifecycleState = () => {
      if (!mountedRef.current || !enabledRef.current) return
      setCurrentState(stateFromSnapshot(controller.snapshot()))
    }
    const unsubscribeState = lifecycle.subscribe(syncLifecycleState)

    return () => {
      mountedRef.current = false
      unsubscribeState()
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [setCurrentState])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    const target = enabled ? buildPollingTarget(task, sourcePath, branchUid) : null
    controller.setTarget(target)
    setCurrentState(target ? stateFromSnapshot(controller.snapshot()) : 'paused')
  }, [branchUid, enabled, setCurrentState, sourcePath, task])

  const cancel = useCallback(() => {
    controllerRef.current?.setTarget(null)
    setCurrentState('paused')
  }, [setCurrentState])

  return { state, cancel }
}

function buildPollingTarget(
  task: SwitchboardTaskRecord | null,
  sourcePath: string,
  branchUid: string,
): SwitchboardPollingTarget | null {
  if (!task) return null
  const target: SwitchboardPollingTarget = {
    taskId: task.taskId,
    sourcePath,
    noteUid: branchUid,
    admissionId: task.receipt.admissionId,
    messageId: task.receipt.messageId,
    rawIntentId: task.receipt.rawIntentId,
    sourceRecordId: task.receipt.sourceRecordId,
    phase: task.projection?.phase ?? 'admitted',
    pollingTerminal: task.projection?.pollingTerminal === true,
  }
  return isSwitchboardPollingTargetEligible(target) ? target : null
}

function taskMatchesTarget(
  task: SwitchboardTaskRecord,
  target: SwitchboardPollingTarget,
): boolean {
  return task.taskId === target.taskId
    && task.receipt.admissionId === target.admissionId
    && task.receipt.messageId === target.messageId
    && task.receipt.rawIntentId === target.rawIntentId
    && task.receipt.sourceRecordId === target.sourceRecordId
}

function stateFromSnapshot(snapshot: SwitchboardPollingSnapshot): SwitchboardAutoRefreshState {
  if (!snapshot.target) return 'paused'
  if (snapshot.target.pollingTerminal) return 'terminal'
  if (!snapshot.available) return 'paused'
  if (snapshot.inFlight) return 'checking'
  if (snapshot.consecutiveFailures > 0 || snapshot.consecutiveUnchanged > 0) return 'backoff'
  return 'active'
}

function createBrowserPollingLifecycle(): SwitchboardPollingLifecycleEnvironment {
  return {
    isVisible: browserDocumentVisible,
    isOnline: browserNavigatorOnline,
    subscribe: (onChange) => {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onChange)
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onChange)
        window.addEventListener('offline', onChange)
      }
      return () => {
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onChange)
        }
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onChange)
          window.removeEventListener('offline', onChange)
        }
      }
    },
  }
}

function browserPollingAvailable(): boolean {
  return browserDocumentVisible() && browserNavigatorOnline()
}

function browserDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function browserNavigatorOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
