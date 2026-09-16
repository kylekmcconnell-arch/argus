// Grow the shipping backtest set from the reports the workspace has saved.
//
//   npx tsx scripts/backtest-from-reports.ts [--out eval/shipping-backtest.json] [--min-age-days 30]
//
// Every saved token or investigation report that carries a frozen development
// read (`shipping` on the token dossier) names a GitHub target, a chain, an
// address and the date the read was taken. That is exactly a backtest subject
// with `asOf` = the capture date, and the horizon runs from there. The script
// reads them with the service credentials, keeps one row per target+address
// (the earliest capture, so the horizon is longest), skips rows younger than
// the minimum age (nothing to measure yet), merges them into the existing set
// and writes it back. Run it monthly; the set fills itself as scans are saved.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

import { subjectsFromReports, type BacktestSubject as Subject, type SavedReportRow as Row } from "../src/threat/backtestSubjects";

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? fallback : fallback; };
const outFile = flag("--out", "eval/shipping-backtest.json");
const minAgeDays = Number(flag("--min-age-days", "30")) || 30;

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" };

  const select = "ref,kind,symbol:payload->>symbol,chain:payload->>chain,address:payload->>address,shipping:payload->shipping,tsymbol:payload->token->>symbol,tchain:payload->token->>chain,taddress:payload->token->>address,tshipping:payload->token->shipping";
  const rows: Row[] = [];
  for (const kind of ["token", "investigation"]) {
    const filter = kind === "token" ? "payload->shipping=not.is.null" : "payload->token->shipping=not.is.null";
    const r = await fetch(`${url}/rest/v1/reports?select=${select}&kind=eq.${kind}&${filter}&order=ts.asc&limit=1000`, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.error(`reports ${kind}: ${r.status} ${await r.text()}`); process.exit(1); }
    rows.push(...((await r.json()) as Row[]));
  }

  const existing: Subject[] = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : [];
  const { merged, added } = subjectsFromReports(rows, existing, { minAgeDays });
  writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n");
  console.log(`${rows.length} saved reports carry a development read; ${added.length} new subject${added.length === 1 ? "" : "s"} added (older than ${minAgeDays} days); ${merged.length} in ${outFile}.`);
  for (const s of added) console.log(`  + ${s.label.padEnd(12)} ${s.target.padEnd(28)} ${s.chain.padEnd(10)} asOf ${s.asOf}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
