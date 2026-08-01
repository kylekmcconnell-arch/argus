// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The real $LINKR payloads, trimmed to the fields the audit reads. Recorded
// live from dexscreener and GoPlus while diagnosing why a day-old pump.fun
// launch reported 57% insider concentration: its top "holder" was its own
// PumpSwap pool, and GoPlus returned no LP holder records at all.
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const POOL = "FNZk3jfkVwd1uNn8EmNsyVxou2WpQx8BEEdGnQwv6Qkx";

const dexPair = {
  chainId: "solana",
  dexId: "pumpswap",
  pairAddress: POOL,
  url: `https://dexscreener.com/solana/${POOL}`,
  baseToken: { address: MINT, name: "linkrbot", symbol: "LINKR" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
  priceUsd: "0.000015",
  liquidity: { usd: 8329.01, base: 1, quote: 1 },
  fdv: 14976,
  marketCap: 14976,
  pairCreatedAt: 1785452189000,
  volume: { h24: 166000 },
  priceChange: { h24: -50 },
  txns: { h24: { buys: 200, sells: 210 } },
};

const goplusSolanaBody = {
  code: 1,
  result: {
    [MINT]: {
      holder_count: "120",
      // The pool is holder #1 at 36.94%, tagged with nothing at all.
      holders: [
        { account: POOL, percent: "0.3694", is_locked: 0, tag: "" },
        { account: "GYZymWPdXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.0356", is_locked: 0, tag: "" },
        { account: "Wallet3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.0300", is_locked: 0, tag: "" },
      ],
      lp_holders: null,
      mintable: { status: "0" },
      freezable: { status: "0" },
      metadata_mutable: { status: "0" },
      non_transferable: "0",
      closable: { status: "0" },
      balance_mutable_authority: { status: "0" },
    },
  },
};

function stubNetwork(overrides: { goplusSol?: unknown } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });
    if (url.includes("dexscreener.com/token-pairs") || url.includes("/latest/dex/tokens/")) {
      return json({ pairs: [dexPair] });
    }
    if (url.includes("dexscreener")) return json({ pairs: [dexPair] });
    if (url.includes("gopluslabs") && url.includes("solana")) return json(overrides.goplusSol ?? goplusSolanaBody);
    if (url.includes("gopluslabs")) return json({ code: 1, result: {} });
    return json({});
  }));
}

describe("market infrastructure is not a holder", () => {
  it("excludes the token's own pool from concentration and says so", async () => {
    stubNetwork();
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });
    expect(dossier).not.toBeNull();

    // 36.94 + 3.56 + 3.00 = 43.5% would read "high" bundle risk. Excluding the
    // pool leaves 6.56% across two wallets, which is the honest number.
    const concentration = dossier!.findings.find((f) => /Concentrated supply/.test(f.claim));
    expect(concentration).toBeUndefined();
    expect(dossier!.insiderPct).toBeLessThan(10);
    expect(dossier!.bundleRisk).toBe("low");

    const exclusion = dossier!.findings.find((f) => /Excluded from concentration/.test(f.claim));
    expect(exclusion?.claim).toContain("liquidity pool");
    expect(exclusion?.claim).toContain("36.9%");
  });

  it("reports an unmeasured LP lock as unmeasured, never as unlocked", async () => {
    stubNetwork();
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    const t1 = dossier!.axes.find((axis) => axis.key === "T1");
    expect(t1?.rationale).toContain("LP lock not measured");
    expect(dossier!.findings.some((f) => /does not appear locked or burned/i.test(f.claim))).toBe(false);
  });

  it("discards an impossible LP share instead of publishing it", async () => {
    // The real WIF payload: GoPlus returned percent "255324.3541", which ARGUS
    // published as "1 wallet 25532435%" about a top-100 token.
    stubNetwork({
      goplusSol: {
        code: 1,
        result: {
          [MINT]: {
            ...goplusSolanaBody.result[MINT],
            lp_holders: [{ address: "LpWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "255324.3541", is_locked: 0 }],
          },
        },
      },
    });
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    expect(dossier!.safety.lpTopUnlockedEoaPct).toBeLessThanOrEqual(100);
    expect(dossier!.safety.lpAssessed).toBe(false);
    expect(JSON.stringify(dossier!.findings)).not.toContain("25532435");
    expect(dossier!.axes.find((axis) => axis.key === "T1")?.rationale).not.toContain("25532435");
  });
});
