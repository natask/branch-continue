import type { SwitchboardTaskRecord } from '../../core/intents/switchboard-task'

export interface SwitchboardObservationToken {
  key: string
  generation: number
  kind: 'explicit' | 'automatic'
}

export interface SwitchboardObservationCoordinator {
  beginExplicit(key: string): SwitchboardObservationToken | null
  beginAutomatic(key: string): SwitchboardObservationToken | null
  isCurrent(token: SwitchboardObservationToken): boolean
  finishExplicit(token: SwitchboardObservationToken): boolean
  hasExplicit(key: string): boolean
  explicitKeys(): IterableIterator<string>
}

export function createSwitchboardObservationCoordinator(): SwitchboardObservationCoordinator {
  const generations = new Map<string, number>()
  const explicitGenerations = new Map<string, number>()
  const begin = (key: string, kind: SwitchboardObservationToken['kind']): SwitchboardObservationToken => {
    const generation = (generations.get(key) ?? 0) + 1
    generations.set(key, generation)
    return { key, generation, kind }
  }
  return {
    beginExplicit: (key) => {
      if (explicitGenerations.has(key)) return null
      const token = begin(key, 'explicit')
      explicitGenerations.set(key, token.generation)
      return token
    },
    beginAutomatic: (key) => (
      explicitGenerations.has(key) ? null : begin(key, 'automatic')
    ),
    isCurrent: (token) => generations.get(token.key) === token.generation,
    finishExplicit: (token) => {
      if (
        token.kind !== 'explicit'
        || explicitGenerations.get(token.key) !== token.generation
      ) return false
      explicitGenerations.delete(token.key)
      return true
    },
    hasExplicit: (key) => explicitGenerations.has(key),
    explicitKeys: () => explicitGenerations.keys(),
  }
}

/**
 * Keeps the durable note record authoritative once it catches up with, or
 * overtakes, the transient GET-only observation for the same handoff receipt.
 */
export function selectSwitchboardTaskObservation(
  persisted: SwitchboardTaskRecord | null,
  transient: SwitchboardTaskRecord | null,
): SwitchboardTaskRecord | null {
  if (!persisted) return null
  if (!transient || !isSameSwitchboardReceipt(persisted, transient)) return persisted

  return observationTime(transient) > observationTime(persisted)
    ? transient
    : persisted
}

export function isSameSwitchboardReceipt(
  left: SwitchboardTaskRecord,
  right: SwitchboardTaskRecord,
): boolean {
  const leftReceipt = left.receipt
  const rightReceipt = right.receipt
  return left.taskId === right.taskId
    && leftReceipt.admissionId === rightReceipt.admissionId
    && leftReceipt.rawIntentId === rightReceipt.rawIntentId
    && leftReceipt.messageId === rightReceipt.messageId
    && leftReceipt.sourceSystem === rightReceipt.sourceSystem
    && leftReceipt.sourceRecordId === rightReceipt.sourceRecordId
    && leftReceipt.sourceHash === rightReceipt.sourceHash
    && leftReceipt.authority === rightReceipt.authority
    && leftReceipt.idempotencyKey === rightReceipt.idempotencyKey
    && leftReceipt.admittedAt === rightReceipt.admittedAt
    && leftReceipt.handoffStartedAt === rightReceipt.handoffStartedAt
}

function observationTime(task: SwitchboardTaskRecord): number {
  return Math.max(
    parseTimestamp(task.projection?.checkedAt),
    parseTimestamp(task.refreshErrorAt),
  )
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}
