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
  }
}

function resolveAgentRuntimeUrl(): string {
  return import.meta.env.VITE_AGENT_RUNTIME_URL || DEFAULT_AGENT_RUNTIME_URL
}
