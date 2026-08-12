import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentPublicReport } from "../src/lib/reportPresentation";

const ogCapture = vi.hoisted(() => ({ element: null as unknown }));

vi.mock("@vercel/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown, options?: { headers?: HeadersInit }) {
      ogCapture.element = element;
      super("mock image", { status: 200, headers: options?.headers });
    }
  },
}));

import handler from "./og";

const SHARE_TOKEN = "B".repeat(43);
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000111";
const VERSION_ID = "12345678-0000-4000-8000-000000000222";
const CASE_ID = "00000000-0000-4000-8000-000000000333";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function snapshotFetch(
  verdict: string,
  completeness: string,
  score: number,
  checkState = completeness === "complete" ? "complete" : "not_run",
  staleAt?: string,
) {
  return vi.fn()
    .mockResolvedValueOnce(jsonResponse([{
      organization_id: ORGANIZATION_ID,
      report_version_id: VERSION_ID,
    }]))
    .mockResolvedValueOnce(jsonResponse([{
      id: VERSION_ID,
      case_id: CASE_ID,
      payload: {
        handle: "@alice",
        headline: "Strong operator with evidence still outstanding.",
        report: { handle: "@alice", composite_verdict: verdict },
      },
      verdict,
      score,
      completeness_state: completeness,
      attestation_state: "server_collected",
      created_at: "2026-07-11T12:00:00.000Z",
    }]))
    .mockResolvedValueOnce(jsonResponse([{
      kind: "person",
      canonical_ref: "alice",
      display_query: "@alice",
    }]))
    .mockResolvedValueOnce(jsonResponse([{
      state: checkState,
      stale_at: staleAt,
      metadata: { notApplicable: false },
    }]));
}

function renderedText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join(" ");
  if (!value || typeof value !== "object") return "";
  const props = (value as { props?: { children?: unknown } }).props;
  return props ? renderedText(props.children) : "";
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://database.example");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  ogCapture.element = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Open Graph report presentation", () => {
  it("uses the same incomplete-positive policy as the public card", async () => {
    vi.stubGlobal("fetch", snapshotFetch("PASS", "partial", 94));

    const response = await handler(new Request(`https://argus.example/api/og?share=${SHARE_TOKEN}`));
    const text = renderedText(ogCapture.element);
    const policy = presentPublicReport({ verdict: "PASS", score: 94, completeness: "partial" });

    expect(response.status).toBe(200);
    for (const expected of [
      policy.resultLabel,
      policy.displayVerdict,
      policy.readinessLabel,
      policy.coverageLabel,
      policy.secondarySignal,
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("VERDICT PASS");
    expect(text).toContain("VERSION 12345678");
  });

  it.each(["CAUTION", "FAIL", "AVOID"])(
    "uses the same incomplete-risk policy for a partial %s",
    async (verdict) => {
      const score = verdict === "CAUTION" ? 54 : verdict === "AVOID" ? 9 : 34;
      vi.stubGlobal("fetch", snapshotFetch(verdict, "partial", score));

      const response = await handler(new Request(`https://argus.example/api/og?share=${SHARE_TOKEN}`));
      const text = renderedText(ogCapture.element);
      const policy = presentPublicReport({ verdict, score: 34, completeness: "partial" });

      expect(response.status).toBe(200);
      expect(text).toContain(policy.resultLabel);
      expect(text).toContain(policy.displayVerdict);
      expect(text).toContain(policy.readinessLabel);
      expect(text).toContain(policy.coverageLabel);
      expect(text).toContain("RISK SCORE");
    },
  );

  it("renders complete PASS with complete-coverage parity", async () => {
    vi.stubGlobal("fetch", snapshotFetch("PASS", "complete", 88));

    const response = await handler(new Request(`https://argus.example/api/og?share=${SHARE_TOKEN}`));
    const text = renderedText(ogCapture.element);

    expect(response.status).toBe(200);
    expect(text).toContain("VERDICT PASS");
    expect(text).toContain("EVIDENCE COVERAGE COMPLETE");
    expect(text).toContain("COMPLETE COVERAGE");
    expect(text).not.toContain("PRELIMINARY MODEL SIGNAL");
  });

  it("fails closed when a frozen check has expired", async () => {
    const fetchMock = snapshotFetch("PASS", "complete", 88, "complete", "2020-01-01T00:00:00.000Z");
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(new Request(`https://argus.example/api/og?share=${SHARE_TOKEN}`));
    const text = renderedText(ogCapture.element);

    expect(response.status).toBe(200);
    expect(text).toContain("INCOMPLETE");
    expect(text).not.toContain("VERDICT PASS");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("select=state,stale_at,metadata");
  });
});
