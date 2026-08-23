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
    expect(t1?.rationale).toContain("liquidity protection unverified");
    expect(dossier!.findings.some((f) => /does not appear locked or burned/i.test(f.claim))).toBe(false);
  });

  it("caps a severe holder concentration without calling it a bundled launch", async () => {
    stubNetwork({
      goplusSol: {
        code: 1,
        result: {
          [MINT]: {
            ...goplusSolanaBody.result[MINT],
            holder_count: "137301",
            holders: [
              { account: "LargeWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.49", is_contract: 0 },
              { account: "SecondWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.14", is_contract: 0 },
            ],
          },
        },
      },
    });

    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });
    const concentration = dossier!.findings.find((finding) => /Concentrated supply/.test(finding.claim));

    expect(dossier!.score).toBeLessThanOrEqual(69);
    expect(dossier!.verdict).not.toBe("PASS");
    expect(dossier!.capApplied).toBe("single_wallet_concentration");
    expect(concentration?.claim).toContain("holder snapshot does not establish whether the wallets coordinated");
    expect(concentration?.claim).not.toMatch(/bundled launch|coordinated snipe/i);
    expect(dossier!.axes.find((axis) => axis.key === "T4")?.rationale).not.toContain("fresh wallets");
  });

  it("caps three wallets holding 61 percent even when a fourth material wallet exists", async () => {
    // The ceiling asks what the three largest material wallets hold BETWEEN
    // them. Gating on the COUNT of material wallets instead let a fourth
    // 1.2% wallet lift the gate off a token where three wallets controlled
    // 61% of supply, and no single wallet reached the 25% single-wallet cap.
    stubNetwork({
      goplusSol: {
        code: 1,
        result: {
          [MINT]: {
            ...goplusSolanaBody.result[MINT],
            holder_count: "137301",
            holders: [
              { account: "WalletAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.24", is_contract: 0 },
              { account: "WalletBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.22", is_contract: 0 },
              { account: "WalletCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.15", is_contract: 0 },
              { account: "WalletDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.012", is_contract: 0 },
            ],
          },
        },
      },
    });

    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    expect(dossier!.verdict).not.toBe("PASS");
    expect(dossier!.score).toBeLessThanOrEqual(69);
    expect(dossier!.capApplied).toBe("few_wallet_concentration");
  });

  it("does not fire the few-wallet ceiling on dust that merely sums past 60 percent", async () => {
    // Three material wallets hold 51% between them. The old condition summed
    // the top FIFTEEN non-market wallets, so sub-1% dust could push an
    // otherwise unremarkable distribution over the 60% ceiling.
    stubNetwork({
      goplusSol: {
        code: 1,
        result: {
          [MINT]: {
            ...goplusSolanaBody.result[MINT],
            holder_count: "137301",
            holders: [
              { account: "WalletAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.17", is_contract: 0 },
              { account: "WalletBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.17", is_contract: 0 },
              { account: "WalletCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.17", is_contract: 0 },
              ...Array.from({ length: 12 }, (_, index) => ({
                account: `DustWallet${String(index).padStart(2, "0")}XXXXXXXXXXXXXXXXXXXXXXXX`,
                percent: "0.0075",
                is_contract: 0,
              })),
            ],
          },
        },
      },
    });

    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    expect(dossier!.capApplied).not.toBe("few_wallet_concentration");
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

// The engine learned to record an unmeasured LP lock, an unusable holder list
// and a pool-excluded top holder. None of that is worth anything if the row a
// reader looks at still asserts the number the engine refused to publish.
describe("what the engine refuses to claim, the report must not print", () => {
  it("publishes the pool-excluded wallet as the top holder, not the pool", async () => {
    stubNetwork();
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    // The raw provider list leads with the PumpSwap pool at 36.94%. The report
    // cannot say "top holder 37%" on the same page as "excluded: the pool 36.9%".
    expect(dossier!.safety.topHolderPct).not.toBeNull();
    expect(dossier!.safety.topHolderPct!).toBeLessThan(10);
    const exclusion = dossier!.findings.find((f) => /Excluded from concentration/.test(f.claim));
    expect(exclusion?.claim).toContain("36.9%");
  });

  it("marks an unusable holder distribution as unassessed instead of a measured zero", async () => {
    // Percentages that sum past 100% are a broken payload, and the audit already
    // suppresses the concentration numbers. The suppression has to be legible.
    stubNetwork({
      goplusSol: {
        code: 1,
        result: {
          [MINT]: {
            ...goplusSolanaBody.result[MINT],
            holders: [
              { account: "WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", percent: "0.80", is_contract: 0 },
              { account: "WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", percent: "0.75", is_contract: 0 },
            ],
          },
        },
      },
    });
    const dossier = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

    expect(dossier!.holdersAssessed).toBe(false);
    expect(dossier!.insiderPct).toBe(0);
    expect(dossier!.bundleCount).toBe(0);
  });

  it("reports the Token-2022 transfer fee rather than asserting a 0% tax nothing measured", async () => {
    stubNetwork();
    const clean = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });
    expect(clean!.axes.find((axis) => axis.key === "T3")?.rationale).toBe("no Token-2022 transfer fee is configured.");

    vi.unstubAllGlobals();
    stubNetwork({
      goplusSol: {
        code: 1,
        result: {
          [MINT]: { ...goplusSolanaBody.result[MINT], transfer_fee: { fee_rate: "0.05" } },
        },
      },
    });
    const fee = await auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });
    expect(fee!.safety.transferFee).toBe(true);
    expect(fee!.axes.find((axis) => axis.key === "T3")?.rationale).toContain("transfer fee is configured");
  });
});
