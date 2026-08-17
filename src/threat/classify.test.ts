import { describe, expect, it } from "vitest";
import { classifyToken } from "./classify";
import type { CodeTokenomics } from "./solidity";
import type { TokenDossier } from "../token/audit";
import type { CgInfo } from "../token/sources";

function cg(over: Partial<CgInfo> = {}): CgInfo {
  return {
    listed: true, rank: null, mcapUsd: null, marketCount: 3, cexCount: 0, cexNames: [],
    homepage: null, twitter: null, image: null, description: null, categories: [],
    ...over,
  };
}

function dossier(over: Partial<TokenDossier> = {}): TokenDossier {
  return {
    address: "0xabc", chain: "ethereum", dexId: "uniswap", symbol: "TKN", name: "Token",
    liquidityUsd: 50000, mcap: 100000, ageDays: 40, bundleRisk: "low", insiderPct: 0,
    bundleCount: 0, safety: { available: true } as any, findings: [], cg: null,
    ...over,
  } as TokenDossier;
}

const rwaCode = { taxDestinations: ["rwa-distribution"], hasBurnFunction: false, hasAutoBurn: false, rwaKeywords: ["stock"] } as unknown as CodeTokenomics;

describe("classifyToken", () => {
  it("classifies a CoinGecko-categorized meme coin as meme, high confidence", () => {
    const c = classifyToken(dossier({ symbol: "PEPE", name: "Pepe", cg: cg({ categories: ["Meme"], description: "Pepe is a community-driven meme coin with no utility." }) }));
    expect(c.kind).toBe("meme");
    expect(c.confidence).toBe("high");
  });

  it("meme category outranks a utility category on the same token", () => {
    const c = classifyToken(dossier({ cg: cg({ categories: ["Meme", "Decentralized Finance (DeFi)"] }) }));
    expect(c.kind).toBe("meme");
  });

  it("reads a pump.fun-class mint as a meme launch", () => {
    const c = classifyToken(dossier({ chain: "solana", dexId: "pumpswap", address: "7pXs…pump" }));
    expect(c.kind).toBe("meme");
    expect(c.signals.join(" ")).toMatch(/launchpad/i);
  });

  it("classifies tokenized stock as equity", () => {
    const c = classifyToken(dossier({ symbol: "TSLAX", name: "Tesla xStock", cg: cg({ categories: ["Tokenized Stocks"], description: "Tokenized share tracking Tesla equity." }) }));
    expect(c.kind).toBe("equity");
    expect(c.confidence).toBe("high");
  });

  it("classifies RWA from the code's tax destination even without a blurb", () => {
    const before = classifyToken(dossier());
    const after = classifyToken(dossier(), rwaCode);
    expect(before.kind).not.toBe("rwa");
    expect(after.kind).toBe("rwa");
  });

  it("classifies a DeFi protocol token as utility", () => {
    const c = classifyToken(dossier({ cg: cg({ categories: ["Decentralized Finance (DeFi)"], description: "Governance token for the lending protocol." }) }));
    expect(c.kind).toBe("utility");
  });

  it("flags dividend / revenue-share language as security-like", () => {
    const c = classifyToken(dossier({ cg: cg({ description: "Holders receive dividends from a share of the revenue every week." }) }));
    expect(c.kind).toBe("security-like");
  });

  it("defaults an unlisted, description-less fresh token to meme at low confidence", () => {
    const c = classifyToken(dossier({ cg: null }));
    expect(c.kind).toBe("meme");
    expect(c.confidence).toBe("low");
  });

  it("returns unknown when listed with a blurb that matches nothing", () => {
    const c = classifyToken(dossier({ cg: cg({ description: "An experiment." }) }));
    expect(c.kind).toBe("unknown");
  });
});
