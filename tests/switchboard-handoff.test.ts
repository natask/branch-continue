import { describe, expect, it, vi } from 'vitest'
import type { SourceNote } from '../src/core/quicknote/types'
import {
  buildBranchExecuteEnvelope,
  fetchSwitchboardTasks,
  submitBranchForExecution,
  type SwitchboardExternalIntentEnvelope,
  type SwitchboardTasksResponse,
} from '../src/core/intents/switchboard-handoff'
import {
  appendSwitchboardTask,
  applySwitchboardTaskResponse,
  createSwitchboardTaskFromAdmission,
  updateSwitchboardTask,
} from '../src/core/intents/switchboard-task'
import { appendRecognizedVoiceContext } from '../src/ui/lib/voice-agent-context'

function branch(overrides: Partial<SourceNote> = {}): SourceNote {
  return {
    id: 'qn-ts-legacy-parser-id',
    noteUid: 'qnuid-branch-42',
    parentNoteId: 'qnuid-parent-7',
    disposition: 'retained',
    offset: 0,
    sourcePath: '/notes/quicknote.org',
    startLine: 10,
    endLine: 14,
    rawHeadline: 'Ship it [2026-08-03 Mon 10:00:00 -0700]',
    title: 'Ship it',
    timestamp: '[2026-08-03 Mon 10:00:00 -0700]',
    tags: ['project'],
    body: 'Build the explicit integration.',
    preview: 'Build the explicit integration.',
    ...overrides,
  }
}

function acceptedAdmission(envelope: SwitchboardExternalIntentEnvelope) {
  return {
    admission: {
      id: 'admission-1',
      sourceSystem: envelope.source_system,
      sourceRecordId: envelope.source_record_id,
      sourceHash: envelope.source_hash,
      authority: envelope.authority,
      idempotencyKey: envelope.idempotency_key,
      rawIntentId: 'raw-intent-1',
      messageId: 'message-1',
      state: 'queued',
    },
  }
}

function projectedTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'raw-intent-1',
    messageId: 'message-1',
    state: 'active',
    inboxState: 'completed',
    intents: [
      {
        relation: 'primary',
        intentId: 'intent-1',
        workstreamNumber: 1,
        title: 'Build the explicit integration',
        progress: {
          state: 'active',
          summary: 'Implementing the bounded status projection.',
          nextAction: 'Run the focused tests.',
          blockedReason: null,
          evidence: [],
        },
        agent: {
          id: 'agent-1',
          name: 'Builder',
          status: 'running',
          executionId: 'execution-1',
          executionState: 'running',
        },
        updates: [],
      },
    ],
    ...overrides,
  }
}

describe('Branch Continue to Switchboard handoff', () => {
  it('binds one stable note revision to execute authority and a deterministic idempotency key', async () => {
    const first = await buildBranchExecuteEnvelope(branch(), 'branch-continue')
    const retry = await buildBranchExecuteEnvelope(branch({ disposition: 'handed-off' }), 'branch-continue')

    expect(first).toEqual(retry)
    expect(first.source_record_id).toBe('qnuid-branch-42')
    expect(first.source_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.idempotency_key).toBe(`branch-continue:qnuid-branch-42:${first.source_hash}`)
    expect(first.authority).toBe('execute')
    expect(first.exact_text).toBe('Ship it\n\nBuild the explicit integration.')
    expect(first.context_refs).toEqual([expect.objectContaining({
      type: 'branch-continue-lineage',
      parent_note_id: 'qnuid-parent-7',
    })])
  })

  it('changes the revision admission when executable note content changes', async () => {
    const first = await buildBranchExecuteEnvelope(branch())
    const edited = await buildBranchExecuteEnvelope(branch({ body: 'Build the smaller integration.' }))

    expect(edited.source_hash).not.toBe(first.source_hash)
    expect(edited.idempotency_key).not.toBe(first.idempotency_key)
  })

  it('keeps retry identity stable after persisting a receipt and its task projection', async () => {
    const source = branch()
    const original = await buildBranchExecuteEnvelope(source)
    const record = createSwitchboardTaskFromAdmission(
      acceptedAdmission(original).admission,
      '2026-08-07T17:00:00.000Z',
    )
    const bodyWithReceipt = appendSwitchboardTask(source.body, record)
    const receiptEnvelope = await buildBranchExecuteEnvelope(branch({ body: bodyWithReceipt }))
    const projected = applySwitchboardTaskResponse(
      record,
      { tasks: [projectedTask()] },
      '2026-08-07T17:01:00.000Z',
    )
    const bodyWithProjection = updateSwitchboardTask(bodyWithReceipt, projected)
    const projectionEnvelope = await buildBranchExecuteEnvelope(branch({ body: bodyWithProjection }))

    expect(bodyWithReceipt).not.toBe(source.body)
    expect(bodyWithProjection).not.toBe(bodyWithReceipt)
    for (const envelope of [receiptEnvelope, projectionEnvelope]) {
      expect(envelope.exact_text).toBe(original.exact_text)
      expect(envelope.source_hash).toBe(original.source_hash)
      expect(envelope.idempotency_key).toBe(original.idempotency_key)
    }
  })

  it('binds a recognized voice transcript and its opaque audio reference to the explicit handoff', async () => {
    const original = await buildBranchExecuteEnvelope(branch())
    const body = appendRecognizedVoiceContext(
      'Audio recording: recordings/voice-note.wav',
      'Ship the smallest reliable slice.',
    )
    const voice = await buildBranchExecuteEnvelope(branch({ body }))
    const retry = await buildBranchExecuteEnvelope(branch({ body, disposition: 'handed-off' }))

    expect(voice.source_hash).not.toBe(original.source_hash)
    expect(retry).toEqual(voice)
    expect(voice.exact_text).toContain('Recognized voice transcript:\n\nShip the smallest reliable slice.')
    expect(voice.context_refs).toContainEqual({
      type: 'branch-continue-audio',
      uri: 'recordings/voice-note.wav',
    })
  })

  it('requires a saved stable UID and branch lineage before transport', async () => {
    await expect(buildBranchExecuteEnvelope(branch({ noteUid: null }))).rejects.toThrow(/save this branch/i)
    await expect(buildBranchExecuteEnvelope(branch({ parentNoteId: null }))).rejects.toThrow(/only a branch/i)
  })

  it('reuses the same admission envelope when an explicit handoff is retried', async () => {
    const transport = vi.fn(async (_endpoint: string, envelope: SwitchboardExternalIntentEnvelope) => (
      acceptedAdmission(envelope)
    ))

    const first = await submitBranchForExecution(branch(), { transport })
    const retry = await submitBranchForExecution(branch(), { transport })

    expect(first.admission.id).toBe('admission-1')
    expect(retry.admission.id).toBe('admission-1')
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[0]?.[1]).toEqual(transport.mock.calls[1]?.[1])
  })

  it.each([
    ['sourceSystem', 'chief-moa'],
    ['sourceRecordId', 'different-note'],
    ['sourceHash', 'sha256:different'],
    ['authority', 'capture'],
    ['idempotencyKey', 'different-attempt'],
  ] as const)('rejects an admission with mismatched %s', async (field, value) => {
    const transport = vi.fn(async (_endpoint: string, envelope: SwitchboardExternalIntentEnvelope) => ({
      admission: { ...acceptedAdmission(envelope).admission, [field]: value },
    }))

    await expect(submitBranchForExecution(branch(), { transport })).rejects.toThrow(
      new RegExp(field, 'i'),
    )
  })

  it('rejects an admission without a durable message ID', async () => {
    const transport = vi.fn(async (_endpoint: string, envelope: SwitchboardExternalIntentEnvelope) => {
      const response = acceptedAdmission(envelope)
      return {
        admission: {
          ...response.admission,
          messageId: '',
        },
      }
    })

    await expect(submitBranchForExecution(branch(), { transport })).rejects.toThrow(/message ID/i)
  })

  it('rejects an admission without a durable raw intent ID', async () => {
    const transport = vi.fn(async (_endpoint: string, envelope: SwitchboardExternalIntentEnvelope) => {
      const response = acceptedAdmission(envelope)
      return {
        admission: {
          ...response.admission,
          rawIntentId: '',
        },
      }
    })

    await expect(submitBranchForExecution(branch(), { transport })).rejects.toThrow(/raw intent ID/i)
  })

  it('requests one bounded task projection by message ID and accepts a not-yet-projected admission', async () => {
    const transport = vi.fn(async () => ({ tasks: [] }))

    await expect(fetchSwitchboardTasks(' message-1 ', {
      baseUrl: 'http://127.0.0.1:4317/',
      rawIntentId: ' raw-intent-1 ',
      timeoutMs: 2_500,
      transport,
    })).resolves.toEqual({ tasks: [] })

    expect(transport).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/tasks',
      'message-1',
      'raw-intent-1',
      2_500,
    )
  })

  it('accepts every intent in one durable multi-intent task projection', async () => {
    const task = projectedTask({
      intents: [
        projectedTask().intents[0],
        {
          relation: 'follow-up',
          intentId: 'intent-2',
          workstreamNumber: 2,
          title: 'Verify the integration',
          progress: {
            state: 'verifying',
            summary: 'Checking the resulting handoff.',
            nextAction: null,
            blockedReason: null,
            evidence: ['test:focused'],
          },
          agent: null,
          updates: [],
        },
      ],
    })
    const transport = vi.fn(async () => ({ tasks: [task] }))

    const response = await fetchSwitchboardTasks('message-1', {
      rawIntentId: 'raw-intent-1',
      transport,
    })

    expect(response.tasks[0]?.intents).toHaveLength(2)
    expect(response.tasks[0]?.intents.map((intent) => intent.intentId)).toEqual([
      'intent-1',
      'intent-2',
    ])
  })

  it.each([
    ['messageId', projectedTask({ messageId: 'different-message' }), /messageId/i],
    ['rawIntentId', projectedTask({ taskId: 'different-raw-intent' }), /rawIntentId/i],
  ] as const)('rejects a task projection with mismatched %s', async (_field, task, error) => {
    const transport = vi.fn(async () => ({ tasks: [task] }))

    await expect(fetchSwitchboardTasks('message-1', {
      rawIntentId: 'raw-intent-1',
      transport,
    })).rejects.toThrow(error)
  })

  it.each([
    ['a non-array task collection', { tasks: null }],
    ['a task without intents', { tasks: [{ ...projectedTask(), intents: null }] }],
    ['more than one task', { tasks: [projectedTask(), projectedTask()] }],
  ])('rejects %s', async (_label, value) => {
    const transport = vi.fn(async () => value as unknown as SwitchboardTasksResponse)

    await expect(fetchSwitchboardTasks('message-1', {
      rawIntentId: 'raw-intent-1',
      transport,
    })).rejects.toThrow(/invalid task response|more than one task/i)
  })

  it('stops waiting for a task projection transport that never returns', async () => {
    const transport = vi.fn(() => new Promise<never>(() => {}))

    await expect(fetchSwitchboardTasks('message-1', {
      transport,
      timeoutMs: 5,
    })).rejects.toThrow(/status lookup timed out/i)
  })

  it('stops waiting for a transport that never returns', async () => {
    const transport = vi.fn(() => new Promise<never>(() => {}))

    await expect(submitBranchForExecution(branch(), {
      transport,
      timeoutMs: 5,
    })).rejects.toThrow(/timed out/i)
  })
})
