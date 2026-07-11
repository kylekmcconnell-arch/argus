import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./card";

const SHARE_TOKEN = "A".repeat(43);
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000011";
const VERSION_ID = "00000000-0000-4000-8000-000000000022";
const CASE_ID = "00000000-0000-4000-8000-000000000033";

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
      expires_at: "2026-08-10T12:00:00.000Z",
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

function responseCapture() {
  const captured: {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
  } = { statusCode: 200, body: "", headers: {} };
  const response = {
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = String(value);
    },
    status(code: number) {
      captured.statusCode = code;
      return response;
    },
    send(body: unknown) {
      captured.body = String(body);
      return response;
    },
  };
  return { captured, response };
}

function request() {
  return {
    method: "GET",
    query: { share: SHARE_TOKEN },
    headers: { host: "argus.example", "x-forwarded-proto": "https" },
  };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://database.example");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("public immutable report card", () => {
  it("downgrades a partial PASS and links only to its exact immutable version", async () => {
    const fetchMock = snapshotFetch("PASS", "partial", 94);
    vi.stubGlobal("fetch", fetchMock);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toContain('<div class="label">DECISION READINESS</div><div class="verdict">INCOMPLETE</div>');
    expect(captured.body).toContain("INVESTIGATION INCOMPLETE");
    expect(captured.body).toContain("PRELIMINARY MODEL SIGNAL · PASS 94/100");
    expect(captured.body).toContain("PARTIAL COVERAGE");
    expect(captured.body).not.toContain('<div class="label">VERDICT</div><div class="verdict">PASS</div>');
    expect(captured.body).toContain("<title>@alice — INCOMPLETE · investigation incomplete · ARGUS</title>");
    expect(captured.body).toContain(
      '<meta property="og:title" content="@alice — INCOMPLETE · investigation incomplete · ARGUS"/>',
    );
    expect(captured.body).toContain(
      '<meta name="description" content="Evidence coverage is incomplete. Do not treat the preliminary score as investment clearance.',
    );
    expect(captured.body).toContain(`href="/?version=${VERSION_ID}"`);
    expect(captured.body).toContain("Open exact snapshot");
    expect(captured.body).not.toContain("/?s=");
    expect(captured.body).not.toContain("/?t=");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`id=eq.${VERSION_ID}`);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`organization_id=eq.${ORGANIZATION_ID}`);
  });

  it.each(["CAUTION", "FAIL", "AVOID"])(
    "preserves a partial %s as an explicitly incomplete risk signal",
    async (verdict) => {
      const score = verdict === "CAUTION" ? 54 : verdict === "AVOID" ? 9 : 34;
      vi.stubGlobal("fetch", snapshotFetch(verdict, "partial", score));
      const { captured, response } = responseCapture();

      await handler(request() as never, response as never);

      expect(captured.statusCode).toBe(200);
      expect(captured.body).toContain('<div class="label">RISK SIGNAL</div>');
      expect(captured.body).toContain(`<div class="verdict">${verdict}</div>`);
      expect(captured.body).toContain("INVESTIGATION INCOMPLETE");
      expect(captured.body).toContain("MODEL SCORE");
      expect(captured.body).toContain("missing coverage prevents a complete assessment");
    },
  );

  it("renders a complete PASS as a final verdict", async () => {
    vi.stubGlobal("fetch", snapshotFetch("PASS", "complete", 88));
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.body).toContain('<div class="label">VERDICT</div><div class="verdict">PASS</div>');
    expect(captured.body).toContain("EVIDENCE COVERAGE COMPLETE");
    expect(captured.body).toContain("COMPLETE COVERAGE");
    expect(captured.body).not.toContain("PRELIMINARY MODEL SIGNAL");
  });

  it("fails closed when stored completeness conflicts with frozen checks", async () => {
    vi.stubGlobal("fetch", snapshotFetch("PASS", "complete", 88, "not_run"));
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.body).toContain("INCOMPLETE");
  });

  it("fails closed when a frozen check has expired", async () => {
    const fetchMock = snapshotFetch("PASS", "complete", 88, "complete", "2020-01-01T00:00:00.000Z");
    vi.stubGlobal("fetch", fetchMock);
    const { captured, response } = responseCapture();

    await handler(request() as never, response as never);

    expect(captured.body).toContain("INCOMPLETE");
    expect(captured.body).not.toContain('<div class="label">VERDICT</div><div class="verdict">PASS</div>');
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("select=state,stale_at,metadata");
  });
});
