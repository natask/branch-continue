import { DEFAULT_AGENT_REGISTRY, resolveAgentDefinition } from './registry'
import type { AgentDefinition, AgentRouter, AgentRuntime, AgentWorkRequest, AgentWorkResult } from './types'

export interface AgentRouterOptions {
  registry?: AgentDefinition[]
  runtimes: AgentRuntime[]
}

export function createAgentRouter(options: AgentRouterOptions): AgentRouter {
  const registry = options.registry ?? DEFAULT_AGENT_REGISTRY
  const runtimes = options.runtimes

  async function route(request: AgentWorkRequest): Promise<AgentWorkResult> {
    const agent = resolveAgentDefinition(request.agentId, registry)
    const candidates = chooseRuntimeCandidates(request, agent, runtimes)
    if (candidates.length === 0) {
      return {
        runtimeId: 'none',
        status: 'failed',
        response: `No agent runtime can handle @${agent.id}.`,
        error: 'No available runtime',
      }
    }

    let lastResult: AgentWorkResult | null = null
    for (const runtime of candidates) {
      const result = await runtime.submit(request, agent)
      lastResult = result
      if (!shouldTryNextRuntime(result)) return result
    }

    return lastResult ?? {
      runtimeId: 'none',
      status: 'failed',
      response: `No agent runtime completed @${agent.id}.`,
      error: 'No runtime completed',
    }
  }

  return { route }
}

export function chooseRuntime(
  request: AgentWorkRequest,
  agent: AgentDefinition,
  runtimes: AgentRuntime[],
): AgentRuntime | null {
  return chooseRuntimeCandidates(request, agent, runtimes)[0] ?? null
}

export function chooseRuntimeCandidates(
  request: AgentWorkRequest,
  agent: AgentDefinition,
  runtimes: AgentRuntime[],
): AgentRuntime[] {
  const available = runtimes.filter((runtime) => runtime.available() && runtime.canHandle(request, agent))
  if (available.length === 0) return []

  if (agent.runtimeHint) {
    const hinted = available.find((runtime) => runtime.kind === agent.runtimeHint)
    if (hinted) return [hinted, ...available.filter((runtime) => runtime.id !== hinted.id)]
  }

  const explicitOrch = ['orch', 'master-orch', 'implementer', 'deployer', 'code'].includes(agent.id)
  if (explicitOrch) {
    const orch = available.find((runtime) => runtime.kind === 'master-orch')
    if (orch) return [orch, ...available.filter((runtime) => runtime.id !== orch.id)]
  }

  return [
    ...available.filter((runtime) => runtime.kind !== 'local'),
    ...available.filter((runtime) => runtime.kind === 'local'),
  ]
}

function shouldTryNextRuntime(result: AgentWorkResult): boolean {
  if (result.status !== 'failed') return false
  const text = `${result.error ?? ''} ${result.response ?? ''}`.toLowerCase()
  return (
    text.includes('not reachable') ||
    text.includes('failed to fetch') ||
    text.includes('connection refused') ||
    text.includes('econnrefused') ||
    text.includes('networkerror')
  )
}
