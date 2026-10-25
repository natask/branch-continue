export type ActionSchema = Readonly<Record<string, unknown>>

export type ActionEffects = {
  readOnly: boolean
  destructive: boolean
  idempotent: boolean
  openWorld: boolean
}

export type ActionConfirmation = 'never' | 'writes' | 'always'

export type ActionAuthorityRequirement = {
  /** Security scheme name or URI from the source document. */
  scheme: string
  scopes?: readonly string[]
}

export type ActionAuthority = {
  access: 'read' | 'write'
  scopes?: readonly string[]
  /** Alternatives are OR-ed. Requirements inside one alternative are AND-ed. */
  requirements?: readonly (readonly ActionAuthorityRequirement[])[]
}

export type ActionAdapterReference = {
  /** Runtime adapter instance id. */
  id: string
  /** Adapter family, such as `openapi`, `mcp`, or `native`. */
  kind: string
  version?: string
  /** Opaque lookup key for runtime configuration. Never place configuration or secrets here. */
  configRef?: string
}

export type ActionExecutionReference = {
  adapter: ActionAdapterReference
  /** Stable operation key within the adapter. OpenAPI adapters use `operationId` when present. */
  operation: string
}

export type ActionPermissionReference = {
  adapter: ActionAdapterReference
  resource?: string
}

export type ActionSource = {
  kind: 'manual' | 'openapi' | 'mcp' | 'recorded'
  /** Safe provenance only. Never store signed URLs or credentials in a manifest. */
  reference?: string
  provenance?: string
  adapter?: ActionAdapterReference
}

declare const actionTypes: unique symbol

export type ActionDefinition<TInput = unknown, TOutput = unknown> = {
  id: string
  title: string
  description?: string
  keywords?: readonly string[]
  inputSchema?: ActionSchema
  outputSchema?: ActionSchema
  authority: ActionAuthority
  effects: ActionEffects
  confirmation: ActionConfirmation
  source: ActionSource
  execution?: ActionExecutionReference
  permission?: ActionPermissionReference
  readonly [actionTypes]?: {
    input: TInput
    output: TOutput
  }
}

export type ActionManifest = readonly ActionDefinition[]

export type ActionAdapterContext = {
  signal: AbortSignal
}

export type ActionDocumentSource<TDocument = unknown> = {
  document: TDocument
  /** Safe provenance string, such as a file path or public URL. */
  reference?: string
}

export type ActionSourceAdapter<TSource = unknown> = {
  identity: ActionAdapterReference
  load: (source: TSource, context: ActionAdapterContext) => ActionManifest | Promise<ActionManifest>
}

export type ActionExecutionRequest<TInput = unknown> = {
  action: ActionDefinition<TInput, unknown>
  input: TInput
}

export type ActionExecutionAdapter<TInput = unknown, TOutput = unknown> = {
  identity: ActionAdapterReference
  execute: (
    request: ActionExecutionRequest<TInput>,
    context: ActionAdapterContext,
  ) => TOutput | Promise<TOutput>
}

export function actionExecutorFromAdapter<TInput = unknown, TOutput = unknown>(
  adapter: ActionExecutionAdapter<TInput, TOutput>,
): ActionExecutor<TInput, TOutput> {
  return (input, context) =>
    adapter.execute(
      { action: context.action as ActionDefinition<TInput, unknown>, input },
      { signal: context.signal },
    )
}

export type ActionPermissionRequest<TInput = unknown> = {
  action: ActionDefinition<TInput, unknown>
  input: TInput
}

export type ActionPermissionDecision =
  | {
      decision: 'allow'
      /** A permission adapter may add confirmation. It cannot remove the action's own confirmation rule. */
      confirmation?: 'default' | 'required'
    }
  | {
      decision: 'deny'
      reason: string
      code?: string
    }

export type ActionPermissionAdapter = {
  identity: ActionAdapterReference
  authorize: (
    request: ActionPermissionRequest,
    context: ActionAdapterContext,
  ) => ActionPermissionDecision | Promise<ActionPermissionDecision>
}

export type ActionAuthorizer = ActionPermissionAdapter['authorize']

export type ActionRegistryOptions = {
  authorize?: ActionAuthorizer
}

export type ActionExecutionContext = {
  action: ActionDefinition
  signal: AbortSignal
}

export type ActionExecutor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ActionExecutionContext,
) => TOutput | Promise<TOutput>

export type ActionRunStatus =
  | 'idle'
  | 'authorizing'
  | 'confirming'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'cancelled'

export type ActionRunSnapshot<TInput = unknown, TOutput = unknown> = {
  actionId: string
  status: ActionRunStatus
  input?: TInput
  output?: TOutput
  error?: string
  denial?: {
    reason: string
    code?: string
  }
  startedAt?: number
  finishedAt?: number
}

export type ExecuteActionOptions = {
  confirmed?: boolean
  signal?: AbortSignal
}

export type ActionRegistrySnapshot = {
  actions: ActionDefinition[]
  runs: Map<string, ActionRunSnapshot>
}

type RegisteredAction = {
  definition: ActionDefinition
  execute: ActionExecutor
  order: number
}

type ActiveRun = {
  token: number
  controller: AbortController
}

export function defineActions<const TManifest extends ActionManifest>(manifest: TManifest): TManifest {
  const ids = new Set<string>()

  for (const action of manifest) {
    assertActionDefinition(action)
    if (ids.has(action.id)) throw new Error(`Duplicate action id: ${action.id}`)
    ids.add(action.id)
  }

  return manifest
}

export function requiresActionConfirmation(action: ActionDefinition): boolean {
  if (action.confirmation === 'always') return true
  if (action.confirmation === 'never') return false
  return !action.effects.readOnly
}

export function createActionRegistry(registryOptions: ActionRegistryOptions = {}) {
  let nextOrder = 0
  let nextRunToken = 0
  const listeners = new Set<() => void>()
  const actions = new Map<string, RegisteredAction>()
  const runs = new Map<string, ActionRunSnapshot>()
  const activeRuns = new Map<string, ActiveRun>()
  let snapshot: ActionRegistrySnapshot = {
    actions: [],
    runs: new Map(),
  }

  function emit() {
    snapshot = {
      actions: list(),
      runs: new Map(Array.from(runs, ([id, run]) => [id, cloneRun(run)])),
    }
    listeners.forEach((listener) => listener())
  }

  function register<TInput, TOutput>(
    definition: ActionDefinition<TInput, TOutput>,
    execute: ActionExecutor<TInput, TOutput>,
  ) {
    assertActionDefinition(definition)
    if (actions.has(definition.id)) throw new Error(`Action already registered: ${definition.id}`)

    actions.set(definition.id, {
      definition,
      execute: execute as ActionExecutor,
      order: nextOrder++,
    })
    emit()

    return () => {
      const current = actions.get(definition.id)
      if (!current || current.definition !== definition) return
      activeRuns.get(definition.id)?.controller.abort()
      activeRuns.delete(definition.id)
      actions.delete(definition.id)
      runs.delete(definition.id)
      emit()
    }
  }

  function list() {
    return Array.from(actions.values())
      .sort((a, b) => a.order - b.order)
      .map((action) => action.definition)
  }

  function get(actionId: string) {
    return actions.get(actionId)?.definition
  }

  function getRun(actionId: string): ActionRunSnapshot {
    return cloneRun(runs.get(actionId) ?? { actionId, status: 'idle' })
  }

  function getSnapshot(): ActionRegistrySnapshot {
    return snapshot
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  async function execute<TInput = unknown, TOutput = unknown>(
    actionId: string,
    input: TInput,
    options: ExecuteActionOptions = {},
  ): Promise<ActionRunSnapshot<TInput, TOutput>> {
    const registered = actions.get(actionId)
    if (!registered) throw new Error(`Unknown action: ${actionId}`)
    if (activeRuns.has(actionId)) throw new Error(`Action is already running: ${actionId}`)

    const token = ++nextRunToken
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    activeRuns.set(actionId, { token, controller })

    try {
      const permissionStartedAt = Date.now()
      let permission: ActionPermissionDecision = { decision: 'allow' }

      if (registered.definition.permission && !registryOptions.authorize) {
        return finishDenied(
          actionId,
          input,
          permissionStartedAt,
          token,
          'Action requires a permission adapter',
          'permission_adapter_missing',
        )
      }

      if (registryOptions.authorize) {
        const authorizing: ActionRunSnapshot<TInput, TOutput> = {
          actionId,
          status: 'authorizing',
          input,
          startedAt: permissionStartedAt,
        }
        setRunIfCurrent(authorizing, token)

        try {
          const decision: unknown = await registryOptions.authorize(
            { action: registered.definition, input },
            { signal: controller.signal },
          )
          if (!isPermissionDecision(decision)) {
            return finishDenied(
              actionId,
              input,
              permissionStartedAt,
              token,
              'Permission adapter returned an invalid decision',
              'invalid_permission_decision',
            )
          }
          permission = decision
        } catch {
          if (controller.signal.aborted) {
            return finishCancelled(actionId, input, permissionStartedAt, token)
          }
          return finishDenied(
            actionId,
            input,
            permissionStartedAt,
            token,
            'Permission check failed',
            'permission_error',
          )
        }
      }

      if (controller.signal.aborted) return finishCancelled(actionId, input, permissionStartedAt, token)

      if (permission.decision === 'deny') {
        return finishDenied(
          actionId,
          input,
          permissionStartedAt,
          token,
          permission.reason,
          permission.code,
        )
      }

      const needsConfirmation =
        requiresActionConfirmation(registered.definition) || permission.confirmation === 'required'

      if (needsConfirmation && !options.confirmed) {
        const confirming: ActionRunSnapshot<TInput, TOutput> = {
          actionId,
          status: 'confirming',
          input,
        }
        setRunIfCurrent(confirming, token)
        return cloneRun(confirming)
      }

      const startedAt = Date.now()
      const running: ActionRunSnapshot<TInput, TOutput> = {
        actionId,
        status: 'running',
        input,
        startedAt,
      }
      setRunIfCurrent(running, token)

      try {
        const output = (await registered.execute(input, {
          action: registered.definition,
          signal: controller.signal,
        })) as TOutput

        if (controller.signal.aborted) return finishCancelled(actionId, input, startedAt, token)

        const succeeded: ActionRunSnapshot<TInput, TOutput> = {
          actionId,
          status: 'succeeded',
          input,
          output,
          startedAt,
          finishedAt: Date.now(),
        }
        setRunIfCurrent(succeeded, token)
        return cloneRun(succeeded)
      } catch (error) {
        if (controller.signal.aborted) return finishCancelled(actionId, input, startedAt, token)

        const failed: ActionRunSnapshot<TInput, TOutput> = {
          actionId,
          status: 'failed',
          input,
          error: toErrorMessage(error),
          startedAt,
          finishedAt: Date.now(),
        }
        setRunIfCurrent(failed, token)
        return cloneRun(failed)
      }
    } finally {
      options.signal?.removeEventListener('abort', abort)
      if (activeRuns.get(actionId)?.token === token) activeRuns.delete(actionId)
    }
  }

  function cancel(actionId: string) {
    const active = activeRuns.get(actionId)
    if (!active) return false
    active.controller.abort()
    return true
  }

  function reset(actionId: string) {
    if (activeRuns.has(actionId) || !runs.has(actionId)) return false
    runs.delete(actionId)
    emit()
    return true
  }

  function setRun(run: ActionRunSnapshot) {
    runs.set(run.actionId, run)
    emit()
  }

  function setRunIfCurrent(run: ActionRunSnapshot, token: number) {
    if (activeRuns.get(run.actionId)?.token !== token) return
    setRun(run)
  }

  function finishCancelled<TInput, TOutput>(
    actionId: string,
    input: TInput,
    startedAt: number,
    token: number,
  ): ActionRunSnapshot<TInput, TOutput> {
    const cancelled: ActionRunSnapshot<TInput, TOutput> = {
      actionId,
      status: 'cancelled',
      input,
      startedAt,
      finishedAt: Date.now(),
    }
    setRunIfCurrent(cancelled, token)
    return cloneRun(cancelled)
  }

  function finishDenied<TInput, TOutput>(
    actionId: string,
    input: TInput,
    startedAt: number,
    token: number,
    reason: string,
    code?: string,
  ): ActionRunSnapshot<TInput, TOutput> {
    const denied: ActionRunSnapshot<TInput, TOutput> = {
      actionId,
      status: 'denied',
      input,
      denial: { reason, code },
      startedAt,
      finishedAt: Date.now(),
    }
    setRunIfCurrent(denied, token)
    return cloneRun(denied)
  }

  return {
    register,
    list,
    get,
    getRun,
    getSnapshot,
    subscribe,
    execute,
    cancel,
    reset,
  }
}

export type ActionRegistry = ReturnType<typeof createActionRegistry>

function assertActionDefinition(action: ActionDefinition) {
  if (!action.id.trim()) throw new Error('Action id is required')
  if (!action.title.trim()) throw new Error(`Action title is required: ${action.id}`)
  if (action.authority.access === 'read' && !action.effects.readOnly) {
    throw new Error(`Read authority requires readOnly effects: ${action.id}`)
  }
  if (action.authority.access === 'write' && action.effects.readOnly) {
    throw new Error(`Write authority requires write effects: ${action.id}`)
  }
  action.source.adapter && assertAdapterReference(action.source.adapter, `${action.id} source`)
  if (action.execution) {
    assertAdapterReference(action.execution.adapter, `${action.id} execution`)
    if (!action.execution.operation.trim()) throw new Error(`Action operation is required: ${action.id}`)
  }
  if (action.permission) {
    assertAdapterReference(action.permission.adapter, `${action.id} permission`)
  }
}

function assertAdapterReference(reference: ActionAdapterReference, label: string) {
  if (!reference.id.trim()) throw new Error(`Adapter id is required: ${label}`)
  if (!reference.kind.trim()) throw new Error(`Adapter kind is required: ${label}`)
  if (reference.configRef !== undefined && !reference.configRef.trim()) {
    throw new Error(`Adapter configRef cannot be empty: ${label}`)
  }
}

function isPermissionDecision(value: unknown): value is ActionPermissionDecision {
  if (!value || typeof value !== 'object') return false
  const decision = value as Partial<ActionPermissionDecision>
  if (decision.decision === 'allow') {
    return decision.confirmation === undefined || decision.confirmation === 'default' || decision.confirmation === 'required'
  }
  if (decision.decision === 'deny') {
    return typeof decision.reason === 'string' && decision.reason.trim().length > 0
  }
  return false
}

function cloneRun<TInput, TOutput>(run: ActionRunSnapshot<TInput, TOutput>): ActionRunSnapshot<TInput, TOutput> {
  return { ...run }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
