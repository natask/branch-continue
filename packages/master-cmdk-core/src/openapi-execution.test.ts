import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { actionExecutorFromAdapter, createActionRegistry } from './actions'
import type { ActionDefinition } from './actions'
import {
  createOpenApiExecutionAdapter,
  OpenApiExecutionError,
} from './openapi-execution'
import type {
  OpenApiExecutionAdapterOptions,
  OpenApiExecutionInput,
  OpenApiExecutionResult,
} from './openapi-execution'

const identity = {
  id: 'fixture-api',
  kind: 'openapi',
  configRef: 'fixture-runtime',
} as const

const permission = {
  adapter: { id: 'fixture-policy', kind: 'permission', configRef: 'fixture-policy-runtime' },
  resource: 'widgets',
} as const

const operations = [
  { operation: 'getWidget', method: 'GET', path: '/widgets/{id}', allowedHeaders: ['X-Trace-Id'] },
  { operation: 'createWidget', method: 'POST', path: '/widgets' },
  { operation: 'largeResponse', method: 'GET', path: '/large' },
  { operation: 'slowRead', method: 'GET', path: '/slow' },
  { operation: 'retryRead', method: 'GET', path: '/retry' },
  { operation: 'retryWrite', method: 'POST', path: '/retry' },
  { operation: 'badRead', method: 'GET', path: '/bad' },
  { operation: 'redirectRead', method: 'GET', path: '/redirect' },
  { operation: 'networkRead', method: 'GET', path: '/drop' },
  { operation: 'networkWrite', method: 'POST', path: '/drop' },
] as const

let origin = ''
let calls: Array<{ method: string; url: string; authorization?: string; trace?: string; body: string }> = []

const server = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    calls.push({
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization,
      trace: request.headers['x-trace-id'] as string | undefined,
      body,
    })

    if (request.url === '/large') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('x'.repeat(256))
      return
    }
    if (request.url === '/slow') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"ok":')
      setTimeout(() => response.end('true}'), 100)
      return
    }
    if (request.url === '/retry') {
      response.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '2' })
      response.end('runtime-secret must stay private')
      return
    }
    if (request.url === '/bad') {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('runtime-secret must stay private')
      return
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'https://example.com/never-follow' })
      response.end()
      return
    }
    if (request.url === '/drop') {
      request.socket.destroy()
      return
    }

    response.writeHead(request.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        trace: request.headers['x-trace-id'],
        body: body ? JSON.parse(body) : null,
      }),
    )
  })
})

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

beforeEach(() => {
  calls = []
})

function action(
  operation: string,
  options: { access?: 'read' | 'write'; permission?: boolean } = {},
): ActionDefinition<OpenApiExecutionInput, OpenApiExecutionResult> {
  const access = options.access ?? 'read'
  return {
    id: `fixture-api:${operation}`,
    title: operation,
    authority: { access },
    effects: {
      readOnly: access === 'read',
      destructive: false,
      idempotent: access === 'read',
      openWorld: true,
    },
    confirmation: access === 'write' ? 'writes' : 'never',
    source: { kind: 'openapi', adapter: identity },
    execution: { adapter: identity, operation },
    ...(options.permission ? { permission } : {}),
  }
}

function adapter(overrides: Partial<OpenApiExecutionAdapterOptions> = {}) {
  return createOpenApiExecutionAdapter({
    identity,
    allowedOrigins: [origin],
    allowedOperations: operations,
    resolveRuntime: async (configRef) => {
      expect(configRef).toBe('fixture-runtime')
      return { baseUrl: origin, headers: { authorization: 'Bearer runtime-secret' } }
    },
    ...overrides,
  })
}

async function execute(
  definition: ActionDefinition<OpenApiExecutionInput, OpenApiExecutionResult>,
  input: OpenApiExecutionInput,
  executionAdapter = adapter(),
) {
  return executionAdapter.execute(
    { action: definition, input },
    { signal: new AbortController().signal },
  )
}

describe('createOpenApiExecutionAdapter', () => {
  test('executes an allowlisted operation with runtime credentials', async () => {
    const result = await execute(action('getWidget'), {
      path: { id: 'widget one' },
      query: { include: ['owner', 'history'], active: true },
      header: { 'X-Trace-Id': 'trace-1' },
    })

    expect(result).toEqual({
      status: 200,
      body: {
        method: 'GET',
        url: '/widgets/widget%20one?active=true&include=owner&include=history',
        authorization: '[REDACTED]',
        trace: 'trace-1',
        body: null,
      },
    })
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('runtime-secret')
  })

  test('rejects actions, operations, and origins outside the allowlist', async () => {
    const resolveRuntime = vi.fn(() => ({ baseUrl: origin }))
    const executionAdapter = adapter({ resolveRuntime })
    const wrongAction = {
      ...action('getWidget'),
      execution: {
        adapter: { ...identity, id: 'other-api' },
        operation: 'getWidget',
      },
    }

    await expect(execute(wrongAction, {}, executionAdapter)).rejects.toMatchObject({ code: 'action_not_allowed' })
    await expect(execute(action('missing'), {}, executionAdapter)).rejects.toMatchObject({
      code: 'operation_not_allowed',
    })
    expect(resolveRuntime).not.toHaveBeenCalled()

    const wrongOrigin = adapter({ resolveRuntime: () => ({ baseUrl: 'http://127.0.0.1:1' }) })
    await expect(execute(action('getWidget'), { path: { id: '1' } }, wrongOrigin)).rejects.toMatchObject({
      code: 'origin_not_allowed',
    })
    expect(calls).toHaveLength(0)
  })

  test('rejects oversized request and response bodies', async () => {
    const requestLimited = adapter({ limits: { maxRequestBytes: 16 } })
    await expect(
      execute(action('createWidget', { access: 'write' }), { body: { name: 'x'.repeat(32) } }, requestLimited),
    ).rejects.toMatchObject({ code: 'request_too_large', retryable: false })
    expect(calls).toHaveLength(0)

    const responseLimited = adapter({ limits: { maxResponseBytes: 32 } })
    await expect(execute(action('largeResponse'), {}, responseLimited)).rejects.toMatchObject({
      code: 'response_too_large',
      retryable: false,
    })
  })

  test('caps the full runtime and response timeout', async () => {
    const slowRuntime = adapter({
      limits: { timeoutMs: 20 },
      resolveRuntime: () => new Promise(() => undefined),
    })
    await expect(execute(action('getWidget'), { path: { id: '1' } }, slowRuntime)).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })

    const slowResponse = adapter({ limits: { timeoutMs: 20 } })
    await expect(execute(action('slowRead'), {}, slowResponse)).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    })
  })

  test('classifies retryable HTTP failures without exposing response secrets', async () => {
    const retryable = await execute(action('retryRead'), {}).catch((error: unknown) => error)
    expect(retryable).toBeInstanceOf(OpenApiExecutionError)
    expect(retryable).toMatchObject({ code: 'http_error', status: 503, retryable: true, retryAfterMs: 2000 })
    expect(JSON.stringify(retryable)).not.toContain('runtime-secret')
    expect((retryable as Error).message).not.toContain('runtime-secret')

    await expect(execute(action('badRead'), {})).rejects.toMatchObject({
      code: 'http_error',
      status: 400,
      retryable: false,
    })
    await expect(execute(action('retryWrite', { access: 'write' }), {})).rejects.toMatchObject({
      code: 'http_error',
      status: 503,
      retryable: false,
    })
  })

  test('classifies network failures from the local fixture by idempotency', async () => {
    await expect(execute(action('networkRead'), {})).rejects.toMatchObject({
      code: 'network_error',
      retryable: true,
    })
    await expect(execute(action('networkWrite', { access: 'write' }), {})).rejects.toMatchObject({
      code: 'network_error',
      retryable: false,
    })
  })

  test('does not follow redirects or accept credential headers from action input', async () => {
    await expect(execute(action('redirectRead'), {})).rejects.toMatchObject({
      code: 'http_error',
      status: 302,
      retryable: false,
    })
    expect(calls).toHaveLength(1)

    await expect(
      execute(action('getWidget'), { path: { id: '1' }, header: { Authorization: 'Bearer injected' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(calls).toHaveLength(1)
  })

  test('redacts runtime resolver failures and validates hard limit caps', async () => {
    const resolverFailure = adapter({
      resolveRuntime: () => {
        throw new Error('runtime-secret')
      },
    })
    const error = await execute(action('getWidget'), { path: { id: '1' } }, resolverFailure).catch(
      (failure: unknown) => failure,
    )
    expect(error).toMatchObject({ code: 'runtime_config_error', retryable: false })
    expect((error as Error).message).not.toContain('runtime-secret')

    expect(() => adapter({ limits: { timeoutMs: 60_001 } })).toThrow('timeoutMs must be between')
    expect(() => adapter({ limits: { maxRequestBytes: 1024 * 1024 + 1 } })).toThrow(
      'maxRequestBytes must be between',
    )
  })

  test('runs through registry permission and confirmation gates', async () => {
    const writeAction = action('createWidget', { access: 'write', permission: true })
    const executionAdapter = adapter()
    const deniedRegistry = createActionRegistry({
      authorize: () => ({ decision: 'deny', reason: 'Writes disabled' }),
    })
    deniedRegistry.register(writeAction, actionExecutorFromAdapter(executionAdapter))
    await expect(deniedRegistry.execute(writeAction.id, { body: { name: 'Ada' } })).resolves.toMatchObject({
      status: 'denied',
    })
    expect(calls).toHaveLength(0)

    const missingPermissionRegistry = createActionRegistry()
    missingPermissionRegistry.register(writeAction, actionExecutorFromAdapter(executionAdapter))
    await expect(
      missingPermissionRegistry.execute(writeAction.id, { body: { name: 'Ada' } }),
    ).resolves.toMatchObject({
      status: 'denied',
      denial: { code: 'permission_adapter_missing' },
    })
    expect(calls).toHaveLength(0)

    const allowedRegistry = createActionRegistry({ authorize: () => ({ decision: 'allow' }) })
    allowedRegistry.register(writeAction, actionExecutorFromAdapter(executionAdapter))
    await expect(allowedRegistry.execute(writeAction.id, { body: { name: 'Ada' } })).resolves.toMatchObject({
      status: 'confirming',
    })
    expect(calls).toHaveLength(0)
    await expect(
      allowedRegistry.execute(writeAction.id, { body: { name: 'Ada' } }, { confirmed: true }),
    ).resolves.toMatchObject({ status: 'succeeded' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/widgets',
      authorization: 'Bearer runtime-secret',
      body: '{"name":"Ada"}',
    })
  })
})
