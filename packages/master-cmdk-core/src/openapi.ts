import { defineActions } from "./actions"
import type {
  ActionAdapterReference,
  ActionAdapterContext,
  ActionAuthority,
  ActionAuthorityRequirement,
  ActionDefinition,
  ActionDocumentSource,
  ActionManifest,
  ActionPermissionReference,
  ActionSchema,
  ActionSourceAdapter,
} from "./actions"

export type OpenApiDocument = Readonly<Record<string, unknown>> & {
  openapi: string
  info: Readonly<Record<string, unknown>>
  paths: Readonly<Record<string, unknown>>
}

export type OpenApiActionSourceAdapterOptions = {
  identity: ActionAdapterReference
  permission?: ActionPermissionReference
}

export type OpenApiActionSourceAdapter = Omit<ActionSourceAdapter<ActionDocumentSource<OpenApiDocument>>, "load"> & {
  load: (
    source: ActionDocumentSource<OpenApiDocument>,
    context: ActionAdapterContext,
  ) => ActionManifest
}

type OpenApiMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace" | "query"
type JsonObject = Record<string, unknown>

const METHODS: readonly OpenApiMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
]
const READ_METHODS = new Set<OpenApiMethod>([
  "get",
  "options",
  "head",
  "trace",
  "query",
])
const IDEMPOTENT_METHODS = new Set<OpenApiMethod>([
  "get",
  "put",
  "delete",
  "options",
  "head",
  "trace",
  "query",
])
const PARAMETER_LOCATIONS = [
  "path",
  "query",
  "querystring",
  "header",
  "cookie",
] as const

export function createOpenApiActionSourceAdapter(
  options: OpenApiActionSourceAdapterOptions,
): OpenApiActionSourceAdapter {
  assertAdapterIdentity(options.identity)

  return {
    identity: options.identity,
    load(source, context) {
      throwIfAborted(context.signal)
      const document = assertOpenApiDocument(source.document)
      const actions: ActionDefinition[] = []

      for (const path of Object.keys(document.paths).sort()) {
        throwIfAborted(context.signal)
        if (!path.startsWith("/"))
          throw new Error(`OpenAPI path must start with /: ${path}`)
        const pathItem = resolveObject(
          document,
          document.paths[path],
          `path ${path}`,
          [],
        )

        for (const method of METHODS) {
          if (!(method in pathItem)) continue
          if (method === "query" && !document.openapi.startsWith("3.2.")) {
            throw new Error(
              `OpenAPI ${document.openapi} does not support QUERY operations`,
            )
          }

          const operation = resolveObject(
            document,
            pathItem[method],
            `${method.toUpperCase()} ${path}`,
            [],
          )
          actions.push(
            mapOperation(
              document,
              path,
              method,
              pathItem,
              operation,
              source,
              options,
            ),
          )
        }
      }

      return defineActions(actions)
    },
  }
}

function mapOperation(
  document: OpenApiDocument,
  path: string,
  method: OpenApiMethod,
  pathItem: JsonObject,
  operation: JsonObject,
  source: ActionDocumentSource<OpenApiDocument>,
  options: OpenApiActionSourceAdapterOptions,
): ActionDefinition {
  const fallbackOperation = `${method.toUpperCase()} ${path}`
  const operationId = optionalString(
    operation.operationId,
    `operationId for ${fallbackOperation}`,
  )
  const operationKey = operationId ?? fallbackOperation
  const access = READ_METHODS.has(method) ? "read" : "write"
  const security =
    operation.security === undefined ? document.security : operation.security
  const requirements = mapSecurityRequirements(
    document,
    security,
    fallbackOperation,
  )
  const scopes = Array.from(
    new Set(
      requirements.flatMap((alternative) =>
        alternative.flatMap((requirement) => requirement.scopes ?? []),
      ),
    ),
  ).sort()
  const authority: ActionAuthority = {
    access,
    ...(scopes.length > 0 ? { scopes } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
  }
  const title =
    optionalString(operation.summary, `summary for ${fallbackOperation}`) ??
    operationId ??
    fallbackOperation
  const description = optionalString(
    operation.description,
    `description for ${fallbackOperation}`,
  )
  const tags = stringArray(operation.tags, `tags for ${fallbackOperation}`)
  const keywords = Array.from(
    new Set(
      [method.toUpperCase(), path, operationId, ...tags].filter(isString),
    ),
  )
  const inputSchema = mapInputSchema(
    document,
    pathItem,
    operation,
    fallbackOperation,
  )
  const outputSchema = mapOutputSchema(document, operation, fallbackOperation)

  return {
    id: `${options.identity.id}:${operationKey}`,
    title,
    ...(description ? { description } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(inputSchema ? { inputSchema } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    authority,
    effects: {
      readOnly: access === "read",
      destructive: method === "delete",
      idempotent: IDEMPOTENT_METHODS.has(method),
      openWorld: true,
    },
    confirmation: access === "write" ? "writes" : "never",
    source: {
      kind: "openapi",
      reference: operationReference(source.reference, path, method),
      provenance: `OpenAPI ${document.openapi}`,
      adapter: options.identity,
    },
    execution: {
      adapter: options.identity,
      operation: operationKey,
    },
    ...(options.permission ? { permission: options.permission } : {}),
  }
}

function mapInputSchema(
  document: OpenApiDocument,
  pathItem: JsonObject,
  operation: JsonObject,
  label: string,
): ActionSchema | undefined {
  const parameters = mergeParameters(
    document,
    pathItem.parameters,
    operation.parameters,
    label,
  )
  const properties: JsonObject = {}
  const required: string[] = []

  for (const location of PARAMETER_LOCATIONS) {
    const located = parameters.filter((parameter) => parameter.in === location)
    if (located.length === 0) continue
    const locationProperties: JsonObject = {}
    const locationRequired: string[] = []

    for (const parameter of located.sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const schema = parameterSchema(
        document,
        parameter.value,
        `${label} parameter ${parameter.name}`,
      )
      locationProperties[parameter.name] = schema
      if (parameter.value.required === true || location === "path")
        locationRequired.push(parameter.name)
    }

    properties[location] = {
      type: "object",
      properties: locationProperties,
      ...(locationRequired.length > 0 ? { required: locationRequired } : {}),
    }
    if (locationRequired.length > 0) required.push(location)
  }

  if (operation.requestBody !== undefined) {
    const requestBody = resolveObject(
      document,
      operation.requestBody,
      `${label} requestBody`,
      [],
    )
    const schema = contentSchema(
      document,
      requestBody.content,
      `${label} requestBody`,
    )
    if (schema) properties.body = schema
    if (schema && requestBody.required === true) required.push("body")
  }

  if (Object.keys(properties).length === 0) return undefined
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function mapOutputSchema(
  document: OpenApiDocument,
  operation: JsonObject,
  label: string,
): ActionSchema | undefined {
  if (operation.responses === undefined) return undefined
  const responses = record(operation.responses, `responses for ${label}`)
  const success = Object.keys(responses)
    .filter((status) => /^2\d\d$/.test(status))
    .sort()[0]
  const selected =
    success ??
    (responses["2XX"] === undefined ? undefined : "2XX") ??
    (responses.default === undefined ? undefined : "default")
  if (!selected) return undefined
  const response = resolveObject(
    document,
    responses[selected],
    `${label} response ${selected}`,
    [],
  )
  return contentSchema(
    document,
    response.content,
    `${label} response ${selected}`,
  )
}

function mergeParameters(
  document: OpenApiDocument,
  pathParameters: unknown,
  operationParameters: unknown,
  label: string,
) {
  const merged = new Map<string, {
    name: string
    in: string
    value: JsonObject
  }>()

  for (const [sourceLabel, value] of [
    ["path", pathParameters],
    ["operation", operationParameters],
  ] as const) {
    if (value === undefined) continue
    if (!Array.isArray(value))
      throw new Error(
        `OpenAPI ${sourceLabel} parameters must be an array: ${label}`,
      )
    for (const item of value) {
      const parameter = resolveObject(
        document,
        item,
        `${label} ${sourceLabel} parameter`,
        [],
      )
      const name = requiredString(parameter.name, `parameter name for ${label}`)
      const location = requiredString(
        parameter.in,
        `parameter location for ${label}`,
      )
      if (!(PARAMETER_LOCATIONS as readonly string[]).includes(location)) {
        throw new Error(
          `Unsupported OpenAPI parameter location ${location}: ${label}`,
        )
      }
      if (
        location === "header" &&
        ["accept", "content-type", "authorization"].includes(name.toLowerCase())
      ) {
        continue
      }
      merged.set(`${location}:${name}`, {
        name,
        in: location,
        value: parameter,
      })
    }
  }

  return Array.from(merged.values())
}

function parameterSchema(
  document: OpenApiDocument,
  parameter: JsonObject,
  label: string,
): ActionSchema {
  if (parameter.schema !== undefined)
    return resolveSchema(document, parameter.schema, label, [])
  const schema = contentSchema(document, parameter.content, label)
  if (schema) return schema
  throw new Error(`OpenAPI parameter needs schema or content: ${label}`)
}

function contentSchema(
  document: OpenApiDocument,
  value: unknown,
  label: string,
): ActionSchema | undefined {
  if (value === undefined) return undefined
  const content = record(value, `content for ${label}`)
  const mediaType =
    content["application/json"] === undefined
      ? Object.keys(content).sort()[0]
      : "application/json"
  if (!mediaType) return undefined
  const media = resolveObject(
    document,
    content[mediaType],
    `${label} content ${mediaType}`,
    [],
  )
  if (media.schema === undefined) return undefined
  return resolveSchema(document, media.schema, `${label} schema`, [])
}

function mapSecurityRequirements(
  document: OpenApiDocument,
  value: unknown,
  label: string,
): readonly (readonly ActionAuthorityRequirement[])[] {
  if (value === undefined) return []
  if (!Array.isArray(value))
    throw new Error(`OpenAPI security must be an array: ${label}`)
  const components =
    document.components === undefined
      ? {}
      : record(document.components, "OpenAPI components")
  const schemes =
    components.securitySchemes === undefined
      ? {}
      : record(components.securitySchemes, "OpenAPI securitySchemes")

  return value.map((alternative, index) => {
    const requirement = record(
      alternative,
      `security alternative ${index} for ${label}`,
    )
    return Object.keys(requirement)
      .sort()
      .map((scheme) => {
        if (!(scheme in schemes))
          throw new Error(`Unknown OpenAPI security scheme ${scheme}: ${label}`)
        return {
          scheme,
          scopes: stringArray(
            requirement[scheme],
            `security scopes for ${scheme} in ${label}`,
          ),
        }
      })
  })
}

function resolveSchema(
  document: OpenApiDocument,
  value: unknown,
  label: string,
  references: readonly string[],
): ActionSchema {
  const schema = record(value, `schema for ${label}`)
  if (typeof schema.$ref === "string") {
    const reference = schema.$ref
    const resolved = resolveLocalReference(
      document,
      reference,
      label,
      references,
    )
    const siblings = Object.fromEntries(
      Object.entries(schema).filter(([key]) => key !== "$ref"),
    )
    return resolveSchema(document, { ...resolved, ...siblings }, label, [
      ...references,
      reference,
    ])
  }

  const result: JsonObject = {}
  for (const key of Object.keys(schema).sort()) {
    if (
      key === "example" ||
      key === "examples" ||
      key === "default" ||
      key.startsWith("x-")
    )
      continue
    result[key] = mapSchemaValue(
      document,
      schema[key],
      `${label}.${key}`,
      references,
    )
  }
  return result
}

function mapSchemaValue(
  document: OpenApiDocument,
  value: unknown,
  label: string,
  references: readonly string[],
): unknown {
  if (Array.isArray(value))
    return value.map((item, index) =>
      mapSchemaValue(document, item, `${label}[${index}]`, references),
    )
  if (!isObject(value)) return value
  if (typeof value.$ref === "string")
    return resolveSchema(document, value, label, references)
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter(
        (key) =>
          key !== "example" &&
          key !== "examples" &&
          key !== "default" &&
          !key.startsWith("x-"),
      )
      .map((key) => [
        key,
        mapSchemaValue(document, value[key], `${label}.${key}`, references),
      ]),
  )
}

function resolveObject(
  document: OpenApiDocument,
  value: unknown,
  label: string,
  references: readonly string[],
): JsonObject {
  const object = record(value, label)
  if (typeof object.$ref !== "string") return object
  const reference = object.$ref
  const resolved = resolveLocalReference(document, reference, label, references)
  return resolveObject(
    document,
    {
      ...resolved,
      ...Object.fromEntries(
        Object.entries(object).filter(([key]) => key !== "$ref"),
      ),
    },
    label,
    [...references, reference],
  )
}

function resolveLocalReference(
  document: OpenApiDocument,
  reference: string,
  label: string,
  references: readonly string[],
): JsonObject {
  if (!reference.startsWith("#/"))
    throw new Error(
      `External OpenAPI references are not supported: ${reference}`,
    )
  if (references.includes(reference))
    throw new Error(`Circular OpenAPI reference: ${reference}`)
  let value: unknown = document
  for (const token of reference.slice(2).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~")
    if (!isObject(value) || !(key in value))
      throw new Error(`Unresolved OpenAPI reference ${reference}: ${label}`)
    value = value[key]
  }
  return record(value, `reference ${reference}`)
}

function assertOpenApiDocument(value: unknown): OpenApiDocument {
  const document = record(value, "OpenAPI document")
  const version = requiredString(document.openapi, "OpenAPI version")
  if (!/^3\.(0|1|2)\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Unsupported OpenAPI version: ${version}`)
  }
  const info = record(document.info, "OpenAPI info")
  requiredString(info.title, "OpenAPI info.title")
  requiredString(info.version, "OpenAPI info.version")
  record(document.paths, "OpenAPI paths")
  return document as OpenApiDocument
}

function assertAdapterIdentity(identity: ActionAdapterReference) {
  if (identity.kind !== "openapi")
    throw new Error(`OpenAPI adapter kind must be openapi: ${identity.kind}`)
  if (!identity.id.trim()) throw new Error("OpenAPI adapter id is required")
}

function operationReference(
  reference: string | undefined,
  path: string,
  method: OpenApiMethod,
) {
  const pointer = `#/paths/${escapePointer(path)}/${method}`
  if (!reference) return pointer
  return `${safeReference(reference)}${pointer}`
}

function safeReference(reference: string) {
  if (/^https?:\/\//i.test(reference)) {
    const url = new URL(reference)
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString()
  }
  const query = reference.indexOf("?")
  const hash = reference.indexOf("#")
  const end = Math.min(
    query < 0 ? reference.length : query,
    hash < 0 ? reference.length : hash,
  )
  return reference.slice(0, end)
}

function escapePointer(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1")
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  const error = new Error("OpenAPI action loading was aborted")
  error.name = "AbortError"
  throw error
}

function record(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} must be an object`)
  return value
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) return undefined
  return requiredString(value, label)
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isString))
    throw new Error(`${label} must be an array of strings`)
  return [...value]
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}
