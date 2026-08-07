import type { SourceNote } from '../quicknote/types'
import { extractAudioCaptureReferences } from '../audio/audio-store'

export const SWITCHBOARD_EXTERNAL_INTENT_PATH = '/api/v1/external-intents'
export const DEFAULT_SWITCHBOARD_URL = 'http://127.0.0.1:4317'
export const DEFAULT_SWITCHBOARD_TIMEOUT_MS = 15_000

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
  rawIntentId?: string
  messageId?: string
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

  const exactText = renderExactIntentText(note)
  if (!exactText) throw new Error('Add text to this branch before handing it off.')

  const revision = JSON.stringify({
    noteUid,
    parentNoteId: note.parentNoteId,
    title: note.title,
    timestamp: note.timestamp,
    tags: note.tags,
    body: note.body,
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
      ...extractAudioCaptureReferences(note.body).map((reference) => ({
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

export function validateAdmissionBinding(
  response: SwitchboardAdmissionResponse,
  envelope: SwitchboardExternalIntentEnvelope,
): void {
  const admission = response?.admission
  if (!admission?.id) throw new Error('Switchboard returned an invalid admission response.')

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

export function switchboardEndpoint(baseUrl = DEFAULT_SWITCHBOARD_URL): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('The Switchboard URL is empty.')
  return `${normalized}${SWITCHBOARD_EXTERNAL_INTENT_PATH}`
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

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SWITCHBOARD_TIMEOUT_MS
  if (!Number.isFinite(value) || value <= 0) throw new Error('Switchboard timeout must be positive.')
  return Math.min(Math.round(value), 60_000)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = globalThis.setTimeout(
      () => reject(new Error('Switchboard handoff timed out.')),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
  }
}
