import { describe, expect, it } from "vitest";

import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import { launchedProductTokenBindPending } from "./orchestrate";

// The first token pass runs before intake; orientation (the only producer of
// launchedProducts) runs inside intake. Without a second pass, a company whose
// token is not named after the company (CLUTCH -> $STONKBROKER) records an
// assessed "no token under a matching name" and the report normalizes token
// conduct away as if the project were tokenless.
describe("launched-product token bind re-run trigger", () => {
  const orientation = (launchedProducts?: Array<{ name?: string; tokenTicker?: string }>) => ({
    kind: "PROJECT" as const,
    what: "Clutch Markets launched StonkBrokers",
    audience: "",
    boundHandle: "clutchmarkets",
    boundDomain: "clutch.markets",
    sourceUrls: ["https://clutch.markets/"],
    ...(launchedProducts ? { launchedProducts } : {}),
  });

  it("re-runs for an unbound PROJECT once orientation names a launched product ticker", () => {
    const evidence = emptyEvidence("@clutchmarkets");
    evidence.subjectOrientation = orientation([{ name: "StonkBrokers", tokenTicker: "STONKBROKER" }]);
    expect(launchedProductTokenBindPending(evidence, [SubjectClass.PROJECT])).toBe(true);
  });

  it("does not re-run when the first pass already bound a token", () => {
    const evidence = emptyEvidence("@clutchmarkets");
    evidence.subjectOrientation = orientation([{ name: "StonkBrokers", tokenTicker: "STONKBROKER" }]);
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "StonkBroker",
      symbol: "STONKBROKER",
      rank: null,
      address: "0xe934f5c7f0b9cd6b6e1d3c3c1a8e0c1f4d3b2a10",
      chain: "robinhood",
      sourceUrl: "https://www.coingecko.com/en/coins/stonkbroker",
      capturedAt: "2026-09-02T00:00:00.000Z",
      producerSources: { identity: { provider: "coingecko", sourceUrl: "https://www.coingecko.com/en/coins/stonkbroker", capturedAt: "2026-09-02T00:00:00.000Z" } },
      providers: ["coingecko"],
    };
    expect(launchedProductTokenBindPending(evidence, [SubjectClass.PROJECT])).toBe(false);
  });

  it("does not re-run without a PROJECT role or without a searchable launched product", () => {
    const evidence = emptyEvidence("@clutchmarkets");
    evidence.subjectOrientation = orientation([{ name: "StonkBrokers", tokenTicker: "STONKBROKER" }]);
    expect(launchedProductTokenBindPending(evidence, [SubjectClass.INVESTOR])).toBe(false);

    const bare = emptyEvidence("@clutchmarkets");
    bare.subjectOrientation = orientation();
    expect(launchedProductTokenBindPending(bare, [SubjectClass.PROJECT])).toBe(false);

    const unnamed = emptyEvidence("@clutchmarkets");
    unnamed.subjectOrientation = orientation([{ name: "ab" }]);
    expect(launchedProductTokenBindPending(unnamed, [SubjectClass.PROJECT])).toBe(false);
  });
});
