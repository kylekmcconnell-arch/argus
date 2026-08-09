// The threat scan orchestrator: token ref in → mechanical audit (src/token) →
// code review (LYRA layer) → deployer memory → one risk call. Output model:
// risk points 0–100 (higher = worse), a verdict bucket, a one-line action, and
// three tiers of plain-English second-person findings (flags / warnings /
// positives — good news is reported even on a RUG). Every scan is recorded to
// the receipts ledger so the module builds a public track record and remembers
// deployers.

import { auditToken, type TokenDossier } from "../token/audit";
import type { ResolvedInput } from "../lib/resolveInput";
import type { TraceStep } from "../data/evidence";
import type {
  CodeReview, DeployerRep, ThreatCall, ThreatCheck, ThreatScan, ThreatVerdict,
} from "./types";
import { reviewCode } from "./codereview";
import { byDeployer, recordReceipt } from "./receipts";
import { honeypotDeep, rugcheckReport, type HoneypotDeep, type RugcheckReport } from "./deepsources";

const money = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Math.round(n);

export async function threatScan(
  input: ResolvedInput,
  emit?: (s: TraceStep) => void,
): Promise<ThreatScan | null> {
  if (input.kind !== "token") return null;

  const dossier = await auditToken(input, emit);
  if (!dossier) return null;

  emit?.({ phase: "LYRA · Code", label: "Source read", detail: "Fetching verified source and reading the contract…", tone: "neutral" });
  const sol = dossier.chain === "solana";
  emit?.({
    phase: "NERON · Deep scan",
    label: sol ? "RugCheck report" : "Holder sell analysis",
    detail: sol
      ? "Named risk patterns, insider networks, LP lockers…"
      : "Simulating sells for real holders — selective honeypots, siphoned wallets, max caps…",
    tone: "neutral",
  });
  const [code, rc, hp] = await Promise.all([
    reviewCode(dossier.chain, dossier.address),
    sol ? rugcheckReport(dossier.address) : Promise.resolve(null),
    sol ? Promise.resolve(null) : honeypotDeep(dossier.chain, dossier.address),
  ]);
  emit?.({
    phase: "LYRA · Code",
    label: code.verified ? `${code.contractName ?? "Contract"} read` : code.checked ? "No verified source" : "No per-token code on this chain",
    detail: code.verified
      ? `${code.stats?.functions ?? 0} functions, ${code.stats?.gatedFunctions ?? 0} privileged, ${code.flags.length} code flags${code.ai ? ", AI read complete" : ""}.`
      : code.checked
        ? "Source is not verified on any public database — the code cannot be read."
        : "SPL tokens share the standard token program; authorities carry the risk.",
    tone: code.verified ? (code.flags.some((f) => f.severity === "critical") ? "bad" : "good") : "warn",
  });

  const deployer = deployerRep(dossier);
  if (deployer.priorRugs > 0) {
    emit?.({ phase: "NERON · Deployer", label: "Known deployer", detail: `This wallet has ${deployer.priorRugs} previously flagged token${deployer.priorRugs === 1 ? "" : "s"} in the ledger.`, tone: "bad" });
  }

  const call = judge(dossier, code, deployer, rc, hp);
  const checks = buildChecks(dossier, code, deployer, rc, hp);
  emit?.({ phase: "Verdict", label: call.verdict, detail: `${call.risk}/100 risk · ${call.action}`, tone: call.verdict === "SAFE" ? "good" : call.verdict === "CAUTION" ? "warn" : "bad" });

  const scan: ThreatScan = {
    address: dossier.address,
    chain: dossier.chain,
    symbol: dossier.symbol,
    name: dossier.name,
    dossier, call, code, deployer, checks,
    deep: { rugcheck: rc, honeypot: hp },
    scannedAt: Date.now(),
  };

  recordReceipt({
    address: dossier.address, chain: dossier.chain, symbol: dossier.symbol,
    verdict: call.verdict, risk: call.risk, flaggedAt: scan.scannedAt,
    liqThen: dossier.liquidityUsd ?? 0, deployer: dossier.deployer,
  });

  return scan;
}

function deployerRep(d: TokenDossier): DeployerRep {
  const prior = d.deployer
    ? byDeployer(d.deployer).filter((r) => r.address.toLowerCase() !== d.address.toLowerCase())
    : [];
  return {
    address: d.deployer,
    serialHoneypoter: d.safety.serialScammerCreator,
    priorScans: prior.map((r) => ({ address: r.address, symbol: r.symbol, verdict: r.verdict, at: r.flaggedAt })),
    priorRugs: prior.filter((r) => r.verdict === "RUG" || r.verdict === "DANGER").length,
  };
}

// ---- the judge: additive risk points + tiered plain-English strings ----
// Wording rules (deliberate): second person, the scary word in CAPS, one
// sentence per finding, no jargon without a translation.
function judge(
  d: TokenDossier, code: CodeReview, dep: DeployerRep,
  rc: RugcheckReport | null, hp: HoneypotDeep | null,
): ThreatCall {
  const s = d.safety;
  const flags: string[] = [];
  const warnings: string[] = [];
  const positives: string[] = [];
  let risk = 0;
  let trap = false; // honeypot-class: forces RUG at 100
  const add = (pts: number) => { risk += pts; };

  // Same legitimacy gate as the base engine: real CEX presence with market-cap
  // floors is the thing a rug can't fake. On an established token, soft signals
  // (unverified LP custody, concentration, mutable metadata, capability-class
  // code flags) are disclosures, not risk points — PEPE ships a blacklist and
  // 37% of its supply sits in big wallets, and it is not a trap. Hard traps
  // (honeypot, siphoned sells, serial deployer) are never relaxed.
  const cexN = d.cg?.cexCount ?? 0;
  const mcap = d.mcap ?? 0;
  const established = cexN >= 5 || (cexN >= 3 && mcap >= 10_000_000) || (cexN >= 1 && mcap >= 100_000_000);
  const soft = (pts: number) => { if (!established) risk += pts; };

  // The mechanical audit already adjudicated the ambiguous cases (sim
  // false-positives, governed authorities on CEX-listed tokens, unreliable
  // holder data), so we read its conclusions — capApplied and findings tones —
  // rather than re-litigating the raw flags.
  const capped = (k: string) => d.capApplied === k;
  const confirmedBad = (needle: string) => d.findings.some((f) => f.tone === "bad" && f.claim.toLowerCase().includes(needle));

  // --- honeypot class ---
  if (capped("honeypot_confirmed") || (s.honeypot && confirmedBad("honeypot"))) {
    trap = true;
    flags.push(s.nonTransferable ? "NON-TRANSFERABLE — once you buy, you can never move it" : "🍯 HONEYPOT — you will NOT be able to sell");
  }
  if (s.cannotSellAll && !trap) { trap = true; flags.push("You can buy but you CANNOT sell your full balance — a honeypot with the door ajar"); }
  if (rc?.rugged && !trap) { trap = true; flags.push("RugCheck marks this token as already RUGGED — the pull has happened"); }
  if (hp?.reason && trap) warnings.push(`Simulator's reason: ${hp.reason}`);

  // --- per-holder sell analysis (EVM, Honeypot.is deep) ---
  // A selective honeypot lets the simulator's fresh wallet sell while real
  // holders can't. Failed/siphoned real-holder sells outrank a clean sim.
  if (hp && hp.holdersAnalyzed >= 5) {
    const failPct = (hp.holdersFailed / hp.holdersAnalyzed) * 100;
    if (hp.siphoned > 0) { add(45); flags.push(`${hp.siphoned} real holder${hp.siphoned === 1 ? "'s" : "s'"} sells were SIPHONED (taxed to nothing) — a selective honeypot`); }
    else if (failPct >= 25) { add(35); flags.push(`${hp.holdersFailed} of ${hp.holdersAnalyzed} real holders FAILED to sell — the sim passes but the exits don't work`); }
    else if (hp.highTaxWallets > 0) { add(12); warnings.push(`${hp.highTaxWallets} wallet${hp.highTaxWallets === 1 ? " is" : "s are"} taxed far above the advertised rate — per-address tax manipulation`); }
    else positives.push(`${hp.holdersAnalyzed} real holders' sells simulated — exits work for actual wallets, not just the test wallet`);
  }
  if (hp?.maxSellPct != null && hp.maxSellPct > 0 && hp.maxSellPct < 0.5) { add(12); warnings.push(`Max sell is capped at ${hp.maxSellPct.toFixed(2)}% of supply — exits are rationed`); }

  // --- Solana deep report (RugCheck) ---
  if (rc) {
    // RugCheck's own normalized score (higher = riskier) adjudicates its named
    // patterns: a token IT scores clean shouldn't have its patterns re-escalated.
    const rcTrusts = rc.score < 25;
    for (const r of rc.risks) {
      const lvl = r.level.toLowerCase();
      const line = r.description || r.name;
      // Skip categories the base audit already adjudicated (authorities, LP,
      // concentration) — RugCheck's named patterns add the rest.
      const dup = /mint authority|freeze authority|top .*holders|lp|liquidity/i.test(r.name);
      if (dup) continue;
      if ((lvl === "danger" || lvl === "critical" || lvl === "high") && !rcTrusts) { add(20); flags.push(`${line} (RugCheck)`); }
      else if (lvl !== "info" && lvl !== "low") { soft(6); warnings.push(`${line} (RugCheck)`); }
    }
    if (rc.insidersDetected > 0 && rc.insiderPct >= 10) {
      // A big linked-wallet share is a red flag on a fresh token and a fact of
      // life on an old blue chip (BONK's airdrop web). Escalate only when
      // RugCheck itself is worried or the token has no market legitimacy.
      const red = rc.insiderPct >= 25 && !established && !rcTrusts;
      if (red) { add(25); flags.push(`Insider network: ${rc.insidersDetected} linked wallets hold ~${rc.insiderPct}% of supply — funded from common sources`); }
      else { soft(8); warnings.push(`Linked-wallet network holds ~${rc.insiderPct}% of supply (${rc.insidersDetected} wallets, common funding) — normal for airdropped tokens, a snipe signature on fresh ones`); }
    }
    if (rc.lockerPct >= 50) positives.push(`LP in known lockers (${rc.lockerNames.join(", ")}) — ${rc.lockerPct}% of pooled liquidity`);
  }

  // --- authority / owner powers ---
  const authorityRelaxed = (d.findings.some((f) => f.tone === "warn" && /governed emissions|ops mechanism/i.test(f.claim)));
  if (s.hiddenOwner) { add(45); flags.push("HIDDEN OWNER — control is disguised behind a wallet the renounce doesn't touch"); }
  if (s.mintable) {
    if (authorityRelaxed) warnings.push("Mint authority is live — on this listed token it reads as a governed emissions switch, but confirm who holds it");
    else { add(40); flags.push("Mint authority is LIVE — the team can print supply and dilute you to zero"); }
  }
  if (s.freezable) {
    if (authorityRelaxed) warnings.push("Freeze authority is live — governed on a listed token, but it can still freeze accounts");
    else { add(40); flags.push("Freeze authority is LIVE — your tokens can be frozen in your wallet"); }
  }
  if (s.takeBack && !s.hiddenOwner) {
    if (authorityRelaxed) warnings.push("Ownership can be reclaimed after renouncement — a governed escape hatch here, but verify");
    else { add(40); flags.push("Ownership can be RECLAIMED after renouncement — a renounce announcement means nothing here"); }
  }
  if (s.ownerChangeBalance && confirmedBad("modify holder balances")) { add(50); flags.push("Owner can EDIT your balance — your tokens can be zeroed without a transfer"); }
  if (s.balanceMutable && confirmedBad("balance-mutable")) { add(50); flags.push("A balance-mutable authority can REWRITE your token balance at will"); }
  if (s.transferHook) { add(35); flags.push("A transfer hook runs on every transfer — an external program can BLOCK your sell"); }

  // --- deployer history ---
  if (s.serialScammerCreator) { add(45); flags.push("The deployer has shipped HONEYPOTS before — a serial scammer's wallet"); }
  if (dep.priorRugs > 0) { add(30); flags.push(`This deployer already has ${dep.priorRugs} flagged token${dep.priorRugs === 1 ? "" : "s"} in our ledger — a rug factory pattern`); }
  else if (dep.priorScans.length > 0) warnings.push(`Deployer seen before: ${dep.priorScans.length} prior scan${dep.priorScans.length === 1 ? "" : "s"} in the ledger, none flagged`);

  // --- code review (LYRA) ---
  if (code.verified) {
    positives.push(`Verified contract — the source is public${code.contractName ? ` (${code.contractName})` : ""} and was read line by line`);
    // Capability-class code flags are dangerous in an active owner's hands and
    // dead switches once ownership is renounced (PEPE ships a blacklist it can
    // no longer flip). Renounced or established => disclosure, not risk points.
    // Fake-renounce is the exception that PROVES renounce state: if the chain
    // says the owner is already zero, the heuristic mis-read a custom renounce.
    const disarmed = s.ownerRenounced || established;
    for (const f of code.flags) {
      const cite = ` [${f.file.split("/").pop()}:${f.line}]`;
      const line = f.detail.replace(/\.$/, "") + cite;
      if (f.severity === "critical") {
        if (f.id === "fake-renounce" && s.ownerRenounced) { warnings.push("renounceOwnership is custom-written, though the owner reads as zero on-chain — verify the renounce on the explorer" + cite); soft(8); }
        else { add(45); flags.push(line); }
      } else if (f.severity === "high") {
        if (disarmed) { soft(6); warnings.push(line + (s.ownerRenounced ? " (ownership renounced — the switch has no hand on it)" : "")); }
        else { add(20); warnings.push(line); }
      } else if (f.severity === "medium") { soft(8); warnings.push(line); }
    }
    if (!code.flags.some((f) => f.severity === "critical" || f.severity === "high"))
      positives.push("No dangerous patterns in the source — no hidden mint, balance rewrite, or trading kill-switch found");
  } else if (code.checked && EVM(d.chain)) {
    soft(15);
    warnings.push("UNVERIFIED contract — the source is hidden, so nobody can read what the code really does");
  }

  // --- taxes ---
  if (s.sellTax >= 40) { add(40); flags.push(`Sell tax is ${s.sellTax.toFixed(0)}% — a toll booth on the exit`); }
  else if (s.sellTax >= 15) { add(20); warnings.push(`Sell tax is ${s.sellTax.toFixed(0)}% — you lose a real cut on every exit`); }
  else if (s.available && s.buyTax + s.sellTax > 0) warnings.push(`Taxes: buy ${s.buyTax.toFixed(1)}% / sell ${s.sellTax.toFixed(1)}%`);
  else if (s.available && d.chain !== "solana") positives.push(`Low taxes (buy ${s.buyTax.toFixed(1)}% / sell ${s.sellTax.toFixed(1)}%)`);
  if (s.simChecked && !s.honeypot) positives.push("Sell simulation PASSED — a real sell went through");

  // --- liquidity ---
  const liq = d.liquidityUsd ?? 0;
  if (s.available) {
    if (s.lpBurnedPct >= 50) positives.push(`LP burned ${s.lpBurnedPct.toFixed(0)}% — the pool can never be pulled`);
    else if (s.lpLockedPct >= 50) positives.push(`LP locked ${s.lpLockedPct.toFixed(0)}%`);
    else if (s.lpTopUnlockedEoaPct >= 80) { add(35); flags.push(`${s.lpTopUnlockedEoaPct.toFixed(0)}% of the liquidity sits in ONE unlocked wallet — it can be pulled at any moment`); }
    else if (s.lpTopUnlockedEoaPct >= 50) { add(20); warnings.push(`Most of the liquidity (${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet — treat the pool as removable`); }
    else if (!established) { add(12); warnings.push("LP CUSTODY UNVERIFIED — nobody could confirm the liquidity is locked or burned, so treat the pool as removable"); }
    else warnings.push("LP lock/burn not confirmed — on a token this established, liquidity typically sits in pair and market-maker contracts");
  }
  if (liq < 15000) { add(10); warnings.push(`Thin liquidity (${money(liq)}) — easy to drain, brutal to exit`); }

  // --- holders ---
  if (d.bundleRisk === "high" && !established) { add(25); flags.push(`${d.insiderPct}% of supply sits in ${d.bundleCount} fresh wallets — a bundled launch or coordinated snipe`); }
  else if (d.bundleRisk !== "low") { soft(12); warnings.push(`${d.insiderPct}% of supply is concentrated in ${d.bundleCount} non-contract wallets`); }
  const top = s.topHolderPct;
  if (top != null && top > 50 && !established) { add(25); flags.push(`One wallet holds ${top.toFixed(0)}% of the supply — they ARE the market`); }
  else if (top != null && top > 25) { soft(12); warnings.push(`Top holder owns ${top.toFixed(0)}% of supply`); }
  if (s.creatorPercent >= 15) { add(12); warnings.push(`The creator still holds ~${s.creatorPercent.toFixed(0)}% of supply`); }
  if (s.holderCount >= 5000) positives.push(`${s.holderCount.toLocaleString()} holders — distribution is real`);

  // --- market conduct ---
  if (d.findings.some((f) => /wash-trading|wash-trade/i.test(f.claim))) { add(25); flags.push("Volume churns without moving the price — a WASH-TRADING signature, the activity is manufactured"); }
  if ((d.priceChange?.h24 ?? 0) <= -60) { add(20); warnings.push(`Down ${Math.abs(d.priceChange!.h24!).toFixed(0)}% in 24h — the dump may already have happened`); }
  if (d.ageDays != null && d.ageDays < 1) { add(10); warnings.push("Pair created <24h ago — no history to judge, maximum uncertainty"); }
  else if (d.ageDays != null && d.ageDays < 7) { add(6); warnings.push(`Pair is ${Math.round(d.ageDays)} day${Math.round(d.ageDays) === 1 ? "" : "s"} old`); }

  // --- corroboration positives ---
  if (d.cg?.listed) positives.push(`Listed on CoinGecko${d.cg.rank ? ` (rank #${d.cg.rank})` : ""}${d.cg.cexCount ? `, ${d.cg.cexCount} CEX market${d.cg.cexCount === 1 ? "" : "s"}` : ""}`);
  if (s.ownerRenounced && !s.mintable && !s.freezable && !s.takeBack)
    positives.push(d.chain === "solana" ? "Mint and freeze authority revoked — the token is set in stone" : "Ownership renounced — no owner powers remain");

  // --- verdict ---
  risk = trap ? 100 : Math.min(100, Math.round(risk));
  const unknown = !s.available && !code.verified;
  // RUG is reserved for a CONFIRMED trap (honeypot-class or already rugged);
  // everything else, however dark, is DANGER — a claim we can defend.
  const verdict: ThreatVerdict = trap ? "RUG" : unknown ? "UNKNOWN" : risk >= 40 ? "DANGER" : risk >= 16 ? "CAUTION" : "SAFE";
  const action =
    verdict === "RUG" ? "DON'T TOUCH IT"
    : verdict === "DANGER" ? "Walk away — the trap doors outnumber the exits"
    : verdict === "CAUTION" ? "Tradeable, but size it like it can go to zero"
    : verdict === "UNKNOWN" ? "Could not verify — treat unverifiable as hostile"
    : "No mechanical red flags (not financial advice)";

  return { verdict, risk, action, flags, warnings, positives };
}

const EVM = (chain: string) => chain !== "solana";

// ---- the transparent checklist: what was examined, including clean results ----
function buildChecks(
  d: TokenDossier, code: CodeReview, dep: DeployerRep,
  rc: RugcheckReport | null, hp: HoneypotDeep | null,
): ThreatCheck[] {
  const s = d.safety;
  const sol = d.chain === "solana";
  const na = !s.available;
  const cexN = d.cg?.cexCount ?? 0;
  const mcap = d.mcap ?? 0;
  const established = cexN >= 5 || (cexN >= 3 && mcap >= 10_000_000) || (cexN >= 1 && mcap >= 100_000_000);
  const chk = (
    key: string, category: ThreatCheck["category"], label: string,
    status: ThreatCheck["status"], detail: string,
  ): ThreatCheck => ({ key, category, label, status, detail });

  return [
    chk("honeypot", "honeypot", "Can holders sell?",
      na ? "na" : s.honeypot || s.cannotSellAll || (hp?.siphoned ?? 0) > 0 ? "fail" : "pass",
      na ? "Not verifiable on this chain keyless" : s.honeypot ? "Selling is blocked" : (hp?.siphoned ?? 0) > 0 ? "Real holders' sells are siphoned" : hp && hp.holdersAnalyzed >= 5 ? `Sells simulated for ${hp.holdersAnalyzed} real holders` : s.simChecked ? "Real sell simulated successfully" : "No sell restriction found on-chain"),
    chk("mint", "authority", sol ? "Mint authority" : "Mint capability",
      na ? "na" : s.mintable ? "fail" : "pass",
      na ? "Unchecked" : s.mintable ? "Supply can be inflated" : "No live mint power"),
    chk("freeze", "authority", sol ? "Freeze authority" : "Pause / freeze",
      na ? "na" : (sol ? s.freezable : s.pausable) ? "fail" : "pass",
      na ? "Unchecked" : (sol ? s.freezable : s.pausable) ? "Accounts/transfers can be frozen" : "No freeze power"),
    chk("owner", "authority", "Ownership",
      na ? "na" : s.hiddenOwner || s.takeBack ? "fail" : s.ownerRenounced ? "pass" : "warn",
      na ? "Unchecked" : s.hiddenOwner ? "Hidden owner detected" : s.takeBack ? "Renounce is reversible" : s.ownerRenounced ? "Renounced / authorities revoked" : "Owner is active"),
    chk("lp", "liquidity", "Liquidity custody",
      na ? "na" : s.lpBurnedPct + s.lpLockedPct >= 50 ? "pass" : s.lpTopUnlockedEoaPct >= 50 ? "fail" : established ? "pass" : "warn",
      na ? "Unchecked" : s.lpBurnedPct >= 50 ? `${s.lpBurnedPct.toFixed(0)}% burned` : s.lpLockedPct >= 50 ? `${s.lpLockedPct.toFixed(0)}% locked` : s.lpTopUnlockedEoaPct >= 50 ? "Pullable by one wallet" : established ? "In pair/market contracts (established token)" : "Lock/burn not confirmed"),
    chk("tax", "honeypot", "Exit taxes",
      na ? "na" : s.sellTax >= 15 ? "fail" : s.sellTax > 5 ? "warn" : "pass",
      na ? "Unchecked" : `buy ${s.buyTax.toFixed(1)}% / sell ${s.sellTax.toFixed(1)}%`),
    chk("holders", "holders", "Holder concentration",
      na ? "na" : (d.bundleRisk === "high" || (s.topHolderPct ?? 0) > 50 || (rc?.insiderPct ?? 0) >= 25) && !established ? "fail" : d.bundleRisk !== "low" || (s.topHolderPct ?? 0) > 25 || (rc?.insiderPct ?? 0) >= 10 ? "warn" : "pass",
      na ? "Unchecked" : `${s.holderCount.toLocaleString()} holders${s.topHolderPct != null ? `, top ${s.topHolderPct.toFixed(0)}%` : ""}${rc?.insidersDetected ? `, insider net ${rc.insiderPct}%` : d.insiderPct ? `, ${d.insiderPct}% insider cluster` : ""}`),
    chk("deployer", "deployer", "Deployer history",
      s.serialScammerCreator || dep.priorRugs > 0 ? "fail" : dep.address ? "pass" : "na",
      s.serialScammerCreator ? "Has shipped honeypots before" : dep.priorRugs > 0 ? `${dep.priorRugs} flagged tokens in ledger` : dep.address ? "No adverse history found" : "Deployer not resolvable"),
    chk("code", "code", "Source code read",
      !code.checked ? "na" : code.verified ? (code.flags.some((f) => f.severity === "critical") ? "fail" : code.flags.some((f) => f.severity === "high") ? "warn" : "pass") : "warn",
      !code.checked ? (sol ? "SPL — standard program, no per-token code" : "Not checked") : code.verified ? `${code.stats?.functions ?? 0} functions read, ${code.flags.length} flag${code.flags.length === 1 ? "" : "s"}` : "Source unverified — unreadable"),
    chk("market", "market", "Market conduct",
      d.findings.some((f) => /wash-trad/i.test(f.claim)) ? "fail" : (d.liquidityUsd ?? 0) < 15000 ? "warn" : "pass",
      d.findings.some((f) => /wash-trad/i.test(f.claim)) ? "Wash-trading signature" : `${money(d.liquidityUsd ?? 0)} liquidity, ${money(d.vol24 ?? 0)} 24h volume`),
  ];
}
