// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// $LINKR again, this time for the ticker burst. The project's mint landed at
// 22:29:09 UTC; four more LINKR mints appeared six minutes later, and because
// dexscreener drops a pump.fun bonding pair on graduation, the real mint's
// earliest visible POOL (22:52:20) trails the impostors' pools by 17 minutes.
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const POOL = "FNZk3jfkVwd1uNn8EmNsyVxou2WpQx8BEEdGnQwv6Qkx";
const IMPOSTOR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const REAL_POOL_AT = Date.parse("2026-07-30T22:52:20Z");
const IMPOSTOR_POOL_AT = Date.parse("2026-07-30T22:35:00Z");

const dexPair = {
  chainId: "solana",
  dexId: "pumpswap",
  pairAddress: POOL,
  baseToken: { address: MINT, name: "linkrbot", symbol: "LINKR" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
  priceUsd: "0.000015",
  liquidity: { usd: 8329.01 },
  fdv: 14976,
  marketCap: 14976,
  pairCreatedAt: REAL_POOL_AT,
  volume: { h24: 166000 },
  priceChange: { h24: -50 },
};

const impostorPair = {
  ...dexPair,
  pairAddress: "imp-pool",
  baseToken: { address: IMPOSTOR, name: "linkr", symbol: "LINKR" },
  liquidity: { usd: 0 },
  pairCreatedAt: IMPOSTOR_POOL_AT,
};

function stubNetwork(searchPairs: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });
    if (url.includes("/latest/dex/search")) return json({ pairs: searchPairs });
    if (url.includes("dexscreener")) return json({ pairs: [dexPair] });
    return json({});
  }));
}

describe("ticker collisions in a token dossier", () => {
  it("warns about same-ticker mints without calling the audited mint the clone", async () => {
    stubNetwork([dexPair, impostorPair]);
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });
    expect(dossier).not.toBeNull();

    // The load-bearing assertion. Ordering on pool times alone would rank the
    // real mint 17 minutes "later" than a zero-liquidity impostor and tell the
    // project's own buyers they hold the clone.
    expect(dossier!.cloneCheck?.audited).toBe("unresolved");
    expect(dossier!.cloneCheck?.earliestMint).toBeUndefined();
    expect(dossier!.cloneCheck?.clones.map((c) => c.mint)).toEqual([IMPOSTOR]);

    const collision = dossier!.findings.find((f) => /ticker \$LINKR/.test(f.claim));
    expect(collision?.tone).toBe("warn");
    expect(collision?.claim).toContain("1 other mint trades");
    expect(collision?.claim).toContain("Verify you hold the address in this report");
    // Nothing in the dossier may name a person or a wallet off a ticker match.
    expect(collision?.claim).not.toMatch(/deployer|creator|scam|impersonat/i);
  });

  it("publishes no finding when the ticker sweeps clean, since the sweep is a floor", async () => {
    stubNetwork([dexPair]);
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    expect(dossier!.cloneCheck?.audited).toBe("only");
    expect(dossier!.findings.some((f) => /ticker \$LINKR/.test(f.claim))).toBe(false);
    expect(dossier!.findings.some((f) => /only mint|original|authentic/i.test(f.claim))).toBe(false);
  });

  it("does not fail the audit when the sweep itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/latest/dex/search")) throw new Error("dexscreener down");
      return new Response(JSON.stringify({ pairs: [dexPair] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }));

    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });
    expect(dossier).not.toBeNull();
    expect(dossier!.cloneCheck?.checked).toBe(false);
    expect(dossier!.findings.some((f) => /ticker \$LINKR/.test(f.claim))).toBe(false);
  });
});
