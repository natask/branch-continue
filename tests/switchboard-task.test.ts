import { describe, expect, it } from 'vitest'
import {
  MAX_SWITCHBOARD_TASK_INTENTS,
  MAX_SWITCHBOARD_TASK_LINE_LENGTH,
  appendSwitchboardTask,
  applySwitchboardTaskResponse,
  createSwitchboardTaskFromAdmission,
  deriveSwitchboardTaskPhase,
  extractLatestSwitchboardTask,
  hasMeaningfulSwitchboardTaskChange,
  isSwitchboardPollingTerminal,
  recordSwitchboardRefreshError,
  stripSwitchboardTasks,
  updateSwitchboardTask,
  type SwitchboardTaskIntentRow,
  type SwitchboardTaskRecord,
} from '../src/core/intents/switchboard-task'

const ADMITTED_AT = '2026-08-07T17:00:00.000Z'
const CHECKED_AT = '2026-08-07T17:01:00.000Z'

function admission(suffix = '1') {
  return {
    id: `admission-${suffix}`,
    rawIntentId: `raw-${suffix}`,
    messageId: `message-${suffix}`,
    sourceSystem: 'branch-continue',
    sourceRecordId: `note-${suffix}`,
    sourceHash: `sha256:hash-${suffix}`,
    authority: 'execute',
    idempotencyKey: `branch-continue:note-${suffix}:hash-${suffix}`,
    state: 'queued',
    createdAt: ADMITTED_AT,
  }
}

function taskRecord(suffix = '1'): SwitchboardTaskRecord {
  return createSwitchboardTaskFromAdmission(admission(suffix))
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [{
      taskId: 'raw-1',
      messageId: 'message-1',
      state: 'assigned',
      inboxState: 'completed',
      intents: [{
        intentId: 'intent-1',
        workstreamNumber: 42,
        title: 'Ship the durable projection',
        relation: 'compiled',
        progress: {
          state: 'active',
          summary: 'The task record is implemented.',
          nextAction: 'Run focused tests.',
          evidence: {
            executionResult: 'The marker codec round-tripped.',
            executionError: null,
          },
        },
        agent: {
          name: 'Codex',
          status: 'active',
          executionId: 'execution-1',
          executionState: 'running',
        },
      }],
      ...overrides,
    }],
  }
}

function completedIntent(index: number) {
  return {
    intentId: `completed-${index}`,
    title: `Completed ${index}`,
    progress: { state: 'completed' },
    agent: { executionState: 'succeeded' },
  }
}

function removePersistedPollingTerminal(body: string): string {
  const encoded = body.match(/^Switchboard task: ([A-Za-z0-9_-]+)$/m)?.[1]
  if (!encoded) throw new Error('Expected an encoded Switchboard task.')
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=')
  const parsed = JSON.parse(atob(padded)) as { projection?: { pollingTerminal?: boolean } }
  if (parsed.projection) delete parsed.projection.pollingTerminal
  const legacy = btoa(JSON.stringify(parsed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return body.replace(encoded, legacy)
}

describe('durable Switchboard task records', () => {
  it('round-trips a marker-safe receipt without changing the executable body', () => {
    const original = 'Ship this exact body.  \n\nTrailing evidence stays.\n  '
    const record = taskRecord()
    const body = appendSwitchboardTask(original, record)

    expect(record.taskId).toMatch(/^switchboard-[a-f0-9]{16}$/)
    expect(body.split('\n').filter((line) => line.startsWith('Switchboard task: '))).toHaveLength(1)
    expect(extractLatestSwitchboardTask(body)).toEqual(record)
    expect(stripSwitchboardTasks(body)).toBe(original)
  })

  it('updates one matching block in place and retains the complete projection', () => {
    const original = 'A saved executable branch.'
    const admitted = taskRecord()
    const running = applySwitchboardTaskResponse(admitted, response(), CHECKED_AT)
    const updated = updateSwitchboardTask(appendSwitchboardTask(original, admitted), running)
    const extracted = extractLatestSwitchboardTask(updated)

    expect(updated.match(/branch-continue-switchboard-task:start/g)).toHaveLength(1)
    expect(stripSwitchboardTasks(updated)).toBe(original)
    expect(extracted?.projection).toMatchObject({
      phase: 'running',
      pollingTerminal: false,
      checkedAt: CHECKED_AT,
      taskState: 'assigned',
      rawIntentState: 'assigned',
      inboxState: 'completed',
    })
    expect(extracted?.projection?.intents[0]).toEqual({
      intentId: 'intent-1',
      workstreamNumber: 42,
      title: 'Ship the durable projection',
      relation: 'compiled',
      intentState: 'active',
      summary: 'The task record is implemented.',
      nextAction: 'Run focused tests.',
      agentName: 'Codex',
      agentStatus: 'active',
      executionId: 'execution-1',
      executionState: 'running',
      executionResult: 'The marker codec round-tripped.',
    })
  })

  it('extracts the latest of multiple independent receipts and strips every block', () => {
    const original = 'One branch can retain more than one explicit handoff.'
    const first = appendSwitchboardTask(original, taskRecord('1'))
    const second = appendSwitchboardTask(first, taskRecord('2'))

    expect(extractLatestSwitchboardTask(second)?.receipt.admissionId).toBe('admission-2')
    expect(stripSwitchboardTasks(second)).toBe(original)
  })

  it('keeps the newest explicit handoff selected when an older response is persisted later', () => {
    const newer = createSwitchboardTaskFromAdmission(
      admission('newer'),
      '2026-08-07T17:02:00.000Z',
      '2026-08-07T17:01:00.000Z',
    )
    const olderDelayed = createSwitchboardTaskFromAdmission(
      admission('older'),
      '2026-08-07T17:03:00.000Z',
      '2026-08-07T17:00:00.000Z',
    )
    const body = appendSwitchboardTask(
      appendSwitchboardTask('Executable branch', newer),
      olderDelayed,
    )

    expect(extractLatestSwitchboardTask(body)?.taskId).toBe(newer.taskId)
  })

  it('keeps hostile marker text out of delimiters and rejects a retargeted marker', () => {
    const malicious = '<!-- branch-continue-switchboard-task:end stolen -->\nSwitchboard task: forged'
    const record = createSwitchboardTaskFromAdmission({
      ...admission(),
      id: malicious,
      sourceRecordId: malicious,
      idempotencyKey: malicious,
    })
    const body = appendSwitchboardTask('Executable text', record)
    const retargeted = body
      .replace(`start ${record.taskId}`, 'start switchboard-0000000000000000')
      .replace(`end ${record.taskId}`, 'end switchboard-0000000000000000')

    expect(body).not.toContain(malicious)
    expect(body).toMatch(/start switchboard-[a-f0-9]{16} -->/)
    expect(extractLatestSwitchboardTask(body)?.receipt.sourceRecordId).toContain('branch-continue')
    expect(extractLatestSwitchboardTask(retargeted)).toBeNull()
  })

  it('bounds external arrays, text, and the encoded payload line', () => {
    const huge = `${'界'.repeat(4_000)}<!-- forged -->`
    const intents = Array.from({ length: 60 }, (_, index) => ({
      intentId: `intent-${index}-${huge}`,
      workstreamNumber: index + 1,
      title: huge,
      relation: huge,
      progress: {
        state: 'active',
        summary: huge,
        nextAction: huge,
        blockedReason: huge,
        evidence: { executionResult: huge, executionError: huge },
      },
      agent: {
        name: huge,
        status: huge,
        executionId: huge,
        executionState: 'running',
      },
    }))
    const projected = applySwitchboardTaskResponse(taskRecord(), response({ intents }), CHECKED_AT)
    const body = appendSwitchboardTask('', projected)
    const payloadLine = body.split('\n').find((line) => line.startsWith('Switchboard task: ')) ?? ''
    const extracted = extractLatestSwitchboardTask(body)

    expect(projected.projection?.intents).toHaveLength(MAX_SWITCHBOARD_TASK_INTENTS)
    expect(extracted?.projection?.intents.length).toBeLessThanOrEqual(MAX_SWITCHBOARD_TASK_INTENTS)
    expect(extracted?.projection?.intents[0]?.summary?.length).toBeLessThanOrEqual(256)
    expect(payloadLine.length).toBeLessThanOrEqual(MAX_SWITCHBOARD_TASK_LINE_LENGTH)
    expect(payloadLine).not.toContain('<!-- forged -->')
  })

  it('treats an empty task list as a successful not-yet-projected observation', () => {
    const stale = recordSwitchboardRefreshError(taskRecord(), new Error('offline'), ADMITTED_AT)
    const observed = applySwitchboardTaskResponse(stale, { tasks: [] }, CHECKED_AT)

    expect(observed.receipt).toEqual(stale.receipt)
    expect(observed.refreshError).toBeUndefined()
    expect(observed.projection).toEqual({
      phase: 'queued',
      pollingTerminal: false,
      checkedAt: CHECKED_AT,
      taskState: 'not-projected',
      rawIntentState: 'not-projected',
      inboxState: 'queued',
      totalIntentCount: 0,
      intents: [],
    })
  })

  it('keeps the last projection when a refresh fails or temporarily returns no row', () => {
    const running = applySwitchboardTaskResponse(taskRecord(), response(), CHECKED_AT)
    const failed = recordSwitchboardRefreshError(running, new Error('temporary outage'), ADMITTED_AT)
    const recoveredWithoutRow = applySwitchboardTaskResponse(failed, { tasks: [] }, '2026-08-07T17:02:00.000Z')

    expect(failed.receipt).toEqual(running.receipt)
    expect(failed.projection).toEqual(running.projection)
    expect(failed.refreshError).toBe('temporary outage')
    expect(recoveredWithoutRow.projection).toEqual(running.projection)
    expect(recoveredWithoutRow.refreshError).toBeUndefined()
  })

  it('requires a response bound to both the receipt message and raw intent', () => {
    expect(() => applySwitchboardTaskResponse(taskRecord(), response({ messageId: 'other' }))).toThrow(
      /does not match/i,
    )
    expect(() => applySwitchboardTaskResponse(taskRecord(), { tasks: 'invalid' })).toThrow(/invalid/i)
  })
})

describe('Switchboard aggregate phase', () => {
  const phase = (
    intents: SwitchboardTaskIntentRow[],
    states: Partial<{ taskState: string; rawIntentState: string; inboxState: string }> = {},
  ) => deriveSwitchboardTaskPhase({
    taskState: states.taskState ?? 'assigned',
    rawIntentState: states.rawIntentState ?? 'assigned',
    inboxState: states.inboxState ?? 'completed',
    intents,
  })

  it('does not call an empty projection or execution-only success complete', () => {
    expect(phase([])).toBe('queued')
    expect(phase([{ intentId: '1', title: 'Await acceptance', executionState: 'succeeded' }])).toBe('queued')
    expect(phase([{
      intentId: '1',
      title: 'Await acceptance',
      intentState: 'verifying',
      executionState: 'succeeded',
    }])).toBe('verifying')
  })

  it('completes only a nonempty set whose every intent is completed', () => {
    const completed = (intentId: string): SwitchboardTaskIntentRow => ({
      intentId,
      title: intentId,
      intentState: 'completed',
      executionState: 'succeeded',
    })
    expect(phase([completed('1'), completed('2')])).toBe('completed')
    expect(phase([completed('1'), { ...completed('2'), intentState: 'active' }])).toBe('running')
    expect(phase([{ ...completed('1'), executionState: 'running' }])).toBe('running')
  })

  it('keeps a mixed active or queued fan-out running while preserving all rows', () => {
    const verifying: SwitchboardTaskIntentRow = {
      intentId: '1', title: 'Await acceptance', intentState: 'verifying', executionState: 'succeeded',
    }
    expect(phase([verifying, {
      intentId: '2', title: 'Still running', intentState: 'active', executionState: 'running',
    }])).toBe('running')
    expect(phase([verifying, {
      intentId: '2', title: 'Not started', intentState: 'ready', executionState: 'queued',
    }])).toBe('running')
    expect(phase([verifying, {
      intentId: '2', title: 'Accepted', intentState: 'completed', executionState: 'succeeded',
    }])).toBe('verifying')
  })

  it('derives aggregate status from intents beyond the persisted row bound', () => {
    const completed = Array.from({ length: MAX_SWITCHBOARD_TASK_INTENTS }, (_, index) => completedIntent(index))
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [
        ...completed,
        {
          intentId: 'active-tail',
          title: 'Still active beyond the display bound',
          progress: { state: 'active' },
          agent: { executionState: 'running' },
        },
      ],
    }), CHECKED_AT)
    const roundTripped = extractLatestSwitchboardTask(appendSwitchboardTask('', projected))

    expect(projected.projection?.intents).toHaveLength(MAX_SWITCHBOARD_TASK_INTENTS)
    expect(projected.projection?.totalIntentCount).toBe(MAX_SWITCHBOARD_TASK_INTENTS + 1)
    expect(projected.projection?.phase).toBe('running')
    expect(projected.projection?.pollingTerminal).toBe(false)
    expect(isSwitchboardPollingTerminal(projected)).toBe(false)
    expect(roundTripped?.projection?.phase).toBe('running')
    expect(roundTripped?.projection?.pollingTerminal).toBe(false)
    expect(roundTripped?.projection?.totalIntentCount).toBe(MAX_SWITCHBOARD_TASK_INTENTS + 1)
  })

  it('keeps failure and blocking distinct from inbox and execution activity', () => {
    expect(phase([{
      intentId: '1', title: 'Failed', intentState: 'active', executionError: 'boom',
    }])).toBe('failed')
    expect(phase([{
      intentId: '1', title: 'Blocked', intentState: 'active', blockedReason: 'Owner input',
    }])).toBe('blocked')
    expect(phase([], { taskState: 'assigned', rawIntentState: 'assigned', inboxState: 'processing' })).toBe('running')
  })
})

describe('Switchboard polling observations', () => {
  it('stops a projected empty task after inbox failure but not an absent task projection', () => {
    const failedBeforeRouting = applySwitchboardTaskResponse(taskRecord(), response({
      state: 'assigned',
      inboxState: 'failed',
      intents: [],
    }), CHECKED_AT)
    const notProjected = applySwitchboardTaskResponse(taskRecord(), { tasks: [] }, CHECKED_AT)

    expect(failedBeforeRouting.projection).toMatchObject({
      phase: 'failed',
      pollingTerminal: true,
      totalIntentCount: 0,
    })
    expect(isSwitchboardPollingTerminal(failedBeforeRouting)).toBe(true)
    expect(notProjected.projection).toMatchObject({
      phase: 'queued',
      pollingTerminal: false,
      taskState: 'not-projected',
    })
  })

  it('settles and round-trips only after the full fan-out completes', () => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: Array.from({ length: MAX_SWITCHBOARD_TASK_INTENTS + 1 }, (_, index) => completedIntent(index)),
    }), CHECKED_AT)
    const roundTripped = extractLatestSwitchboardTask(appendSwitchboardTask('', projected))

    expect(projected.projection).toMatchObject({
      phase: 'completed',
      pollingTerminal: true,
      totalIntentCount: MAX_SWITCHBOARD_TASK_INTENTS + 1,
    })
    expect(isSwitchboardPollingTerminal(projected)).toBe(true)
    expect(roundTripped?.projection?.pollingTerminal).toBe(true)
    expect(roundTripped && isSwitchboardPollingTerminal(roundTripped)).toBe(true)
  })

  it.each([
    ['active', { progress: { state: 'active' }, agent: { executionState: 'running' } }],
    ['blocked', { progress: { state: 'blocked', blockedReason: 'Owner input' } }],
    ['verifying', { progress: { state: 'verifying' }, agent: { executionState: 'succeeded' } }],
  ])('keeps a completed fan-out live when a %s sibling remains', (_state, sibling) => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [completedIntent(1), {
        intentId: 'unfinished-sibling',
        title: 'Unfinished sibling',
        ...sibling,
      }],
    }), CHECKED_AT)

    expect(projected.projection?.pollingTerminal).toBe(false)
    expect(isSwitchboardPollingTerminal(projected)).toBe(false)
  })

  it('stops after every sibling reaches a completed or cancelled terminal state', () => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [completedIntent(1), {
        intentId: 'cancelled-sibling',
        title: 'Cancelled sibling',
        progress: { state: 'cancelled' },
        agent: { executionState: 'cancelled' },
      }],
    }), CHECKED_AT)

    expect(projected.projection).toMatchObject({ phase: 'failed', pollingTerminal: true })
    expect(isSwitchboardPollingTerminal(projected)).toBe(true)
  })

  it('keeps polling when a cancelled sibling still has active work beside it', () => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [{
        intentId: 'cancelled-sibling',
        title: 'Cancelled sibling',
        progress: { state: 'cancelled' },
        agent: { executionState: 'cancelled' },
      }, {
        intentId: 'active-sibling',
        title: 'Active sibling',
        progress: { state: 'active' },
        agent: { executionState: 'running' },
      }],
    }), CHECKED_AT)

    expect(projected.projection?.phase).toBe('failed')
    expect(projected.projection?.pollingTerminal).toBe(false)
  })

  it.each([
    ['completed', 'succeeded'],
    ['completed', 'failed'],
    ['completed', 'lost'],
    ['completed', 'cancelled'],
    ['cancelled', 'succeeded'],
    ['cancelled', 'failed'],
    ['cancelled', 'lost'],
    ['cancelled', 'cancelled'],
  ])('accepts contract terminal intent %s with terminal execution %s', (intentState, executionState) => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [{
        intentId: `${intentState}-${executionState}`,
        title: 'Terminal contract row',
        progress: { state: intentState },
        agent: { executionState },
      }],
    }), CHECKED_AT)

    expect(projected.projection?.pollingTerminal).toBe(true)
  })

  it.each(['completed', 'cancelled'])('accepts terminal intent %s without an execution', (intentState) => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [{
        intentId: `${intentState}-without-execution`,
        title: 'Terminal manual intent',
        progress: { state: intentState },
      }],
    }), CHECKED_AT)

    expect(projected.projection?.pollingTerminal).toBe(true)
  })

  it.each(['draft', 'ready', 'active', 'blocked', 'verifying'])(
    'keeps contract live intent %s nonterminal even after an execution succeeds',
    (intentState) => {
      const projected = applySwitchboardTaskResponse(taskRecord(), response({
        intents: [{
          intentId: `${intentState}-intent`,
          title: 'Live contract row',
          progress: { state: intentState },
          agent: { executionState: 'succeeded' },
        }],
      }), CHECKED_AT)

      expect(projected.projection?.pollingTerminal).toBe(false)
    },
  )

  it('keeps a terminal intent live while its execution is live or unrecognized', () => {
    for (const executionState of ['queued', 'starting', 'waiting_input', 'running', 'unknown']) {
      const projected = applySwitchboardTaskResponse(taskRecord(), response({
        intents: [{
          ...completedIntent(1),
          agent: { executionState },
        }],
      }), CHECKED_AT)
      expect(projected.projection?.pollingTerminal, executionState).toBe(false)
    }
  })

  it('infers terminal success for a truncated legacy completed projection without the flag', () => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: Array.from({ length: MAX_SWITCHBOARD_TASK_INTENTS + 1 }, (_, index) => completedIntent(index)),
    }), CHECKED_AT)
    const legacyBody = removePersistedPollingTerminal(appendSwitchboardTask('', projected))
    const legacy = extractLatestSwitchboardTask(legacyBody)

    expect(legacy?.projection).toMatchObject({
      phase: 'completed',
      pollingTerminal: true,
      totalIntentCount: MAX_SWITCHBOARD_TASK_INTENTS + 1,
    })
    expect(legacy && isSwitchboardPollingTerminal(legacy)).toBe(true)
  })

  it('keeps a legacy failed-phase projection without the terminal flag live', () => {
    const projected = applySwitchboardTaskResponse(taskRecord(), response({
      intents: [{
        intentId: 'cancelled-intent',
        title: 'Cancelled intent',
        progress: { state: 'cancelled' },
        agent: { executionState: 'cancelled' },
      }],
    }), CHECKED_AT)
    const legacy = extractLatestSwitchboardTask(
      removePersistedPollingTerminal(appendSwitchboardTask('', projected)),
    )

    expect(projected.projection).toMatchObject({ phase: 'failed', pollingTerminal: true })
    expect(legacy?.projection).toMatchObject({ phase: 'failed', pollingTerminal: false })
    expect(legacy && isSwitchboardPollingTerminal(legacy)).toBe(false)
  })

  it('ignores observation timestamps while detecting content and error changes', () => {
    const first = applySwitchboardTaskResponse(taskRecord(), response(), CHECKED_AT)
    const checkedAgain = applySwitchboardTaskResponse(first, response(), '2026-08-07T17:02:00.000Z')
    const firstError = recordSwitchboardRefreshError(first, new Error('offline'), '2026-08-07T17:03:00.000Z')
    const repeatedError = recordSwitchboardRefreshError(firstError, new Error('offline'), '2026-08-07T17:04:00.000Z')
    const differentError = recordSwitchboardRefreshError(firstError, new Error('timeout'), '2026-08-07T17:04:00.000Z')
    const changedContent = applySwitchboardTaskResponse(first, response({
      intents: [{
        intentId: 'intent-1',
        title: 'Ship the durable projection',
        progress: { state: 'active', summary: 'New observable progress.' },
        agent: { executionState: 'running' },
      }],
    }), '2026-08-07T17:02:00.000Z')

    expect(hasMeaningfulSwitchboardTaskChange(first, checkedAgain)).toBe(false)
    expect(hasMeaningfulSwitchboardTaskChange(firstError, repeatedError)).toBe(false)
    expect(hasMeaningfulSwitchboardTaskChange(first, firstError)).toBe(true)
    expect(hasMeaningfulSwitchboardTaskChange(firstError, differentError)).toBe(true)
    expect(hasMeaningfulSwitchboardTaskChange(first, changedContent)).toBe(true)
    expect(hasMeaningfulSwitchboardTaskChange(taskRecord(), first)).toBe(true)
    expect(hasMeaningfulSwitchboardTaskChange(null, first)).toBe(true)
  })
})
