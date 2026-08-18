import { describe, expect, it } from "vitest";
import { threatCompositionRows } from "./ThreatScanPage";
import type { ThreatCheck } from "../threat/types";

const check = (category: ThreatCheck["category"], status: ThreatCheck["status"], detail = ""): ThreatCheck => ({
  key: `${category}-${status}-${detail.length}`,
  category,
  label: `${category} check`,
  status,
  detail,
});

describe("threatCompositionRows", () => {
  it("groups recorded outcomes into honest clean-vs-applicable rows", () => {
    const rows = threatCompositionRows([
      check("authority", "pass"),
      check("authority", "pass"),
      check("holders", "pass"),
      check("holders", "warn", "top holder concentration is elevated"),
      check("code", "fail", "hidden mint capability"),
      check("code", "pass"),
    ]);

    const authority = rows.find((row) => row.axis === "authority")!;
    expect(authority).toMatchObject({ score: 2, weight: 2, tone: "pass" });
    expect(authority.rationale).toContain("came back clean");

    const holders = rows.find((row) => row.axis === "holders")!;
    expect(holders).toMatchObject({ score: 1, weight: 2, tone: "caution" });
    expect(holders.rationale).toContain("top holder concentration");
    expect(holders.countsLine).toBe("1 clean · 1 warning");

    const code = rows.find((row) => row.axis === "code")!;
    expect(code.tone).toBe("fail");
    expect(code.rationale).toContain("hidden mint");
  });

  it("drops groups with no applicable checks instead of rendering empty rows", () => {
    const rows = threatCompositionRows([
      check("deployer", "na"),
      check("market", "pass"),
    ]);

    expect(rows.map((row) => row.axis)).toEqual(["market"]);
  });

  it("flags outrank warnings when both exist in one group", () => {
    const rows = threatCompositionRows([
      check("liquidity", "warn", "lock not confirmed"),
      check("liquidity", "fail", "LP pullable by one wallet"),
    ]);

    expect(rows[0].tone).toBe("fail");
    // The flag's detail leads the rationale.
    expect(rows[0].rationale.startsWith("LP pullable")).toBe(true);
  });
});
