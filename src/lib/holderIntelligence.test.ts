import { describe, expect, it } from "vitest";
import { CABALS } from "../data/cabals";
import { buildHolderIntelligence } from "./holderIntelligence";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const base = { chain: "robinhood", tokenAddress: addr(9999), capturedAt: "2026-09-23T20:00:00Z", source: "fixture", ranked: true };

describe("holder intelligence", () => {
  it("matches a registry wallet at rank 25 without treating its token as guilty", () => {
    const wallet = CABALS.flatMap(c => c.wallets).find(w => w.chain === "robinhood" && w.address.length === 42)!;
    const rows = Array.from({ length: 24 }, (_, i) => ({ address: addr(i + 100), percent: 1 }));
    const result = buildHolderIntelligence({ ...base, rows: [...rows, { address: wallet.address, percent: 0.1 }] });
    expect(result.status).toBe("complete");
    expect(result.rows[24]?.matches.length).toBeGreaterThan(0);
    expect(result.rows[24]?.matches[0]?.evidence).toBeTruthy();
    expect(result).not.toHaveProperty("verdict");
  });
  it("does not call a ten-address sample a complete top-25 investigation", () => {
    expect(buildHolderIntelligence({ ...base, rows: [{ address: addr(1), percent: 12 }] })).toMatchObject({ examined: 1, target: 25, status: "partial" });
  });
  it("retains a large smart-account holder and separately labels a proven pool", () => {
    const result = buildHolderIntelligence({ ...base, poolAddresses: [addr(2)], rows: [{ address: addr(1), percent: 20, isContract: true }, { address: addr(2), percent: 15, isContract: true }] });
    expect(result.rows.map(row => row.role)).toEqual(["unclassified-contract", "pool"]);
    expect(result.supplyCoveredPct).toBe(35);
  });
  it("preserves Solana case and aggregates unique token accounts by owner without claiming global ranks", () => {
    const a = "EkeSXXNqPc5bvxeLgPmAQoVjwTPUB4k8hzNHDmfQ4S9p";
    const b = "So11111111111111111111111111111111111111112";
    const result = buildHolderIntelligence({ ...base, chain: "solana", tokenAddress: b, aggregateOwners: true, rows: [{ address: a, owner: a, percent: 2 }, { address: b, owner: a, percent: 3 }, { address: b, owner: a, percent: 3 }] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ address: a, percent: 5 });
    expect(result.invalidRows).toBe(1);
    expect(result.status).toBe("partial");
  });
  it("rejects invalid shares and never presents an inconsistent supply total", () => {
    const result = buildHolderIntelligence({ ...base, rows: [{ address: addr(1), percent: 70 }, { address: addr(2), percent: 60 }, { address: addr(3), percent: NaN }] });
    expect(result.status).toBe("partial");
    expect(result.supplyCoveredPct).toBeNull();
    expect(result.invalidRows).toBe(1);
  });
});
