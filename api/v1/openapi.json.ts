// Machine-readable API spec: GET /api/v1/openapi.json
// Integrators import this into Postman / Swagger / openapi-generator for typed clients.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const VERDICTS = ["PASS", "CAUTION", "FAIL", "AVOID", "UNVERIFIABLE_IDENTITY", "INCOMPLETE"];

const spec = {
  openapi: "3.1.0",
  info: {
    title: "ARGUS API",
    version: "1.1.0",
    description: "Forensic due-diligence for crypto. Investigation endpoints require an active ARGUS workspace membership and a Bearer access token.",
  },
  servers: [{ url: "https://argus-one-flax.vercel.app" }],
  paths: {
    "/api/v1/token": {
      get: {
        summary: "Audit a token",
        description: "Live forensic rug-audit from a contract address or DexScreener link. EVM and Solana.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "address", in: "query", schema: { type: "string" }, description: "Token contract address" },
          { name: "url", in: "query", schema: { type: "string" }, description: "A DexScreener link (alternative to address)" },
        ],
        responses: {
          "200": { description: "Token audit", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenAudit" } } } },
          "400": { description: "Missing or invalid input" },
          "404": { description: "No DEX pair found" },
          "429": { description: "Daily investigation limit reached" },
        },
      },
    },
    "/api/v1/person": {
      get: {
        summary: "Audit a principal",
        description: "Multi-class audit of an X handle (founder / fund / KOL / advisor / agency), governed by the most severe role.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "handle", in: "query", required: true, schema: { type: "string" }, description: "X handle, e.g. @0xlumen" }],
        responses: {
          "200": { description: "Principal audit", content: { "application/json": { schema: { $ref: "#/components/schemas/PersonAudit" } } } },
          "404": { description: "Could not resolve subject" },
          "429": { description: "Daily investigation limit reached" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Supabase access token" },
    },
    schemas: {
      Verdict: { type: "string", enum: VERDICTS },
      Axis: {
        type: "object",
        properties: { key: { type: "string" }, label: { type: "string" }, score: { type: "number" }, weight: { type: "number" }, rationale: { type: "string" } },
      },
      Finding: {
        type: "object",
        properties: { claim: { type: "string" }, tone: { type: "string", enum: ["good", "warn", "bad"] }, source: { type: "string" } },
      },
      PersonRole: {
        type: "object",
        properties: {
          role: { type: "string" },
          verdict: {
            $ref: "#/components/schemas/Verdict",
            description: "Coverage-qualified role verdict. INCOMPLETE while the report is not decision-ready.",
          },
          score: {
            type: ["number", "null"],
            description: "Coverage-qualified role score. Null while the report is not decision-ready.",
          },
          cap: { type: ["string", "null"] },
          status: { type: "string", enum: ["final", "preliminary"] },
        },
      },
      RawPersonRoleSignal: {
        type: "object",
        properties: {
          role: { type: "string" },
          verdict: { type: "string" },
          score: { type: ["number", "null"] },
          cap: { type: ["string", "null"] },
        },
      },
      DecisionReadiness: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["ready", "provisional", "incomplete", "failed"] },
          coverage_percent: { type: "integer", minimum: 0, maximum: 100 },
          successful_checks: { type: "integer", minimum: 0 },
          applicable_checks: { type: "integer", minimum: 0 },
          unresolved_checks: { type: "integer", minimum: 0 },
          note: { type: "string" },
        },
      },
      PreliminaryPersonModelSignal: {
        type: ["object", "null"],
        description: "Raw scorer output retained for auditability when coverage or output validation withholds a final verdict. Never investment clearance.",
        properties: {
          verdict: { type: "string" },
          score: { type: ["number", "null"] },
          headline: { type: "string" },
          classification: { type: "string", enum: ["preliminary", "risk_signal"] },
          roles: { type: "array", items: { $ref: "#/components/schemas/RawPersonRoleSignal" } },
        },
      },
      TokenAudit: {
        type: "object",
        properties: {
          api: { type: "string" }, kind: { type: "string" }, address: { type: "string" }, chain: { type: "string" },
          symbol: { type: "string" }, name: { type: "string" },
          verdict: { $ref: "#/components/schemas/Verdict" }, score: { type: ["number", "null"] },
          cap_applied: { type: ["string", "null"] }, headline: { type: "string" },
          market: { type: "object", properties: { priceUsd: { type: "number" }, marketCap: { type: "number" }, liquidityUsd: { type: "number" }, volume24h: { type: "number" }, ageDays: { type: "number" } } },
          safety: { type: "object", properties: { honeypot: { type: "boolean" }, mintable: { type: "boolean" }, freezable: { type: "boolean" }, ownerRenounced: { type: "boolean" }, lpLocked: { type: "boolean" }, buyTax: { type: "number" }, sellTax: { type: "number" }, holderCount: { type: "number" } } },
          holders: { type: "object", properties: { insiderPct: { type: "number" }, bundleCount: { type: "number" }, bundleRisk: { type: "string", enum: ["low", "elevated", "high"] } } },
          corroboration: { type: ["object", "null"], properties: { listed: { type: "boolean" }, rank: { type: ["number", "null"] }, cexCount: { type: "number" } } },
          axes: { type: "array", items: { $ref: "#/components/schemas/Axis" } },
          findings: { type: "array", items: { $ref: "#/components/schemas/Finding" } },
        },
      },
      PersonAudit: {
        type: "object",
        properties: {
          api: { type: "string" }, kind: { type: "string" }, handle: { type: "string" }, display_name: { type: "string" },
          live: { type: "boolean" },
          verdict: {
            $ref: "#/components/schemas/Verdict",
            description: "Final coverage-qualified verdict. INCOMPLETE unless decision_ready is true.",
          },
          score: {
            type: ["number", "null"],
            description: "Final coverage-qualified score. Null unless decision_ready is true.",
          },
          decision_ready: { type: "boolean" },
          completeness_state: { type: "string", enum: ["complete", "partial", "failed"] },
          decision_readiness: { $ref: "#/components/schemas/DecisionReadiness" },
          preliminary_model_signal: { $ref: "#/components/schemas/PreliminaryPersonModelSignal" },
          governing_role: { type: ["string", "null"] }, cap_applied: { type: ["string", "null"] },
          identity: { type: "string" }, headline: { type: "string" },
          roles: { type: "array", items: { $ref: "#/components/schemas/PersonRole" } },
          findings: { type: "array", items: { $ref: "#/components/schemas/Finding" } },
        },
      },
    },
  },
};

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "public, max-age=3600");
  res.status(200).json(spec);
}
