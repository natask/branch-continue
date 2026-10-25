import type {
  ActionAdapterContext,
  ActionAdapterReference,
  ActionDefinition,
  ActionExecutionAdapter,
  ActionExecutionRequest,
} from './actions'

export type OpenApiAllowedOperation = {
  operation: string
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
  path: string
  allowedHeaders?: readonly string[]
  idempotent?: boolean
}

export type OpenApiRuntimeConfig = {
  baseUrl: string
  /** Runtime-only credentials and request headers. These values never enter an action manifest. */
  headers?: Readonly<Record<string, string>>
}

export type OpenApiRuntimeRequest = {
  action: ActionDefinition
  operation: OpenApiAllowedOperation
}

export type OpenApiRuntimeResolver = (
  configRef: string,
  request: OpenApiRuntimeRequest,
  context: ActionAdapterContext,
) => OpenApiRuntimeConfig | Promise<OpenApiRuntimeConfig>

export type OpenApiExecutionLimits = {
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
}

export type OpenApiExecutionAdapterOptions = {
  identity: ActionAdapterReference
  allowedOrigins: readonly string[]
  allowedOperations: readonly OpenApiAllowedOperation[]
  resolveRuntime: OpenApiRuntimeResolver
  limits?: OpenApiExecutionLimits
  fetch?: typeof fetch
}

export type OpenApiExecutionInput = {
  path?: Readonly<Record<string, unknown>>
  query?: Readonly<Record<string, unknown>>
  querystring?: string
  header?: Readonly<Record<string, unknown>>
  cookie?: Readonly<Record<string, unknown>>
  body?: unknown
}

export type OpenApiExecutionResult<TBody = unknown> = {
  status: number
  body: TBody
}

export type OpenApiExecutionErrorCode =
  | 'action_not_allowed'
  | 'operation_not_allowed'
  | 'origin_not_allowed'
  | 'runtime_config_error'
  | 'invalid_input'
  | 'request_too_large'
  | 'response_too_large'
  | 'timeout'
  | 'aborted'
  | 'network_error'
  | 'http_error'

export class OpenApiExecutionError extends Error {
  readonly code: OpenApiExecutionErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(
    code: OpenApiExecutionErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; retryAfterMs?: number } = {},
  ) {
    super(message)
    this.name = 'OpenApiExecutionError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }
}

export type OpenApiExecutionAdapter = ActionExecutionAdapter<OpenApiExecutionInput, OpenApiExecutionResult>

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_TIMEOUT_MS = 60_000
const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const FORBIDDEN_INPUT_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'content-length',
  'proxy-authorization',
])
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])

export function createOpenApiExecutionAdapter(options: OpenApiExecutionAdapterOptions): OpenApiExecutionAdapter {
  assertIdentity(options.identity)
  const allowedOrigins = new Set(options.allowedOrigins.map(normalizeAllowedOrigin))
  if (allowedOrigins.size === 0) throw new Error('At least one OpenAPI origin must be allowed')
  const operations = indexOperations(options.allowedOperations)
  const limits = normalizeLimits(options.limits)
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (!fetchImplementation) throw new Error('OpenAPI execution needs a fetch implementation')

  return {
    identity: options.identity,
    async execute(request, context) {
      assertActionReference(request, options.identity)
      const operationKey = request.action.execution?.operation
      const operation = operationKey ? operations.get(operationKey) : undefined
      if (!operation) {
        throw new OpenApiExecutionError(
          'operation_not_allowed',
          `OpenAPI operation is not allowed: ${operationKey ?? 'missing'}`,
        )
      }

      const configRef = request.action.execution?.adapter.configRef
      if (!configRef) {
        throw new OpenApiExecutionError('runtime_config_error', 'OpenAPI action needs a runtime configRef')
      }

      const controller = new AbortController()
      let timedOut = false
      const abort = () => controller.abort()
      if (context.signal.aborted) controller.abort()
      context.signal.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, limits.timeoutMs)

      try {
        let runtime: OpenApiRuntimeConfig
        try {
          runtime = await raceWithSignal(
            options.resolveRuntime(
              configRef,
              { action: request.action, operation },
              { signal: controller.signal },
            ),
            controller.signal,
          )
        } catch {
          if (timedOut) throw timeoutError(operation)
          if (context.signal.aborted) throw abortedError()
          throw new OpenApiExecutionError(
            'runtime_config_error',
            'Failed to resolve OpenAPI runtime configuration',
          )
        }
        if (controller.signal.aborted) {
          if (timedOut) throw timeoutError(operation)
          throw abortedError()
        }

        const baseUrl = parseBaseUrl(runtime.baseUrl)
        if (!allowedOrigins.has(baseUrl.origin)) {
          throw new OpenApiExecutionError('origin_not_allowed', `OpenAPI origin is not allowed: ${baseUrl.origin}`)
        }

        const built = buildRequest(baseUrl, operation, request.input, runtime.headers, limits.maxRequestBytes)
        let response: Response
        try {
          response = await fetchImplementation(built.url, {
            method: operation.method,
            headers: built.headers,
            body: built.body,
            signal: controller.signal,
            redirect: 'manual',
            credentials: 'omit',
            cache: 'no-store',
          })
        } catch {
          if (timedOut) throw timeoutError(operation)
          if (context.signal.aborted) throw abortedError()
          throw new OpenApiExecutionError('network_error', 'OpenAPI request failed', {
            retryable: operationIsIdempotent(operation),
          })
        }

        if (!response.ok) {
          await response.body?.cancel()
          throw new OpenApiExecutionError(
            'http_error',
            `OpenAPI request failed with status ${response.status}`,
            {
              status: response.status,
              retryable: operationIsIdempotent(operation) && RETRYABLE_STATUSES.has(response.status),
              retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
            },
          )
        }

        try {
          const body = redactSecrets(
            await readResponseBody(response, limits.maxResponseBytes),
            runtimeSecretValues(runtime.headers),
          )
          if (controller.signal.aborted) {
            if (timedOut) throw timeoutError(operation)
            throw abortedError()
          }
          return { status: response.status, body }
        } catch (error) {
          if (error instanceof OpenApiExecutionError) throw error
          if (timedOut) throw timeoutError(operation)
          if (context.signal.aborted) throw abortedError()
          throw new OpenApiExecutionError('network_error', 'OpenAPI response failed', {
            retryable: operationIsIdempotent(operation),
          })
        }
      } catch (error) {
        if (error instanceof OpenApiExecutionError) throw error
        if (timedOut) throw timeoutError(operation)
        if (context.signal.aborted) throw abortedError()
        throw new OpenApiExecutionError('network_error', 'OpenAPI request failed', {
          retryable: operationIsIdempotent(operation),
        })
      } finally {
        clearTimeout(timeout)
        context.signal.removeEventListener('abort', abort)
      }
    },
  }
}

function assertActionReference(request: ActionExecutionRequest, identity: ActionAdapterReference) {
  const reference = request.action.execution?.adapter
  if (
    !reference ||
    reference.id !== identity.id ||
    reference.kind !== identity.kind ||
    reference.configRef !== identity.configRef
  ) {
    throw new OpenApiExecutionError('action_not_allowed', `Action is not bound to OpenAPI adapter ${identity.id}`)
  }
}

function buildRequest(
  baseUrl: URL,
  operation: OpenApiAllowedOperation,
  input: OpenApiExecutionInput,
  runtimeHeaders: Readonly<Record<string, string>> | undefined,
  maxRequestBytes: number,
) {
  if (!isObject(input)) throw new OpenApiExecutionError('invalid_input', 'OpenAPI input must be an object')
  if (input.cookie && Object.keys(input.cookie).length > 0) {
    throw new OpenApiExecutionError('invalid_input', 'Cookie input is not allowed')
  }

  const path = fillPath(operation.path, input.path)
  const url = new URL(path, baseUrl)
  appendQuery(url, input.query)
  if (input.querystring !== undefined) {
    if (typeof input.querystring !== 'string') {
      throw new OpenApiExecutionError('invalid_input', 'OpenAPI querystring input must be a string')
    }
    const suffix = input.querystring.replace(/^\?/, '')
    if (suffix) url.search = url.search ? `${url.search.slice(1)}&${suffix}` : suffix
  }

  const headers = new Headers(runtimeHeaders)
  appendInputHeaders(headers, input.header, operation.allowedHeaders)
  let body: string | undefined
  if (input.body !== undefined) {
    if (operation.method === 'GET' || operation.method === 'HEAD') {
      throw new OpenApiExecutionError('invalid_input', `${operation.method} operations cannot send a body`)
    }
    try {
      body = JSON.stringify(input.body)
    } catch {
      throw new OpenApiExecutionError('invalid_input', 'OpenAPI request body must be JSON serializable')
    }
    if (byteLength(body) > maxRequestBytes) {
      throw new OpenApiExecutionError('request_too_large', 'OpenAPI request body exceeds the size limit')
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  }

  return { url, headers, body }
}

function fillPath(template: string, values: Readonly<Record<string, unknown>> | undefined) {
  const path = template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values?.[name]
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new OpenApiExecutionError('invalid_input', `Missing OpenAPI path input: ${name}`)
    }
    return encodeURIComponent(String(value))
  })
  if (/\{[^}]+\}/.test(path)) throw new OpenApiExecutionError('invalid_input', 'OpenAPI path input is incomplete')
  return path
}

function appendQuery(url: URL, values: Readonly<Record<string, unknown>> | undefined) {
  if (!values) return
  for (const name of Object.keys(values).sort()) {
    const value = values[name]
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        throw new OpenApiExecutionError('invalid_input', `OpenAPI query input must be scalar: ${name}`)
      }
      url.searchParams.append(name, String(item))
    }
  }
}

function appendInputHeaders(
  headers: Headers,
  values: Readonly<Record<string, unknown>> | undefined,
  allowedHeaders: readonly string[] | undefined,
) {
  if (!values) return
  const allowed = new Set((allowedHeaders ?? []).map((name) => name.toLowerCase()))
  for (const name of Object.keys(values)) {
    const normalized = name.toLowerCase()
    if (FORBIDDEN_INPUT_HEADERS.has(normalized) || !allowed.has(normalized)) {
      throw new OpenApiExecutionError('invalid_input', `OpenAPI input header is not allowed: ${name}`)
    }
    const value = values[name]
    if (typeof value !== 'string') {
      throw new OpenApiExecutionError('invalid_input', `OpenAPI input header must be a string: ${name}`)
    }
    headers.set(name, value)
  }
}

async function readResponseBody(response: Response, limit: number): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared && Number(declared) > limit) {
    await response.body?.cancel()
    throw new OpenApiExecutionError('response_too_large', 'OpenAPI response exceeds the size limit')
  }
  if (!response.body) return null

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new OpenApiExecutionError('response_too_large', 'OpenAPI response exceeds the size limit')
    }
    chunks.push(value)
  }
  if (total === 0) return null

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return JSON.parse(text)
    } catch {
      throw new OpenApiExecutionError('http_error', 'OpenAPI response contains invalid JSON', {
        status: response.status,
      })
    }
  }
  return text
}

function indexOperations(values: readonly OpenApiAllowedOperation[]) {
  const operations = new Map<string, OpenApiAllowedOperation>()
  for (const operation of values) {
    if (!operation.operation.trim()) throw new Error('OpenAPI allowed operation needs an operation key')
    if (!operation.path.startsWith('/') || operation.path.startsWith('//')) {
      throw new Error(`OpenAPI operation path must be origin-relative: ${operation.path}`)
    }
    if (operations.has(operation.operation)) throw new Error(`Duplicate OpenAPI operation: ${operation.operation}`)
    operations.set(operation.operation, operation)
  }
  if (operations.size === 0) throw new Error('At least one OpenAPI operation must be allowed')
  return operations
}

function normalizeAllowedOrigin(value: string) {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error(`Invalid OpenAPI allowed origin: ${value}`)
  }
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`OpenAPI allowlist entry must be an origin: ${value}`)
  return url.origin
}

function parseBaseUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OpenApiExecutionError('runtime_config_error', 'OpenAPI runtime baseUrl is invalid')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new OpenApiExecutionError('runtime_config_error', 'OpenAPI runtime baseUrl is invalid')
  }
  return new URL(url.origin)
}

function normalizeLimits(values: OpenApiExecutionLimits | undefined) {
  return {
    timeoutMs: boundedInteger(values?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS, 'timeoutMs'),
    maxRequestBytes: boundedInteger(
      values?.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
      1,
      MAX_REQUEST_BYTES,
      'maxRequestBytes',
    ),
    maxResponseBytes: boundedInteger(
      values?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      1,
      MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    ),
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`OpenAPI ${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.max(0, timestamp - Date.now())
}

function operationIsIdempotent(operation: OpenApiAllowedOperation) {
  return operation.idempotent ?? IDEMPOTENT_METHODS.has(operation.method)
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function runtimeSecretValues(headers: Readonly<Record<string, string>> | undefined) {
  if (!headers) return []
  const values = new Set<string>()
  for (const value of Object.values(headers)) {
    if (!value) continue
    values.add(value)
    const credential = value.match(/^(?:basic|bearer)\s+(.+)$/i)?.[1]
    if (credential) values.add(credential)
  }
  return Array.from(values).sort((left, right) => right.length - left.length)
}

function redactSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (secrets.length === 0) return value
  if (typeof value === 'string') {
    return secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), value)
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]))
  }
  return value
}

function abortedError() {
  return new OpenApiExecutionError('aborted', 'OpenAPI request was aborted')
}

function timeoutError(operation: OpenApiAllowedOperation) {
  return new OpenApiExecutionError('timeout', 'OpenAPI request timed out', {
    retryable: operationIsIdempotent(operation),
  })
}

function raceWithSignal<T>(value: T | Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener('abort', abort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function assertIdentity(identity: ActionAdapterReference) {
  if (identity.kind !== 'openapi') throw new Error(`OpenAPI adapter kind must be openapi: ${identity.kind}`)
  if (!identity.id.trim()) throw new Error('OpenAPI adapter id is required')
  if (!identity.configRef?.trim()) throw new Error('OpenAPI execution adapter configRef is required')
}

function isObject(value: unknown): value is OpenApiExecutionInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
