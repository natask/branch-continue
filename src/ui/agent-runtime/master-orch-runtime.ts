import type { AgentDefinition, AgentRuntime, AgentWorkRequest, AgentWorkResult } from '../../core/agents/types'
import type { useAgentStation } from '../agent-station/use-agent-station'

export function createMasterOrchAgentRuntime(
  station: ReturnType<typeof useAgentStation>,
): AgentRuntime {
  return {
    id: 'master-orch',
    label: 'Master Orch',
    kind: 'master-orch',
    available: () => station.configured && station.availability === 'available',
    canHandle: () => true,
    submit: (request, agent) => submitToMasterOrch(station, request, agent),
  }
}

async function submitToMasterOrch(
  station: ReturnType<typeof useAgentStation>,
  request: AgentWorkRequest,
  agent: AgentDefinition,
): Promise<AgentWorkResult> {
  const comment = await station.client.postComment({
    body: [
      `@${agent.id} ${request.prompt}`,
      '',
      `Agent role: ${agent.purpose}`,
      '',
      'Anchor:',
      request.context.quote,
      '',
      'Context:',
      request.context.localContext,
    ].join('\n'),
    anchor: {
      label: request.context.quote,
      route: request.source,
    },
    metadata: {
      kind: 'agent-work-request',
      actor: 'agent-router',
      requestId: request.id,
      agentId: agent.id,
      runtime: 'master-orch',
      pageId: request.context.pageId,
      anchorId: request.context.anchorId,
      threadId: request.context.threadId,
      ...request.metadata,
    },
  })
  const commentId = typeof comment.comment?.id === 'string' ? comment.comment.id : undefined
  const triage = await station.client.triageAndRun({
    mode: 'single',
    commentIds: commentId ? [commentId] : [],
    instruction: [
      `Route and run @${agent.id} for this inline work request.`,
      '',
      `Prompt: ${request.prompt}`,
      '',
      `Role: ${agent.purpose}`,
    ].join('\n'),
  })
  await station.refresh({ reason: 'agent-router-request', commentId })
  const run = extractFirstRecord(triage, 'run', 'runs')
  const runId = typeof run?.id === 'string' ? run.id : undefined
  const runUrl = runId ? `${station.dashboardUrl}#run-${runId}` : undefined

  return {
    runtimeId: 'master-orch',
    status: 'launched',
    externalId: commentId,
    runUrl,
    response: [
      `@${agent.id} routed to Master Orch.`,
      '',
      `Prompt: ${request.prompt}`,
      commentId ? `Comment: ${commentId}` : '',
      runUrl ? `Run: ${runUrl}` : '',
    ].filter(Boolean).join('\n'),
  }
}

function extractFirstRecord(payload: unknown, singularKey: string, pluralKey: string): { id?: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const singular = record[singularKey]
  if (singular && typeof singular === 'object') return singular as { id?: string }
  const plural = record[pluralKey]
  if (Array.isArray(plural)) {
    const first = plural.find((item) => item && typeof item === 'object')
    if (first) return first as { id?: string }
  }
  return null
}
