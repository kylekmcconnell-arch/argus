import { describe, expect, it } from "vitest";
import { personDimensionChapters, tokenDimensionChapters } from "./dimensionChapters";
import type { TokenDossier } from "../token/audit";

const dossier = (): TokenDossier => ({
  chain: "ethereum",
  liquidityUsd: 114_100,
  mcap: 2_000_000,
  ageDays: 12,
  insiderPct: 0,
  bundleCount: 0,
  bundleRisk: "low",
  safety: {
    available: true,
    simChecked: true,
    honeypot: false,
    cannotSellAll: false,
    mintable: false,
    freezable: false,
    ownerRenounced: true,
    openSource: true,
    buyTax: 0,
    sellTax: 0,
    holderCount: 4872,
    topHolderPct: 8,
    lpLocked: true,
    lpBurnedPct: 100,
    lpLockedPct: 100,
    lpTopUnlockedEoaPct: 0,
  },
  cg: { cexCount: 0, rank: 2103 },
  axes: [
    { key: "T1", label: "Liquidity & lock", score: 22, weight: 24, rationale: "LP burned in full at launch." },
    { key: "T2", label: "Contract safety", score: 24, weight: 26, rationale: "Simulated clean; no owner powers." },
    { key: "T4", label: "Holder distribution", score: 8, weight: 16, rationale: "Top wallet holds 31% of supply." },
    { key: "T5", label: "Trading authenticity", score: 3, weight: 12, rationale: "vol/liquidity 4.1x but price flat: wash-trade signature." },
  ],
} as unknown as TokenDossier);

describe("tokenDimensionChapters", () => {
  it("chooses the judgment headline from the recorded score band", () => {
    const chapters = tokenDimensionChapters(dossier());

    expect(chapters.find((c) => c.axis === "T1")).toMatchObject({
      tone: "pass",
      headline: "The liquidity is locked where it belongs.",
      eyebrow: "The liquidity · 24% of the score",
    });
    expect(chapters.find((c) => c.axis === "T4")).toMatchObject({
      tone: "caution",
      headline: "A few pockets hold more than is comfortable.",
    });
    expect(chapters.find((c) => c.axis === "T5")).toMatchObject({
      tone: "fail",
      headline: "The volume does not survive inspection.",
    });
  });

  it("leads with the engine's own rationale, never invented prose", () => {
    const chapters = tokenDimensionChapters(dossier());
    expect(chapters.find((c) => c.axis === "T5")?.lead).toContain("wash-trade signature");
  });

  it("builds the fact ledger from recorded dossier fields with honest tones", () => {
    const chapters = tokenDimensionChapters(dossier());

    const t1 = chapters.find((c) => c.axis === "T1")!;
    expect(t1.facts.map((f) => f.label)).toEqual(["Liquidity", "LP burned", "LP lock"]);
    expect(t1.facts[0].value).toBe("$114.1K");
    expect(t1.facts[1]).toMatchObject({ value: "100%", tone: "pass" });

    const t2 = chapters.find((c) => c.axis === "T2")!;
    expect(t2.facts.find((f) => f.label === "Sell simulation")).toMatchObject({ value: "clean", tone: "pass" });
    // Freeze authority is a Solana concept; an EVM chapter never shows it.
    expect(t2.facts.some((f) => f.label === "Freeze authority")).toBe(false);
  });

  it("omits facts whose fields were never recorded", () => {
    const bare = dossier();
    (bare as unknown as { liquidityUsd?: number }).liquidityUsd = undefined;
    const t1 = tokenDimensionChapters(bare).find((c) => c.axis === "T1")!;
    expect(t1.facts.some((f) => f.label === "Liquidity")).toBe(false);
  });
});

describe("personDimensionChapters", () => {
  it("chooses the headline from the recorded strength-band tier", () => {
    const chapters = personDimensionChapters({
      P1_team_and_identity: { tier: "solid", minScore: 10, maxScore: 16, reasons: ["Two first-party named operators."] },
      P5_traction_and_liveness: { tier: "weak", minScore: 2, maxScore: 6, reasons: ["Last post 40 days ago."] },
    });
    expect(chapters.find((c) => c.axis === "P1_team_and_identity")).toMatchObject({
      tone: "pass",
      headline: "The people behind this are on the record.",
      lead: "Two first-party named operators.",
    });
    expect(chapters.find((c) => c.axis === "P5_traction_and_liveness")).toMatchObject({
      tone: "fail",
      headline: "Signs of life remain unresolved.",
      lead: "Last post 40 days ago.",
    });
  });

  it("does not invent a fact the band never recorded", () => {
    const chapters = personDimensionChapters({
      P2_product_substance: { tier: "emerging" },
    });
    expect(chapters[0].facts.some((f) => f.label === "Recorded range")).toBe(false);
    expect(chapters[0].lead).toBe("");
  });

  it("translates internal null bands into public language", () => {
    const chapters = personDimensionChapters({
      P6_transparency_integrity: { tier: "assessed_null", minScore: 0, maxScore: 4 },
    });
    expect(chapters[0].facts).toContainEqual({
      label: "Evidence strength",
      value: "checked, but no reliable supporting evidence was confirmed",
      tone: "fail",
    });
    expect(JSON.stringify(chapters[0])).not.toContain("assessed_null");
  });
});
