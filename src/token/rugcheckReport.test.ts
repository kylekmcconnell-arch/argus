// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";
import { largestInsiderClusterPercent, rugcheckReport } from "./sources";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Every Solana scan already downloads the whole RugCheck report and used three
// fields out of it. These are the rest, on the $LINKR payload shape: the LP lock
// GoPlus never answers on this chain, RugCheck's labelled accounts, its rugged
// verdict, and its connected clusters.
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const POOL = "FNZk3jfkVwd1uNn8EmNsyVxou2WpQx8BEEdGnQwv6Qkx";
const LABELLED_CEX = "7hGkTvXQ8mPzRc4WdNvBqLsYxAe2FuJnKpRt5MwZbQ3d";
const NAME_ONLY = "3pQxLmWvTb9RkCzHfNdYs6JgAe4UnBoMr7XtVqZw2Ecs";
const PLAIN_WALLET = "9dFtKpRxMz2BnQvWcYs4LhJa7UgEo3TrXbNiZm5QwAv8";
const SUPPLY = 1_000_000_000;

const dexPair = {
  chainId: "solana",
  dexId: "pumpswap",
  pairAddress: POOL,
  baseToken: { address: MINT, name: "linkrbot", symbol: "LINKR" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
  priceUsd: "0.000015",
  liquidity: { usd: 82_000 },
  fdv: 149_760,
  marketCap: 149_760,
  pairCreatedAt: 1785452189000,
  volume: { h24: 166_000 },
  priceChange: { h24: -5 },
  txns: { h24: { buys: 200, sells: 210 } },
};

// GoPlus Solana, exactly as it comes back: holders, and no LP holder rows at
// all, which is why the LP lock read as unchecked on every Solana token.
const goplusSolanaBody = (overrides: Record<string, unknown> = {}) => ({
  code: 1,
  result: {
    [MINT]: {
      holder_count: "1200",
      holders: [
        { account: POOL, percent: "0.10", is_locked: 0, tag: "" },
        { account: LABELLED_CEX, percent: "0.20", is_locked: 0, tag: "" },
        { account: NAME_ONLY, percent: "0.15", is_locked: 0, tag: "" },
        { account: PLAIN_WALLET, percent: "0.05", is_locked: 0, tag: "" },
      ],
      lp_holders: null,
      mintable: { status: "0" },
      freezable: { status: "0" },
      metadata_mutable: { status: "0" },
      non_transferable: "0",
      closable: { status: "0" },
      balance_mutable_authority: { status: "0" },
      ...overrides,
    },
  },
});

const rugcheckBody = (overrides: Record<string, unknown> = {}) => ({
  creator: PLAIN_WALLET,
  creatorBalance: 50_000_000,
  token: { supply: SUPPLY },
  lpLockedPct: 92.5,
  rugged: false,
  knownAccounts: {
    // The structured type is the only thing the classifier may trust.
    [LABELLED_CEX]: { name: "Bybit hot wallet", type: "EXCHANGE" },
    // A name that says "pool" with no type behind it. Names are chosen by
    // whoever deployed the account, so this one must still count as a wallet.
    [NAME_ONLY]: { name: "Raydium Pool Reserve" },
  },
  insiderNetworks: [
    { size: 12, tokenAmount: 200_000_000 },
    { size: 21, tokenAmount: 350_000_000 },
    { size: 9, tokenAmount: 250_000_000 },
  ],
  graphInsidersDetected: 40,
  ...overrides,
});

function stubNetwork(overrides: { goplusSol?: unknown; rugcheck?: unknown; rugcheckStatus?: number } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "content-type": "application/json" },
    });
    if (url.includes("rugcheck")) {
      return json(overrides.rugcheck ?? rugcheckBody(), overrides.rugcheckStatus ?? 200);
    }
    if (url.includes("dexscreener")) return json({ pairs: [dexPair] });
    if (url.includes("gopluslabs") && url.includes("solana")) return json(overrides.goplusSol ?? goplusSolanaBody());
    if (url.includes("gopluslabs")) return json({ code: 1, result: {} });
    return json({});
  }));
}

const scan = () => auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

describe("rugcheckReport reads the whole report it already paid for", () => {
  it("returns the LP lock, the rugged flag, the labels and the clusters from one fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(rugcheckBody({ rugged: true })), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const report = await rugcheckReport(MINT, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(report?.creator).toBe(PLAIN_WALLET);
    expect(report?.creatorPercent).toBeCloseTo(5, 6);
    expect(report?.lpLockedPct).toBe(92.5);
    expect(report?.rugged).toBe(true);
    expect(report?.knownAccounts[LABELLED_CEX]?.type).toBe("EXCHANGE");
    expect(report?.graphInsidersDetected).toBe(40);
    expect(report?.insiderNetworks.map((network) => network.percent)).toEqual([20, 35, 25]);
  });

  it("treats an absent LP lock as unmeasured rather than zero percent locked", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: { supply: SUPPLY } }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const report = await rugcheckReport(MINT, fetchImpl as unknown as typeof fetch);

    expect(report?.lpLockedPct).toBeNull();
    expect(report?.rugged).toBe(false);
    expect(report?.knownAccounts).toEqual({});
    expect(report?.insiderNetworks).toEqual([]);
    expect(report?.graphInsidersDetected).toBeNull();
  });

  it("discards an LP lock outside 0 to 100, the way a supply share is gated", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(rugcheckBody({ lpLockedPct: 4200 })), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    await expect(rugcheckReport(MINT, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ lpLockedPct: null });
  });

  // RugCheck writes 0 into this field both for a pool it read and found
  // unlocked, and for a mint it holds no market record for. The two are only
  // separable by whether it shows any market at all.
  it("keeps a zero lock unmeasured when RugCheck shows no market it could have read", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(rugcheckBody({ lpLockedPct: 0 })), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    await expect(rugcheckReport(MINT, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ lpLockedPct: null });
  });

  it("accepts a zero lock once RugCheck shows a market it actually examined", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rugcheckBody({ lpLockedPct: 0, markets: [{ pubkey: POOL, marketType: "pumpswap" }] }),
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(rugcheckReport(MINT, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ lpLockedPct: 0 });
  });

  it("needs no market record to trust a positive lock, which is its own evidence", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(rugcheckBody({ lpLockedPct: 4 })), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    await expect(rugcheckReport(MINT, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ lpLockedPct: 4 });
  });

  it("reports a cluster whose wallet count RugCheck omitted as uncounted, not as empty", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rugcheckBody({ insiderNetworks: [{ tokenAmount: 200_000_000 }] }),
    ), { status: 200, headers: { "content-type": "application/json" } }));
    const report = await rugcheckReport(MINT, fetchImpl as unknown as typeof fetch);

    // A cluster of zero wallets is the one reading that would talk a reader out
    // of looking at a cluster holding 20% of supply.
    expect(report?.insiderNetworks[0]?.size).toBeNull();
    expect(report?.insiderNetworks[0]?.percent).toBe(20);
  });
});

describe("largestInsiderClusterPercent", () => {
  it("takes the biggest cluster, because overlapping networks cannot be added", () => {
    expect(largestInsiderClusterPercent([{ size: 12, percent: 20 }, { size: 21, percent: 35 }, { size: 9, percent: 25 }]))
      .toBe(35);
  });

  it("returns null when no cluster carried a measurable share", () => {
    expect(largestInsiderClusterPercent([])).toBeNull();
    expect(largestInsiderClusterPercent([{ size: 4, percent: null }])).toBeNull();
  });
});

describe("a Solana LP lock RugCheck already answered", () => {
  it("records the lock GoPlus could not measure, and says RugCheck measured it", async () => {
    stubNetwork();
    const dossier = await scan();

    expect(dossier!.safety.lpAssessed).toBe(true);
    expect(dossier!.safety.lpLockedPct).toBe(92.5);
    expect(dossier!.safety.lpLocked).toBe(true);
    const lock = dossier!.findings.find((f) => /liquidity is locked/i.test(f.claim));
    expect(lock?.tone).toBe("good");
    expect(lock?.source).toBe("rugcheck");
    expect(lock?.claim).toMatch(/rugcheck/i);
    expect(dossier!.findings.some((f) => /LP lock was not measured/.test(f.claim))).toBe(false);
    expect(dossier!.axes.find((axis) => axis.key === "T1")?.rationale).toContain("LP locked");
  });

  it("reports a low RugCheck lock as RugCheck's reading, not as an ARGUS measurement", async () => {
    stubNetwork({ rugcheck: rugcheckBody({ lpLockedPct: 4 }) });
    const dossier = await scan();

    expect(dossier!.safety.lpAssessed).toBe(true);
    expect(dossier!.safety.lpLocked).toBe(false);
    const lock = dossier!.findings.find((f) => /LP locked|liquidity is not lock protected/i.test(f.claim));
    expect(lock?.tone).toBe("warn");
    expect(lock?.source).toBe("rugcheck");
    expect(lock?.claim).toMatch(/rugcheck/i);
    expect(dossier!.axes.find((axis) => axis.key === "T1")?.rationale).toContain("LP not locked");
  });

  it("keeps the lock unmeasured when RugCheck's figure is impossible", async () => {
    stubNetwork({ rugcheck: rugcheckBody({ lpLockedPct: 4200 }) });
    const dossier = await scan();

    expect(dossier!.safety.lpAssessed).toBe(false);
    expect(dossier!.safety.lpLockedPct).toBe(0);
    expect(dossier!.findings.some((f) => /LP lock was not measured/.test(f.claim))).toBe(true);
    expect(JSON.stringify(dossier!.findings)).not.toContain("4200");
    expect(dossier!.axes.find((axis) => axis.key === "T1")?.rationale).toContain("LP lock not measured");
  });

  it("does not publish 'not lock protected' from a zero RugCheck never evidenced", async () => {
    stubNetwork({ rugcheck: rugcheckBody({ lpLockedPct: 0 }) });
    const dossier = await scan();

    // No market record means nothing was read, and an unread pool is not an
    // unlocked one. This is the same failure as the old GoPlus branch, one
    // provider over.
    expect(dossier!.safety.lpAssessed).toBe(false);
    expect(dossier!.findings.some((f) => /LP lock was not measured/.test(f.claim))).toBe(true);
    expect(dossier!.findings.some((f) => /not lock protected/i.test(f.claim))).toBe(false);
  });

  it("does publish the unlocked reading once RugCheck shows the market it read", async () => {
    stubNetwork({ rugcheck: rugcheckBody({ lpLockedPct: 0, markets: [{ pubkey: POOL }] }) });
    const dossier = await scan();

    expect(dossier!.safety.lpAssessed).toBe(true);
    expect(dossier!.safety.lpLocked).toBe(false);
    const lock = dossier!.findings.find((f) => /not lock protected/i.test(f.claim));
    expect(lock?.tone).toBe("warn");
    expect(lock?.source).toBe("rugcheck");
  });

  it("leaves the lock unmeasured when RugCheck itself is unreachable", async () => {
    stubNetwork({ rugcheckStatus: 500 });
    const dossier = await scan();

    expect(dossier!.safety.lpAssessed).toBe(false);
    expect(dossier!.findings.some((f) => /LP lock was not measured/.test(f.claim))).toBe(true);
  });

  it("does not overwrite an LP lock GoPlus did report", async () => {
    stubNetwork({
      goplusSol: goplusSolanaBody({ lp_holders: [{ account: "LpWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.10", is_locked: 0 }] }),
    });
    const dossier = await scan();

    // GoPlus measured 10% locked. RugCheck's 92.5% must not silently replace a
    // reading the primary source already made.
    expect(dossier!.safety.lpLockedPct).toBe(0);
    expect(dossier!.safety.lpTopUnlockedEoaPct).toBe(10);
    expect(dossier!.safety.lpAssessed).toBe(true);
  });
});

describe("RugCheck's labelled accounts are excluded from concentration", () => {
  it("drops a typed exchange account and keeps a wallet that merely calls itself a pool", async () => {
    stubNetwork();
    const dossier = await scan();

    // Pool 10% + labelled exchange 20% + name-only 15% + wallet 5% = 50%.
    // Excluding the pool and the typed exchange leaves 20% across two wallets.
    expect(dossier!.insiderPct).toBe(20);
    expect(dossier!.bundleRisk).toBe("low");
    expect(dossier!.safety.topHolderPct).toBe(15);

    const exclusion = dossier!.findings.find((f) => /Excluded from concentration/.test(f.claim));
    expect(exclusion?.claim).toContain("Bybit hot wallet");
    expect(exclusion?.source).toBe("rugcheck");
    // A name is chosen by whoever deployed the account. Excluding on the word
    // "Pool" alone is the one direction ARGUS must never fail in.
    expect(exclusion?.claim).not.toContain("Raydium Pool Reserve");
  });

  it("counts the labelled account as a wallet when RugCheck gives no type", async () => {
    stubNetwork({
      rugcheck: rugcheckBody({
        knownAccounts: { [LABELLED_CEX]: { name: "Bybit hot wallet" }, [NAME_ONLY]: { name: "Raydium Pool Reserve" } },
      }),
    });
    const dossier = await scan();

    expect(dossier!.insiderPct).toBe(40);
    expect(dossier!.bundleRisk).toBe("elevated");
  });
});

describe("RugCheck's own assessments, named as RugCheck's", () => {
  it("pushes a bad finding when RugCheck flags the token as rugged", async () => {
    stubNetwork({ rugcheck: rugcheckBody({ rugged: true }) });
    const dossier = await scan();

    const rugged = dossier!.findings.find((f) => /rugged/i.test(f.claim));
    expect(rugged?.tone).toBe("bad");
    expect(rugged?.source).toBe("rugcheck");
    expect(rugged?.claim).toMatch(/rugcheck/i);
  });

  it("says nothing about rugging when RugCheck did not flag it", async () => {
    stubNetwork();
    const dossier = await scan();
    expect(dossier!.findings.some((f) => /rugged/i.test(f.claim))).toBe(false);
  });

  it("reports the largest connected cluster, never the sum of overlapping ones", async () => {
    stubNetwork();
    const dossier = await scan();

    const cluster = dossier!.findings.find((f) => /connected|common funding source/i.test(f.claim));
    expect(cluster?.source).toBe("rugcheck");
    expect(cluster?.tone).toBe("bad");
    expect(cluster?.claim).toContain("35%");
    expect(cluster?.claim).toContain("40");
    // 20 + 35 + 25 = 80. Wallets sit in several networks at once, so the sum is
    // supply that does not exist.
    expect(cluster?.claim).not.toContain("80%");
    expect(cluster?.claim).toMatch(/largest|biggest/i);
  });

  it("stays quiet on a mega-holder base, where a large linked graph is expected", async () => {
    stubNetwork({ goplusSol: goplusSolanaBody({ holder_count: "60000" }) });
    const dossier = await scan();

    expect(dossier!.findings.some((f) => /common funding source/i.test(f.claim))).toBe(false);
  });
});
