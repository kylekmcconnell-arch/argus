import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { SubjectClass } from "../../src/engine";
import type { CollectContext } from "./types";
import { coingeckoAdapter } from "./coingecko";
import { dexscreenerAdapter } from "./dexscreener";

const projectContext = (): CollectContext => {
  const evidence = emptyEvidence("@project");
  evidence.roles = [SubjectClass.PROJECT];
  evidence.promotions = [{
    ticker: "PARTNER",
    contract_address: "So11111111111111111111111111111111111111112",
    chain: "solana",
    evidence_origin: "model_lead",
    artifact_verified: false,
  }];
  return { handle: evidence.profile.handle, evidence, emit: vi.fn(), recordCheck: vi.fn() };
};

const kolContext = (promoCount: number): CollectContext => {
  const evidence = emptyEvidence("@kol");
  evidence.roles = [SubjectClass.KOL];
  evidence.promotions = Array.from({ length: promoCount }, (_, i) => ({
    ticker: `TOK${i}`,
    contract_address: `0x${String(i).padStart(40, "0")}`,
    chain: "ethereum",
    evidence_origin: "model_lead" as const,
    artifact_verified: false,
  }));
  return { handle: evidence.profile.handle, evidence, emit: vi.fn(), recordCheck: vi.fn() };
};

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("project token-mention scope", () => {
  it("does not treat a project account's partner-token mentions as KOL promotions", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = projectContext();

    await expect(dexscreenerAdapter.run(ctx)).resolves.toMatchObject({ state: "skipped", attempts: 0 });
    await expect(coingeckoAdapter.run(ctx)).resolves.toMatchObject({ state: "skipped", attempts: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.recordCheck).not.toHaveBeenCalled();
  });

  it("retains promotion analysis for an account explicitly routed as both project and KOL", async () => {
    const ctx = projectContext();
    ctx.evidence.roles.push(SubjectClass.KOL);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ pairs: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await dexscreenerAdapter.run(ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// A prolific promoter with dozens of CA-bearing promos must not turn the token
// lane into an uncapped serial crawl of timeout-bounded lookups: the adapters
// cap at 8 and issue the capped lookups in parallel.
describe("promotion lookup cap and concurrency", () => {
  it("dexscreener caps at 8 lookups and starts them all before any response returns", async () => {
    const ctx = kolContext(12);
    const resolvers: Array<(r: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
    vi.stubGlobal("fetch", fetchMock);

    const run = dexscreenerAdapter.run(ctx);
    await new Promise((r) => setTimeout(r, 0));
    // all capped lookups in flight at once; a serial loop would hold at 1 here
    expect(fetchMock).toHaveBeenCalledTimes(8);
    for (const resolve of resolvers) resolve(jsonResponse({ pairs: [] }));
    await run;
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(ctx.recordCheck).toHaveBeenCalledTimes(8);
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining("8 of 12"),
    }));
  });

  it("coingecko caps at 8 lookups and starts them all before any response returns", async () => {
    const ctx = kolContext(12);
    const resolvers: Array<(r: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
    vi.stubGlobal("fetch", fetchMock);

    const run = coingeckoAdapter.run(ctx);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(8);
    for (const resolve of resolvers) resolve(jsonResponse({ symbol: "tok", name: "Tok" }));
    await run;
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(ctx.recordCheck).toHaveBeenCalledTimes(8);
  });

  it("still resolves every promotion when the count is under the cap", async () => {
    const ctx = kolContext(3);
    const fetchMock = vi.fn(async () => jsonResponse({ pairs: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await dexscreenerAdapter.run(ctx);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(ctx.recordCheck).toHaveBeenCalledTimes(3);
    expect(ctx.emit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining("Resolving 3 promoted token(s)"),
    }));
  });
});
