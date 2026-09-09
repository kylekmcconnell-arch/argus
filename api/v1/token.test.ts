import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("../_collector.js", async () => {
  const { resolveInput } = await import("../../src/lib/resolveInput");
  return {
    resolveInput: vi.fn(resolveInput),
    auditToken: vi.fn(),
    collectSocialActivity: vi.fn(),
  };
});

vi.mock("../_auth.js", () => ({
  consumeInvestigationQuota: vi.fn(),
  serviceCredentials: vi.fn(() => ({ url: "https://db.example", key: "test" })),
  serviceHeaders: vi.fn(() => ({})),
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "analyst@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "analyst",
    displayName: "Analyst",
  })),
}));
vi.mock("../_scanReceipts.js", () => ({ claimScanReceipt: vi.fn(async () => "written"), recordScanReceipt: vi.fn() }));

vi.mock("../_provenance.js", () => ({ persistReportVersionBundle: vi.fn(async () => ({ reportVersionId: "00000000-0000-4000-8000-000000000111", caseId: "case", version: 1 })) }));

vi.mock("../_sanctions-core.js", () => ({
  screenSanctionedAddresses: vi.fn(),
}));

import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { auditToken, resolveInput } from "../_collector.js";
import handler from "./token";
import { persistReportVersionBundle } from "../_provenance.js";
afterEach(() => vi.unstubAllGlobals());

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(name: string, value: unknown) { captured.headers[name] = value; return this; },
    end() { return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(query: Record<string, string | string[]>): VercelRequest {
  return {
    method: "GET",
    query,
    headers: {},
  } as unknown as VercelRequest;
}

describe("v1 token input guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a repeated query key with a JSON 400 instead of crashing on the array", async () => {
    const address = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    const { res, captured } = response();

    await handler(request({ address: [address, address] }), res);

    expect(requireArgusAuth).toHaveBeenCalledOnce();
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "pass ?address=<contract> or ?url=<dexscreener url>" });
    expect(resolveInput).not.toHaveBeenCalled();
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(auditToken).not.toHaveBeenCalled();
  });

  it("skips an array-valued key and falls through to the next valid string key", async () => {
    const url = "https://dexscreener.com/solana/abc123";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(auditToken).mockResolvedValue(null);
    const { res, captured } = response();

    await handler(request({ address: ["a", "b"], url }), res);

    expect(resolveInput).toHaveBeenCalledWith(url);
    expect(captured.statusCode).toBe(404);
  });

  it("still audits a single string contract address", async () => {
    const address = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(auditToken).mockResolvedValue(null);
    const { res, captured } = response();

    await handler(request({ address }), res);

    expect(resolveInput).toHaveBeenCalledWith(address);
    expect(auditToken).toHaveBeenCalledOnce();
    expect(captured.statusCode).toBe(404);
    expect(captured.body).toEqual({ error: "no DEX pair found for this contract" });
  });
  it("retains a provisional score without publishing final clearance on missing token checks", async () => {
    const address = "0x1111111111111111111111111111111111111111";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(auditToken).mockResolvedValue(thinToken(address, "Raw positive model output") as never);
    const { res, captured } = response();
    await handler(request({ address }), res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ decision_ready: false, verdict: "PROVISIONAL", score: 90,
      assessment: { verdict: "PROVISIONAL", score: 90 }, preliminary_model_signal: { verdict: "PASS", score: 90 } });
  });

});

function thinToken(address: string, headline: string) {
  return {
    address,
    chain: "ethereum",
    dexId: "uniswap",
    symbol: "ORDER",
    name: "Ordering Test",
    verdict: "PASS",
    score: 90,
    capApplied: null,
    headline,
    axes: [],
    safety: { available: false, simChecked: false },
    socials: [],
    projectX: null,
    deployer: null,
    topHolders: [],
    insiderPct: 0,
    bundleCount: 0,
    bundleRisk: "low",
    graph: { nodes: [], edges: [] },
    findings: [],
    trace: [],
    live: true,
    safetyChecked: false,
  };
}

it("recovers the exact saved API response before quota or provider work", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const savedId = "00000000-0000-4000-8000-000000000111";
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ route: "/api/v1/token", canonical_ref: address, report_version_id: savedId, status: "degraded" }])).mockResolvedValueOnce(Response.json([{ payload: { apiResponse: { api: "argus/v1", address, assessment: { score: 67 } } } }]));
  vi.stubGlobal("fetch", fetcher);
  vi.mocked(consumeInvestigationQuota).mockClear(); vi.mocked(auditToken).mockClear();
  const req = request({ address }); req.headers["idempotency-key"] = "recovery-key-123";
  const { res, captured } = response(); await handler(req, res);
  expect(captured.body).toMatchObject({ address, replayed: true, reportVersionId: savedId, assessment: { score: 67 } });
  expect(consumeInvestigationQuota).not.toHaveBeenCalled(); expect(auditToken).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([url]) => String(url).includes("organization_id=eq."))).toBe(true);
});
it("does not publish success when the immutable token save fails", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
  vi.mocked(auditToken).mockResolvedValue(thinToken(address, "test") as never);
  vi.mocked(persistReportVersionBundle).mockRejectedValueOnce(new Error("storage down"));
  const { res, captured } = response(); await handler(request({ address }), res);
  expect(captured.statusCode).toBe(500);
  expect(captured.body).toMatchObject({ error: "scan_failed" });
});
it("publishes FDV separately from unmeasured market cap", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
  vi.mocked(auditToken).mockResolvedValue({ ...thinToken(address, "test"), mcap: 100000000, fdv: 100000000, marketEvidence: { mcap: false, fdv: true, liquidityUsd: false, vol24: false, ageDays: false } } as never);
  const { res, captured } = response(); await handler(request({ address }), res);
  expect(captured.statusCode).toBe(200);
  expect(captured.body).toMatchObject({ market: { marketCap: null, fullyDilutedValuation: 100000000, liquidityUsd: null, volume24h: null } });
});
it("recovers a committed version even when finishing the receipt failed", async () => {
  const address = "0x1111111111111111111111111111111111111111";
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ route: "/api/v1/token", canonical_ref: address, report_version_id: null, status: "running" }])).mockResolvedValueOnce(Response.json([{ id: "saved-version", payload: { apiResponse: { address, score: 67 } } }]));
  vi.stubGlobal("fetch", fetcher); vi.mocked(consumeInvestigationQuota).mockClear(); vi.mocked(auditToken).mockClear();
  const req = request({ address }); req.headers["idempotency-key"] = "lost-response-key";
  const { res, captured } = response(); await handler(req, res);
  expect(captured.body).toMatchObject({ replayed: true, reportVersionId: "saved-version", score: 67 });
  expect(fetcher.mock.calls[1][0]).toContain("run_id=eq.token-api%3Alost-response-key");
  expect(consumeInvestigationQuota).not.toHaveBeenCalled(); expect(auditToken).not.toHaveBeenCalled();
});
