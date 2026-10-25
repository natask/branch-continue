import { describe, expect, test, vi } from 'vitest'
import { createActionRegistry, defineActions, requiresActionConfirmation } from './actions'
import type {
  ActionDefinition,
  ActionDocumentSource,
  ActionExecutionAdapter,
  ActionPermissionAdapter,
  ActionSourceAdapter,
} from './actions'

const readAction = {
  id: 'find-customer',
  title: 'Find customer',
  authority: { access: 'read', scopes: ['customers:read'] },
  effects: {
    readOnly: true,
    destructive: false,
    idempotent: true,
    openWorld: false,
  },
  confirmation: 'writes',
  source: { kind: 'manual' },
} as const

const writeAction = {
  id: 'invite-teammate',
  title: 'Invite teammate',
  authority: { access: 'write', scopes: ['team:write'] },
  inputSchema: {
    type: 'object',
    properties: { email: { type: 'string', format: 'email' } },
    required: ['email'],
  },
  outputSchema: {
    type: 'object',
    properties: { invited: { type: 'string' } },
    required: ['invited'],
  },
  effects: {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  confirmation: 'writes',
  source: { kind: 'manual', provenance: 'playground' },
} as const

const openApiAdapter = {
  id: 'billing-api',
  kind: 'openapi',
  version: '3.2',
  configRef: 'billing-production',
} as const

const permissionAdapter = {
  id: 'app-policy',
  kind: 'permission',
  configRef: 'production-policy',
} as const

const openApiAction: ActionDefinition<{ invoiceId: string }, { status: string }> = {
  id: 'refund-invoice',
  title: 'Refund invoice',
  authority: { access: 'write', scopes: ['invoices:refund'] },
  effects: {
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
  },
  confirmation: 'always',
  source: {
    kind: 'openapi',
    reference: '#/paths/~1invoices~1{id}~1refund/post',
    adapter: openApiAdapter,
  },
  execution: {
    adapter: openApiAdapter,
    operation: 'refundInvoice',
  },
  permission: {
    adapter: permissionAdapter,
    resource: 'invoice',
  },
}

describe('defineActions', () => {
  test('keeps a serializable manifest unchanged', () => {
    const manifest = defineActions([readAction, writeAction])

    expect(manifest[1]).toBe(writeAction)
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })

  test('rejects duplicate ids', () => {
    expect(() => defineActions([readAction, readAction])).toThrow('Duplicate action id: find-customer')
  })

  test('keeps adapter references serializable without inline configuration', () => {
    const [action] = defineActions([openApiAction])
    const serialized = JSON.stringify(action)

    expect(JSON.parse(serialized)).toEqual(action)
    expect(action.execution?.adapter.configRef).toBe('billing-production')
    expect(serialized).not.toMatch(/apiKey|password|secret|token/i)
  })

  test('rejects authority that conflicts with declared effects', () => {
    expect(() =>
      defineActions([
        {
          ...readAction,
          authority: { access: 'write' },
        },
      ]),
    ).toThrow('Write authority requires write effects: find-customer')
  })
})

describe('adapter contracts', () => {
  test('loads and executes through runtime adapters', async () => {
    const source: ActionSourceAdapter<ActionDocumentSource<object>> = {
      identity: openApiAdapter,
      load: async () => [openApiAction],
    }
    const execution: ActionExecutionAdapter<{ invoiceId: string }, { status: string }> = {
      identity: openApiAdapter,
      execute: async ({ input }) => ({ status: `refunded:${input.invoiceId}` }),
    }
    const permission: ActionPermissionAdapter = {
      identity: permissionAdapter,
      authorize: async () => ({ decision: 'allow', confirmation: 'required' }),
    }

    await expect(source.load({ document: {} }, { signal: new AbortController().signal })).resolves.toEqual([
      openApiAction,
    ])
    await expect(
      execution.execute(
        { action: openApiAction, input: { invoiceId: 'inv-1' } },
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ status: 'refunded:inv-1' })
    await expect(
      permission.authorize(
        { action: openApiAction, input: { invoiceId: 'inv-1' } },
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ decision: 'allow', confirmation: 'required' })
  })
})

describe('createActionRegistry', () => {
  test('registers and lists actions in source order', () => {
    const registry = createActionRegistry()
    registry.register(readAction, () => ({ customer: 'Ada' }))
    registry.register(writeAction, () => ({ invited: 'ada@example.com' }))

    expect(registry.list().map((action) => action.id)).toEqual(['find-customer', 'invite-teammate'])
    expect(registry.get('find-customer')).toBe(readAction)
  })

  test('requires confirmation for writes and runs after confirmation', async () => {
    const registry = createActionRegistry()
    const executor = vi.fn(({ email }: { email: string }) => ({ invited: email }))
    registry.register(writeAction, executor)

    const pending = await registry.execute('invite-teammate', { email: 'ada@example.com' })
    expect(pending.status).toBe('confirming')
    expect(executor).not.toHaveBeenCalled()

    const finished = await registry.execute<{ email: string }, { invited: string }>(
      'invite-teammate',
      { email: 'ada@example.com' },
      { confirmed: true },
    )
    expect(finished.status).toBe('succeeded')
    expect(finished.output).toEqual({ invited: 'ada@example.com' })
    expect(executor).toHaveBeenCalledOnce()
  })

  test('runs read-only actions without confirmation', async () => {
    const registry = createActionRegistry()
    registry.register(readAction, () => ({ customer: 'Ada' }))

    expect(requiresActionConfirmation(readAction)).toBe(false)
    await expect(registry.execute('find-customer', { query: 'ada' })).resolves.toMatchObject({
      status: 'succeeded',
      output: { customer: 'Ada' },
    })
  })

  test('records executor failures', async () => {
    const registry = createActionRegistry()
    registry.register(readAction, () => {
      throw new Error('Customer service unavailable')
    })

    await expect(registry.execute('find-customer', {})).resolves.toMatchObject({
      status: 'failed',
      error: 'Customer service unavailable',
    })
  })

  test('cancels an active action', async () => {
    const registry = createActionRegistry()
    registry.register(readAction, async (_input, { signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { customer: 'Ada' }
    })

    const execution = registry.execute('find-customer', {})
    expect(registry.getRun('find-customer').status).toBe('running')
    expect(registry.cancel('find-customer')).toBe(true)

    await expect(execution).resolves.toMatchObject({ status: 'cancelled' })
  })

  test('notifies subscribers for registration and run changes', async () => {
    const registry = createActionRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)

    registry.register(readAction, () => ({ customer: 'Ada' }))
    await registry.execute('find-customer', {})

    expect(listener).toHaveBeenCalledTimes(3)
  })

  test('keeps snapshots stable until state changes', () => {
    const registry = createActionRegistry()
    const initial = registry.getSnapshot()

    expect(registry.getSnapshot()).toBe(initial)
    registry.register(readAction, () => ({ customer: 'Ada' }))
    expect(registry.getSnapshot()).not.toBe(initial)
    expect(registry.getSnapshot()).toBe(registry.getSnapshot())
  })

  test('resets a confirmation request to idle', async () => {
    const registry = createActionRegistry()
    registry.register(writeAction, ({ email }: { email: string }) => ({ invited: email }))

    await registry.execute('invite-teammate', { email: 'ada@example.com' })
    expect(registry.getRun('invite-teammate').status).toBe('confirming')
    expect(registry.reset('invite-teammate')).toBe(true)
    expect(registry.getRun('invite-teammate').status).toBe('idle')
  })

  test('denies execution before the executor runs', async () => {
    const executor = vi.fn(() => ({ customer: 'Ada' }))
    const registry = createActionRegistry({
      authorize: () => ({ decision: 'deny', reason: 'Missing customer scope', code: 'missing_scope' }),
    })
    registry.register(readAction, executor)

    await expect(registry.execute('find-customer', {})).resolves.toMatchObject({
      status: 'denied',
      denial: { reason: 'Missing customer scope', code: 'missing_scope' },
    })
    expect(executor).not.toHaveBeenCalled()
  })

  test('lets permission require confirmation without weakening action policy', async () => {
    const executor = vi.fn(() => ({ customer: 'Ada' }))
    const authorize = vi.fn(() => ({ decision: 'allow', confirmation: 'required' } as const))
    const registry = createActionRegistry({ authorize })
    registry.register(readAction, executor)

    await expect(registry.execute('find-customer', {})).resolves.toMatchObject({ status: 'confirming' })
    expect(executor).not.toHaveBeenCalled()

    await expect(registry.execute('find-customer', {}, { confirmed: true })).resolves.toMatchObject({
      status: 'succeeded',
    })
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(executor).toHaveBeenCalledOnce()
  })

  test('fails closed when the permission adapter throws', async () => {
    const executor = vi.fn(() => ({ customer: 'Ada' }))
    const registry = createActionRegistry({
      authorize: () => {
        throw new Error('Policy service unavailable')
      },
    })
    registry.register(readAction, executor)

    await expect(registry.execute('find-customer', {})).resolves.toMatchObject({
      status: 'denied',
      denial: { reason: 'Permission check failed', code: 'permission_error' },
    })
    expect(executor).not.toHaveBeenCalled()
  })

  test('fails closed when the permission adapter returns an invalid decision', async () => {
    const executor = vi.fn(() => ({ customer: 'Ada' }))
    const registry = createActionRegistry({
      authorize: (() => ({ decision: 'maybe' })) as never,
    })
    registry.register(readAction, executor)

    await expect(registry.execute('find-customer', {})).resolves.toMatchObject({
      status: 'denied',
      denial: {
        reason: 'Permission adapter returned an invalid decision',
        code: 'invalid_permission_decision',
      },
    })
    expect(executor).not.toHaveBeenCalled()
  })
})
