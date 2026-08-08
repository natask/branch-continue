import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applySwitchboardTaskResponse,
  createSwitchboardTaskFromAdmission,
  type SwitchboardTaskPhase,
  type SwitchboardTaskRecord,
} from '../src/core/intents/switchboard-task'
import {
  createSwitchboardPollingController,
  isSwitchboardPollingTargetEligible,
  SwitchboardPollingSupersededError,
  switchboardPollingBackoffMs,
  switchboardPollingUnchangedBackoffMs,
  type SwitchboardPollingAppliedStatus,
  type SwitchboardPollingLifecycleEnvironment,
  type SwitchboardPollingPolicy,
  type SwitchboardPollingTarget,
  type SwitchboardPollingTimerEnvironment,
} from '../src/ui/lib/switchboard-polling'

const POLICY: SwitchboardPollingPolicy = {
  initialDelayMs: 10,
  successDelayMs: 20,
  failureBackoffBaseMs: 30,
  maxBackoffMs: 100,
  resumeDelayMs: 0,
}

const timers: SwitchboardPollingTimerEnvironment = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

interface MutableLifecycle {
  environment: SwitchboardPollingLifecycleEnvironment
  listenerCount(): number
  setOnline(value: boolean): void
  setVisible(value: boolean): void
  notify(): void
}

function createLifecycle(visible = true, online = true): MutableLifecycle {
  let currentVisible = visible
  let currentOnline = online
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    environment: {
      isVisible: () => currentVisible,
      isOnline: () => currentOnline,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    listenerCount: () => listeners.size,
    setOnline: (value) => {
      currentOnline = value
      notify()
    },
    setVisible: (value) => {
      currentVisible = value
      notify()
    },
    notify,
  }
}

function target(
  suffix = '1',
  phase: SwitchboardTaskPhase = 'admitted',
  overrides: Partial<SwitchboardPollingTarget> = {},
): SwitchboardPollingTarget {
  return {
    taskId: `switchboard-${suffix}`,
    sourcePath: '/notes/quicknote.org',
    noteUid: `note-${suffix}`,
    admissionId: `admission-${suffix}`,
    messageId: `message-${suffix}`,
    rawIntentId: `raw-${suffix}`,
    sourceRecordId: `note-${suffix}`,
    phase,
    pollingTerminal: false,
    ...overrides,
  }
}

function applied(
  phase: SwitchboardTaskPhase,
  pollingTerminal = false,
  changed = true,
): SwitchboardPollingAppliedStatus {
  return { phase, pollingTerminal, changed }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Switchboard polling policy', () => {
  it('requires a complete durable receipt owned by the active stable UID', () => {
    expect(isSwitchboardPollingTargetEligible(target())).toBe(true)
    expect(isSwitchboardPollingTargetEligible(target('1', 'admitted', {
      noteUid: 'copied-note',
    }))).toBe(false)
    expect(isSwitchboardPollingTargetEligible(target('1', 'admitted', {
      admissionId: '',
    }))).toBe(false)
    expect(isSwitchboardPollingTargetEligible(target('1', 'admitted', {
      sourcePath: '',
    }))).toBe(false)
  })

  it('bounds exponential failure delays', () => {
    expect(switchboardPollingBackoffMs(1, POLICY)).toBe(30)
    expect(switchboardPollingBackoffMs(2, POLICY)).toBe(60)
    expect(switchboardPollingBackoffMs(3, POLICY)).toBe(100)
    expect(switchboardPollingBackoffMs(20, POLICY)).toBe(100)
    expect(switchboardPollingUnchangedBackoffMs(1, POLICY)).toBe(20)
    expect(switchboardPollingUnchangedBackoffMs(2, POLICY)).toBe(40)
    expect(switchboardPollingUnchangedBackoffMs(3, POLICY)).toBe(80)
    expect(switchboardPollingUnchangedBackoffMs(4, POLICY)).toBe(100)
  })
})

describe('Switchboard polling controller', () => {
  it('starts only for an active, owned, nonterminal durable receipt', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn(async () => 'running' as SwitchboardTaskPhase)
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      policy: POLICY,
    })

    controller.setTarget(target('copied', 'admitted', { noteUid: 'another-note' }))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchStatus).not.toHaveBeenCalled()

    controller.setTarget(null)
    controller.setTarget(target('terminal', 'completed', { pollingTerminal: true }))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchStatus).not.toHaveBeenCalled()

    controller.setTarget(target('owned'))
    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs - 1)
    expect(fetchStatus).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(applyStatus).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  it('resets failure backoff after any successful observation', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValue('running' as SwitchboardTaskPhase)
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase, false, false))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 1,
      nextDelayMs: POLICY.failureBackoffBaseMs,
    })
    expect(applyError).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLICY.failureBackoffBaseMs)
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 0,
      consecutiveUnchanged: 1,
      nextDelayMs: POLICY.successDelayMs,
    })
    await vi.advanceTimersByTimeAsync(POLICY.successDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(3)

    controller.dispose()
  })

  it('applies exact bounded exponential backoff over repeated failures', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn(async () => {
      throw new Error('offline')
    })
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async () => applied('running'),
      policy: POLICY,
    })
    controller.setTarget(target())

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(controller.snapshot().nextDelayMs).toBe(30)
    await vi.advanceTimersByTimeAsync(30)
    expect(controller.snapshot().nextDelayMs).toBe(60)
    await vi.advanceTimersByTimeAsync(60)
    expect(controller.snapshot().nextDelayMs).toBe(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(controller.snapshot().nextDelayMs).toBe(100)
    expect(fetchStatus).toHaveBeenCalledTimes(4)

    controller.dispose()
  })

  it('backs off unchanged successful observations and resets only on meaningful progress', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(applied('verifying', false, false))
      .mockResolvedValueOnce(applied('verifying', false, false))
      .mockResolvedValueOnce(applied('verifying', false, false))
      .mockResolvedValueOnce(applied('verifying', false, false))
      .mockResolvedValueOnce(applied('running', false, true))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async (_target, status) => status,
      policy: POLICY,
    })
    controller.setTarget(target())

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(controller.snapshot()).toMatchObject({
      consecutiveUnchanged: 1,
      nextDelayMs: 20,
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(controller.snapshot()).toMatchObject({
      consecutiveUnchanged: 2,
      nextDelayMs: 40,
    })
    await vi.advanceTimersByTimeAsync(40)
    expect(controller.snapshot()).toMatchObject({
      consecutiveUnchanged: 3,
      nextDelayMs: 80,
    })
    await vi.advanceTimersByTimeAsync(80)
    expect(controller.snapshot()).toMatchObject({
      consecutiveUnchanged: 4,
      nextDelayMs: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 0,
      consecutiveUnchanged: 0,
      nextDelayMs: POLICY.successDelayMs,
      target: { phase: 'running' },
    })
    expect(fetchStatus).toHaveBeenCalledTimes(5)

    controller.dispose()
  })

  it('restarts independent unchanged and failure backoffs when observation kind changes', async () => {
    const lifecycle = createLifecycle()
    const transportFailure = new Error('temporary transport failure')
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(applied('verifying', false, false))
      .mockRejectedValueOnce(transportFailure)
      .mockResolvedValueOnce(applied('verifying', false, false))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async (_target, status) => status,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 0,
      consecutiveUnchanged: 1,
      nextDelayMs: POLICY.successDelayMs,
    })

    await vi.advanceTimersByTimeAsync(POLICY.successDelayMs)
    expect(applyError).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'switchboard-1' }),
      transportFailure,
      expect.objectContaining({ generation: expect.any(Number) }),
    )
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 1,
      consecutiveUnchanged: 0,
      nextDelayMs: POLICY.failureBackoffBaseMs,
    })

    await vi.advanceTimersByTimeAsync(POLICY.failureBackoffBaseMs)
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 0,
      consecutiveUnchanged: 1,
      nextDelayMs: POLICY.successDelayMs,
    })
    expect(fetchStatus).toHaveBeenCalledTimes(3)

    controller.dispose()
  })

  it('pauses while hidden and resumes when visibility returns while still online', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn(async () => 'running' as SwitchboardTaskPhase)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async (_target, phase) => applied(phase),
      policy: POLICY,
    })
    controller.setTarget(target())
    expect(lifecycle.listenerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(5)
    lifecycle.setVisible(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStatus).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ available: false, nextDelayMs: null })

    lifecycle.setVisible(true)
    await vi.advanceTimersByTimeAsync(POLICY.resumeDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    controller.dispose()
    expect(lifecycle.listenerCount()).toBe(0)
  })

  it('pauses while offline and resumes when connectivity returns while still visible', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn(async () => 'running' as SwitchboardTaskPhase)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async (_target, phase) => applied(phase),
      policy: POLICY,
    })
    controller.setTarget(target())

    await vi.advanceTimersByTimeAsync(5)
    lifecycle.setOnline(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStatus).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ available: false, nextDelayMs: null })

    lifecycle.setOnline(true)
    await vi.advanceTimersByTimeAsync(POLICY.resumeDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  it('aborts and fences a hidden in-flight lookup, then resumes exactly once when visible', async () => {
    const lifecycle = createLifecycle()
    const hiddenLookup = deferred<SwitchboardTaskPhase>()
    const resumedLookup = deferred<SwitchboardTaskPhase>()
    const signals: AbortSignal[] = []
    const fetchStatus = vi.fn((_target, context) => {
      signals.push(context.signal)
      return fetchStatus.mock.calls.length === 1 ? hiddenLookup.promise : resumedLookup.promise
    })
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())
    const hiddenOutcome = controller.refreshNow()
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    lifecycle.setVisible(false)
    expect(signals[0]?.aborted).toBe(true)
    hiddenLookup.resolve('completed')
    await expect(hiddenOutcome).resolves.toEqual({ status: 'superseded' })
    expect(applyStatus).not.toHaveBeenCalled()
    expect(applyError).not.toHaveBeenCalled()

    lifecycle.setVisible(true)
    lifecycle.notify()
    lifecycle.notify()
    await vi.advanceTimersByTimeAsync(POLICY.resumeDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(2)

    resumedLookup.resolve('running')
    await flushMicrotasks()
    expect(applyStatus).toHaveBeenCalledTimes(1)
    expect(applyStatus.mock.calls[0]?.[1]).toBe('running')
    expect(controller.snapshot().nextDelayMs).toBe(POLICY.successDelayMs)
    await vi.advanceTimersByTimeAsync(POLICY.resumeDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(2)

    controller.dispose()
  })

  it('coalesces explicit refreshes and unchanged lifecycle notifications into one flight', async () => {
    const lifecycle = createLifecycle()
    const lookup = deferred<SwitchboardTaskPhase>()
    const fetchStatus = vi.fn(() => lookup.promise)
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      policy: POLICY,
    })
    controller.setTarget(target())

    const first = controller.refreshNow()
    const second = controller.refreshNow()
    lifecycle.notify()
    lifecycle.notify()
    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(first).toBe(second)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    lookup.resolve('running')
    await expect(first).resolves.toEqual({
      status: 'applied',
      phase: 'running',
      pollingTerminal: false,
      changed: true,
    })
    await expect(second).resolves.toEqual({
      status: 'applied',
      phase: 'running',
      pollingTerminal: false,
      changed: true,
    })
    expect(applyStatus).toHaveBeenCalledTimes(1)

    controller.dispose()
  })

  it('aborts and fences a deferred lookup after disposal', async () => {
    const lifecycle = createLifecycle()
    const lookup = deferred<SwitchboardTaskPhase>()
    let signal: AbortSignal | undefined
    const fetchStatus = vi.fn((_target, context) => {
      signal = context.signal
      return lookup.promise
    })
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())
    const outcome = controller.refreshNow()

    controller.dispose()
    expect(signal?.aborted).toBe(true)
    lookup.resolve('running')
    await expect(outcome).resolves.toEqual({ status: 'superseded' })
    expect(applyStatus).not.toHaveBeenCalled()
    expect(applyError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
  })

  it('treats an ordinary current AbortError as a retryable status failure', async () => {
    const lifecycle = createLifecycle()
    const abortError = new Error('The target is no longer owned.')
    abortError.name = 'AbortError'
    const fetchStatus = vi.fn(async () => {
      throw abortError
    })
    const applyStatus = vi.fn(async () => applied('running'))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())

    await expect(controller.refreshNow()).resolves.toEqual({
      status: 'failed',
      error: abortError,
    })
    expect(applyStatus).not.toHaveBeenCalled()
    expect(applyError).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'switchboard-1' }),
      abortError,
      expect.objectContaining({ generation: expect.any(Number) }),
    )
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 1,
      consecutiveUnchanged: 0,
      nextDelayMs: POLICY.failureBackoffBaseMs,
    })

    controller.dispose()
  })

  it('retries a current ownership-superseded error without persisting it', async () => {
    const lifecycle = createLifecycle()
    const superseded = new SwitchboardPollingSupersededError('The note no longer owns this result.')
    let attempt = 0
    const fetchStatus = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw superseded
      return 'running' as SwitchboardTaskPhase
    })
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())

    await expect(controller.refreshNow()).resolves.toEqual({ status: 'superseded' })
    expect(applyStatus).not.toHaveBeenCalled()
    expect(applyError).not.toHaveBeenCalled()
    const retryDelayMs = controller.snapshot().nextDelayMs
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 0,
      consecutiveUnchanged: 0,
    })
    expect(retryDelayMs).not.toBeNull()
    expect(retryDelayMs!).toBeGreaterThan(0)
    expect(retryDelayMs!).toBeLessThanOrEqual(POLICY.maxBackoffMs)

    await vi.advanceTimersByTimeAsync(retryDelayMs!)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(applyStatus).toHaveBeenCalledTimes(1)
    expect(applyError).not.toHaveBeenCalled()
    expect(controller.snapshot().nextDelayMs).toBe(POLICY.successDelayMs)

    controller.dispose()
  })

  it('drops a late result when the source path switches around the same stable UID receipt', async () => {
    const lifecycle = createLifecycle()
    const firstLookup = deferred<SwitchboardTaskPhase>()
    const secondLookup = deferred<SwitchboardTaskPhase>()
    const signals: AbortSignal[] = []
    const fetchStatus = vi.fn((pollingTarget, context) => {
      signals.push(context.signal)
      return pollingTarget.sourcePath === '/notes/a.org' ? firstLookup.promise : secondLookup.promise
    })
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      policy: POLICY,
    })

    const sourceA = target('same', 'admitted', { sourcePath: '/notes/a.org' })
    const sourceB = target('same', 'admitted', { sourcePath: '/notes/b.org' })
    controller.setTarget(sourceA)
    const firstOutcome = controller.refreshNow()
    controller.setTarget(sourceB)
    const secondOutcome = controller.refreshNow()
    expect(signals[0]?.aborted).toBe(true)

    firstLookup.resolve('completed')
    secondLookup.resolve('running')
    await expect(firstOutcome).resolves.toEqual({ status: 'superseded' })
    await expect(secondOutcome).resolves.toEqual({
      status: 'applied',
      phase: 'running',
      pollingTerminal: false,
      changed: true,
    })
    expect(applyStatus).toHaveBeenCalledTimes(1)
    expect(applyStatus.mock.calls[0]?.[0]).toMatchObject({
      taskId: 'switchboard-same',
      noteUid: 'note-same',
      sourcePath: '/notes/b.org',
    })

    controller.dispose()
  })

  it('ignores a stale failure after an offline cancellation and resumed success', async () => {
    const lifecycle = createLifecycle()
    const staleLookup = deferred<SwitchboardTaskPhase>()
    const resumedLookup = deferred<SwitchboardTaskPhase>()
    const fetchStatus = vi.fn()
      .mockImplementationOnce(() => staleLookup.promise)
      .mockImplementationOnce(() => resumedLookup.promise)
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase))
    const applyError = vi.fn(async () => undefined)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      applyError,
      policy: POLICY,
    })
    controller.setTarget(target())
    const staleOutcome = controller.refreshNow()

    lifecycle.setOnline(false)
    lifecycle.setOnline(true)
    await vi.advanceTimersByTimeAsync(POLICY.resumeDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(2)

    resumedLookup.resolve('running')
    await flushMicrotasks()
    staleLookup.reject(new Error('late offline failure'))
    await expect(staleOutcome).resolves.toEqual({ status: 'superseded' })
    await flushMicrotasks()

    expect(applyStatus).toHaveBeenCalledTimes(1)
    expect(applyError).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({
      consecutiveFailures: 0,
      nextDelayMs: POLICY.successDelayMs,
    })

    controller.dispose()
  })

  it('persists a terminal result once, stops auto polling, and keeps manual refresh available', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn(async () => 'completed' as SwitchboardTaskPhase)
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase, true))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      policy: POLICY,
    })
    controller.setTarget(target('done', 'running'))

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({
      nextDelayMs: null,
      target: { phase: 'completed' },
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    await expect(controller.refreshNow()).resolves.toEqual({
      status: 'applied',
      phase: 'completed',
      pollingTerminal: true,
      changed: true,
    })
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().nextDelayMs).toBeNull()

    controller.dispose()
  })

  it('does not cancel a deferred manual refresh when the same terminal target is supplied again', async () => {
    const lifecycle = createLifecycle()
    const lookup = deferred<SwitchboardTaskPhase>()
    let signal: AbortSignal | undefined
    const fetchStatus = vi.fn((_target, context) => {
      signal = context.signal
      return lookup.promise
    })
    const applyStatus = vi.fn(async (_target, phase: SwitchboardTaskPhase) => applied(phase, true, false))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus,
      policy: POLICY,
    })
    const terminalTarget = target('terminal-manual', 'completed', { pollingTerminal: true })
    controller.setTarget(terminalTarget)
    const first = controller.refreshNow()

    controller.setTarget({ ...terminalTarget })
    const coalesced = controller.refreshNow()
    expect(signal?.aborted).toBe(false)
    expect(coalesced).toBe(first)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    lookup.resolve('completed')
    await expect(first).resolves.toEqual({
      status: 'applied',
      phase: 'completed',
      pollingTerminal: true,
      changed: false,
    })
    expect(applyStatus).toHaveBeenCalledTimes(1)
    expect(controller.snapshot().nextDelayMs).toBeNull()

    controller.dispose()
  })

  it('keeps polling failed or blocked display phases while the full fan-out is nonterminal', async () => {
    const lifecycle = createLifecycle()
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(applied('failed', false))
      .mockResolvedValueOnce(applied('blocked', false))
      .mockResolvedValueOnce(applied('failed', true))
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async (_target, status) => status,
      policy: POLICY,
    })
    controller.setTarget(target('mixed', 'failed'))

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(controller.snapshot()).toMatchObject({
      nextDelayMs: POLICY.successDelayMs,
      target: { phase: 'failed', pollingTerminal: false },
    })
    await vi.advanceTimersByTimeAsync(POLICY.successDelayMs)
    expect(controller.snapshot()).toMatchObject({
      nextDelayMs: POLICY.successDelayMs,
      target: { phase: 'blocked', pollingTerminal: false },
    })
    await vi.advanceTimersByTimeAsync(POLICY.successDelayMs)
    expect(controller.snapshot()).toMatchObject({
      nextDelayMs: null,
      target: { phase: 'failed', pollingTerminal: true },
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStatus).toHaveBeenCalledTimes(3)

    controller.dispose()
  })

  it('uses the full fan-out aggregate beyond the persisted row bound to decide whether to stop', async () => {
    const lifecycle = createLifecycle()
    let record: SwitchboardTaskRecord = createSwitchboardTaskFromAdmission({
      id: 'admission-1',
      rawIntentId: 'raw-1',
      messageId: 'message-1',
      sourceSystem: 'branch-continue',
      sourceRecordId: 'note-1',
      sourceHash: 'sha256:hash-1',
      authority: 'execute',
      idempotencyKey: 'branch-continue:note-1:hash-1',
      state: 'queued',
    })
    const completed = Array.from({ length: 32 }, (_, index) => ({
      intentId: `completed-${index}`,
      title: `Completed ${index}`,
      progress: { state: 'completed' },
      agent: { executionState: 'succeeded' },
    }))
    const mixedResponse = {
      tasks: [{
        taskId: 'raw-1',
        messageId: 'message-1',
        state: 'assigned',
        inboxState: 'completed',
        intents: [
          {
            intentId: 'cancelled-head',
            title: 'Cancelled visible workstream',
            progress: { state: 'cancelled' },
            agent: { executionState: 'cancelled' },
          },
          ...completed.slice(1),
          {
            intentId: 'active-tail',
            title: 'Active beyond display bound',
            progress: { state: 'active' },
            agent: { executionState: 'running' },
          },
        ],
      }],
    }
    const completedResponse = {
      tasks: [{
        ...mixedResponse.tasks[0],
        intents: [mixedResponse.tasks[0].intents[0], ...completed.slice(1), {
          intentId: 'completed-tail',
          title: 'Completed beyond display bound',
          progress: { state: 'completed' },
          agent: { executionState: 'succeeded' },
        }],
      }],
    }
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(mixedResponse)
      .mockResolvedValueOnce(completedResponse)
    const controller = createSwitchboardPollingController({
      timers,
      lifecycle: lifecycle.environment,
      fetchStatus,
      applyStatus: async (_target, response) => {
        record = applySwitchboardTaskResponse(record, response)
        return {
          phase: record.projection!.phase,
          pollingTerminal: record.projection!.pollingTerminal,
          changed: true,
        }
      },
      policy: POLICY,
    })
    controller.setTarget(target())

    await vi.advanceTimersByTimeAsync(POLICY.initialDelayMs)
    expect(record.projection).toMatchObject({
      phase: 'failed',
      pollingTerminal: false,
      totalIntentCount: 33,
    })
    expect(record.projection?.intents).toHaveLength(32)
    expect(controller.snapshot().nextDelayMs).toBe(POLICY.successDelayMs)

    await vi.advanceTimersByTimeAsync(POLICY.successDelayMs)
    expect(record.projection).toMatchObject({
      phase: 'failed',
      pollingTerminal: true,
      totalIntentCount: 33,
    })
    expect(controller.snapshot().nextDelayMs).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStatus).toHaveBeenCalledTimes(2)

    controller.dispose()
  })
})
