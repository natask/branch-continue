import { describe, expect, it, vi } from 'vitest'
import type { SourceNote } from '../src/core/quicknote/types'
import {
  buildBranchExecuteEnvelope,
  submitBranchForExecution,
  type SwitchboardExternalIntentEnvelope,
} from '../src/core/intents/switchboard-handoff'

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
      state: 'queued',
    },
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

  it('stops waiting for a transport that never returns', async () => {
    const transport = vi.fn(() => new Promise<never>(() => {}))

    await expect(submitBranchForExecution(branch(), {
      transport,
      timeoutMs: 5,
    })).rejects.toThrow(/timed out/i)
  })
})
