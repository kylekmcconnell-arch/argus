import { describe, expect, it } from "vitest";
import { buildCohort } from "./shipping-cohort";

const row = (ref: string, over: Record<string, unknown> = {}) => ({
  ref,
  chain: "robinhood",
  mcap: 500_000,
  ageDays: 40,
  shipping: { version: 1, grade: "thin", totalCommits: 6, distinctHuman: 1 },
  ...over,
});

describe("buildCohort", () => {
  const subject = { ref: "0xsubject", chain: "robinhood", mcap: 600_000, ageDays: 45, commits: 40, authors: 3 };

  it("positions the subject among comparable saved reports on the same chain", () => {
    const rows = [
      row("0xa", { shipping: { version: 1, grade: "shipping-solo", totalCommits: 30, distinctHuman: 1 } }),
      row("0xb", { shipping: { version: 1, grade: "thin", totalCommits: 4, distinctHuman: 1 } }),
      row("0xc", { shipping: { version: 1, grade: "stalled", totalCommits: 0, distinctHuman: 0 } }),
      row("0xd", { shipping: { version: 1, grade: "shipping-team", totalCommits: 60, distinctHuman: 4 } }),
      row("0xe", { shipping: { version: 1, grade: "thin", totalCommits: 8, distinctHuman: 2 } }),
      row("0xf", { chain: "base" }),
      row("0xg", { mcap: 50_000_000 }),
      row("0xh", { ageDays: 400 }),
      row("0xsubject"),
      row("0xi", { shipping: null }),
    ];
    const c = buildCohort(rows, subject)!;
    expect(c).not.toBeNull();
    expect(c.size).toBe(5);
    expect(c.medianCommits).toBe(8);
    expect(c.medianAuthors).toBe(1);
    expect(c.percentileCommits).toBe(80);
    expect(c.percentileAuthors).toBe(80);
    expect(c.shippingSharePct).toBe(40);
    expect(c.label).toMatch(/robinhood tokens this workspace has scanned between \$150k and \$2\.4M aged 15 to 90 days/);
  });

  it("refuses a cohort smaller than five", () => {
    expect(buildCohort([row("0xa"), row("0xb"), row("0xc"), row("0xd")], subject)).toBeNull();
  });

  it("ignores rows with no development read or a foreign summary version", () => {
    const rows = [row("0xa"), row("0xb"), row("0xc"), row("0xd"), row("0xe", { shipping: { version: 2, grade: "thin", totalCommits: 1, distinctHuman: 1 } })];
    expect(buildCohort(rows, subject)).toBeNull();
  });
});
