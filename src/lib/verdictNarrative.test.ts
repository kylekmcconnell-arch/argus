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
      .toBe("The selected pool holds $3,071,603, but most liquidity-provider tokens are held in one wallet. That is this pool only, not all of the token's liquidity.");
    expect(plainScoreRationale("$14,384,482 pooled, LP not locked."))
      .toBe("The selected pool holds $14,384,482, but liquidity-provider tokens are not confirmed locked. That is this pool only, not all of the token's liquidity.");
    expect(plainScoreRationale("verified source, owner active."))
      .toBe("The source code is verified, and the owner still has control.");
    expect(plainScoreRationale("149175 holders, top holder 2%."))
      .toBe("About 149,175 addresses hold this token, and the largest holds about 2% of supply.");
    expect(plainScoreRationale("590,215 holders, top holder 9%, ~30% across 8 non-market wallets holding at least 1% each."))
      .toBe("About 590,215 addresses hold this token, and the largest holds about 9% of supply. About 30% of supply sits in 8 addresses that are not known market venues, each holding at least 1%.");
    expect(plainScoreRationale("24h vol/liquidity 0.95x, 10566 buys / 6091 sells."))
      .toBe("In the last day, this selected pool traded about 0.95 times its own size, with 10,566 buys and 6,091 sells. That is this pool only, not global volume.");
    expect(plainScoreRationale("24h vol/liquidity 0.17x, 1 buys / 2 sells."))
      .toBe("In the last day, this selected pool traded about 0.17 times its own size, with 1 buy and 2 sells. That is this pool only, not global volume.");
    expect(plainScoreRationale("24h vol/liquidity 0.17x. Swap counts from this pool were incomplete."))
      .toBe("In the last day, this selected pool traded about 0.17 times its own size. Swap counts from this feed were incomplete, so they are not part of the score. That is this pool only, not global volume.");
    expect(plainScoreRationale("$162,220,055 pooled (UNI/USDC on Uniswap), liquidity protection unverified."))
      .toBe("The selected pool holds $162,220,055 (UNI/USDC on Uniswap), but liquidity protection is unverified. That is this pool only, not all of the token's liquidity.");
    expect(plainScoreRationale("2175 days old, 2 socials, 71 CEX listings."))
      .toBe("This pool has been trading for 2,175 days. 2 public links were on the market record. It is listed on 71 centralized exchanges.");
    expect(plainScoreRationale("token tax buy 0% / sell 0% (simulated)."))
      .toBe("The token currently adds about 0% tax on buys and 0% on sells. A simulated buy and sell produced these rates. This is not total trading cost: gas, pool fees, and price impact are separate.");
    expect(plainScoreRationale("vol/liquidity 4.1x but price flat (0.2%): wash-trade signature."))
      .toBe("This selected pool traded 4.1 times its own size while the price barely moved (0.2%). That pattern is a wash-trade signature, not proof of genuine demand.");
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
