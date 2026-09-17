// Cross-compare everything ARGUS has attributed against FomoScan's trader
// identity index: which of our wallets belong to a FOMO account, which of our
// handles have a verified wallet, and what FOMO traders posted about our
// launches. This is the "who's who in the zoo" pass for the index.
//
//   FOMOSCAN_API_KEY=... npx tsx scripts/fomoscan-sweep.ts handles [--notable] [--handles-file f.txt] [--out dir]
//   FOMOSCAN_API_KEY=... npx tsx scripts/fomoscan-sweep.ts wallets --budget-cu 200000 [--wallets-file f.txt] [--out dir]
//   FOMOSCAN_API_KEY=... npx tsx scripts/fomoscan-sweep.ts theses [--out dir]
//   npx tsx scripts/fomoscan-sweep.ts <mode> --dry-run          (cost estimate only, no key needed)
//
// Every mode calls GET /v2/me first (0 CU) and refuses to start when the key is
// missing, rejected, or has no plan, and it stops before any call that would
// take the plan under the budget floor. Prices are FomoScan's documented
// compute units: a handle lookup is 2,500 CU on a hit and 250 on a miss; a
// wallet resolution is 50,000 CU on a hit and 250 on a miss; a thesis page is
// 250 CU. The wallet mode is therefore the expensive one and is gated behind an
// explicit --budget-cu; the sweep assumes a miss for the running estimate and
// re-checks the remaining units after every hit.
//
// Inputs are the cabal registry (src/data/cabals.ts wallets, accounts and
// launches), optionally the notable-account directory (--notable), and any
// extra newline-separated address or handle files (traced wallets that never
// made it into the registry are curated in eval/fomoscan/traced-wallets.txt).
// Output: <out>/fomoscan-<mode>-<date>.json with every answer, and the same as
// a markdown table on stdout. Nothing FomoScan says is written back into the
// registry by this script; an analyst reads the table and decides.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CABALS } from "../src/data/cabals";
import { NOTABLE_ACCOUNTS } from "../server/adapters/notableAccounts";
import {
  FOMOSCAN_CU,
  fetchFomoMe,
  fetchFomoPnlBatch,
  fetchFomoTokenTheses,
  fetchFomoUserByHandle,
  fetchFomoUserByWallet,
  type FomoPnl,
  type FomoResult,
  type FomoThesis,
  type FomoUser,
} from "../server/adapters/fomoscan";

type Mode = "handles" | "wallets" | "theses";

interface Args {
  mode: Mode;
  dryRun: boolean;
  notable: boolean;
  budgetCu: number;
  walletsFile?: string;
  handlesFile?: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const mode = argv[0] as Mode;
  if (!["handles", "wallets", "theses"].includes(mode)) {
    console.error("usage: fomoscan-sweep.ts handles|wallets|theses [--dry-run] [--notable] [--budget-cu N] [--wallets-file f] [--handles-file f] [--out dir]");
    process.exit(2);
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    mode,
    dryRun: argv.includes("--dry-run"),
    notable: argv.includes("--notable"),
    budgetCu: Number(flag("--budget-cu") ?? 0),
    walletsFile: flag("--wallets-file"),
    handlesFile: flag("--handles-file"),
    out: flag("--out") ?? "eval/fomoscan",
  };
}

const readLines = (file?: string): string[] =>
  file && existsSync(file)
    ? readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];

interface WalletSubject { chain: string; address: string; cabal: string; role: string; label?: string }
interface HandleSubject { handle: string; cabal: string; role: string; label?: string }
interface LaunchSubject { chain: string; address: string; symbol: string; cabal: string; outcome: string }

function walletSubjects(extra: string[]): WalletSubject[] {
  const seen = new Set<string>();
  const out: WalletSubject[] = [];
  for (const c of CABALS) {
    for (const w of c.wallets) {
      const key = w.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chain: w.chain, address: w.address, cabal: c.id, role: w.role, label: w.label });
    }
  }
  for (const a of extra) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chain: a.startsWith("0x") ? "evm" : "solana", address: a, cabal: "(file)", role: "traced" });
  }
  return out;
}

function handleSubjects(notable: boolean, extra: string[]): HandleSubject[] {
  const seen = new Set<string>();
  const out: HandleSubject[] = [];
  const push = (h: HandleSubject) => {
    const key = h.handle.replace(/^@/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...h, handle: key });
  };
  for (const c of CABALS) for (const a of c.accounts) push({ handle: a.handle, cabal: c.id, role: a.role, label: a.label });
  if (notable) for (const n of NOTABLE_ACCOUNTS) push({ handle: n.handle, cabal: "(notable)", role: "notable", label: n.label });
  for (const h of extra) push({ handle: h, cabal: "(file)", role: "file" });
  return out;
}

function launchSubjects(): LaunchSubject[] {
  const seen = new Set<string>();
  const out: LaunchSubject[] = [];
  for (const c of CABALS) for (const l of c.launches) {
    const key = l.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chain: l.chain, address: l.address, symbol: l.symbol, cabal: c.id, outcome: l.outcome });
  }
  return out;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

interface WalletRow extends WalletSubject { state: string; fomo?: FomoUser | null; cu: number; note: string }
interface HandleRow extends HandleSubject { state: string; fomo?: FomoUser | null; pnl?: FomoPnl | null; cu: number; note: string }
interface ThesisRow extends LaunchSubject { state: string; theses: FomoThesis[]; cu: number; note: string }

function stopState(r: FomoResult<unknown>): boolean {
  return r.state === "no_key" || r.state === "no_plan" || r.state === "unauthorized";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wallets = walletSubjects(readLines(args.walletsFile));
  const handles = handleSubjects(args.notable, readLines(args.handlesFile));
  const launches = launchSubjects();

  // Cost estimate. Wallet hits are the swing: assume all misses for the floor
  // and quote the per-hit price so the reader can size the budget.
  const estimate = {
    handles: { calls: handles.length, floorCu: handles.length * FOMOSCAN_CU.handleMiss, ceilingCu: handles.length * (FOMOSCAN_CU.handleHit + FOMOSCAN_CU.pnlBatchPerHandle) },
    wallets: { calls: wallets.length, floorCu: wallets.length * FOMOSCAN_CU.walletMiss, perHitCu: FOMOSCAN_CU.walletHit },
    theses: { calls: launches.length, cu: launches.length * FOMOSCAN_CU.thesisPage },
  };
  console.log(`subjects: ${wallets.length} wallets, ${handles.length} handles, ${launches.length} launches`);
  console.log(`estimate (${args.mode}): ${JSON.stringify(estimate[args.mode])}`);
  if (args.dryRun) return;

  const me = await fetchFomoMe();
  if (me.state !== "hit" || !me.value) {
    console.error(`cannot start: ${me.note}`);
    process.exit(1);
  }
  const unmetered = me.value.unmetered;
  let remaining = unmetered ? Number.POSITIVE_INFINITY : (me.value.unitsRemaining ?? 0) + (me.value.additionalUnits ?? 0);
  console.log(`plan: ${me.value.plan ?? "none"}; units remaining: ${unmetered ? "unmetered" : fmt(remaining)}${args.budgetCu ? `; budget for this run: ${fmt(args.budgetCu)}` : ""}`);
  let spent = 0;
  const budget = args.budgetCu > 0 ? args.budgetCu : remaining;
  const canAfford = (cu: number): boolean => spent + cu <= budget && remaining >= cu;
  const charge = (cu: number) => { spent += cu; remaining -= cu; };

  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = join(args.out, `fomoscan-${args.mode}-${stamp}.json`);

  if (args.mode === "handles") {
    const rows: HandleRow[] = [];
    for (const h of handles) {
      if (!canAfford(FOMOSCAN_CU.handleHit)) { rows.push({ ...h, state: "budget", cu: 0, note: "stopped: budget floor reached" }); continue; }
      const r = await fetchFomoUserByHandle(h.handle);
      charge(r.cu);
      rows.push({ ...h, state: r.state, fomo: r.value, cu: r.cu, note: r.note });
      if (stopState(r)) { console.error(`stopping: ${r.note}`); break; }
    }
    // Cash-flow numbers for the hits, in batches of 100 at half price.
    const hits = rows.filter((r) => r.state === "hit").map((r) => r.handle);
    for (let i = 0; i < hits.length; i += 100) {
      const chunk = hits.slice(i, i + 100);
      if (!canAfford(chunk.length * FOMOSCAN_CU.pnlBatchPerHandle)) break;
      const r = await fetchFomoPnlBatch(chunk);
      charge(r.cu);
      if (r.value) for (const p of r.value.entries) {
        const row = rows.find((x) => x.handle === p.handle.toLowerCase());
        if (row) row.pnl = p;
      }
      if (stopState(r)) break;
    }
    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), spentCu: spent, rows }, null, 2));
    console.log(`\n| handle | cabal | role | FOMO | X on FOMO | solana | evm | 30d net USD |\n|---|---|---|---|---|---|---|---|`);
    for (const r of rows) {
      const w = r.pnl?.windows["30d"] ?? r.pnl?.windows.all;
      console.log(`| @${r.handle} | ${r.cabal} | ${r.role} | ${r.state === "hit" ? r.fomo?.handle : r.state} | ${r.fomo?.twitter ? "@" + r.fomo.twitter : ""} | ${r.fomo?.solanaAddress ?? ""} | ${r.fomo?.evmAddress ?? ""} | ${w?.netUsd != null ? fmt(Math.round(w.netUsd)) : ""} |`);
    }
  }

  if (args.mode === "wallets") {
    if (!args.budgetCu) {
      console.error("wallets mode spends 50,000 CU per hit; pass --budget-cu N to cap this run");
      process.exit(2);
    }
    const rows: WalletRow[] = [];
    for (const w of wallets) {
      // A hit must still fit: stop when one more hit would breach the cap.
      if (!canAfford(FOMOSCAN_CU.walletHit)) { rows.push({ ...w, state: "budget", cu: 0, note: "stopped: one more hit would breach the budget" }); continue; }
      const r = await fetchFomoUserByWallet(w.address, { allowExpensive: true });
      charge(r.cu);
      rows.push({ ...w, state: r.state, fomo: r.value, cu: r.cu, note: r.note });
      if (stopState(r)) { console.error(`stopping: ${r.note}`); break; }
    }
    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), spentCu: spent, rows }, null, 2));
    console.log(`\n| wallet | chain | cabal | role | FOMO | X on FOMO | name |\n|---|---|---|---|---|---|---|`);
    for (const r of rows) {
      console.log(`| ${r.address} | ${r.chain} | ${r.cabal} | ${r.role}${r.label ? " (" + r.label + ")" : ""} | ${r.state === "hit" ? r.fomo?.handle : r.state} | ${r.fomo?.twitter ? "@" + r.fomo.twitter : ""} | ${r.fomo?.name ?? ""} |`);
    }
  }

  if (args.mode === "theses") {
    const rows: ThesisRow[] = [];
    for (const l of launches) {
      if (!canAfford(FOMOSCAN_CU.thesisPage)) { rows.push({ ...l, state: "budget", theses: [], cu: 0, note: "stopped: budget floor reached" }); continue; }
      const r = await fetchFomoTokenTheses(l.address);
      charge(r.cu);
      rows.push({ ...l, state: r.state, theses: r.value ?? [], cu: r.cu, note: r.note });
      if (stopState(r)) { console.error(`stopping: ${r.note}`); break; }
    }
    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), spentCu: spent, rows }, null, 2));
    console.log(`\n| token | chain | cabal | outcome | theses | authors |\n|---|---|---|---|---|---|`);
    for (const r of rows) {
      const authors = Array.from(new Set(r.theses.map((t) => t.authorHandle ?? t.authorId ?? "?"))).slice(0, 6).join(", ");
      console.log(`| ${r.symbol} ${r.address.slice(0, 10)}… | ${r.chain} | ${r.cabal} | ${r.outcome} | ${r.state === "hit" ? r.theses.length : r.state} | ${authors} |`);
    }
  }

  console.log(`\nspent ${fmt(spent)} CU this run; wrote ${outFile}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
