import type { OpenApiDocument } from "../openapi"

export const billingOpenApiFixture = {
  openapi: "3.1.1",
  info: {
    title: "Billing API",
    version: "2026-08-07",
  },
  servers: [{ url: "https://billing.example.test?api_key=fixture-secret" }],
  security: [{ ApiKeyAuth: [] }, { BillingOAuth: ["customers:read"] }],
  paths: {
    "/invoices/{invoiceId}/refund": {
      post: {
        operationId: "refundInvoice",
        summary: "Refund invoice",
        tags: ["billing", "invoices"],
        parameters: [{ $ref: "#/components/parameters/InvoiceId" }],
        requestBody: { $ref: "#/components/requestBodies/RefundRequest" },
        responses: {
          202: { $ref: "#/components/responses/RefundAccepted" },
          default: { description: "Refund failed" },
        },
        security: [{ BillingOAuth: ["invoices:refund"], AuditKey: [] }],
      },
    },
    "/customers/{customerId}": {
      parameters: [
        { $ref: "#/components/parameters/CustomerId" },
        {
          name: "include",
          in: "query",
          schema: { type: "string", enum: ["invoices", "payments"] },
        },
        {
          name: "Authorization",
          in: "header",
          required: true,
          schema: { type: "string", default: "fixture-secret" },
        },
      ],
      get: {
        operationId: "getCustomer",
        summary: "Get customer",
        description: "Read one customer.",
        tags: ["customers"],
        parameters: [
          {
            name: "include",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["profile"] },
          },
          { $ref: "#/components/parameters/TraceId" },
        ],
        responses: {
          404: { description: "Not found" },
          200: {
            description: "Customer",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Customer" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      AuditKey: { type: "apiKey", in: "header", name: "X-Audit-Key" },
      BillingOAuth: {
        type: "oauth2",
        flows: {
          clientCredentials: {
            tokenUrl: "https://auth.example.test/token",
            scopes: {
              "customers:read": "Read customers",
              "invoices:refund": "Refund invoices",
            },
          },
        },
      },
    },
    parameters: {
      CustomerId: {
        name: "customerId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      InvoiceId: {
        name: "invoiceId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      TraceId: {
        name: "X-Trace-Id",
        in: "header",
        schema: { type: "string", default: "fixture-secret" },
      },
    },
    requestBodies: {
      RefundRequest: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefundInput" },
          },
        },
      },
    },
    responses: {
      RefundAccepted: {
        description: "Accepted",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Refund" },
          },
        },
      },
    },
    schemas: {
      Customer: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", example: "fixture-secret" },
        },
        required: ["id", "name"],
      },
      RefundInput: {
        type: "object",
        properties: {
          amount: { type: "number", minimum: 0 },
          reason: { type: "string" },
        },
        required: ["amount"],
      },
      Refund: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
        },
        required: ["id", "status"],
      },
    },
  },
} as const satisfies OpenApiDocument
