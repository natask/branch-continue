import type { SourceNote } from '../quicknote/types'
import { extractAudioCaptureReferences } from '../audio/audio-store'
import { stripSwitchboardTasks } from './switchboard-task'

export const SWITCHBOARD_EXTERNAL_INTENT_PATH = '/api/v1/external-intents'
export const SWITCHBOARD_TASKS_PATH = '/api/v1/tasks'
export const DEFAULT_SWITCHBOARD_URL = 'http://127.0.0.1:4317'
export const DEFAULT_SWITCHBOARD_TIMEOUT_MS = 15_000
export const DEFAULT_SWITCHBOARD_STATUS_TIMEOUT_MS = 10_000

export interface SwitchboardExternalIntentEnvelope {
  contract_version: 1
  source_system: 'branch-continue'
  source_record_id: string
  source_hash: string
  exact_text: string
  evidence_refs: Array<Record<string, unknown>>
  context_refs: Array<Record<string, unknown>>
  project_hint?: string
  authority: 'execute'
  idempotency_key: string
}

export interface SwitchboardAdmission {
  id: string
  sourceSystem: string
  sourceRecordId: string
  sourceHash: string | null
  authority: string
  idempotencyKey: string
  rawIntentId: string
  messageId: string
  state?: string
  compiledIntents?: unknown[]
}

export interface SwitchboardAdmissionResponse {
  admission: SwitchboardAdmission
}

export interface SubmitBranchOptions {
  baseUrl?: string
  projectHint?: string
  timeoutMs?: number
  transport?: (
    endpoint: string,
    envelope: SwitchboardExternalIntentEnvelope,
    timeoutMs: number,
  ) => Promise<SwitchboardAdmissionResponse>
}

export interface SwitchboardTaskIntentResponse {
  relation?: unknown
  intentId?: unknown
  workstreamNumber?: unknown
  title?: unknown
  progress?: unknown
  agent?: unknown
  updates?: unknown
}

export interface SwitchboardTaskResponse {
  taskId: string
  messageId: string
  sourceText?: unknown
  provenance?: unknown
  state?: unknown
  inboxState?: unknown
  routes?: unknown
  intents: SwitchboardTaskIntentResponse[]
}

export interface SwitchboardTasksResponse {
  tasks: SwitchboardTaskResponse[]
}

export interface FetchSwitchboardTasksOptions {
  baseUrl?: string
  rawIntentId?: string
  timeoutMs?: number
  signal?: AbortSignal
  transport?: (
    endpoint: string,
    messageId: string,
    rawIntentId: string | undefined,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<SwitchboardTasksResponse>
}

/**
 * Builds the immutable admission envelope for one saved branch revision.
 * Disposition is intentionally excluded: marking a successful retry as
 * `handed-off` must not create a second Switchboard admission.
 */
export async function buildBranchExecuteEnvelope(
  note: SourceNote,
  projectHint?: string,
): Promise<SwitchboardExternalIntentEnvelope> {
  const noteUid = note.noteUid?.trim()
  if (!noteUid) throw new Error('Save this branch once before handing it off.')
  if (!note.parentNoteId?.trim()) throw new Error('Only a branch can be handed off from this control.')

  // The receipt and progress projection are local control-plane metadata. They
  // must never become executable source text or change a retry's identity.
  const executableBody = stripSwitchboardTasks(note.body)
  const executableNote = executableBody === note.body ? note : { ...note, body: executableBody }
  const exactText = renderExactIntentText(executableNote)
  if (!exactText) throw new Error('Add text to this branch before handing it off.')

  const revision = JSON.stringify({
    noteUid,
    parentNoteId: note.parentNoteId,
    title: note.title,
    timestamp: note.timestamp,
    tags: note.tags,
    body: executableBody,
  })
  const digest = await sha256Hex(revision)
  const sourceHash = `sha256:${digest}`

  return {
    contract_version: 1,
    source_system: 'branch-continue',
    source_record_id: noteUid,
    source_hash: sourceHash,
    exact_text: exactText,
    evidence_refs: [],
    context_refs: [
      {
        type: 'branch-continue-lineage',
        source_path: note.sourcePath,
        parent_note_id: note.parentNoteId,
      },
      ...extractAudioCaptureReferences(executableBody).map((reference) => ({
        type: 'branch-continue-audio',
        uri: reference.uri,
      })),
    ],
    ...(projectHint?.trim() ? { project_hint: projectHint.trim() } : {}),
    authority: 'execute',
    idempotency_key: `branch-continue:${noteUid}:${sourceHash}`,
  }
}

export async function submitBranchForExecution(
  note: SourceNote,
  options: SubmitBranchOptions = {},
): Promise<SwitchboardAdmissionResponse> {
  const envelope = await buildBranchExecuteEnvelope(note, options.projectHint)
  const endpoint = switchboardEndpoint(options.baseUrl)
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs)
  const response = await withTimeout(
    (options.transport ?? postExternalIntent)(endpoint, envelope, timeoutMs),
    timeoutMs,
  )
  validateAdmissionBinding(response, envelope)
  return response
}

export async function fetchSwitchboardTasks(
  messageId: string,
  options: FetchSwitchboardTasksOptions = {},
): Promise<SwitchboardTasksResponse> {
  const normalizedMessageId = messageId.trim()
  if (!normalizedMessageId) throw new Error('Switchboard status requires a message ID.')
  const rawIntentId = options.rawIntentId?.trim() || undefined
  const endpoint = switchboardTasksEndpoint(options.baseUrl)
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? DEFAULT_SWITCHBOARD_STATUS_TIMEOUT_MS)
  const response = await withSwitchboardStatusDeadline(
    (signal) => (options.transport ?? getSwitchboardTasks)(
      endpoint,
      normalizedMessageId,
      rawIntentId,
      timeoutMs,
      signal,
    ),
    timeoutMs,
    options.signal,
  )
  validateSwitchboardTasksResponse(response, normalizedMessageId, rawIntentId)
  return response
}

export function validateAdmissionBinding(
  response: SwitchboardAdmissionResponse,
  envelope: SwitchboardExternalIntentEnvelope,
): void {
  const admission = response?.admission
  if (!admission?.id) throw new Error('Switchboard returned an invalid admission response.')
  if (!admission.messageId?.trim()) {
    throw new Error('Switchboard admission is missing its durable message ID.')
  }
  if (!admission.rawIntentId?.trim()) {
    throw new Error('Switchboard admission is missing its durable raw intent ID.')
  }

  const expected: Array<[keyof SwitchboardAdmission, string]> = [
    ['sourceSystem', envelope.source_system],
    ['sourceRecordId', envelope.source_record_id],
    ['sourceHash', envelope.source_hash],
    ['authority', envelope.authority],
    ['idempotencyKey', envelope.idempotency_key],
  ]
  const mismatch = expected.find(([key, value]) => admission[key] !== value)
  if (mismatch) {
    throw new Error(`Switchboard admission does not match this branch revision (${mismatch[0]}).`)
  }
}

export function validateSwitchboardTasksResponse(
  response: SwitchboardTasksResponse,
  messageId: string,
  rawIntentId?: string,
): void {
  if (!response || !Array.isArray(response.tasks)) {
    throw new Error('Switchboard returned an invalid task response.')
  }
  if (response.tasks.length > 1) {
    throw new Error('Switchboard returned more than one task for this message.')
  }
  const task = response.tasks[0]
  if (!task) return
  if (!task || typeof task !== 'object' || !Array.isArray(task.intents)) {
    throw new Error('Switchboard returned an invalid task response.')
  }
  if (task.messageId !== messageId) {
    throw new Error('Switchboard task does not match this admission (messageId).')
  }
  if (rawIntentId && task.taskId !== rawIntentId) {
    throw new Error('Switchboard task does not match this admission (rawIntentId).')
  }
}

export function switchboardEndpoint(baseUrl = DEFAULT_SWITCHBOARD_URL): string {
  return `${normalizedSwitchboardBaseUrl(baseUrl)}${SWITCHBOARD_EXTERNAL_INTENT_PATH}`
}

export function switchboardTasksEndpoint(baseUrl = DEFAULT_SWITCHBOARD_URL): string {
  return `${normalizedSwitchboardBaseUrl(baseUrl)}${SWITCHBOARD_TASKS_PATH}`
}

function renderExactIntentText(note: SourceNote): string {
  const body = note.body.trim()
  const title = note.title.trim()
  if (!body) return title === 'Untitled' ? '' : title
  if (!title || title === 'Untitled') return body
  return `${title}\n\n${body}`
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function postExternalIntent(
  endpoint: string,
  envelope: SwitchboardExternalIntentEnvelope,
  timeoutMs: number,
): Promise<SwitchboardAdmissionResponse> {
  const { isTauri, invoke } = await import('@tauri-apps/api/core')
  if (isTauri()) {
    return invoke<SwitchboardAdmissionResponse>('submit_switchboard_intent', {
      endpoint,
      envelope,
      timeoutMs,
    })
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Switchboard handoff timed out.')
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
  const value = await response.json().catch(() => null) as SwitchboardAdmissionResponse | { error?: string } | null
  if (!response.ok) {
    const message = value && 'error' in value ? value.error : null
    throw new Error(message || `Switchboard rejected the handoff (${response.status}).`)
  }
  if (!value || !('admission' in value) || !value.admission?.id) {
    throw new Error('Switchboard returned an invalid admission response.')
  }
  return value
}

async function getSwitchboardTasks(
  endpoint: string,
  messageId: string,
  rawIntentId: string | undefined,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<SwitchboardTasksResponse> {
  const { isTauri, invoke } = await import('@tauri-apps/api/core')
  throwIfSwitchboardStatusAborted(signal)
  if (isTauri()) {
    return invoke<SwitchboardTasksResponse>('fetch_switchboard_tasks', {
      endpoint,
      messageId,
      expectedRawIntentId: rawIntentId,
      timeoutMs,
    })
  }

  const url = new URL(endpoint)
  url.searchParams.set('message_id', messageId)
  url.searchParams.set('limit', '1')
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw switchboardStatusAbortError()
    throw error
  }
  const value = await response.json().catch(() => null) as SwitchboardTasksResponse | { error?: string } | null
  if (!response.ok) {
    const message = value && 'error' in value ? value.error : null
    throw new Error(message || `Switchboard rejected the status lookup (${response.status}).`)
  }
  if (!value || !('tasks' in value)) throw new Error('Switchboard returned an invalid task response.')
  return value
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SWITCHBOARD_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) throw new Error('Switchboard timeout must be positive.')
  return Math.min(Math.round(value), 60_000)
}

function normalizedSwitchboardBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('The Switchboard URL is empty.')
  return normalized
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Switchboard handoff timed out.',
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = globalThis.setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
  }
}

async function withSwitchboardStatusDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  throwIfSwitchboardStatusAborted(externalSignal)

  const controller = new AbortController()
  let abortCause: 'external' | 'timeout' | undefined
  const abortFromExternal = () => {
    if (controller.signal.aborted) return
    abortCause = 'external'
    controller.abort()
  }
  const abortFromTimeout = () => {
    if (controller.signal.aborted) return
    abortCause = 'timeout'
    controller.abort()
  }
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(abortCause === 'timeout'
        ? new Error('Switchboard status lookup timed out.')
        : switchboardStatusAbortError())
    }, { once: true })
  })

  externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timeout = globalThis.setTimeout(abortFromTimeout, timeoutMs)
  try {
    return await Promise.race([operation(controller.signal), cancelled])
  } finally {
    globalThis.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

function throwIfSwitchboardStatusAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw switchboardStatusAbortError()
}

function switchboardStatusAbortError(): Error {
  const error = new Error('Switchboard status lookup was cancelled.')
  error.name = 'AbortError'
  return error
}
