import { describe, expect, it } from "vitest";
import { subjectsFromReports, type SavedReportRow } from "./backtestSubjects";

const NOW = Date.parse("2026-09-16T00:00:00Z");
const row = (over: Partial<SavedReportRow>): SavedReportRow => ({ ref: "0xa", kind: "token", symbol: "AAA", chain: "base", address: "0xAAA", shipping: { target: "acme", capturedAt: "2026-06-01T00:00:00Z", grade: "shipping-team" }, ...over });

describe("subjectsFromReports", () => {
  it("turns saved token and investigation reads into subjects, oldest capture first, one per target and address", () => {
    const rows: SavedReportRow[] = [
      row({}),
      row({ ref: "0xa-later", shipping: { target: "acme", capturedAt: "2026-08-01T00:00:00Z", grade: "thin" } }),
      { ref: "0xb", kind: "investigation", tsymbol: "bbb", tchain: "robinhood", taddress: "0xBBB", tshipping: { target: "beta-labs/core", capturedAt: "2026-07-10T00:00:00Z", grade: "stalled" } },
      row({ ref: "0xc", address: "0xCCC", shipping: { target: "gamma", capturedAt: "2026-09-10T00:00:00Z", grade: "shipping-solo" } }),
      row({ ref: "0xd", address: "0xDDD", shipping: { target: "delta", capturedAt: "2026-05-01T00:00:00Z", grade: "unknown" } }),
      row({ ref: "0xe", address: "0xEEE", shipping: null }),
    ];
    const { merged, added } = subjectsFromReports(rows, [{ label: "OLD", target: "acme", kind: "org", chain: "base", address: "0xaaa", asOf: "2026-04-01" }], { now: NOW, minAgeDays: 30 });
    expect(added.map((s) => [s.label, s.target, s.kind, s.chain, s.asOf])).toEqual([
      ["BBB", "beta-labs/core", "repo", "robinhood", "2026-07-10"],
    ]);
    expect(merged).toHaveLength(2);
    expect(added[0].note).toMatch(/from saved investigation report; graded stalled/);
  });

  it("keeps the earliest capture when the same subject was saved twice", () => {
    const rows = [
      row({ ref: "later", address: "0xF", shipping: { target: "zeta", capturedAt: "2026-07-01T00:00:00Z", grade: "thin" } }),
      row({ ref: "earlier", address: "0xF", shipping: { target: "zeta", capturedAt: "2026-05-01T00:00:00Z", grade: "shipping-team" } }),
    ];
    const { added } = subjectsFromReports(rows, [], { now: NOW });
    expect(added).toHaveLength(1);
    expect(added[0].asOf).toBe("2026-05-01");
  });
});
