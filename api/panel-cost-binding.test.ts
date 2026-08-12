import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({
  attachPanelCost,
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  claudeUsd: vi.fn(() => 0),
  grokUsd: vi.fn(() => 0),
  resolvePanelCostVersion,
}));

import callPerformanceHandler from "./call-performance";
import challengeVerdictHandler from "./challenge-verdict";
import kolSignalsHandler from "./kol-signals";
import namesakeHandler from "./namesake";
import pfpCheckHandler from "./pfp-check";
import tokenIdentityHandler from "./token-identity";
import vcPortfolioHandler from "./vc-portfolio";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const RAW_VERSION_ID = "00000000-0000-4000-8000-000000000399";

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function requests(panelToken?: string) {
  const headers = panelToken ? { "x-argus-panel-token": panelToken } : {};
  return [
    () => ({ handler: pfpCheckHandler, req: { method: "GET", headers, query: { handle: "alice", reportVersionId: RAW_VERSION_ID } } }),
    () => ({ handler: vcPortfolioHandler, req: { method: "GET", headers, query: { handle: "alice", name: "Alice Fund", reportVersionId: RAW_VERSION_ID } } }),
    () => ({ handler: kolSignalsHandler, req: { method: "GET", headers, query: { handle: "alice", reportVersionId: RAW_VERSION_ID } } }),
    () => ({ handler: callPerformanceHandler, req: { method: "GET", headers, query: { handle: "alice", address: "address", chain: "", reportVersionId: RAW_VERSION_ID } } }),
    () => ({ handler: namesakeHandler, req: { method: "GET", headers, query: { symbol: "ARGUS", reportVersionId: RAW_VERSION_ID } } }),
    () => ({ handler: challengeVerdictHandler, req: { method: "POST", headers, query: {}, body: { verdict: "PASS", evidence: "Evidence", reportVersionId: RAW_VERSION_ID } } }),
    () => ({ handler: tokenIdentityHandler, req: { method: "GET", headers, query: { symbol: "ARGUS", reportVersionId: RAW_VERSION_ID } } }),
  ];
}

describe("supplemental panel cost binding", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    requireArgusAuth.mockReset().mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      userId: "00000000-0000-4000-8000-000000000010",
      displayName: "Analyst",
    });
    resolvePanelCostVersion.mockReset().mockReturnValue(undefined);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TWITTERAPI_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("derives every panel target from the signed header, never a raw reportVersionId", async () => {
    resolvePanelCostVersion.mockReturnValue(RAW_VERSION_ID);

    for (const makeRequest of requests("signed-panel-token")) {
      const { handler, req } = makeRequest();
      const { res, captured } = response();
      await handler(req as never, res as never);
      expect(captured.status).toBe(200);
    }

    expect(resolvePanelCostVersion).toHaveBeenCalledTimes(7);
    for (const call of resolvePanelCostVersion.mock.calls) {
      expect(call).toEqual([ORGANIZATION_ID, "signed-panel-token"]);
    }
  });

  it("rejects raw historical ids for paid post-report panels while preserving pre-persistence token identity", async () => {
    const rawRequests = requests();
    for (const [index, makeRequest] of rawRequests.entries()) {
      const { handler, req } = makeRequest();
      const { res, captured } = response();
      await handler(req as never, res as never);
      expect(captured.status).toBe(index === rawRequests.length - 1 ? 200 : 409);
      if (index < rawRequests.length - 1) {
        expect(captured.body).toMatchObject({ error: "invalid_panel_context" });
      }
    }

    expect(resolvePanelCostVersion).toHaveBeenCalledTimes(7);
    for (const call of resolvePanelCostVersion.mock.calls) {
      expect(call).toEqual([ORGANIZATION_ID, undefined]);
    }
  });

  it("rejects an invalid signed context before any provider or cost work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const makeRequest of requests("invalid-panel-token")) {
      const { handler, req } = makeRequest();
      const { res, captured } = response();
      await handler(req as never, res as never);
      expect(captured.status).toBe(409);
      expect(captured.body).toMatchObject({ error: "invalid_panel_context" });
    }

    expect(resolvePanelCostVersion).toHaveBeenCalledTimes(7);
    for (const call of resolvePanelCostVersion.mock.calls) {
      expect(call).toEqual([ORGANIZATION_ID, "invalid-panel-token"]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });
});
