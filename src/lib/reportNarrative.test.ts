import { describe, expect, it } from "vitest";
import type { BasicFact, ProjectTokenSnapshot, SubjectOrientation } from "../data/evidence";
import { reportOpeningNarrative } from "./reportNarrative";

const contract = "0xa3b6aee90017b72c0812dc1e013de70eb2917ba3";

const orientation = (what: string): SubjectOrientation => ({
  kind: "PROJECT",
  what,
  audience: "investors in tokenized assets",
  boundHandle: "@earnonhood",
  boundDomain: "earnonhood.com",
  sourceUrls: ["https://x.com/earnonhood", "https://earnonhood.com/"],
});

const productFact = (value: string): BasicFact => ({
  factId: "fact-product",
  subjectKey: "@earnonhood",
  predicate: "product",
  value,
  normalizedValue: value.toLowerCase(),
  status: "verified",
  critical: false,
  sources: [],
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
});

const token = {
  symbol: "EARN",
  chain: "Robinhood Chain",
  verified: true,
} as ProjectTokenSnapshot;

describe("reportOpeningNarrative", () => {
  it("uses Grok's bound product explanation and adds the linked token without exposing a contract", () => {
    const summary = reportOpeningNarrative({
      name: "EARN",
      handle: "@earnonhood",
      bio: `DeFi for RWAs ⚫ live on Robinhood ⚫ ${contract}`,
      website: "https://earnonhood.com",
      subjectOrientation: orientation("EARN turns tokenized stocks into onchain yield vaults for users seeking automated real-world-asset strategies."),
      projectToken: token,
    });

    expect(summary).toContain("turns tokenized stocks into onchain yield vaults");
    expect(summary).toContain("linked $EARN token is issued on Robinhood Chain");
    expect(summary).not.toContain(contract);
  });

  it("rejects a Grok sentence that merely repeats the X bio and uses fetched product copy", () => {
    const summary = reportOpeningNarrative({
      name: "EARN",
      handle: "@earnonhood",
      bio: `DeFi for RWAs live on Robinhood ${contract}`,
      subjectOrientation: orientation(`EARN is DeFi for RWAs live on Robinhood ${contract}`),
      basicFacts: [productFact("The product lets users earn real yield on tokenized stocks through agent-managed strategies")],
      projectToken: token,
    });

    expect(summary).toContain("lets users earn yield on tokenized stocks");
    expect(summary).not.toContain(contract);
  });

  it("rejects a generic project-identity sentence that does not explain a product function", () => {
    const summary = reportOpeningNarrative({
      name: "EARN",
      handle: "@earnonhood",
      bio: "DeFi for RWAs live on Robinhood",
      website: "https://earnonhood.com",
      subjectOrientation: orientation("EARN is the project behind the official product surface at earnonhood.com."),
      basicFacts: [productFact("EARN offers agent-managed liquidity vaults and stock-backed lending for tokenized-stock users")],
      projectToken: token,
    });

    expect(summary).toContain("offers agent-managed liquidity vaults and stock-backed lending");
    expect(summary).not.toContain("official product surface");
  });

  it("does not mistake the EARN ticker for the verb earn", () => {
    const summary = reportOpeningNarrative({
      name: "EARN",
      handle: "@earnonhood",
      bio: "DeFi for RWAs live on Robinhood",
      website: "https://earnonhood.com",
      subjectOrientation: orientation("EARN is a project on Robinhood Chain for tokenized assets."),
      projectToken: token,
    });

    expect(summary).toContain("did not establish a source-backed explanation");
    expect(summary).not.toContain("EARN is a project on Robinhood Chain");
  });

  it("never falls back to publishing the raw X bio", () => {
    const summary = reportOpeningNarrative({
      name: "EARN",
      handle: "@earnonhood",
      bio: `DeFi for RWAs ⚫ ${contract}`,
      website: "https://earnonhood.com",
      projectToken: token,
    });

    expect(summary).toContain("linked to earnonhood.com");
    expect(summary).toContain("did not establish a source-backed explanation of what the product does");
    expect(summary).not.toContain("official product surface");
    expect(summary).not.toContain(contract);
    expect(summary).not.toContain("⚫");
  });

  it("removes calls to action and pitch adjectives from the opening product explanation", () => {
    const summary = reportOpeningNarrative({
      name: "Relay",
      handle: "@relay",
      bio: "Privacy infrastructure",
      subjectOrientation: orientation("Relay is a revolutionary privacy-first application powered by a decentralized relay network. Join the revolution."),
    });

    expect(summary).toContain("privacy-focused application uses a decentralized relay network");
    expect(summary).not.toMatch(/revolutionary|powered by|join the revolution/i);
  });
});
