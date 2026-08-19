import { describe, expect, it } from "vitest";
import { composeWhy, judgmentLine } from "./verdictNarrative";

const axes = [
  { key: "T1", label: "Liquidity & lock", score: 22, weight: 24, rationale: "LP burned in full at launch" },
  { key: "T4", label: "Holder distribution", score: 4, weight: 16, rationale: "Top wallet holds 41% of supply." },
  { key: "T6", label: "Maturity & presence", score: 6, weight: 10, rationale: "Listed for two years." },
];

describe("judgmentLine", () => {
  it("selects from the fixed table by recorded verdict, with a neutral default", () => {
    expect(judgmentLine("PASS")).toBe("The record holds up.");
    expect(judgmentLine("CAUTION")).toBe("Sound, with reservations.");
    expect(judgmentLine("AVOID")).toBe("A disqualifying record.");
    expect(judgmentLine("SOMETHING_NEW")).toBe("The state of the record.");
  });
});

describe("composeWhy", () => {
  it("leads with the strongest dimension and names the drag, in the engine's own words", () => {
    const segments = composeWhy({ score: 62, capApplied: null, axes } as never)!;
    const text = segments.map((segment) => segment.text).join("");

    expect(text.startsWith("Liquidity & lock carries the file at 22 of 24 points.")).toBe(true);
    // The rationale gets a terminal period added when the engine omitted one.
    expect(text).toContain("LP burned in full at launch.");
    expect(text).toContain("The drag is Holder distribution at 4 of 16.");
    expect(text).toContain("Top wallet holds 41% of supply.");
    // Score fractions are the dotted figures.
    expect(segments.filter((segment) => segment.figure).map((segment) => segment.text))
      .toEqual(["22 of 24 points", "4 of 16"]);
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
