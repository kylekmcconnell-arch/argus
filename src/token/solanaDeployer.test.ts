// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The real $LINKR payloads, trimmed to the fields the audit reads. GoPlus's
// solana/token_security returns "creators": [] for this mint and for every
// other one tested (BONK, WIF, JUP, USDC), so the deployer lane had nothing to
// work with. The RugCheck figures below are the live 2026-08-01 response:
// creatorBalance 6407110631199 of supply 959415024401372 is 0.6678% of supply.
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const POOL = "FNZk3jfkVwd1uNn8EmNsyVxou2WpQx8BEEdGnQwv6Qkx";
const RUGCHECK_CREATOR = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const RESOLVED_DEPLOYER = "9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw";
const SUPPLY = 959415024401372;

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
  pairCreatedAt: 1785452189000,
  volume: { h24: 166000 },
  priceChange: { h24: -5 },
  txns: { h24: { buys: 200, sells: 210 } },
};

const goplusSolanaBody = {
  code: 1,
  result: {
    [MINT]: {
      holder_count: "579",
      // Every Solana mint tested comes back with an empty creators array.
      creators: [],
      holders: [
        { account: POOL, percent: "0.3694", is_locked: 0, tag: "" },
        { account: "GYZymWPdXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", percent: "0.0356", is_locked: 0, tag: "" },
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

interface NetworkOptions {
  resolveDeployer?: unknown;
  resolveDeployerStatus?: number;
  rugcheck?: unknown;
  rugcheckStatus?: number;
  goplusSol?: unknown;
}

function rugcheckBody(creator: string | null, creatorBalance: number) {
  return { creator, creatorBalance, token: { supply: SUPPLY, decimals: 6 } };
}

function stubNetwork(options: NetworkOptions = {}) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    seen.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "content-type": "application/json" },
    });
    if (url.includes("dexscreener")) return json({ pairs: [dexPair] });
    if (url.includes("gopluslabs")) return json(options.goplusSol ?? goplusSolanaBody);
    if (url.includes("/api/resolve-deployer")) {
      return json(options.resolveDeployer ?? { mint: MINT, available: true, deployer: null, via: null }, options.resolveDeployerStatus ?? 200);
    }
    if (url.includes("api.rugcheck.xyz")) {
      return json(options.rugcheck ?? rugcheckBody(RUGCHECK_CREATOR, 6407110631199), options.rugcheckStatus ?? 200);
    }
    return json({});
  }));
  return seen;
}

// The deep scan is the lane that renders the token report, so it is the lane
// allowed to spend a metered Helius resolution.
const run = () => auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { force: true });
const fastScan = () => auditToken({ kind: "token", ref: MINT, via: "solana" }, undefined, { skipSim: true, force: true });

describe("solana deployer resolution", () => {
  it("resolves the deployer from ARGUS's own resolver when GoPlus names no creator", async () => {
    const seen = stubNetwork({
      resolveDeployer: { mint: MINT, available: true, deployer: RESOLVED_DEPLOYER, via: "mint feePayer" },
    });
    const dossier = await run();

    expect(seen.some((url) => url.includes("/api/resolve-deployer?mint="))).toBe(true);
    expect(dossier!.deployer).toBe(RESOLVED_DEPLOYER);
    expect(dossier!.deployerAttribution).toEqual({
      address: RESOLVED_DEPLOYER,
      source: "helius",
      method: "mint feePayer",
      kind: "deployer",
    });
    // The wallet that signed the creation is the one claim the graph may make.
    expect(dossier!.graph.edges.find((edge) => edge.dst.includes(RESOLVED_DEPLOYER))?.type).toBe("DEPLOYED_BY");
  });

  it("falls back to the keyless RugCheck creator and never calls it the deployer", async () => {
    stubNetwork({ resolveDeployer: { mint: MINT, available: false, note: "Helius not configured." } });
    const dossier = await run();

    expect(dossier!.deployer).toBe(RUGCHECK_CREATOR);
    expect(dossier!.deployerAttribution).toEqual({
      address: RUGCHECK_CREATOR,
      source: "rugcheck",
      method: "creator field",
      kind: "attributed",
    });
    expect(dossier!.graph.edges.find((edge) => edge.dst.includes(RUGCHECK_CREATOR))?.type).toBe("ATTRIBUTED_CREATOR");
  });

  it("keeps an update authority an attribution, because on a bridged or DAO token it is a program", async () => {
    stubNetwork({
      resolveDeployer: { mint: MINT, available: true, deployer: RESOLVED_DEPLOYER, via: "update authority" },
    });
    const dossier = await run();

    expect(dossier!.deployer).toBe(RESOLVED_DEPLOYER);
    expect(dossier!.deployerAttribution?.kind).toBe("attributed");
    expect(dossier!.deployerAttribution?.method).toBe("update authority");
  });

  it("keeps the metered resolver off the fast bulk scan and still names the keyless creator", async () => {
    const seen = stubNetwork({
      resolveDeployer: { mint: MINT, available: true, deployer: RESOLVED_DEPLOYER, via: "mint feePayer" },
    });
    const dossier = await fastScan();

    expect(seen.some((url) => url.includes("/api/resolve-deployer"))).toBe(false);
    expect(dossier!.deployerAttribution?.source).toBe("rugcheck");
    expect(dossier!.safety.creatorPercentAssessed).toBe(true);
  });

  it("records no deployer when no source answers, rather than inventing one", async () => {
    stubNetwork({ rugcheck: rugcheckBody(null, 0) });
    const dossier = await run();

    expect(dossier!.deployer).toBeNull();
    expect(dossier!.deployerAttribution).toBeUndefined();
    expect(dossier!.safety.creatorPercentAssessed).toBe(false);
  });
});

describe("solana creator holdings", () => {
  it("measures the creator's share of supply from RugCheck instead of hardcoding zero", async () => {
    stubNetwork({ resolveDeployer: { mint: MINT, available: false } });
    const dossier = await run();

    expect(dossier!.safety.creatorPercentAssessed).toBe(true);
    expect(dossier!.safety.creatorPercent).toBeCloseTo(0.6678, 3);
  });

  it("reaches the concentrated-creator finding and its holder-distribution penalty", async () => {
    stubNetwork({
      resolveDeployer: { mint: MINT, available: false },
      rugcheck: rugcheckBody(RUGCHECK_CREATOR, SUPPLY * 0.18),
    });
    const heavy = await run();

    stubNetwork({ resolveDeployer: { mint: MINT, available: false } });
    const light = await run();

    const finding = heavy!.findings.find((f) => /still holds ~/.test(f.claim));
    expect(finding?.claim).toContain("18%");
    expect(finding?.tone).toBe("bad");
    expect(finding?.source).toBe("rugcheck");
    // RugCheck's creator is an attribution, and the deployer row in the same
    // report says so. The finding may not be the one place that forgets: on
    // GRASS this exact path measures the mint authority's 25.9% holding.
    expect(finding?.claim).toBe("The creator or authority wallet still holds ~18% of supply.");
    expect(light!.findings.some((f) => /still holds ~/.test(f.claim))).toBe(false);

    const score = (d: typeof heavy) => d!.axes.find((axis) => axis.key === "T4")!.score;
    expect(score(heavy)).toBeLessThan(score(light));
  });

  it("says creator flatly once a source has shown that wallet signed the mint", async () => {
    stubNetwork({
      resolveDeployer: { mint: MINT, available: true, deployer: RUGCHECK_CREATOR, via: "mint feePayer" },
      rugcheck: rugcheckBody(RUGCHECK_CREATOR, SUPPLY * 0.18),
    });
    const dossier = await run();

    expect(dossier!.deployerAttribution?.kind).toBe("deployer");
    expect(dossier!.findings.find((f) => /still holds ~/.test(f.claim))?.claim)
      .toBe("Creator still holds ~18% of supply.");
  });

  it("never reports RugCheck's creator balance under a different resolved address", async () => {
    stubNetwork({
      resolveDeployer: { mint: MINT, available: true, deployer: RESOLVED_DEPLOYER, via: "creation-tx fee payer" },
      rugcheck: rugcheckBody(RUGCHECK_CREATOR, SUPPLY * 0.4),
    });
    const dossier = await run();

    expect(dossier!.deployer).toBe(RESOLVED_DEPLOYER);
    expect(dossier!.safety.creatorPercentAssessed).toBe(false);
    expect(dossier!.safety.creatorPercent).toBe(0);
    expect(dossier!.findings.some((f) => /Creator still holds/.test(f.claim))).toBe(false);
  });

  it("discards an impossible creator share instead of publishing it", async () => {
    stubNetwork({
      resolveDeployer: { mint: MINT, available: false },
      rugcheck: rugcheckBody(RUGCHECK_CREATOR, SUPPLY * 7),
    });
    const dossier = await run();

    expect(dossier!.safety.creatorPercentAssessed).toBe(false);
    expect(dossier!.safety.creatorPercent).toBe(0);
  });
});
