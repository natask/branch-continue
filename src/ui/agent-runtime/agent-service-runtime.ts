import type { AgentDefinition, AgentRuntime, AgentWorkRequest, AgentWorkResult } from '../../core/agents/types'

const DEFAULT_AGENT_RUNTIME_URL = 'http://127.0.0.1:8765'

export function createAgentServiceRuntime(
  baseUrl = resolveAgentRuntimeUrl(),
): AgentRuntime {
  return {
    id: 'agent-service',
    label: 'Agent runtime service',
    kind: 'custom',
    available: () => true,
    canHandle: () => true,
    submit: (request, agent) => submitToAgentService(baseUrl, request, agent),
  }
}

async function submitToAgentService(
  baseUrl: string,
  request: AgentWorkRequest,
  agent: AgentDefinition,
): Promise<AgentWorkResult> {
  let response: Response
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/agent-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, agent }),
    })
  } catch (error) {
    return {
      runtimeId: 'agent-service',
      status: 'failed',
      response: `Agent runtime service is not reachable at ${baseUrl}.`,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const payload = await response.json().catch(() => null) as Partial<AgentWorkResult> | null
  if (!response.ok) {
    return {
      runtimeId: 'agent-service',
      status: 'failed',
      response: payload?.response ?? `Agent runtime service failed with HTTP ${response.status}.`,
      error: payload?.error ?? `HTTP ${response.status}`,
    }
  }

  return {
    runtimeId: payload?.runtimeId ?? 'agent-service',
    status: payload?.status ?? 'completed',
    response: payload?.response ?? 'Agent runtime service completed without output.',
    runUrl: payload?.runUrl,
    externalId: payload?.externalId,
    error: payload?.error,
    editedDocument: payload?.editedDocument,
  }
}

function resolveAgentRuntimeUrl(): string {
  return import.meta.env.VITE_AGENT_RUNTIME_URL || DEFAULT_AGENT_RUNTIME_URL
}

export interface CodexAccountState {
  account: { type: string; email?: string | null; planType?: string } | null
  requiresOpenaiAuth: boolean
}

export interface CodexSignIn {
  loginId?: string
  authUrl?: string
  verificationUrl?: string
  userCode?: string
}

export async function getCodexAccount(baseUrl = resolveAgentRuntimeUrl()): Promise<CodexAccountState> {
  return codexAccountRequest(baseUrl, '/codex/account')
}

export async function startCodexSignIn(baseUrl = resolveAgentRuntimeUrl(), deviceCode = usesRemoteCodexRuntime(baseUrl)): Promise<CodexSignIn> {
  return codexAccountRequest(baseUrl, '/codex/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceCode }),
  })
}

async function codexAccountRequest<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, init)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || `Codex account request failed (${response.status}).`)
  return payload as T
}

/** A browser callback on localhost cannot reach a runtime hosted on another device. */
export function usesRemoteCodexRuntime(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname
  return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}
