// Backtest the shipping grades against what the token did next.
//
//   GITHUB_TOKEN=... npx tsx scripts/backtest-shipping.ts [subjects.json] [--horizon 90] [--json]
//
// For each subject the read is taken AS OF `asOf` (commits, releases and star
// history are cut at that date; yearly statistics, peers, npm and identities
// are skipped because they cannot be dated), graded with the same pure
// function the report uses, and paired with the token's forward return over
// the horizon from GeckoTerminal daily candles. The output is the grade
// distribution against forward returns, so the labels can be reweighted
// before anyone trades on them. A subject without price coverage for both
// dates is reported as unpriced, never dropped silently.
//
// The subjects file is a JSON array of
//   { "label": "HEY", "target": "hey-research-lab", "kind": "org" | "repo", "chain": "robinhood",
//     "address": "0x...", "asOf": "2026-09-15", "note": "optional" }
// The default file is eval/shipping-backtest.json.
import { readFileSync } from "node:fs";
import { assessShipping, type ShippingAssessment } from "../src/threat/shipping";
import { collectShipping } from "../src/threat/shippingCollect";
import { fetchOhlcv } from "../src/lib/priceHistory";

interface Subject { label: string; target: string; kind: "org" | "repo"; chain: string; address: string; asOf: string; note?: string }
interface Row {
  label: string;
  target: string;
  asOf: string;
  grade: ShippingAssessment["grade"];
  cadence: string;
  commits: number;
  humans: number;
  authorship: string;
  origin: string;
  stars: string;
  priceAtAsOf?: number;
  priceAtHorizon?: number;
  forwardReturnPct?: number;
  priced: boolean;
  note?: string;
  error?: string;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "eval/shipping-backtest.json";
const horizonFlag = args.indexOf("--horizon");
const horizon = horizonFlag >= 0 ? Number(args[horizonFlag + 1]) || 90 : 90;
const asJson = args.includes("--json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One daily series per subject; GeckoTerminal rate-limits bursts, so a null read is retried once after a pause. */
async function dailySeries(address: string, chain: string): Promise<{ ts: number; close: number }[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const w = await fetchOhlcv(address, chain, undefined, "day").catch(() => null);
    if (w?.candles.length) return w.candles;
    await sleep(2500);
  }
  return null;
}

function priceOn(candles: { ts: number; close: number }[] | null, at: number): number | undefined {
  if (!candles) return undefined;
  const ms = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);
  // The nearest candle on or before the date, within three days.
  const candidates = candles.filter((c) => ms(c.ts) <= at && at - ms(c.ts) <= 3 * 864e5);
  return candidates.length ? candidates[candidates.length - 1].close : undefined;
}

async function main() {
  const key = process.env.GITHUB_TOKEN;
  if (!key) { console.error("GITHUB_TOKEN is required (a classic token with public_repo read is enough)."); process.exit(2); }
  const subjects = JSON.parse(readFileSync(file, "utf8")) as Subject[];
  const rows: Row[] = [];
  for (const s of subjects) {
    const asOf = new Date(`${s.asOf}T23:59:59Z`);
    const usage = { calls: 0, succeeded: 0 };
    try {
      const input = await collectShipping({ target: s.target, kind: s.kind, key, usage, now: asOf, pointInTime: true });
      const a = assessShipping(input);
      const candles = await dailySeries(s.address, s.chain);
      const p0 = priceOn(candles, asOf.getTime());
      const p1 = priceOn(candles, asOf.getTime() + horizon * 864e5);
      await sleep(1200); // stay under GeckoTerminal's free-tier rate limit
      const priced = p0 != null && p1 != null && p0 > 0;
      rows.push({
        label: s.label, target: s.target, asOf: s.asOf,
        grade: a.grade, cadence: a.cadence.status, commits: a.cadence.totalCommits, humans: a.committers.distinctHuman,
        authorship: a.authorship.verdict, origin: a.origin.verdict, stars: a.stars.verdict,
        priceAtAsOf: p0, priceAtHorizon: p1,
        forwardReturnPct: priced ? Math.round(((p1! - p0!) / p0!) * 1000) / 10 : undefined,
        priced, note: s.note,
      });
    } catch (e) {
      rows.push({ label: s.label, target: s.target, asOf: s.asOf, grade: "unknown", cadence: "unknown", commits: 0, humans: 0, authorship: "unknown", origin: "unknown", stars: "none", priced: false, note: s.note, error: String(e) });
    }
  }

  const byGrade = new Map<string, number[]>();
  for (const r of rows) if (r.priced && r.forwardReturnPct != null) byGrade.set(r.grade, [...(byGrade.get(r.grade) ?? []), r.forwardReturnPct]);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const summary = [...byGrade.entries()].map(([grade, rets]) => ({ grade, n: rets.length, medianForwardReturnPct: Math.round(median(rets) * 10) / 10, positiveSharePct: Math.round((rets.filter((x) => x > 0).length / rets.length) * 100) }));

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), horizonDays: horizon, rows, summary }, null, 2));
    return;
  }
  console.log(`Shipping backtest · ${rows.length} subjects · ${horizon}-day horizon`);
  console.log("");
  for (const r of rows) {
    const ret = r.priced ? `${r.forwardReturnPct! >= 0 ? "+" : ""}${r.forwardReturnPct}%` : "unpriced";
    console.log(`${r.label.padEnd(12)} ${r.asOf}  ${r.grade.padEnd(14)} ${r.cadence.padEnd(9)} ${String(r.commits).padStart(4)}c ${String(r.humans).padStart(2)}h  ${r.authorship.padEnd(13)} ${r.origin.padEnd(17)} stars:${r.stars.padEnd(12)} ${ret}${r.error ? `  ERROR ${r.error}` : ""}`);
  }
  console.log("");
  if (!summary.length) { console.log("No priced subjects: add tokens whose GeckoTerminal daily candles cover both dates."); return; }
  console.log("grade            n   median fwd return   share positive");
  for (const s of summary) console.log(`${s.grade.padEnd(16)} ${String(s.n).padStart(2)}   ${(s.medianForwardReturnPct >= 0 ? "+" : "") + s.medianForwardReturnPct + "%"}`.padEnd(40) + `${s.positiveSharePct}%`);
  console.log("");
  console.log("Read this as a sanity check, not a strategy: a grade that does not separate outcomes should lose weight in the engine.");
}

main().catch((e) => { console.error(e); process.exit(1); });
