import type { SwitchboardTaskPhase } from '../../core/intents/switchboard-task'

export const DEFAULT_SWITCHBOARD_POLLING_POLICY: SwitchboardPollingPolicy = {
  initialDelayMs: 1_000,
  successDelayMs: 2_000,
  failureBackoffBaseMs: 2_000,
  maxBackoffMs: 30_000,
  resumeDelayMs: 0,
}

export interface SwitchboardPollingPolicy {
  initialDelayMs: number
  successDelayMs: number
  failureBackoffBaseMs: number
  maxBackoffMs: number
  resumeDelayMs: number
}

/**
 * A target can only be built from a binding-validated, durably persisted
 * admission receipt. `noteUid` names the active status surface; exact equality
 * with `sourceRecordId` prevents a copied receipt from polling for another note.
 */
export interface SwitchboardPollingTarget {
  taskId: string
  sourcePath: string
  noteUid: string
  admissionId: string
  messageId: string
  rawIntentId: string
  sourceRecordId: string
  phase: SwitchboardTaskPhase
  /** Derived from every untruncated intent row, never from aggregate phase alone. */
  pollingTerminal: boolean
}

export interface SwitchboardPollingAppliedStatus {
  phase: SwitchboardTaskPhase
  pollingTerminal: boolean
  /** True only when the durable projection contains meaningful new progress. */
  changed: boolean
}

const SWITCHBOARD_POLLING_SUPERSEDED_CODE = 'branch-continue:switchboard-polling-superseded'

/** Throw only when an observation lost ownership without becoming a status error. */
export class SwitchboardPollingSupersededError extends Error {
  readonly code = SWITCHBOARD_POLLING_SUPERSEDED_CODE

  constructor(message = 'The Switchboard observation was superseded.') {
    super(message)
    this.name = 'SwitchboardPollingSupersededError'
  }
}

export interface SwitchboardPollingTimerEnvironment {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

/** The application adapter owns all window/document event wiring. */
export interface SwitchboardPollingLifecycleEnvironment {
  isVisible(): boolean
  isOnline(): boolean
  subscribe(onChange: () => void): () => void
}

export interface SwitchboardPollingAttemptContext {
  generation: number
  signal: AbortSignal
  isCurrent(): boolean
}

export interface SwitchboardPollingDependencies<TObservation> {
  timers: SwitchboardPollingTimerEnvironment
  lifecycle: SwitchboardPollingLifecycleEnvironment
  /** This callback must perform the bounded GET-only status lookup. */
  fetchStatus(
    target: SwitchboardPollingTarget,
    context: SwitchboardPollingAttemptContext,
  ): Promise<TObservation>
  /** Called only after the lookup passes the current target/generation fence. */
  applyStatus(
    target: SwitchboardPollingTarget,
    observation: TObservation,
    context: SwitchboardPollingAttemptContext,
  ): SwitchboardPollingAppliedStatus | Promise<SwitchboardPollingAppliedStatus>
  /** Called only for a current failure; stale and cancelled failures are ignored. */
  applyError?(
    target: SwitchboardPollingTarget,
    error: unknown,
    context: SwitchboardPollingAttemptContext,
  ): void | Promise<void>
  policy?: Partial<SwitchboardPollingPolicy>
}

export type SwitchboardPollingOutcome =
  | {
      status: 'applied'
      phase: SwitchboardTaskPhase
      pollingTerminal: boolean
      changed: boolean
    }
  | { status: 'failed'; error: unknown; applyError?: unknown }
  | { status: 'superseded' }
  | { status: 'paused' }
  | { status: 'ineligible' }
  | { status: 'terminal'; phase: SwitchboardTaskPhase }
  | { status: 'disposed' }

export interface SwitchboardPollingSnapshot {
  available: boolean
  consecutiveFailures: number
  consecutiveUnchanged: number
  disposed: boolean
  generation: number
  inFlight: boolean
  nextDelayMs: number | null
  target: SwitchboardPollingTarget | null
}

export interface SwitchboardPollingController {
  /** Pass null when the owning note/status surface is no longer active. */
  setTarget(target: SwitchboardPollingTarget | null): void
  /** Coalesces with a current lookup and remains available for terminal tasks. */
  refreshNow(): Promise<SwitchboardPollingOutcome>
  snapshot(): SwitchboardPollingSnapshot
  dispose(): void
}

interface ActiveAttempt {
  abortController: AbortController
  generation: number
  promise: Promise<SwitchboardPollingOutcome>
  targetKey: string
}

/**
 * Creates a single-target polling controller without accessing the DOM.
 * Visibility, connectivity, timers, GET lookup, and persistence are injected
 * so lifecycle and race behavior can be tested deterministically.
 */
export function createSwitchboardPollingController<TObservation>(
  dependencies: SwitchboardPollingDependencies<TObservation>,
): SwitchboardPollingController {
  const policy = normalizePolicy(dependencies.policy)
  let available = readAvailability(dependencies.lifecycle)
  let target: SwitchboardPollingTarget | null = null
  let targetKey: string | null = null
  let generation = 0
  let consecutiveFailures = 0
  let consecutiveUnchanged = 0
  let disposed = false
  let activeAttempt: ActiveAttempt | null = null
  let timerHandle: unknown
  let timerScheduled = false
  let nextDelayMs: number | null = null

  const clearScheduledTimer = () => {
    if (timerScheduled) dependencies.timers.clearTimeout(timerHandle)
    timerHandle = undefined
    timerScheduled = false
    nextDelayMs = null
  }

  const invalidateCycle = (resetBackoff: boolean) => {
    generation += 1
    clearScheduledTimer()
    activeAttempt?.abortController.abort()
    activeAttempt = null
    if (resetBackoff) {
      consecutiveFailures = 0
      consecutiveUnchanged = 0
    }
  }

  const isAttemptCurrent = (
    attemptGeneration: number,
    attemptTargetKey: string,
    signal: AbortSignal,
  ): boolean => (
    !disposed
    && !signal.aborted
    && generation === attemptGeneration
    && targetKey === attemptTargetKey
  )

  const schedule = (delayMs: number) => {
    clearScheduledTimer()
    if (
      disposed
      || !available
      || !target
      || !isSwitchboardPollingTargetEligible(target)
      || target.pollingTerminal
    ) return

    const scheduledGeneration = generation
    const scheduledTargetKey = targetKey
    nextDelayMs = delayMs
    timerScheduled = true
    timerHandle = dependencies.timers.setTimeout(() => {
      timerHandle = undefined
      timerScheduled = false
      nextDelayMs = null
      if (
        disposed
        || !available
        || generation !== scheduledGeneration
        || targetKey !== scheduledTargetKey
      ) return
      void startAttempt(false)
    }, delayMs)
  }

  const finishAttempt = (
    attemptGeneration: number,
    attemptTargetKey: string,
  ) => {
    if (
      activeAttempt?.generation === attemptGeneration
      && activeAttempt.targetKey === attemptTargetKey
    ) {
      activeAttempt = null
    }
  }

  const performAttempt = async (
    attemptTarget: SwitchboardPollingTarget,
    attemptTargetKey: string,
    attemptGeneration: number,
    abortController: AbortController,
  ): Promise<SwitchboardPollingOutcome> => {
    const context: SwitchboardPollingAttemptContext = {
      generation: attemptGeneration,
      signal: abortController.signal,
      isCurrent: () => isAttemptCurrent(
        attemptGeneration,
        attemptTargetKey,
        abortController.signal,
      ),
    }

    try {
      const observation = await dependencies.fetchStatus(attemptTarget, context)
      if (!context.isCurrent()) return { status: 'superseded' }

      const appliedStatus = await dependencies.applyStatus(attemptTarget, observation, context)
      if (!context.isCurrent()) return { status: 'superseded' }

      if (target && targetKey === attemptTargetKey) {
        target = {
          ...target,
          phase: appliedStatus.phase,
          pollingTerminal: appliedStatus.pollingTerminal,
        }
      }
      // A successful GET proves transport recovery even when Switchboard has
      // no new semantic progress. Keep the no-progress cadence independent
      // from the failure backoff so the next real error starts at its base.
      consecutiveFailures = 0
      if (appliedStatus.changed) {
        consecutiveUnchanged = 0
      } else {
        consecutiveUnchanged += 1
      }
      if (!appliedStatus.pollingTerminal) {
        schedule(appliedStatus.changed
          ? policy.successDelayMs
          : switchboardPollingUnchangedBackoffMs(consecutiveUnchanged, policy))
      }
      return { status: 'applied', ...appliedStatus }
    } catch (error) {
      if (!context.isCurrent()) {
        return { status: 'superseded' }
      }
      if (isSwitchboardPollingSupersededError(error)) {
        // A committed target can briefly outrun its React adapter refs. Retry
        // without treating that ownership fence as a transport failure. A real
        // navigation/disposal has already invalidated the context above.
        schedule(policy.successDelayMs)
        return { status: 'superseded' }
      }

      let applyError: unknown
      try {
        await dependencies.applyError?.(attemptTarget, error, context)
      } catch (failure) {
        applyError = failure
      }
      if (!context.isCurrent()) return { status: 'superseded' }

      consecutiveFailures += 1
      consecutiveUnchanged = 0
      schedule(switchboardPollingBackoffMs(consecutiveFailures, policy))
      return applyError === undefined
        ? { status: 'failed', error }
        : { status: 'failed', error, applyError }
    }
  }

  const startAttempt = (allowTerminal: boolean): Promise<SwitchboardPollingOutcome> => {
    if (disposed) return Promise.resolve({ status: 'disposed' })
    if (!target || !targetKey || !isSwitchboardPollingTargetEligible(target)) {
      return Promise.resolve({ status: 'ineligible' })
    }
    if (!available) return Promise.resolve({ status: 'paused' })
    if (!allowTerminal && target.pollingTerminal) {
      return Promise.resolve({ status: 'terminal', phase: target.phase })
    }
    if (
      activeAttempt
      && activeAttempt.generation === generation
      && activeAttempt.targetKey === targetKey
    ) return activeAttempt.promise

    clearScheduledTimer()
    const attemptTarget = { ...target }
    const attemptTargetKey = targetKey
    const attemptGeneration = generation
    const abortController = new AbortController()
    const promise = performAttempt(
      attemptTarget,
      attemptTargetKey,
      attemptGeneration,
      abortController,
    )
    activeAttempt = {
      abortController,
      generation: attemptGeneration,
      promise,
      targetKey: attemptTargetKey,
    }
    void promise.finally(() => finishAttempt(attemptGeneration, attemptTargetKey))
    return promise
  }

  const setTarget = (nextTarget: SwitchboardPollingTarget | null) => {
    if (disposed) return
    const next = nextTarget ? { ...nextTarget } : null
    const nextKey = next ? pollingTargetKey(next) : null
    const sameTarget = nextKey !== null && nextKey === targetKey

    if (!sameTarget) {
      invalidateCycle(true)
      target = next
      targetKey = nextKey
      if (
        target
        && available
        && isSwitchboardPollingTargetEligible(target)
        && !target.pollingTerminal
      ) schedule(policy.initialDelayMs)
      return
    }

    const wasAutomaticallyRunnable = Boolean(
      target
      && isSwitchboardPollingTargetEligible(target)
      && !target.pollingTerminal,
    )
    target = next
    const automaticallyRunnable = Boolean(
      target
      && isSwitchboardPollingTargetEligible(target)
      && !target.pollingTerminal,
    )
    if (wasAutomaticallyRunnable && !automaticallyRunnable) {
      invalidateCycle(false)
    } else if (!wasAutomaticallyRunnable && automaticallyRunnable && available) {
      invalidateCycle(false)
      schedule(policy.initialDelayMs)
    }
  }

  const handleLifecycleChange = () => {
    if (disposed) return
    const nextAvailable = readAvailability(dependencies.lifecycle)
    if (nextAvailable === available) return
    available = nextAvailable
    if (!available) {
      invalidateCycle(false)
      return
    }
    if (
      target
      && isSwitchboardPollingTargetEligible(target)
      && !target.pollingTerminal
    ) schedule(policy.resumeDelayMs)
  }

  const unsubscribe = dependencies.lifecycle.subscribe(handleLifecycleChange)

  return {
    setTarget,
    refreshNow: () => startAttempt(true),
    snapshot: () => ({
      available,
      consecutiveFailures,
      consecutiveUnchanged,
      disposed,
      generation,
      inFlight: Boolean(activeAttempt),
      nextDelayMs,
      target: target ? { ...target } : null,
    }),
    dispose: () => {
      if (disposed) return
      disposed = true
      invalidateCycle(false)
      target = null
      targetKey = null
      unsubscribe()
    },
  }
}

export function isSwitchboardPollingTargetEligible(target: SwitchboardPollingTarget): boolean {
  return Boolean(
    target.taskId.trim()
    && target.sourcePath.trim()
    && target.noteUid.trim()
    && target.admissionId.trim()
    && target.messageId.trim()
    && target.rawIntentId.trim()
    && target.sourceRecordId.trim()
    && target.noteUid === target.sourceRecordId,
  )
}

export function isSwitchboardPollingSupersededError(
  error: unknown,
): error is SwitchboardPollingSupersededError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === SWITCHBOARD_POLLING_SUPERSEDED_CODE,
  )
}

export function switchboardPollingBackoffMs(
  consecutiveFailures: number,
  policy: SwitchboardPollingPolicy = DEFAULT_SWITCHBOARD_POLLING_POLICY,
): number {
  const normalized = normalizePolicy(policy)
  return boundedExponentialDelay(
    consecutiveFailures,
    normalized.failureBackoffBaseMs,
    normalized.maxBackoffMs,
  )
}

export function switchboardPollingUnchangedBackoffMs(
  consecutiveUnchanged: number,
  policy: SwitchboardPollingPolicy = DEFAULT_SWITCHBOARD_POLLING_POLICY,
): number {
  const normalized = normalizePolicy(policy)
  return boundedExponentialDelay(
    consecutiveUnchanged,
    normalized.successDelayMs,
    normalized.maxBackoffMs,
  )
}

function pollingTargetKey(target: SwitchboardPollingTarget): string {
  return [
    target.taskId,
    target.sourcePath,
    target.noteUid,
    target.admissionId,
    target.messageId,
    target.rawIntentId,
    target.sourceRecordId,
  ].join('\u001f')
}

function readAvailability(lifecycle: SwitchboardPollingLifecycleEnvironment): boolean {
  return lifecycle.isVisible() && lifecycle.isOnline()
}

function boundedExponentialDelay(count: number, baseMs: number, maximumMs: number): number {
  const normalizedCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
  const exponent = Math.min(52, normalizedCount - 1)
  return Math.min(maximumMs, baseMs * (2 ** exponent))
}

function normalizePolicy(
  policy: Partial<SwitchboardPollingPolicy> | SwitchboardPollingPolicy | undefined,
): SwitchboardPollingPolicy {
  const normalized = { ...DEFAULT_SWITCHBOARD_POLLING_POLICY, ...policy }
  for (const [field, value] of Object.entries(normalized)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Switchboard polling ${field} must be a non-negative finite number.`)
    }
  }
  if (normalized.failureBackoffBaseMs <= 0) {
    throw new Error('Switchboard polling failureBackoffBaseMs must be positive.')
  }
  if (normalized.successDelayMs <= 0) {
    throw new Error('Switchboard polling successDelayMs must be positive.')
  }
  if (normalized.maxBackoffMs < Math.max(
    normalized.failureBackoffBaseMs,
    normalized.successDelayMs,
  )) {
    throw new Error('Switchboard polling maxBackoffMs must not be below its retry bases.')
  }
  return normalized
}
