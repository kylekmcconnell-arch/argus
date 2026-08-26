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

    expect(summary).toContain("lets users earn real yield on tokenized stocks");
    expect(summary).not.toContain(contract);
  });

  it("never falls back to publishing the raw X bio", () => {
    const summary = reportOpeningNarrative({
      name: "EARN",
      handle: "@earnonhood",
      bio: `DeFi for RWAs ⚫ ${contract}`,
      website: "https://earnonhood.com",
      projectToken: token,
    });

    expect(summary).toContain("official product surface at earnonhood.com");
    expect(summary).not.toContain(contract);
    expect(summary).not.toContain("⚫");
  });
});
