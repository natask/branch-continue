import type { AgentDefinition } from './types'

export const DEFAULT_AGENT_ID = 'agent'

export const DEFAULT_AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: DEFAULT_AGENT_ID,
    label: 'Agent Router',
    purpose: 'Route a general request to the best available worker.',
  },
  {
    id: 'critic',
    label: 'Critic',
    purpose: 'Find weak assumptions, failure modes, and missing constraints.',
    runtimeHint: 'model',
  },
  {
    id: 'researcher',
    label: 'Researcher',
    purpose: 'Find prior art, sources, and competing approaches.',
    runtimeHint: 'search',
  },
  {
    id: 'editor',
    label: 'Editor',
    purpose: 'Improve writing without replacing the user voice.',
    runtimeHint: 'model',
  },
  {
    id: 'architect',
    label: 'Architect',
    purpose: 'Pressure-test schemas, system boundaries, and long-term tradeoffs.',
    runtimeHint: 'model',
  },
  {
    id: 'orch',
    label: 'Master Orch',
    purpose: 'Send the request to the orchestration/deployment worker runtime.',
    runtimeHint: 'master-orch',
    allowedActions: ['post-comment', 'triage-and-run'],
  },
  {
    id: 'implementer',
    label: 'Implementer',
    purpose: 'Turn scoped product or code requests into implementation work.',
    runtimeHint: 'master-orch',
    allowedActions: ['post-comment', 'triage-and-run'],
  },
]

export function resolveAgentDefinition(
  agentId: string,
  registry: AgentDefinition[] = DEFAULT_AGENT_REGISTRY,
): AgentDefinition {
  const normalized = normalizeAgentId(agentId)
  return (
    registry.find((agent) => normalizeAgentId(agent.id) === normalized) ?? {
      id: normalized || DEFAULT_AGENT_ID,
      label: normalized || 'Agent',
      purpose: 'Ad-hoc inline worker.',
    }
  )
}

export function normalizeAgentId(agentId: string): string {
  return agentId.trim().replace(/^@+/, '').toLowerCase()
}
