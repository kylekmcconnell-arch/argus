import { describe, expect, it } from "vitest";
import { describeWalletClusterTrace } from "./walletClusterTruth";

const complete = {
  sampled: 10,
  fullyTraced: 10,
  historyTruncated: 0,
  deadlineSkipped: 0,
  providerFailed: 0,
};

describe("wallet-link trace publication", () => {
  it("never turns an empty bounded trace into independent ownership", () => {
    const result = describeWalletClusterTrace({
      clusters: [],
      coverage: complete,
      directLinkLabel: "a direct SOL transfer",
    });

    expect(result.outcome).toBe("no_links_observed");
    expect(result.note).toContain("not proof");
    expect(result.note).not.toMatch(/independently funded|no hidden common ownership|no common control/i);
  });

  it("publishes missing wallet reads as insufficient coverage", () => {
    const result = describeWalletClusterTrace({
      clusters: [],
      coverage: {
        sampled: 10,
        fullyTraced: 6,
        historyTruncated: 2,
        deadlineSkipped: 1,
        providerFailed: 1,
      },
      directLinkLabel: "a direct token or native-currency transfer",
    });

    expect(result.outcome).toBe("insufficient_coverage");
    expect(result.note).toContain("6 of 10");
    expect(result.note).toContain("cannot be published as independent ownership");
  });

  it("describes an empty eligible sample without claiming a measurement", () => {
    const result = describeWalletClusterTrace({
      clusters: [],
      coverage: { ...complete, sampled: 0, fullyTraced: 0 },
      directLinkLabel: "a direct transfer",
    });

    expect(result.outcome).toBe("insufficient_coverage");
    expect(result.note).toContain("0 eligible holder wallets were available");
    expect(result.note).toContain("not measured");
  });

  it("reports a positive link without converting it into common identity", () => {
    const result = describeWalletClusterTrace({
      clusters: [{
        size: 3,
        combinedPct: 22.4,
        sharedFunders: ["0x1234567890abcdef"],
        includesCreator: true,
      }],
      coverage: complete,
      directLinkLabel: "a direct transfer",
    });

    expect(result.outcome).toBe("links_observed");
    expect(result.note).toContain("shared seed funder");
    expect(result.note).toContain("not that one person owns or controls every wallet");
    expect(result.note).not.toMatch(/one hand|one operator/i);
  });
});
