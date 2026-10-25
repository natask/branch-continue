import { describe, expect, test } from "vitest"
import { billingOpenApiFixture } from "./fixtures/openapi-billing"
import { createOpenApiActionSourceAdapter } from "./openapi"
import type { OpenApiDocument } from "./openapi"

const identity = {
  id: "billing-api",
  kind: "openapi",
  version: "3.1",
  configRef: "billing-production",
} as const

function load(
  document: OpenApiDocument = billingOpenApiFixture,
  reference = "/specs/billing.json",
) {
  return createOpenApiActionSourceAdapter({ identity }).load(
    { document, reference },
    { signal: new AbortController().signal },
  )
}

describe("createOpenApiActionSourceAdapter", () => {
  test("maps operations in deterministic path and method order", () => {
    const actions = load()

    expect(actions.map((action) => action.id)).toEqual([
      "billing-api:getCustomer",
      "billing-api:refundInvoice",
    ])
    expect(actions.map((action) => action.execution?.operation)).toEqual([
      "getCustomer",
      "refundInvoice",
    ])
    expect(actions.map((action) => action.title)).toEqual([
      "Get customer",
      "Refund invoice",
    ])
  })

  test("maps parameters, request bodies, and success responses", () => {
    const [customer, refund] = load()

    expect(customer.inputSchema).toEqual({
      type: "object",
      properties: {
        path: {
          type: "object",
          properties: { customerId: { type: "string" } },
          required: ["customerId"],
        },
        query: {
          type: "object",
          properties: { include: { enum: ["profile"], type: "string" } },
          required: ["include"],
        },
        header: {
          type: "object",
          properties: { "X-Trace-Id": { type: "string" } },
        },
      },
      required: ["path", "query"],
    })
    expect(customer.outputSchema).toEqual({
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
      type: "object",
    })
    expect(refund.inputSchema).toEqual({
      type: "object",
      properties: {
        path: {
          type: "object",
          properties: { invoiceId: { type: "string" } },
          required: ["invoiceId"],
        },
        body: {
          properties: {
            amount: { minimum: 0, type: "number" },
            reason: { type: "string" },
          },
          required: ["amount"],
          type: "object",
        },
      },
      required: ["path", "body"],
    })
    expect(refund.outputSchema).toEqual({
      properties: { id: { type: "string" }, status: { type: "string" } },
      required: ["id", "status"],
      type: "object",
    })
  })

  test("preserves inherited and operation security alternatives", () => {
    const [customer, refund] = load()

    expect(customer.authority).toEqual({
      access: "read",
      scopes: ["customers:read"],
      requirements: [
        [{ scheme: "ApiKeyAuth", scopes: [] }],
        [{ scheme: "BillingOAuth", scopes: ["customers:read"] }],
      ],
    })
    expect(refund.authority).toEqual({
      access: "write",
      scopes: ["invoices:refund"],
      requirements: [
        [
          { scheme: "AuditKey", scopes: [] },
          { scheme: "BillingOAuth", scopes: ["invoices:refund"] },
        ],
      ],
    })
  })

  test("sets effects and confirmation from the HTTP method", () => {
    const [customer, refund] = load()

    expect(customer.effects).toEqual({
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: true,
    })
    expect(customer.confirmation).toBe("never")
    expect(refund.effects).toEqual({
      readOnly: false,
      destructive: false,
      idempotent: false,
      openWorld: true,
    })
    expect(refund.confirmation).toBe("writes")
  })

  test("attaches the host permission adapter reference without configuration values", () => {
    const permission = {
      adapter: {
        id: "billing-policy",
        kind: "permission",
        configRef: "billing-policy-production",
      },
      resource: "billing",
    } as const
    const actions = createOpenApiActionSourceAdapter({
      identity,
      permission,
    }).load({ document: billingOpenApiFixture }, {
      signal: new AbortController().signal,
    })

    expect(actions.every((action) => action.permission === permission)).toBe(
      true,
    )
  })

  test("keeps credentials and example values out of the manifest", () => {
    const actions = load(
      billingOpenApiFixture,
      "https://fixture-user:fixture-secret@example.test/billing.json?token=fixture-secret",
    )
    const serialized = JSON.stringify(actions)

    expect(serialized).not.toContain("fixture-secret")
    expect(serialized).not.toContain("securitySchemes")
    expect(serialized).not.toContain("tokenUrl")
    expect(actions[0].source.reference).toBe(
      "https://example.test/billing.json#/paths/~1customers~1{customerId}/get",
    )
    expect(JSON.parse(serialized)).toEqual(actions)
  })

  test("uses a stable method and path fallback when operationId is absent", () => {
    const document = {
      openapi: "3.2.0",
      info: { title: "Search API", version: "1" },
      paths: {
        "/search": {
          query: {
            responses: { 204: { description: "No content" } },
          },
        },
      },
    } as const satisfies OpenApiDocument

    expect(load(document)[0]).toMatchObject({
      id: "billing-api:QUERY /search",
      title: "QUERY /search",
      authority: { access: "read" },
      execution: { operation: "QUERY /search" },
    })
  })

  test.each(["2.0", "3.3.0", "not-a-version"])(
    "rejects unsupported version %s",
    (openapi) => {
      const document = {
        ...billingOpenApiFixture,
        openapi,
      } as unknown as OpenApiDocument

      expect(() => load(document)).toThrow(
        `Unsupported OpenAPI version: ${openapi}`,
      )
    },
  )

  test.each(["3.0.4", "3.1.2", "3.2.0"])(
    "accepts supported version %s",
    (openapi) => {
      const document = {
        openapi,
        info: { title: "Empty API", version: "1" },
        paths: {},
      } as OpenApiDocument

      expect(load(document)).toEqual([])
    },
  )

  test("rejects external and circular schema references", () => {
    const external = {
      ...billingOpenApiFixture,
      paths: {
        "/external": {
          get: {
            security: [],
            responses: {
              200: {
                description: "External",
                content: {
                  "application/json": {
                    schema: { $ref: "https://example.test/schema.json" },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenApiDocument
    expect(() => load(external)).toThrow(
      "External OpenAPI references are not supported",
    )

    const circular = {
      ...billingOpenApiFixture,
      paths: {
        "/circular": {
          get: {
            security: [],
            responses: {
              200: {
                description: "Circular",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Loop" },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Loop: { $ref: "#/components/schemas/Loop" } } },
    } as unknown as OpenApiDocument
    expect(() => load(circular)).toThrow("Circular OpenAPI reference")
  })

  test("rejects invalid document shapes and aborted loads", () => {
    expect(() =>
      load({ openapi: "3.1.0", info: {}, paths: {} } as OpenApiDocument),
    ).toThrow("OpenAPI info.title must be a non-empty string")

    const controller = new AbortController()
    controller.abort()
    const adapter = createOpenApiActionSourceAdapter({ identity })
    expect(() =>
      adapter.load({ document: billingOpenApiFixture }, {
        signal: controller.signal,
      }),
    ).toThrowError(expect.objectContaining({ name: "AbortError" }))
  })

  test("rejects security requirements that do not reference a declared scheme", () => {
    const document = {
      ...billingOpenApiFixture,
      paths: {
        "/private": {
          get: {
            security: [{ MissingScheme: [] }],
            responses: { 204: { description: "No content" } },
          },
        },
      },
    } as unknown as OpenApiDocument

    expect(() => load(document)).toThrow(
      "Unknown OpenAPI security scheme MissingScheme",
    )
  })
})
