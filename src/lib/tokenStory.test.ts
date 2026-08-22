import { describe, expect, it } from "vitest";
import type { NormalizedSafety, TokenDossier } from "../token/audit";
import { buildTokenStory, tokenDataGaps } from "./tokenStory";

const safety: NormalizedSafety = {
  available: true,
  contractPropertiesAssessed: true,
  simChecked: true,
  honeypot: false,
  honeypotOnchain: false,
  serialScammerCreator: false,
  mintable: false,
  freezable: false,
  nonTransferable: false,
  ownerRenounced: true,
  takeBack: false,
  hiddenOwner: false,
  selfdestruct: false,
  pausable: false,
  openSource: true,
  cannotSellAll: false,
  metadataMutable: false,
  buyTax: 0,
  sellTax: 0,
  holderCount: 1200,
  topHolderPct: 8,
  lpLocked: true,
  lpBurnedPct: 100,
  lpLockedPct: 0,
  lpTopUnlockedEoaPct: 0,
  lpAssessed: true,
  balanceMutable: false,
  transferHook: false,
  transferFee: false,
  proxy: false,
  slippageModifiable: false,
  blacklist: false,
  tradingCooldown: false,
  externalCall: false,
  ownerChangeBalance: false,
  creatorPercent: 1.2,
  creatorPercentAssessed: true,
};

function dossier(overrides: Partial<TokenDossier> = {}): TokenDossier {
  return {
    address: "0x0000000000000000000000000000000000000001",
    chain: "ethereum",
    dexId: "uniswap",
    pairAddress: "0xpair",
    symbol: "ARG",
    name: "Argus Test",
    mcap: 2_400_000,
    fdv: 3_100_000,
    liquidityUsd: 180_000,
    vol24: 42_000,
    ageDays: 40,
    marketEvidence: { mcap: true, fdv: true, liquidityUsd: true, vol24: true, ageDays: true },
    verdict: "PASS",
    score: 88,
    capApplied: null,
    headline: "Test snapshot",
    axes: [],
    safety,
    socials: [],
    projectX: "@argus",
    deployer: "0x1111111111111111111111111111111111111111",
    deployerAttribution: {
      kind: "deployer",
      address: "0x1111111111111111111111111111111111111111",
      source: "goplus",
      method: "creation_tx",
    },
    topHolders: [{ address: "0xholder", percent: 8 }],
    insiderPct: 0,
    bundleCount: 0,
    bundleRisk: "low",
    cg: { listed: true, id: "argus-test", rank: 400, mcapUsd: 2_400_000, marketCount: 4, cexCount: 2, cexNames: ["Binance", "Coinbase"], homepage: null, twitter: "argus", image: null, description: null },
    graph: { nodes: [], edges: [] },
    findings: [],
    trace: [],
    live: true,
    safetyChecked: true,
    holdersAssessed: true,
    ...overrides,
  };
}

describe("buildTokenStory", () => {
  it("authors chronological beats from recorded counts, not editorial copy", () => {
    const story = buildTokenStory(dossier());
    expect(story.beats.map((beat) => beat.id)).toEqual([
      "launch",
      "liquidity",
      "holders",
      "contract",
      "presence",
    ]);
    expect(story.beats.find((beat) => beat.id === "launch")?.heading).toBe(
      "The pair is 40 days old. The deployer wallet is on record.",
    );
    expect(story.beats.find((beat) => beat.id === "liquidity")?.heading).toContain("Liquidity is $180.0K.");
    expect(story.beats.find((beat) => beat.id === "liquidity")?.heading).toContain("100% of the LP is recorded as burned.");
    expect(story.beats.find((beat) => beat.id === "holders")?.heading).toBe(
      "1,200 holders are on record. The largest holder is recorded at 8%.",
    );
    expect(story.beats.find((beat) => beat.id === "presence")?.heading).toBe(
      "Listed on 2 centralized exchanges. An official X account is on record.",
    );
    expect(story.gaps).toEqual([]);
  });

  it("marks missing collectors as unestablished and surfaces them as a gap beat", () => {
    const thin = dossier({
      deployer: null,
      deployerAttribution: undefined,
      projectX: null,
      cg: null,
      topHolders: [],
      ageDays: undefined,
      mcap: undefined,
      fdv: undefined,
      liquidityUsd: undefined,
      vol24: undefined,
      safety: {
        ...safety,
        available: false,
        holderCount: 0,
        topHolderPct: null,
        creatorPercentAssessed: false,
        lpAssessed: false,
      },
    });
    const story = buildTokenStory(thin);
    expect(story.gaps.length).toBeGreaterThan(0);
    expect(story.beats.map((beat) => beat.id)).toContain("gaps");
    expect(story.beats.find((beat) => beat.id === "gaps")?.heading).toMatch(/checks could not be completed/);
    expect(story.headline.every((figure) => figure.provenance.tier === "unestablished")).toBe(true);
    expect(story.beats.find((beat) => beat.id === "launch")?.figures.every((figure) => figure.provenance.tier === "unestablished")).toBe(true);
    expect(tokenDataGaps(thin)).toEqual(story.gaps);
  });

  it("does not treat an attributed creator as a proven deployer", () => {
    const story = buildTokenStory(dossier({
      deployerAttribution: {
        kind: "attributed",
        address: "0x1111111111111111111111111111111111111111",
        source: "metadata",
        method: "update_authority",
      },
    }));
    const launch = story.beats.find((beat) => beat.id === "launch")!;
    expect(launch.heading).toContain("A creator or authority wallet is named, not a proven deployer.");
    expect(launch.figures.find((figure) => figure.label === "Creator or authority")?.provenance.tier).toBe("derived");
  });

  it("ranks recorded sources by how many figures cite them", () => {
    const story = buildTokenStory(dossier());
    expect(story.sources[0]?.factsCited).toBeGreaterThan(0);
    expect(story.sources.some((row) => row.url.includes("dexscreener.com"))).toBe(true);
    expect(story.sources.some((row) => row.url.includes("coingecko.com"))).toBe(true);
    expect(story.sources[0].factsCited).toBeGreaterThanOrEqual(story.sources[story.sources.length - 1].factsCited);
    const dex = story.sources.find((row) => row.url.includes("dexscreener.com"))!;
    expect(dex.citedLabels).not.toContain("Holders");
    expect(dex.citedLabels).not.toContain("LP lock");
    expect(dex.citedLabels).not.toContain("Deployer");
  });

  it("keeps headline market figures sourced when DexScreener recorded them", () => {
    const story = buildTokenStory(dossier());
    expect(story.headline.map((figure) => [figure.label, figure.value, figure.provenance.tier])).toEqual([
      ["mcap", "$2.40M", "sourced"],
      ["All-token value (FDV)", "$3.10M", "sourced"],
      ["liquidity", "$180.0K", "sourced"],
      ["24h vol", "$42.0K", "sourced"],
    ]);
  });

  it("does not present fallback zeros as sourced market observations", () => {
    const story = buildTokenStory(dossier({
      mcap: 0,
      fdv: 0,
      liquidityUsd: 0,
      vol24: 0,
      marketEvidence: { mcap: false, fdv: false, liquidityUsd: false, vol24: false, ageDays: true },
    }));
    expect(story.headline.map((figure) => figure.provenance.tier)).toEqual([
      "unestablished",
      "unestablished",
      "unestablished",
      "unestablished",
    ]);
    expect(story.beats.find((beat) => beat.id === "liquidity")?.heading).toContain("Liquidity was not recorded.");
  });

  it("does not turn a successful trade simulation into clean contract-property claims", () => {
    const story = buildTokenStory(dossier({
      safety: {
        ...safety,
        available: true,
        contractPropertiesAssessed: false,
        simChecked: true,
      },
    }));
    const contract = story.beats.find((beat) => beat.id === "contract")!;
    expect(contract.heading).toBe("1 contract check is on record.");
    expect(contract.figures.map((item) => [item.label, item.provenance.tier])).toEqual([
      ["Honeypot", "sourced"],
      ["Mintable", "unestablished"],
      ["Ownership", "unestablished"],
      ["Source code", "unestablished"],
    ]);
    expect(story.gaps).toContain(
      "ARGUS ran a trade simulation but did not receive contract-property checks. Mint, ownership, and source-code status remain unverified.",
    );
  });
});
