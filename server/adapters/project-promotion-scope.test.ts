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
