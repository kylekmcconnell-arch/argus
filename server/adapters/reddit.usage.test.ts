import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

async function loadModules() {
  const cost = await import("../cost");
  const reddit = await import("./reddit");
  return { ...cost, ...reddit };
}

describe("Reddit provider attempt accounting", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("REDDIT_CLIENT_ID", "reddit-client");
    vi.stubEnv("REDDIT_CLIENT_SECRET", "reddit-secret");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records OAuth and search only after both requests succeed", async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        data: {
          children: [{
            data: {
              title: "A warning thread",
              subreddit_name_prefixed: "r/web3",
              score: 42,
              permalink: "/r/web3/comments/argus",
            },
          }],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCost, searchMentions, withCostLedger } = await loadModules();

    const captured = await withCostLedger(async () => ({
      result: await searchMentions("argus"),
      cost: getCost(),
    }));

    expect(captured.result).toEqual([{
      title: "A warning thread",
      sub: "r/web3",
      score: 42,
      url: "https://reddit.com/r/web3/comments/argus",
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeoutSpy.mock.calls).toEqual([[8_000], [10_000]]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal === signal)).toBe(true);
    expect(captured.cost.calls).toHaveLength(2);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "oauth-token", calls: 1, succeeded: 1, partial: 0, failed: 0 }),
      expect.objectContaining({ op: "search", calls: 1, succeeded: 1, partial: 0, failed: 0 }),
    ]));
  });

  it("does not invent a search attempt when OAuth transport fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { getCost, searchMentions, withCostLedger } = await loadModules();

    const captured = await withCostLedger(async () => ({
      result: await searchMentions("argus"),
      cost: getCost(),
    }));

    expect(captured.result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.cost.calls).toEqual([
      expect.objectContaining({
        op: "oauth-token",
        calls: 1,
        succeeded: 0,
        partial: 0,
        failed: 1,
        status: "failed",
        meta: expect.stringContaining("transport_error"),
      }),
    ]);
  });

  it("records a search HTTP failure once, after successful OAuth", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ error: "rate limited" }, 429));
    vi.stubGlobal("fetch", fetchMock);
    const { getCost, searchMentions, withCostLedger } = await loadModules();

    const captured = await withCostLedger(async () => ({
      result: await searchMentions("argus"),
      cost: getCost(),
    }));

    expect(captured.result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "oauth-token", calls: 1, succeeded: 1 }),
      expect.objectContaining({
        op: "search",
        calls: 1,
        succeeded: 0,
        partial: 0,
        failed: 1,
        status: "failed",
        meta: expect.stringContaining("http_429"),
      }),
    ]));
  });

  it("records an unreadable search response as failed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCost, searchMentions, withCostLedger } = await loadModules();

    const captured = await withCostLedger(async () => ({
      result: await searchMentions("argus"),
      cost: getCost(),
    }));

    expect(captured.result).toEqual([]);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: "search",
        calls: 1,
        failed: 1,
        status: "failed",
        meta: expect.stringContaining("response_json_error"),
      }),
    ]));
  });

  it("records usable results with malformed children as partial", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        data: {
          children: [
            { data: { title: "Valid", subreddit_name_prefixed: "r/web3", score: 5, permalink: "/valid" } },
            { data: { title: "Missing permalink", subreddit_name_prefixed: "r/web3" } },
          ],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCost, searchMentions, withCostLedger } = await loadModules();

    const captured = await withCostLedger(async () => ({
      result: await searchMentions("argus"),
      cost: getCost(),
    }));

    expect(captured.result).toHaveLength(1);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: "search",
        calls: 1,
        succeeded: 0,
        partial: 1,
        failed: 0,
        status: "partial",
        meta: expect.stringContaining("dropped_1_invalid_results"),
      }),
    ]));
  });

  it("records an empty but valid search result as succeeded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ data: { children: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getCost, searchMentions, withCostLedger } = await loadModules();

    const captured = await withCostLedger(async () => ({
      result: await searchMentions("argus"),
      cost: getCost(),
    }));

    expect(captured.result).toEqual([]);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: "search",
        calls: 1,
        succeeded: 1,
        partial: 0,
        failed: 0,
        status: "succeeded",
        meta: expect.stringContaining("0_results"),
      }),
    ]));
  });

  it("freezes Reddit complaints as reported reputation evidence with exact provider lineage", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        data: {
          children: [{ data: { title: "A warning about subject", subreddit_name_prefixed: "r/web3", score: 8, permalink: "/warning" } }],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const { redditAdapter } = await loadModules();
    const { emptyEvidence } = await import("../../src/data/evidence");
    const { buildScoringEvidencePacket, extractScoringEvidenceCatalog } = await import("../agent");
    const evidence = emptyEvidence("@subject");

    await redditAdapter.run({ handle: evidence.profile.handle, evidence, emit: vi.fn(), recordCheck: vi.fn() });

    expect(evidence.findings[0]).toMatchObject({
      provider: "reddit",
      source_author: "reddit",
      verification_status: "Reported",
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: { scope: "direct_subject", target_entity_key: "@subject", relationship_to_subject: "self" },
    });
    const catalog = extractScoringEvidenceCatalog(buildScoringEvidencePacket({ findings: evidence.findings }, [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
      { axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" },
    ]));
    const artifact = catalog.find((candidate) => candidate.section === "findings");
    expect(artifact).toMatchObject({
      provider: "reddit",
      verification: "reported",
      eligibleAxes: ["F5_reputation_integrity"],
    });
  });
});
