export const MAX_SWITCHBOARD_TASK_INTENTS = 32
export const MAX_SWITCHBOARD_TASK_LINE_LENGTH = 262_144

export type SwitchboardTaskPhase =
  | 'admitted'
  | 'queued'
  | 'running'
  | 'verifying'
  | 'blocked'
  | 'failed'
  | 'completed'

export interface SwitchboardAdmissionReceipt {
  admissionId: string
  rawIntentId: string
  messageId: string
  sourceSystem: string
  sourceRecordId: string
  sourceHash: string
  authority: string
  idempotencyKey: string
  admissionState: string
  admittedAt: string
  handoffStartedAt: string
}

export interface SwitchboardTaskIntentRow {
  intentId: string
  workstreamNumber?: number
  title: string
  relation?: string
  intentState?: string
  summary?: string
  nextAction?: string
  blockedReason?: string
  agentName?: string
  agentStatus?: string
  executionId?: string
  executionState?: string
  executionResult?: string
  executionError?: string
}

export interface SwitchboardTaskProjection {
  phase: SwitchboardTaskPhase
  /** True only when the full, untruncated fan-out no longer has pollable work. */
  pollingTerminal: boolean
  checkedAt: string
  taskState: string
  rawIntentState: string
  inboxState: string
  totalIntentCount: number
  intents: SwitchboardTaskIntentRow[]
}

export interface SwitchboardTaskRecord {
  taskId: string
  receipt: SwitchboardAdmissionReceipt
  projection?: SwitchboardTaskProjection
  refreshError?: string
  refreshErrorAt?: string
}

export interface ValidatedSwitchboardAdmission {
  id: string
  rawIntentId: string
  messageId: string
  sourceSystem: string
  sourceRecordId: string
  sourceHash: string
  authority: string
  idempotencyKey: string
  state?: string
  createdAt?: string
}

export interface ValidatedSwitchboardTaskAgent {
  id?: string | null
  name?: string | null
  status?: string | null
  executionId?: string | null
  executionState?: string | null
  executionResult?: string | null
  executionError?: string | null
}

export interface ValidatedSwitchboardTaskIntent {
  intentId: string
  workstreamNumber?: number | null
  title?: string | null
  relation?: string | null
  intentState?: string | null
  summary?: string | null
  nextAction?: string | null
  blockedReason?: string | null
  agentName?: string | null
  agentStatus?: string | null
  executionId?: string | null
  executionState?: string | null
  executionResult?: string | null
  executionError?: string | null
  progress?: {
    state?: string | null
    summary?: string | null
    nextAction?: string | null
    blockedReason?: string | null
    evidence?: {
      executionResult?: string | null
      executionError?: string | null
    } | null
  } | null
  agent?: ValidatedSwitchboardTaskAgent | null
}

export interface ValidatedSwitchboardTask {
  taskId: string
  messageId: string
  state?: string | null
  taskState?: string | null
  rawIntentState?: string | null
  inboxState?: string | null
  intents?: ValidatedSwitchboardTaskIntent[] | null
}

export interface ValidatedSwitchboardTaskResponse {
  tasks: ValidatedSwitchboardTask[]
}

interface TaskIdentity {
  admissionId: string
  messageId: string
  sourceSystem: string
  sourceRecordId: string
  sourceHash: string
  idempotencyKey: string
}

const BLOCK_PATTERN_SOURCE = '<!-- branch-continue-switchboard-task:start ([A-Za-z0-9_-]+) -->\\nSwitchboard task: ([A-Za-z0-9_-]+)\\n<!-- branch-continue-switchboard-task:end \\1 -->'
const SWITCHBOARD_TASK_BLOCK_WITH_DELIMITER_PATTERN = new RegExp(`(?:\\n\\n)?${BLOCK_PATTERN_SOURCE}`, 'g')

const COMPLETE_STATES = new Set(['complete', 'completed', 'done', 'closed', 'resolved', 'succeeded', 'success'])
const FAILED_STATES = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled', 'terminated'])
const BLOCKED_STATES = new Set(['blocked', 'waiting_input', 'waiting-input', 'needs_input', 'needs-input', 'paused'])
const RUNNING_STATES = new Set(['active', 'processing', 'running', 'starting', 'in_progress', 'in-progress'])
const VERIFYING_STATES = new Set(['verifying', 'reviewing', 'awaiting_verification', 'awaiting-verification'])
const QUEUED_STATES = new Set(['accepted', 'admitted', 'assigned', 'pending', 'queued', 'ready', 'recorded', 'routing'])
const POLLING_TERMINAL_INTENT_STATES = new Set(['completed', 'cancelled'])
const POLLING_TERMINAL_EXECUTION_STATES = new Set(['succeeded', 'failed', 'lost', 'cancelled'])
const POLLING_TERMINAL_INBOX_STATES = new Set(['completed', 'failed'])

const RECEIPT_TEXT_LIMIT = 512
const ROW_ID_LIMIT = 256
const ROW_TITLE_LIMIT = 160
const ROW_STATE_LIMIT = 64
const ROW_DETAIL_LIMIT = 256
const ERROR_LIMIT = 512
const TIMESTAMP_LIMIT = 96

/** Creates the durable receipt only after the handoff response has been binding-validated. */
export function createSwitchboardTaskFromAdmission(
  admission: ValidatedSwitchboardAdmission,
  admittedAt = admission.createdAt ?? new Date().toISOString(),
  handoffStartedAt = admittedAt,
): SwitchboardTaskRecord {
  const receipt: SwitchboardAdmissionReceipt = {
    admissionId: requiredText(admission.id, 'admission id', RECEIPT_TEXT_LIMIT),
    rawIntentId: requiredText(admission.rawIntentId, 'raw intent id', RECEIPT_TEXT_LIMIT),
    messageId: requiredText(admission.messageId, 'message id', RECEIPT_TEXT_LIMIT),
    sourceSystem: requiredText(admission.sourceSystem, 'source system', RECEIPT_TEXT_LIMIT),
    sourceRecordId: requiredText(admission.sourceRecordId, 'source record id', RECEIPT_TEXT_LIMIT),
    sourceHash: requiredText(admission.sourceHash, 'source hash', RECEIPT_TEXT_LIMIT),
    authority: requiredText(admission.authority, 'authority', RECEIPT_TEXT_LIMIT),
    idempotencyKey: requiredText(admission.idempotencyKey, 'idempotency key', RECEIPT_TEXT_LIMIT),
    admissionState: clippedText(admission.state, ROW_STATE_LIMIT) || 'admitted',
    admittedAt: clippedText(admittedAt, TIMESTAMP_LIMIT) || new Date().toISOString(),
    handoffStartedAt: clippedText(handoffStartedAt, TIMESTAMP_LIMIT) || admittedAt,
  }
  return { taskId: deriveSwitchboardTaskId(receipt), receipt }
}

/** The marker id is derived from immutable receipt identity and never contains external text. */
export function deriveSwitchboardTaskId(identity: TaskIdentity): string {
  const source = [
    identity.sourceSystem,
    identity.sourceRecordId,
    identity.sourceHash,
    identity.idempotencyKey,
    identity.admissionId,
    identity.messageId,
  ].join('\u001f')
  const [high, low] = stableHash(source)
  return `switchboard-${high}${low}`
}

/** Appends without trimming or otherwise changing the executable note body. */
export function appendSwitchboardTask(body: string, record: SwitchboardTaskRecord): string {
  const block = formatSwitchboardTaskBlock(record)
  return body ? `${body}\n\n${block}` : block
}

export function updateSwitchboardTask(body: string, record: SwitchboardTaskRecord): string {
  const normalized = normalizeRecord(record)
  const pattern = switchboardTaskPattern(normalized.taskId)
  if (!pattern.test(body)) return appendSwitchboardTask(body, normalized)
  return body.replace(pattern, formatSwitchboardTaskBlock(normalized))
}

export function extractLatestSwitchboardTask(body: string): SwitchboardTaskRecord | null {
  const matches = Array.from(body.matchAll(new RegExp(BLOCK_PATTERN_SOURCE, 'g')))
  let latest: SwitchboardTaskRecord | null = null
  let latestStartedAt = Number.NEGATIVE_INFINITY
  for (let index = 0; index < matches.length; index += 1) {
    const markerTaskId = matches[index]?.[1]
    const payload = matches[index]?.[2]
    if (!markerTaskId || !payload) continue
    const record = decodeRecord(payload)
    if (!record || record.taskId !== markerTaskId) continue
    const startedAt = Date.parse(record.receipt.handoffStartedAt)
    const order = Number.isFinite(startedAt) ? startedAt : Number.NEGATIVE_INFINITY
    if (!latest || order >= latestStartedAt) {
      latest = record
      latestStartedAt = order
    }
  }
  return latest
}

/** Removes blocks together with the exact delimiter inserted by appendSwitchboardTask. */
export function stripSwitchboardTasks(body: string): string {
  SWITCHBOARD_TASK_BLOCK_WITH_DELIMITER_PATTERN.lastIndex = 0
  return body.replace(SWITCHBOARD_TASK_BLOCK_WITH_DELIMITER_PATTERN, '')
}

export function applySwitchboardTaskResponse(
  record: SwitchboardTaskRecord,
  response: unknown,
  checkedAt = new Date().toISOString(),
): SwitchboardTaskRecord {
  const normalized = normalizeRecord(record)
  if (!isObject(response) || !Array.isArray(response.tasks)) {
    throw new Error('Switchboard returned an invalid task response.')
  }
  if (response.tasks.length === 0) {
    if (normalized.projection) {
      return { ...normalized, refreshError: undefined, refreshErrorAt: undefined }
    }
    const base = {
      checkedAt: clippedText(checkedAt, TIMESTAMP_LIMIT) || new Date().toISOString(),
      taskState: 'not-projected',
      rawIntentState: 'not-projected',
      inboxState: normalized.receipt.admissionState,
      totalIntentCount: 0,
      intents: [],
    }
    return {
      ...normalized,
      projection: { ...base, phase: deriveSwitchboardTaskPhase(base), pollingTerminal: false },
      refreshError: undefined,
      refreshErrorAt: undefined,
    }
  }
  const task = response.tasks.find((candidate) => (
    isObject(candidate)
    && candidate.messageId === normalized.receipt.messageId
    && candidate.taskId === normalized.receipt.rawIntentId
  ))
  if (!task) throw new Error('Switchboard task response does not match this admission receipt.')
  if (!Array.isArray(task.intents)) throw new Error('Switchboard returned an invalid task response.')

  const state = clippedText(task.state, ROW_STATE_LIMIT) || 'unknown'
  const allIntents = task.intents.map(normalizeIntentRow)
  const intents = allIntents.slice(0, MAX_SWITCHBOARD_TASK_INTENTS)
  const base = {
    checkedAt: clippedText(checkedAt, TIMESTAMP_LIMIT) || new Date().toISOString(),
    taskState: clippedText(task.taskState, ROW_STATE_LIMIT) || state,
    rawIntentState: clippedText(task.rawIntentState, ROW_STATE_LIMIT) || state,
    inboxState: clippedText(task.inboxState, ROW_STATE_LIMIT) || 'unknown',
    totalIntentCount: allIntents.length,
    intents,
  }
  const phase = deriveSwitchboardTaskPhase({ ...base, intents: allIntents })
  const projection: SwitchboardTaskProjection = {
    ...base,
    phase,
    pollingTerminal: isPollingTerminalFanOut(allIntents, base.inboxState),
  }
  return {
    ...normalized,
    projection,
    refreshError: undefined,
    refreshErrorAt: undefined,
  }
}

/** Records an observation failure while retaining the last known projection and immutable receipt. */
export function recordSwitchboardRefreshError(
  record: SwitchboardTaskRecord,
  error: unknown,
  failedAt = new Date().toISOString(),
): SwitchboardTaskRecord {
  const normalized = normalizeRecord(record)
  return {
    ...normalized,
    refreshError: clippedText(errorMessage(error), ERROR_LIMIT) || 'Switchboard progress refresh failed.',
    refreshErrorAt: clippedText(failedAt, TIMESTAMP_LIMIT) || new Date().toISOString(),
  }
}

/**
 * Returns the persisted terminal decision. Legacy records only infer terminal
 * success from their aggregate completed phase, never from displayed rows.
 */
export function isSwitchboardPollingTerminal(record: SwitchboardTaskRecord): boolean {
  return normalizeRecord(record).projection?.pollingTerminal === true
}

/**
 * Compares durable observation content while ignoring refresh-only timestamps.
 * This lets automatic polling avoid rewriting a note when only checkedAt or
 * refreshErrorAt advanced.
 */
export function hasMeaningfulSwitchboardTaskChange(
  previous: SwitchboardTaskRecord | null | undefined,
  next: SwitchboardTaskRecord | null | undefined,
): boolean {
  if (!previous || !next) return previous !== next
  return JSON.stringify(meaningfulObservation(previous)) !== JSON.stringify(meaningfulObservation(next))
}

export function deriveSwitchboardTaskPhase(
  projection: Pick<SwitchboardTaskProjection, 'taskState' | 'rawIntentState' | 'inboxState' | 'intents'>,
): SwitchboardTaskPhase {
  const rows = projection.intents
  const allStates = [projection.taskState, projection.rawIntentState, projection.inboxState]
  const executionFailed = rows.some((row) => (
    isState(row.executionState, FAILED_STATES) || Boolean(row.executionError?.trim())
  ))
  const intentFailed = rows.some((row) => isState(row.intentState, FAILED_STATES))
  if (executionFailed || intentFailed || allStates.some((state) => isState(state, FAILED_STATES))) {
    return 'failed'
  }

  const blocked = rows.some((row) => (
    isState(row.intentState, BLOCKED_STATES)
    || isState(row.executionState, BLOCKED_STATES)
    || Boolean(row.blockedReason?.trim())
  ))
  if (blocked || allStates.some((state) => isState(state, BLOCKED_STATES))) return 'blocked'

  if (rows.length > 0 && rows.every(isCompletedIntentRow)) return 'completed'

  const running = rows.some((row) => (
    isState(row.intentState, RUNNING_STATES) || isState(row.executionState, RUNNING_STATES)
  ))
  if (running || allStates.some((state) => isState(state, RUNNING_STATES))) return 'running'

  const verifying = rows.some((row) => isState(row.intentState, VERIFYING_STATES))
  const queued = rows.some((row) => (
    isState(row.intentState, QUEUED_STATES) || isState(row.executionState, QUEUED_STATES)
  ))
  // A mixed fan-out with one workstream still queued and another verifying is
  // ongoing as a whole. Reserve "verifying" for a projection whose remaining
  // workstreams are already at verification or completion.
  if (verifying && queued) return 'running'
  if (verifying) return 'verifying'
  if (queued || allStates.some((state) => isState(state, QUEUED_STATES))) return 'queued'

  return 'admitted'
}

function normalizeIntentRow(intent: unknown): SwitchboardTaskIntentRow {
  if (!isObject(intent)) throw new Error('Switchboard returned an invalid intent projection.')
  const progress = isObject(intent.progress) ? intent.progress : undefined
  const evidence = isObject(progress?.evidence) ? progress.evidence : undefined
  const agent = isObject(intent.agent) ? intent.agent : undefined
  const workstreamNumber = positiveInteger(intent.workstreamNumber)
  const intentState = clippedOptional(intent.intentState ?? progress?.state, ROW_STATE_LIMIT)
  return {
    intentId: requiredText(intent.intentId, 'intent id', ROW_ID_LIMIT),
    ...(workstreamNumber === undefined ? {} : { workstreamNumber }),
    title: clippedText(intent.title, ROW_TITLE_LIMIT) || 'Untitled intent',
    ...optionalField('relation', intent.relation, ROW_STATE_LIMIT),
    ...(intentState ? { intentState } : {}),
    ...optionalField('summary', intent.summary ?? progress?.summary, ROW_DETAIL_LIMIT),
    ...optionalField('nextAction', intent.nextAction ?? progress?.nextAction, ROW_DETAIL_LIMIT),
    ...optionalField('blockedReason', intent.blockedReason ?? progress?.blockedReason, ROW_DETAIL_LIMIT),
    ...optionalField('agentName', intent.agentName ?? agent?.name, ROW_TITLE_LIMIT),
    ...optionalField('agentStatus', intent.agentStatus ?? agent?.status, ROW_STATE_LIMIT),
    ...optionalField('executionId', intent.executionId ?? agent?.executionId, ROW_ID_LIMIT),
    ...optionalField('executionState', intent.executionState ?? agent?.executionState, ROW_STATE_LIMIT),
    ...optionalField(
      'executionResult',
      intent.executionResult ?? agent?.executionResult ?? evidence?.executionResult,
      ROW_DETAIL_LIMIT,
    ),
    ...optionalField(
      'executionError',
      intent.executionError ?? agent?.executionError ?? evidence?.executionError,
      ROW_DETAIL_LIMIT,
    ),
  }
}

function formatSwitchboardTaskBlock(record: SwitchboardTaskRecord): string {
  const normalized = normalizeRecord(record)
  const encoded = encodeBoundedRecord(normalized)
  return [
    `<!-- branch-continue-switchboard-task:start ${normalized.taskId} -->`,
    `Switchboard task: ${encoded}`,
    `<!-- branch-continue-switchboard-task:end ${normalized.taskId} -->`,
  ].join('\n')
}

function encodeBoundedRecord(record: SwitchboardTaskRecord): string {
  let fitted = record
  let encoded = encodeBase64Url(JSON.stringify(fitted))
  if (`Switchboard task: ${encoded}`.length <= MAX_SWITCHBOARD_TASK_LINE_LENGTH) return encoded

  fitted = compactRecord(fitted)
  encoded = encodeBase64Url(JSON.stringify(fitted))
  while (`Switchboard task: ${encoded}`.length > MAX_SWITCHBOARD_TASK_LINE_LENGTH && fitted.projection?.intents.length) {
    fitted = {
      ...fitted,
      projection: {
        ...fitted.projection,
        intents: fitted.projection.intents.slice(0, -1),
      },
    }
    encoded = encodeBase64Url(JSON.stringify(fitted))
  }
  if (`Switchboard task: ${encoded}`.length > MAX_SWITCHBOARD_TASK_LINE_LENGTH) {
    throw new Error('Switchboard task receipt exceeds its storage bound.')
  }
  return encoded
}

function compactRecord(record: SwitchboardTaskRecord): SwitchboardTaskRecord {
  const projection = record.projection
  return {
    ...record,
    ...(projection ? {
      projection: {
        ...projection,
        taskState: clippedText(projection.taskState, 48),
        rawIntentState: clippedText(projection.rawIntentState, 48),
        inboxState: clippedText(projection.inboxState, 48),
        intents: projection.intents.map((row) => ({
          ...row,
          intentId: clippedText(row.intentId, 96),
          title: clippedText(row.title, 96),
          relation: clippedOptional(row.relation, 32),
          intentState: clippedOptional(row.intentState, 32),
          summary: clippedOptional(row.summary, 96),
          nextAction: clippedOptional(row.nextAction, 96),
          blockedReason: clippedOptional(row.blockedReason, 96),
          agentName: clippedOptional(row.agentName, 96),
          agentStatus: clippedOptional(row.agentStatus, 32),
          executionId: clippedOptional(row.executionId, 96),
          executionState: clippedOptional(row.executionState, 32),
          executionResult: clippedOptional(row.executionResult, 96),
          executionError: clippedOptional(row.executionError, 96),
        })),
      },
    } : {}),
    refreshError: clippedOptional(record.refreshError, 128),
  }
}

function decodeRecord(payload: string): SwitchboardTaskRecord | null {
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payload))
    if (!isRecordShape(parsed)) return null
    const normalized = normalizeRecord(parsed)
    if (normalized.taskId !== deriveSwitchboardTaskId(normalized.receipt)) return null
    return normalized
  } catch {
    return null
  }
}

function normalizeRecord(record: SwitchboardTaskRecord): SwitchboardTaskRecord {
  const receipt = normalizeReceipt(record.receipt)
  const projection = record.projection
    ? normalizeProjection(record.projection)
    : undefined
  return {
    taskId: deriveSwitchboardTaskId(receipt),
    receipt,
    ...(projection ? { projection } : {}),
    ...optionalField('refreshError', record.refreshError, ERROR_LIMIT),
    ...optionalField('refreshErrorAt', record.refreshErrorAt, TIMESTAMP_LIMIT),
  }
}

function normalizeReceipt(receipt: SwitchboardAdmissionReceipt, limit = RECEIPT_TEXT_LIMIT): SwitchboardAdmissionReceipt {
  return {
    admissionId: requiredText(receipt.admissionId, 'admission id', limit),
    rawIntentId: requiredText(receipt.rawIntentId, 'raw intent id', limit),
    messageId: requiredText(receipt.messageId, 'message id', limit),
    sourceSystem: requiredText(receipt.sourceSystem, 'source system', limit),
    sourceRecordId: requiredText(receipt.sourceRecordId, 'source record id', limit),
    sourceHash: requiredText(receipt.sourceHash, 'source hash', limit),
    authority: requiredText(receipt.authority, 'authority', limit),
    idempotencyKey: requiredText(receipt.idempotencyKey, 'idempotency key', limit),
    admissionState: clippedText(receipt.admissionState, ROW_STATE_LIMIT) || 'admitted',
    admittedAt: clippedText(receipt.admittedAt, TIMESTAMP_LIMIT),
    handoffStartedAt: clippedText(receipt.handoffStartedAt, TIMESTAMP_LIMIT)
      || clippedText(receipt.admittedAt, TIMESTAMP_LIMIT),
  }
}

function normalizeProjection(projection: SwitchboardTaskProjection): SwitchboardTaskProjection {
  const intents = projection.intents.slice(0, MAX_SWITCHBOARD_TASK_INTENTS).map((row) => normalizeIntentRow(row))
  const totalIntentCount = Math.max(
    intents.length,
    nonNegativeInteger(projection.totalIntentCount) ?? intents.length,
  )
  const base = {
    checkedAt: clippedText(projection.checkedAt, TIMESTAMP_LIMIT),
    taskState: clippedText(projection.taskState, ROW_STATE_LIMIT) || 'unknown',
    rawIntentState: clippedText(projection.rawIntentState, ROW_STATE_LIMIT) || 'unknown',
    inboxState: clippedText(projection.inboxState, ROW_STATE_LIMIT) || 'unknown',
    totalIntentCount,
    intents,
  }
  const phase = totalIntentCount > intents.length && isSwitchboardTaskPhase(projection.phase)
    ? projection.phase
    : deriveSwitchboardTaskPhase(base)
  // Preserve the full-fan-out decision written by current clients. Legacy
  // records can only infer success-terminal status from their stored phase;
  // failed or blocked legacy projections remain live for a fresh observation.
  const pollingTerminal = typeof projection.pollingTerminal === 'boolean'
    ? projection.pollingTerminal
    : projection.phase === 'completed'
  return { ...base, phase, pollingTerminal }
}

function isRecordShape(value: unknown): value is SwitchboardTaskRecord {
  if (!isObject(value) || typeof value.taskId !== 'string' || !isObject(value.receipt)) return false
  const receipt = value.receipt
  const receiptFields = [
    'admissionId', 'rawIntentId', 'messageId', 'sourceSystem', 'sourceRecordId',
    'sourceHash', 'authority', 'idempotencyKey', 'admissionState', 'admittedAt',
  ]
  if (!receiptFields.every((field) => typeof receipt[field] === 'string')) return false
  if (value.projection !== undefined) {
    if (!isObject(value.projection) || !Array.isArray(value.projection.intents)) return false
    if (!value.projection.intents.every(isIntentShape)) return false
  }
  return true
}

function isIntentShape(value: unknown): value is SwitchboardTaskIntentRow {
  return isObject(value) && typeof value.intentId === 'string'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function switchboardTaskPattern(taskId: string): RegExp {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<!-- branch-continue-switchboard-task:start ${escaped} -->\\nSwitchboard task: [A-Za-z0-9_-]+\\n<!-- branch-continue-switchboard-task:end ${escaped} -->`)
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = clippedText(value, maxLength)
  if (!text) throw new Error(`Switchboard ${label} is required.`)
  return text
}

function clippedText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function clippedOptional(value: unknown, maxLength: number): string | undefined {
  return clippedText(value, maxLength) || undefined
}

function optionalField<K extends string>(
  key: K,
  value: unknown,
  maxLength: number,
): { [P in K]?: string } {
  const text = clippedOptional(value, maxLength)
  return text ? { [key]: text } as { [P in K]?: string } : {}
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value)
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

function isSwitchboardTaskPhase(value: unknown): value is SwitchboardTaskPhase {
  return typeof value === 'string'
    && ['admitted', 'queued', 'running', 'verifying', 'blocked', 'failed', 'completed'].includes(value)
}

function normalizedState(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, '_') ?? ''
}

function isState(value: string | undefined, states: Set<string>): boolean {
  return states.has(normalizedState(value))
}

function isCompletedIntentRow(row: SwitchboardTaskIntentRow): boolean {
  if (row.executionError?.trim()) return false
  const intentState = normalizedState(row.intentState)
  const executionState = normalizedState(row.executionState)
  return COMPLETE_STATES.has(intentState)
    && !RUNNING_STATES.has(executionState)
    && !VERIFYING_STATES.has(executionState)
}

function isPollingTerminalFanOut(rows: SwitchboardTaskIntentRow[], inboxState: string): boolean {
  // A real task can fail before routing creates any intents. This is distinct
  // from the tasks:[] response above, which remains explicitly nonterminal.
  if (rows.length === 0) return isState(inboxState, POLLING_TERMINAL_INBOX_STATES)
  return rows.every((row) => {
    if (!isState(row.intentState, POLLING_TERMINAL_INTENT_STATES)) return false
    const executionState = normalizedState(row.executionState)
    return !executionState || POLLING_TERMINAL_EXECUTION_STATES.has(executionState)
  })
}

function meaningfulObservation(record: SwitchboardTaskRecord): object {
  const normalized = normalizeRecord(record)
  const projection = normalized.projection
  const projectionContent = projection
    ? {
        phase: projection.phase,
        pollingTerminal: projection.pollingTerminal,
        taskState: projection.taskState,
        rawIntentState: projection.rawIntentState,
        inboxState: projection.inboxState,
        totalIntentCount: projection.totalIntentCount,
        intents: projection.intents,
      }
    : undefined
  return {
    taskId: normalized.taskId,
    receipt: normalized.receipt,
    projection: projectionContent,
    refreshError: normalized.refreshError,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Switchboard progress refresh failed.'
}

function stableHash(value: string): [string, string] {
  let high = 0xdeadbeef ^ value.length
  let low = 0x41c6ce57 ^ value.length
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    high = Math.imul(high ^ code, 2_654_435_761)
    low = Math.imul(low ^ code, 1_597_334_677)
  }
  high = Math.imul(high ^ (high >>> 16), 2_246_822_507)
    ^ Math.imul(low ^ (low >>> 13), 3_266_489_909)
  low = Math.imul(low ^ (low >>> 16), 2_246_822_507)
    ^ Math.imul(high ^ (high >>> 13), 3_266_489_909)
  return [(high >>> 0).toString(16).padStart(8, '0'), (low >>> 0).toString(16).padStart(8, '0')]
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8_192))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
