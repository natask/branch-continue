import { describe, expect, it } from 'vitest'
import type { SwitchboardTaskRecord } from '../src/core/intents/switchboard-task'
import {
  createSwitchboardObservationCoordinator,
  selectSwitchboardTaskObservation,
} from '../src/ui/lib/switchboard-observation'

function task(
  checkedAt: string,
  overrides: Partial<SwitchboardTaskRecord> = {},
): SwitchboardTaskRecord {
  return {
    taskId: 'switchboard-task-1',
    receipt: {
      admissionId: 'admission-1',
      rawIntentId: 'raw-1',
      messageId: 'message-1',
      sourceSystem: 'branch-continue',
      sourceRecordId: 'note-1',
      sourceHash: 'sha256:abc',
      authority: 'execute',
      idempotencyKey: 'branch-continue:note-1:sha256:abc',
      admissionState: 'completed',
      admittedAt: '2026-08-08T17:00:00.000Z',
      handoffStartedAt: '2026-08-08T17:00:01.000Z',
    },
    projection: {
      phase: 'running',
      pollingTerminal: false,
      checkedAt,
      taskState: 'active',
      rawIntentState: 'active',
      inboxState: 'completed',
      totalIntentCount: 1,
      intents: [],
    },
    ...overrides,
  }
}

describe('Switchboard observation precedence', () => {
  it('uses a newer transient observation while the durable note catches up', () => {
    const persisted = task('2026-08-08T17:01:00.000Z')
    const transient = task('2026-08-08T17:02:00.000Z')

    expect(selectSwitchboardTaskObservation(persisted, transient)).toBe(transient)
  })

  it('does not let an older transient observation mask a newer durable projection', () => {
    const persisted = task('2026-08-08T17:03:00.000Z')
    const transient = task('2026-08-08T17:02:00.000Z')

    expect(selectSwitchboardTaskObservation(persisted, transient)).toBe(persisted)
  })

  it('does not let a transient projection mask a newer durable refresh error', () => {
    const persisted = task('2026-08-08T17:01:00.000Z', {
      refreshError: 'manual lookup failed',
      refreshErrorAt: '2026-08-08T17:04:00.000Z',
    })
    const transient = task('2026-08-08T17:03:00.000Z')

    expect(selectSwitchboardTaskObservation(persisted, transient)).toBe(persisted)
  })

  it('keeps the durable record when timestamps tie', () => {
    const persisted = task('2026-08-08T17:02:00.000Z')
    const transient = task('2026-08-08T17:02:00.000Z')

    expect(selectSwitchboardTaskObservation(persisted, transient)).toBe(persisted)
  })

  it('rejects a transient observation from an older handoff of the same task identity', () => {
    const persisted = task('2026-08-08T17:02:00.000Z')
    const transient = task('2026-08-08T17:05:00.000Z', {
      receipt: {
        ...persisted.receipt,
        handoffStartedAt: '2026-08-08T16:59:00.000Z',
      },
    })

    expect(selectSwitchboardTaskObservation(persisted, transient)).toBe(persisted)
  })
})

describe('Switchboard observation coordinator', () => {
  it('rejects automatic work while an explicit lookup remains current', () => {
    const coordinator = createSwitchboardObservationCoordinator()
    const explicit = coordinator.beginExplicit('notes\u001ftask-1')

    expect(explicit).not.toBeNull()
    expect(coordinator.beginAutomatic('notes\u001ftask-1')).toBeNull()
    expect(coordinator.beginExplicit('notes\u001ftask-1')).toBeNull()
    expect(coordinator.isCurrent(explicit!)).toBe(true)
    expect(coordinator.hasExplicit('notes\u001ftask-1')).toBe(true)
    expect(Array.from(coordinator.explicitKeys())).toEqual(['notes\u001ftask-1'])

    expect(coordinator.finishExplicit(explicit!)).toBe(true)
    expect(coordinator.hasExplicit('notes\u001ftask-1')).toBe(false)
  })

  it('lets an explicit lookup invalidate automatic work already in flight', () => {
    const coordinator = createSwitchboardObservationCoordinator()
    const automatic = coordinator.beginAutomatic('notes\u001ftask-1')
    const explicit = coordinator.beginExplicit('notes\u001ftask-1')

    expect(automatic).not.toBeNull()
    expect(explicit).not.toBeNull()
    expect(coordinator.isCurrent(automatic!)).toBe(false)
    expect(coordinator.isCurrent(explicit!)).toBe(true)
  })
})
