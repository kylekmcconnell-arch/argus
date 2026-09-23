import { describe, expect, it } from "vitest";
import { appendStudyPage, readStudyLedger, studyCoverage, type StudyPage, type StudyLedger } from "./study";
const empty: StudyLedger = { version: 1, receipts: [] };
const address = (n: number) => `0x${n.toString(16).padStart(40, "a")}`;
function page(overrides: Partial<StudyPage> = {}): StudyPage {
  return { platform: "bankr", chain: "base", asOf: "2026-09-23T12:00:00Z", collectedAt: "2026-09-23T12:01:00Z",
    sourceUrl: "https://example.com/launches", cursor: null, nextCursor: null, scope: "provider-sample",
    rows: [{ address: address(1), attribution: { status: "confirmed", method: "factory-event", evidenceUrl: "https://example.com/tx/1" },
      metrics: { marketCapUsd: 10, liquidityUsd: 5, volume24hUsd: 20 }, marketCapBasis: "circulating-supply", liquidityBasis: "identified-pools", volumeQuality: "corroborated", listings: [] }], ...overrides };
}
describe("resumable launchpad study receipts", () => {
  it("replays a receipt idempotently and resumes only the exact next page", () => {
    const first = page({ nextCursor: "page-2" });
    const ledger = appendStudyPage(empty, first);
    expect(appendStudyPage(ledger, first)).toBe(ledger);
    const next = page({ cursor: "page-2", rows: [{ ...first.rows[0], address: address(2) }] });
    const resumed = readStudyLedger(JSON.parse(JSON.stringify(appendStudyPage(ledger, next))));
    expect(studyCoverage(resumed)[0]).toMatchObject({ terminal: true, observed: 2, populationReportedComplete: false });
    expect(() => appendStudyPage(ledger, { ...next, cursor: "page-3" })).toThrow("sequence");
    expect(() => appendStudyPage(ledger, { ...next, rows: first.rows })).toThrow("Overlapping");
  });
  it("rejects tampered receipts and changes to the source mid-collection", () => {
    const ledger = appendStudyPage(empty, page({ nextCursor: "page-2" }));
    const changed = structuredClone(ledger); changed.receipts[0].page.rows[0].metrics.marketCapUsd = 900;
    expect(() => readStudyLedger(changed)).toThrow("hash mismatch");
    expect(() => appendStudyPage(ledger, page({ cursor: "page-2", sourceUrl: "https://example.net/other" }))).toThrow("source or scope");
  });
  it("does not publish FDV, unreviewed volume or unverifiable pooled liquidity as rankings", () => {
    const p = page({ scope: "full-launch-population" });
    Object.assign(p.rows[0], { marketCapBasis: "fdv", volumeQuality: "unreviewed", liquidityBasis: "unverified" });
    const [coverage] = studyCoverage(appendStudyPage(empty, p));
    expect(coverage.populationReportedComplete).toBe(true);
    expect(coverage.rankings.every(r => r.status === "partial" && r.top25.length === 0)).toBe(true);
  });
  it("does not let 25 usable sample rows claim a complete population", () => {
    const p = page(); p.rows = Array.from({ length: 30 }, (_, i) => ({ ...p.rows[0], address: address(i + 1), metrics: { marketCapUsd: i } }));
    const rank = studyCoverage(appendStudyPage(empty, p))[0].rankings[0];
    expect(rank).toMatchObject({ status: "partial", measured: 30 });
    expect(rank.top25).toHaveLength(25); expect(rank.top25[0].value).toBe(29);
  });
  it("excludes candidate launches and rejects research leads labelled confirmed", () => {
    const p = page(); p.rows[0].attribution = { ...p.rows[0].attribution, method: "research-lead", status: "candidate" };
    expect(studyCoverage(appendStudyPage(empty, p))[0].confirmed).toBe(0);
    p.rows[0].attribution.status = "confirmed";
    expect(() => appendStudyPage(empty, p)).toThrow("Unproven");
  });
  it("keeps different snapshot dates separate and rejects invalid metric values", () => {
    const ledger = appendStudyPage(empty, page());
    expect(studyCoverage(appendStudyPage(ledger, page({ asOf: "2026-09-23T11:00:00Z" })))).toHaveLength(2);
    const p = page(); p.rows[0].metrics.marketCapUsd = -1;
    expect(() => appendStudyPage(empty, p)).toThrow("Invalid metric");
  });
});
