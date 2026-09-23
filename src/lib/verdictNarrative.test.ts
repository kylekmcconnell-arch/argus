import { describe, expect, it } from "vitest";
import { composeWhy, explainCompositionScore, judgmentLine, plainScoreRationale } from "./verdictNarrative";

const axes = [
  { key: "T1", label: "Liquidity & lock", score: 22, weight: 24, rationale: "LP burned in full at launch" },
  { key: "T4", label: "Holder distribution", score: 4, weight: 16, rationale: "Top wallet holds 41% of supply." },
  { key: "T6", label: "Maturity & presence", score: 6, weight: 10, rationale: "Listed for two years." },
];

describe("judgmentLine", () => {
  it("selects from the fixed table by recorded verdict, with a neutral default", () => {
    expect(judgmentLine("PASS")).toBe("Most checks passed. Review the remaining risks.");
    expect(judgmentLine("CAUTION")).toBe("Important risks remain despite some positive checks.");
    expect(judgmentLine("AVOID")).toBe("A critical issue makes this too risky.");
    expect(judgmentLine("INCOMPLETE")).toBe("Too many checks are missing for a reliable verdict.");
    expect(judgmentLine("UNVERIFIABLE_IDENTITY")).toBe("ARGUS could not verify who or what this report is about.");
    expect(judgmentLine("SOMETHING_NEW")).toBe("This result needs review.");
  });
});

describe("plainScoreRationale", () => {
  it("explains contract and liquidity shorthand in reader language", () => {
    expect(plainScoreRationale("verified source, ownership renounced."))
      .toBe("The source code is verified, and ownership has been renounced.");
    expect(plainScoreRationale("$3,071,603 pooled, LP mostly in one wallet."))
      .toBe("The liquidity pool holds $3,071,603, but most liquidity-provider tokens are held in one wallet.");
    expect(plainScoreRationale("$14,384,482 pooled, LP not locked."))
      .toBe("The liquidity pool holds $14,384,482, but liquidity-provider tokens are not confirmed locked.");
    expect(plainScoreRationale("verified source, owner active."))
      .toBe("The source code is verified, and the owner still has control.");
    expect(plainScoreRationale("149175 holders, top holder 2%."))
      .toBe("About 149,175 wallets hold this token, and the largest holds about 2% of supply.");
    expect(plainScoreRationale("24h vol/liquidity 0.95x, 10566 buys / 6091 sells."))
      .toBe("In the last day, trading volume was about 0.95 times the pool size, with 10,566 buys and 6,091 sells.");
    expect(plainScoreRationale("vol/liquidity 4.1x but price flat (0.2%): wash-trade signature."))
      .toBe("Trading volume was 4.1 times the pool size while the price barely moved (0.2%). That pattern is a wash-trade signature, not proof of genuine demand.");
    expect(explainCompositionScore("verified source, owner active.", 22, 26))
      .toBe("The source code is verified, and the owner still has control. That is why it scored 22 of 26 points (4 points not earned).");
  });

  it("keeps an unfamiliar recorded rationale intact and makes it a sentence", () => {
    expect(plainScoreRationale("Listed for two years"))
      .toBe("Listed for two years.");
  });
});

describe("composeWhy", () => {
  it("leads with the strongest dimension and names the main concern in plain language", () => {
    const segments = composeWhy({ score: 62, capApplied: null, axes } as never)!;
    const text = segments.map((segment) => segment.text).join("");

    expect(text.startsWith("Liquidity setup scored 22 of 24 points.")).toBe(true);
    // The rationale gets a terminal period added when the engine omitted one.
    expect(text).toContain("LP burned in full at launch.");
    expect(text).toContain("The main concern is holder concentration, which scored 4 of 16 points.");
    expect(text).toContain("Top wallet holds 41% of supply.");
    // Score fractions are the dotted figures.
    expect(segments.filter((segment) => segment.figure).map((segment) => segment.text))
      .toEqual(["22 of 24 points", "4 of 16 points"]);
  });

  it("appends the cap sentence only when a cap was recorded", () => {
    const capped = composeWhy({ score: 40, capApplied: "HONEYPOT", axes } as never)!;
    expect(capped[capped.length - 1].text).toBe(" A safety cap limits the total to 40.");
    const uncapped = composeWhy({ score: 62, capApplied: null, axes } as never)!;
    expect(uncapped[uncapped.length - 1].text).not.toContain("safety cap");
  });

  it("declines to write when there is no score or not enough scored axes", () => {
    expect(composeWhy({ score: null, capApplied: null, axes } as never)).toBeNull();
    expect(composeWhy({ score: 62, capApplied: null, axes: [axes[0]] } as never)).toBeNull();
  });
});
