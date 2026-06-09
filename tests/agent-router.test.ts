import { describe, expect, it } from 'vitest'
import { createLocalAgentRuntime } from '../src/core/agents/local-runtime'
import { createAgentRouter, chooseRuntime } from '../src/core/agents/router'
import type { AgentDefinition, AgentRuntime, AgentWorkRequest } from '../src/core/agents/types'

const REQUEST: AgentWorkRequest = {
  id: 'request_1',
  agentId: 'critic',
  prompt: 'where is this weak?',
  source: '/agentic-markdown',
  context: {
    pageId: 'page_1',
    anchorId: 'anchor_1',
    threadId: 'thread_1',
    quote: '@critic where is this weak?',
    localContext: 'A paragraph about architecture.',
    documentText: 'A paragraph about architecture.\n@critic where is this weak?',
  },
}

describe('agent router', () => {
  it('prefers the agent runtime hint when that runtime is available', async () => {
    const model = fakeRuntime('model-1', 'model', true)
    const local = createLocalAgentRuntime()
    const router = createAgentRouter({ runtimes: [local, model] })

    const result = await router.route(REQUEST)

    expect(result.runtimeId).toBe('model-1')
  })

  it('routes explicit orch agents to Master Orch when available', () => {
    const orch = fakeRuntime('master-orch', 'master-orch', true)
    const local = createLocalAgentRuntime()
    const agent: AgentDefinition = {
      id: 'orch',
      label: 'Master Orch',
      purpose: 'route to orch',
      runtimeHint: 'master-orch',
    }

    expect(chooseRuntime({ ...REQUEST, agentId: 'orch' }, agent, [local, orch])?.id).toBe('master-orch')
  })

  it('falls back to local capture when external runtimes are unavailable', async () => {
    const model = fakeRuntime('model-1', 'model', false)
    const router = createAgentRouter({ runtimes: [model, createLocalAgentRuntime()] })

    const result = await router.route(REQUEST)

    expect(result.runtimeId).toBe('local')
    expect(result.response).toContain('request captured locally')
  })

  it('tries the next runtime when the first runtime is unreachable', async () => {
    const unreachable = fakeRuntime('agent-service', 'custom', true, {
      status: 'failed',
      response: 'Agent runtime service is not reachable at http://127.0.0.1:8765.',
      error: 'Failed to fetch',
    })
    const router = createAgentRouter({ runtimes: [unreachable, createLocalAgentRuntime()] })

    const result = await router.route(REQUEST)

    expect(result.runtimeId).toBe('local')
  })
})

function fakeRuntime(
  id: string,
  kind: AgentRuntime['kind'],
  available: boolean,
  result?: {
    status: 'completed' | 'launched' | 'failed'
    response: string
    error?: string
  },
): AgentRuntime {
  return {
    id,
    label: id,
    kind,
    available: () => available,
    canHandle: () => true,
    submit: async () => ({
      runtimeId: id,
      status: result?.status ?? 'completed',
      response: result?.response ?? `${id} handled request`,
      error: result?.error,
    }),
  }
}
