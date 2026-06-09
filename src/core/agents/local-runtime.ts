import type { AgentDefinition, AgentRuntime, AgentWorkRequest, AgentWorkResult } from './types'

export function createLocalAgentRuntime(): AgentRuntime {
  return {
    id: 'local',
    label: 'Local capture runtime',
    kind: 'local',
    available: () => true,
    canHandle: () => true,
    submit: async (request, agent) => createLocalResult(request, agent),
  }
}

function createLocalResult(request: AgentWorkRequest, agent: AgentDefinition): AgentWorkResult {
  return {
    runtimeId: 'local',
    status: 'completed',
    response: [
      `@${agent.id} request captured locally.`,
      '',
      `Role: ${agent.purpose}`,
      `Prompt: ${request.prompt}`,
      '',
      'Anchor:',
      request.context.quote,
      '',
      'Context sent:',
      request.context.localContext,
    ].join('\n'),
  }
}
