import { expect, it } from "vitest";
import { buildHolderIntelligence, type HolderIntelligence } from "./holderIntelligence";
import { compareHolderObservations } from "./holderChanges";
const addr = (n: number) => `0x${n.toString(16).padStart(40,"0")}`;
const snapshot = (day: number) => buildHolderIntelligence({ chain: "base", tokenAddress: addr(900), capturedAt: `2026-09-${day}T00:00:00Z`, source: "fixture", ranked: true, rows: Array.from({ length: 25 }, (_, i) => ({ address: addr(i+100), percent: 1 })) });
const match = { registryId: "example", name: "Historical example", role: "observed", label: "fixture", evidence: "fixture evidence", lastSeen: "2026-09-20", intent: "unknown", attribution: "curated-record" as const };
it("identifies changed shares for the same wallet, not inferred trades", () => {
  const before = snapshot(20), after = snapshot(21); after.rows[0].percent = 4;
  expect(compareHolderObservations(before, after)).toEqual([{kind:"share-change", address:addr(100), before:1, after:4, registryNames:[]}]);
});
it("reports newly observed indexed wallets without claiming a new purchase", () => {
  const before = snapshot(20), after = snapshot(21); after.rows[24] = { ...after.rows[24], address:addr(800), matches:[match] };
  expect(compareHolderObservations(before, after)[0]?.kind).toBe("newly-observed-indexed-wallet");
  expect(compareHolderObservations(before, after)[0]?.before).toBeNull();
});
it("does not call a registry update a holder movement", () => {
  const before = snapshot(20), after = snapshot(21); after.registryVersion = "new"; after.rows[24] = { ...after.rows[24], address:addr(800), matches:[match] };
  expect(compareHolderObservations(before, after)).toEqual([]);
});
it("suppresses comparisons across partial samples, providers, tokens or reversed time", () => {
  const before = snapshot(20), after = snapshot(21); after.rows[0].percent = 4;
  for (const override of [{ status:"partial" }, { source:"other" }, { tokenAddress:addr(901) }, { capturedAt:before.capturedAt }, { supplyCoveredPct:null }]) {
    expect(compareHolderObservations(before, { ...after, ...override } as HolderIntelligence)).toEqual([]);
  }
});
it("does not interpret exchange custody changes as one investor's accumulation", () => {
  const before = snapshot(20), after = snapshot(21); after.rows[0].percent = 4; after.rows[0].role = "exchange";
  expect(compareHolderObservations(before, after)).toEqual([]);
});
it("rejects malformed historical payloads and duplicate wallets", () => {
  const before = snapshot(20), after = snapshot(21);
  expect(compareHolderObservations(before, { ...after, rows:undefined } as unknown as HolderIntelligence)).toEqual([]);
  after.rows[1] = after.rows[0]; expect(compareHolderObservations(before, after)).toEqual([]);
});
it("does not trust a forged completeness label over impossible supply totals", () => {
  const before = snapshot(20), after = snapshot(21);
  after.rows.forEach(row => { row.percent = 10; });
  expect(compareHolderObservations(before, after)).toEqual([]);
});
