# master-cmdk-core

Framework-agnostic command menu engine for `master-cmdk`.

The core owns registration, search scoring, ordering, modes, and selection. It does not import React and does not read or write the DOM. UI packages adapt framework-specific component trees into this engine.

## Actions

Define action data once, then bind it to an executor at runtime. The action data has only serializable fields, so OpenAPI and MCP adapters can read and write it.

```ts
import { createActionRegistry, defineActions } from 'master-cmdk-core'
import type { ActionDefinition } from 'master-cmdk-core'

type InviteInput = { email: string }
type InviteOutput = { invited: string }

const inviteAction: ActionDefinition<InviteInput, InviteOutput> = {
  id: 'invite-teammate',
  title: 'Invite teammate',
  authority: { access: 'write', scopes: ['team:write'] },
  inputSchema: {
    type: 'object',
    properties: { email: { type: 'string', format: 'email' } },
    required: ['email'],
  },
  effects: {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  confirmation: 'writes',
  source: { kind: 'manual' },
}

const actions = defineActions([inviteAction])

const registry = createActionRegistry()

registry.register(actions[0], async ({ email }) => {
  return { invited: email }
})

await registry.execute('invite-teammate', { email: 'ada@example.com' })
// status: confirming

await registry.execute(
  'invite-teammate',
  { email: 'ada@example.com' },
  { confirmed: true },
)
// status: succeeded
```

The registry also tracks permission checks and denials. `confirmation: 'writes'` requires confirmation when `effects.readOnly` is false.

## Permission contract

Pass an authorizer when you create the registry. The authorizer can allow the action, require confirmation, or deny it. A confirmed action runs through the authorizer again.

```ts
const registry = createActionRegistry({
  authorize: async ({ action }) => {
    const allowed = (action.authority.scopes ?? []).every((scope) => currentUser.scopes.includes(scope))
    if (!allowed) {
      return { decision: 'deny', reason: 'Missing scope', code: 'missing_scope' }
    }

    return { decision: 'allow' }
  },
})
```

A permission adapter can require confirmation. It cannot remove the action's own confirmation rule. A permission error returns `denied` with `permission_error`. The executor does not run.

## Adapter references

Manifests store `ActionAdapterReference` values. Each reference contains an adapter id and kind. `configRef` is an opaque lookup key for configuration held by the host.

Do not put credentials or configuration values in an action manifest. Runtime adapters receive credentials from the host that created them.

```ts
const billingAdapter = {
  id: 'billing-api',
  kind: 'openapi',
  version: '3.2',
  configRef: 'billing-production',
}

const refundAction = {
  // action fields
  source: { kind: 'openapi', adapter: billingAdapter },
  execution: {
    adapter: billingAdapter,
    operation: 'refundInvoice',
  },
}
```

`ActionSourceAdapter` loads actions. `ActionExecutionAdapter` runs an action. `ActionPermissionAdapter` decides whether the current caller may run it.

## OpenAPI connector

Create the adapter with an identity and pass it a parsed document. The adapter reads local data only. It does not fetch the document or call the described API.

```ts
import { createOpenApiActionSourceAdapter } from 'master-cmdk-core'

const adapter = createOpenApiActionSourceAdapter({
  identity: {
    id: 'billing-api',
    kind: 'openapi',
    version: '3.1',
    configRef: 'billing-production',
  },
})

const actions = adapter.load(
  { document: parsedDocument, reference: '/specs/billing.json' },
  { signal: abortController.signal },
)
```

The entry point is `ActionSourceAdapter<ActionDocumentSource<OpenApiDocument>>.load`.

Map each OpenAPI Operation Object into one `ActionDefinition`:

- Use `operationId` as `execution.operation`. Fall back to a stable method and path key when it is absent.
- Build `inputSchema` from parameters and `requestBody`.
- Build `outputSchema` from the selected success response.
- Preserve security alternatives in `authority.requirements`. The outer array uses OR. Requirements inside one alternative use AND.
- Set read or write authority from the HTTP method.
- Store only the adapter `configRef`. Resolve API keys and OAuth tokens inside the runtime execution adapter.

The connector accepts OpenAPI 3.0, 3.1, and 3.2 documents. It resolves local `$ref` values. Security requirement names must match `components.securitySchemes`. The connector rejects external and circular references. It omits schema examples, defaults, and extensions from manifests. It also removes credentials, query strings, and fragments from the source reference.

## OpenAPI execution

The host supplies the runtime config resolver and the allowlists. The resolver receives the opaque `configRef` from the action. It returns the base URL and runtime-only headers.

```ts
import {
  actionExecutorFromAdapter,
  createActionRegistry,
  createOpenApiExecutionAdapter,
} from 'master-cmdk-core'

const execution = createOpenApiExecutionAdapter({
  identity: {
    id: 'billing-api',
    kind: 'openapi',
    configRef: 'billing-production',
  },
  allowedOrigins: ['https://billing.example.com'],
  allowedOperations: [
    {
      operation: 'refundInvoice',
      method: 'POST',
      path: '/invoices/{invoiceId}/refund',
    },
  ],
  resolveRuntime: async (configRef) => ({
    baseUrl: 'https://billing.example.com',
    headers: { authorization: await secrets.authorizationHeader(configRef) },
  }),
  limits: {
    timeoutMs: 10_000,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 1024 * 1024,
  },
})

const registry = createActionRegistry({ authorize: permissionAdapter.authorize })
registry.register(refundAction, actionExecutorFromAdapter(execution))
```

Use `actionExecutorFromAdapter` with the registry. The registry checks permission and confirmation before the adapter sends a request. An action with a permission reference is denied when the registry has no authorizer.

The adapter checks the action identity, operation, and exact origin. It rejects automatic redirects and ambient browser credentials. Input headers need an operation allowlist entry. Action input cannot set authorization or cookie headers.

`OpenApiExecutionError` reports a code, HTTP status when present, and whether a retry is safe. Timeouts and network failures are retryable only for idempotent operations. HTTP 408, 425, 429, 500, 502, 503, and 504 are classified the same way. Error messages omit credential values and response bodies. Successful response data replaces exact runtime header values with `[REDACTED]`.

The OpenAPI specification defines Operation Objects, request bodies, responses, and security requirements: <https://spec.openapis.org/oas/3.2.0.html>.
