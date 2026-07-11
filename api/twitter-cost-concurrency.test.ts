import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ attachPanelCost, resolvePanelCostVersion }));
vi.mock("./_auth.js", () => ({ requireArgusAuth }));

import callPerformanceHandler from "./call-performance";
import kolSignalsHandler from "./kol-signals";

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("request-local Twitter panel accounting", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    resolvePanelCostVersion.mockReset().mockImplementation((_organizationId: string, token?: string) => ({
      "panel-alice": "00000000-0000-4000-8000-000000000301",
      "panel-bob": "00000000-0000-4000-8000-000000000302",
      "panel-shared": "00000000-0000-4000-8000-000000000303",
    })[token ?? ""]);
    requireArgusAuth.mockReset().mockImplementation(async (req: { query?: { handle?: string } }) => ({
      organizationId: `org-${req.query?.handle ?? "test"}`,
      displayName: "Analyst",
    }));
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps interleaved KOL request counters isolated", async () => {
    let releaseAlice!: () => void;
    const alicePaused = new Promise<Response>((resolve) => {
      releaseAlice = () => resolve(json({ data: { followers: 100 } }));
    });
    let markAliceStarted!: () => void;
    const aliceStarted = new Promise<void>((resolve) => { markAliceStarted = resolve; });

    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/user/info") && url.includes("userName=alice")) {
        markAliceStarted();
        return alicePaused;
      }
      if (url.includes("/user/info")) return Promise.resolve(json({ data: { followers: 100 } }));
      if (url.includes("/user/followers")) return Promise.resolve(json({ followers: [] }));
      if (url.includes("/user/last_tweets")) return Promise.resolve(json({ data: { tweets: [] } }));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const aliceResponse = response();
    const alice = kolSignalsHandler({
      method: "GET",
      query: { handle: "alice", reportVersionId: "00000000-0000-4000-8000-000000000399" },
      headers: { "x-argus-panel-token": "panel-alice" },
    } as never, aliceResponse.res as never);
    await aliceStarted;

    const bobResponse = response();
    await kolSignalsHandler({
      method: "GET",
      query: { handle: "bob", reportVersionId: "00000000-0000-4000-8000-000000000398" },
      headers: { "x-argus-panel-token": "panel-bob" },
    } as never, bobResponse.res as never);
    releaseAlice();
    await alice;

    expect(aliceResponse.captured.status).toBe(200);
    expect(bobResponse.captured.status).toBe(200);
    const lines = new Map(attachPanelCost.mock.calls.map((call) => [call[1], call[2]]));
    for (const version of [
      "00000000-0000-4000-8000-000000000301",
      "00000000-0000-4000-8000-000000000302",
    ]) {
      expect(lines.get(version)?.calls).toBe(3);
      expect(lines.get(version)?.usd).toBeCloseTo(0.0006, 8);
    }
  });

  it("uses one stable cost line per promoted token", async () => {
    const anchor = Math.floor(Date.parse("2026-07-01T00:00:00.000Z") / 1000);
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/tokens/") && url.includes("/pools")) {
        return Promise.resolve(json({ data: [{ attributes: { address: "pool-1" } }] }));
      }
      if (url.includes("/advanced_search")) {
        return Promise.resolve(json({ tweets: [{ id: "tweet-1", createdAt: "2026-07-01T00:00:00.000Z", text: "called it" }] }));
      }
      if (url.includes("/ohlcv/day")) {
        return Promise.resolve(json({ data: { attributes: { ohlcv_list: [
          [anchor, 1, 1, 1, 1, 1],
          [anchor + 86400, 2, 2, 2, 2, 1],
        ] } } }));
      }
      if (url.includes("/ohlcv/hour")) {
        return Promise.resolve(json({ data: { attributes: { ohlcv_list: [
          [anchor, 1, 1, 1, 1, 1],
          [anchor + 3600, 1.1, 1.1, 1.1, 1.1, 1],
        ] } } }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const input of [
      { handle: "alice", ticker: "$ONE", address: "0xAAAA", chain: "eth", reportVersionId: "00000000-0000-4000-8000-000000000399" },
      { handle: "alice", ticker: "$TWO", address: "SoLAddress", chain: "solana", reportVersionId: "00000000-0000-4000-8000-000000000399" },
    ]) {
      const { res, captured } = response();
      await callPerformanceHandler({ method: "GET", query: input, headers: { "x-argus-panel-token": "panel-shared" } } as never, res as never);
      expect(captured.status).toBe(200);
    }

    const operations = attachPanelCost.mock.calls.map((call) => call[2]?.op);
    expect(operations).toContain("panel:call-performance:eth:0xAAAA");
    expect(operations).toContain("panel:call-performance:solana:SoLAddress");
    expect(new Set(operations).size).toBe(2);
    for (const call of attachPanelCost.mock.calls) {
      expect(call[1]).toBe("00000000-0000-4000-8000-000000000303");
      expect(call[2]).toMatchObject({ calls: 1, usd: 0.0002 });
    }
  });

  it("rejects a raw historical id before provider or cost work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await kolSignalsHandler({
      method: "GET",
      query: { handle: "alice", reportVersionId: "00000000-0000-4000-8000-000000000399" },
      headers: {},
    } as never, res as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "invalid_panel_context" });
    expect(resolvePanelCostVersion).toHaveBeenLastCalledWith("org-alice", undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it("rejects an invalid capability before provider or cost work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await kolSignalsHandler({
      method: "GET",
      query: { handle: "alice", reportVersionId: "00000000-0000-4000-8000-000000000399" },
      headers: { "x-argus-panel-token": "invalid-panel-token" },
    } as never, res as never);

    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "invalid_panel_context" });
    expect(resolvePanelCostVersion).toHaveBeenLastCalledWith("org-alice", "invalid-panel-token");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });
});
