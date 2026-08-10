// The threat scan orchestrator: token ref in → mechanical audit (src/token) →
// code review (LYRA layer) → deployer memory → one risk call. Output model:
// risk points 0–100 (higher = worse), a verdict bucket, a one-line action, and
// three tiers of plain-English second-person findings (flags / warnings /
// positives - good news is reported even on a RUG). Every scan is recorded to
// the receipts ledger so the module builds a public track record and remembers
// deployers.

import { auditToken, type TokenDossier } from "../token/audit";
import { isRunnableTokenInput, type ResolvedInput } from "../lib/resolveInput";
import type { TraceStep } from "../data/evidence";
import type {
  CodeReview, DeployerRep, ThreatCall, ThreatCheck, ThreatScan, ThreatVerdict,
} from "./types";
import { reviewCode } from "./codereview";
import { analyzeTokenomics, type TokenomicsView } from "./tokenomics";
import { recordReceipt, sharedByDeployer } from "./receipts";
import {
  honeypotDeep, rugcheckReport, goplusMeta, codeFingerprint, knownRugClones, burnHistory,
  type HoneypotDeep, type RugcheckReport, type GoPlusMeta,
} from "./deepsources";
import { crossChain } from "./crosschain";
import { migrationCheck } from "./migration";
import { launchProvenance } from "./launch";
import type { CrossChain, MigrationInfo, LaunchProvenance } from "./types";

const money = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Math.round(n);

export async function threatScan(
  input: ResolvedInput,
  emit?: (s: TraceStep) => void,
): Promise<ThreatScan | null> {
  // auditToken needs an already-resolved runnable token (main tightened
  // RunnableTokenInput.via to solana|evm|dexscreener). A bare ticker or
  // address-candidate isn't runnable - the caller resolves those first.
  if (!isRunnableTokenInput(input)) return null;

  const dossier = await auditToken(input, emit);
  if (!dossier) return null;

  emit?.({ phase: "LYRA · Code", label: "Source read", detail: "Fetching verified source and reading the contract…", tone: "neutral" });
  const sol = dossier.chain === "solana";
  emit?.({
    phase: "NERON · Deep scan",
    label: sol ? "RugCheck report" : "Holder sell analysis",
    detail: sol
      ? "Named risk patterns, insider networks, LP lockers…"
      : "Simulating sells for real holders - selective honeypots, siphoned wallets, max caps…",
    tone: "neutral",
  });
  const [code, rc, hp, meta, fp, xchain, launch] = await Promise.all([
    reviewCode(dossier.chain, dossier.address),
    sol ? rugcheckReport(dossier.address) : Promise.resolve(null),
    sol ? Promise.resolve(null) : honeypotDeep(dossier.chain, dossier.address),
    sol ? Promise.resolve(null) : goplusMeta(dossier.chain, dossier.address),
    sol ? Promise.resolve(null) : codeFingerprint(dossier.chain, dossier.address),
    sol ? Promise.resolve(null) : crossChain(dossier.chain, dossier.address, dossier.liquidityUsd ?? 0),
    launchProvenance(dossier),
  ]);
  if (launch && launch.kind !== "unknown") {
    const state = launch.onCurve
      ? `on the bonding curve${launch.curveProgressPct != null ? ` (${launch.curveProgressPct.toFixed(0)}%)` : ""}`
      : launch.graduated
        ? "graduated - curve completed"
        : launch.kind === "fair-launch" ? "direct DEX listing" : "state unknown";
    emit?.({
      phase: "NERON · Launch",
      label: launch.venue ?? "Fair launch",
      detail: `${state}${launch.quote ? ` · bonded to ${launch.quote}` : ""}${launch.lpNote ? ` · ${launch.lpNote}` : ""}`,
      tone: "neutral",
    });
  }
  const migration = sol ? await migrationCheck(dossier.chain, dossier.address) : null;
  if (migration?.migrated) {
    emit?.({ phase: "NERON · Migration", label: "Migrate.fun", detail: migration.isPostMigrationToken ? `New post-migration token (${migration.projects[0]?.projectId}) - the chart restarted; claim distribution to prior holders is expected.` : `Registered in a Migrate.fun migration (${migration.projects[0]?.projectId}).`, tone: "neutral" });
  }
  const burns = sol ? null : await burnHistory(dossier.chain, dossier.address);
  if (burns && burns.count > 0) {
    emit?.({ phase: "NERON · Burns", label: `${burns.count} burns`, detail: `${burns.burnedSupplyPct != null ? `${burns.burnedSupplyPct.toFixed(burns.burnedSupplyPct < 10 ? 2 : 0)}% of supply burned; ` : ""}cadence ${burns.cadence}${burns.ongoing ? ", ongoing" : ""}.`, tone: "good" });
  }
  if (xchain?.isOft) {
    emit?.({ phase: "NERON · Cross-chain", label: "LayerZero OFT", detail: `Bridged across ${xchain.legs.length} chain${xchain.legs.length === 1 ? "" : "s"} (${xchain.legs.map((l) => l.chain).join(", ")})${xchain.resolvedLegs > 1 ? ` · $${Math.round(xchain.totalLiquidityUsd).toLocaleString()} total liquidity` : ""}.`, tone: "neutral" });
  }
  // Known-rug-clone check: does this contract's bytecode fingerprint match a
  // token we already flagged? A byte-identical clone of a known rug is the same
  // trap wearing a new ticker.
  const clones = fp ? await knownRugClones(fp.fingerprint, dossier.address) : [];
  if (clones.length) {
    emit?.({ phase: "NERON · Fingerprint", label: "Known-rug clone", detail: `Byte-identical to ${clones.length} previously flagged token${clones.length === 1 ? "" : "s"} (${clones.slice(0, 3).map((c) => "$" + c.symbol).join(", ")}).`, tone: "bad" });
  } else if (meta?.fakeToken) {
    emit?.({ phase: "NERON · Counterfeit", label: "Fake token", detail: "GoPlus flags this as a counterfeit of an established token.", tone: "bad" });
  }
  emit?.({
    phase: "LYRA · Code",
    label: code.verified ? `${code.contractName ?? "Contract"} read` : code.checked ? "No verified source" : "No per-token code on this chain",
    detail: code.verified
      ? `${code.stats?.functions ?? 0} functions, ${code.stats?.gatedFunctions ?? 0} privileged, ${code.flags.length} code flags${code.ai ? ", AI read complete" : ""}.`
      : code.checked
        ? "Source is not verified on any public database - the code cannot be read."
        : "SPL tokens share the standard token program; authorities carry the risk.",
    tone: code.verified ? (code.flags.some((f) => f.severity === "critical") ? "bad" : "good") : "warn",
  });

  const deployer = await deployerRep(dossier);
  if (deployer.priorRugs > 0) {
    emit?.({ phase: "NERON · Deployer", label: "Known deployer", detail: `This wallet has ${deployer.priorRugs} previously flagged token${deployer.priorRugs === 1 ? "" : "s"} in the shared ledger.`, tone: "bad" });
  }

  const tokenomics = analyzeTokenomics(dossier, meta, rc, code.tokenomics, burns);
  if (tokenomics.tax.destinations.includes("rwa-distribution")) {
    emit?.({ phase: "NERON · Tokenomics", label: "Tax → real-world assets", detail: "The transfer tax appears to buy real-world assets/stocks and distribute them to holders - a yield mechanism, not a rug tax.", tone: "good" });
  }
  const call = judge(dossier, code, deployer, rc, hp, meta, clones, tokenomics, xchain, migration, launch);
  const checks = buildChecks(dossier, code, deployer, rc, hp, meta, tokenomics, launch);
  emit?.({ phase: "Verdict", label: call.verdict, detail: `${call.risk}/100 risk · ${call.action}`, tone: call.verdict === "SAFE" ? "good" : call.verdict === "CAUTION" ? "warn" : "bad" });

  const scan: ThreatScan = {
    address: dossier.address,
    chain: dossier.chain,
    symbol: dossier.symbol,
    name: dossier.name,
    dossier, call, code, deployer, tokenomics, checks,
    deep: { rugcheck: rc, honeypot: hp, meta, fingerprint: fp?.fingerprint ?? null, clones, xchain, migration, launch },
    scannedAt: Date.now(),
  };

  recordReceipt({
    address: dossier.address, chain: dossier.chain, symbol: dossier.symbol,
    verdict: call.verdict, risk: call.risk, flaggedAt: scan.scannedAt,
    liqThen: dossier.liquidityUsd ?? 0, deployer: dossier.deployer,
    codeVerified: code.verified, flagCount: code.flags.length,
    codeFingerprint: fp?.fingerprint ?? null,
  });

  return scan;
}

async function deployerRep(d: TokenDossier): Promise<DeployerRep> {
  const prior = d.deployer
    ? (await sharedByDeployer(d.deployer)).filter((r) => r.address.toLowerCase() !== d.address.toLowerCase())
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
  meta: GoPlusMeta | null, clones: { symbol: string; address: string; verdict: string }[],
  tk: TokenomicsView, xchain: CrossChain | null, migration: MigrationInfo | null,
  launch: LaunchProvenance | null,
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
  // code flags) are disclosures, not risk points - PEPE ships a blacklist and
  // 37% of its supply sits in big wallets, and it is not a trap. Hard traps
  // (honeypot, siphoned sells, serial deployer) are never relaxed.
  const cexN = d.cg?.cexCount ?? 0;
  const mcap = d.mcap ?? 0;
  const established = cexN >= 5 || (cexN >= 3 && mcap >= 10_000_000) || (cexN >= 1 && mcap >= 100_000_000);
  const soft = (pts: number) => { if (!established) risk += pts; };

  // The mechanical audit already adjudicated the ambiguous cases (sim
  // false-positives, governed authorities on CEX-listed tokens, unreliable
  // holder data), so we read its conclusions - capApplied and findings tones -
  // rather than re-litigating the raw flags.
  const capped = (k: string) => d.capApplied === k;
  const confirmedBad = (needle: string) => d.findings.some((f) => f.tone === "bad" && f.claim.toLowerCase().includes(needle));

  // --- honeypot class ---
  if (capped("honeypot_confirmed") || (s.honeypot && confirmedBad("honeypot"))) {
    trap = true;
    flags.push(s.nonTransferable ? "NON-TRANSFERABLE - once you buy, you can never move it" : "🍯 HONEYPOT - you will NOT be able to sell");
  }
  if (s.cannotSellAll && !trap) { trap = true; flags.push("You can buy but you CANNOT sell your full balance - a honeypot with the door ajar"); }
  if (rc?.rugged && !trap) { trap = true; flags.push("RugCheck marks this token as already RUGGED - the pull has happened"); }
  if (hp?.reason && trap) warnings.push(`Simulator's reason: ${hp.reason}`);

  // --- counterfeit / known-rug clone (never relaxed - impersonation is intent) ---
  if (meta?.fakeToken) {
    add(45);
    flags.push(meta.fakeTokenOf
      ? `COUNTERFEIT - this contract impersonates an established token (the real one is ${meta.fakeTokenOf.slice(0, 10)}…). You are not buying what you think.`
      : "COUNTERFEIT - GoPlus flags this as a fake of an established token. You are not buying what you think.");
  }
  if (clones.length) {
    add(50);
    const names = clones.slice(0, 3).map((c) => `$${c.symbol}`).join(", ");
    flags.push(`Byte-identical to ${clones.length} token${clones.length === 1 ? "" : "s"} we already flagged (${names}) - the same trap redeployed under a new name`);
  }
  if (meta?.airdropScam) { add(30); flags.push("Flagged as an AIRDROP SCAM - the token was dusted to wallets to lure them to a drainer site"); }
  if (meta?.trustListed) positives.push("On GoPlus's trust list of established, reputable tokens");

  // --- per-holder sell analysis (EVM, Honeypot.is deep) ---
  // A selective honeypot lets the simulator's fresh wallet sell while real
  // holders can't. Failed/siphoned real-holder sells outrank a clean sim.
  if (hp && hp.holdersAnalyzed >= 5) {
    const failPct = (hp.holdersFailed / hp.holdersAnalyzed) * 100;
    if (hp.siphoned > 0) { add(45); flags.push(`${hp.siphoned} real holder${hp.siphoned === 1 ? "'s" : "s'"} sells were SIPHONED (taxed to nothing) - a selective honeypot`); }
    else if (failPct >= 25) { add(35); flags.push(`${hp.holdersFailed} of ${hp.holdersAnalyzed} real holders FAILED to sell - the sim passes but the exits don't work`); }
    else if (hp.highTaxWallets > 0) { add(12); warnings.push(`${hp.highTaxWallets} wallet${hp.highTaxWallets === 1 ? " is" : "s are"} taxed far above the advertised rate - per-address tax manipulation`); }
    else positives.push(`${hp.holdersAnalyzed} real holders' sells simulated - exits work for actual wallets, not just the test wallet`);
  }
  if (hp?.maxSellPct != null && hp.maxSellPct > 0 && hp.maxSellPct < 0.5) { add(12); warnings.push(`Max sell is capped at ${hp.maxSellPct.toFixed(2)}% of supply - exits are rationed`); }

  // --- Solana deep report (RugCheck) ---
  if (rc) {
    // RugCheck's own normalized score (higher = riskier) adjudicates its named
    // patterns: a token IT scores clean shouldn't have its patterns re-escalated.
    const rcTrusts = rc.score < 25;
    for (const r of rc.risks) {
      const lvl = r.level.toLowerCase();
      const line = r.description || r.name;
      // Skip categories the base audit already adjudicated (authorities, LP,
      // concentration) - RugCheck's named patterns add the rest.
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
      if (red) { add(25); flags.push(`Insider network: ${rc.insidersDetected} linked wallets hold ~${rc.insiderPct}% of supply - funded from common sources`); }
      else { soft(8); warnings.push(`Linked-wallet network holds ~${rc.insiderPct}% of supply (${rc.insidersDetected} wallets, common funding) - normal for airdropped tokens, a snipe signature on fresh ones`); }
    }
    // LP locker positive is emitted from the tokenomics block below (which folds
    // in rc.lockerNames/lockerPct), so it isn't repeated here.
  }

  // --- authority / owner powers ---
  const authorityRelaxed = (d.findings.some((f) => f.tone === "warn" && /governed emissions|ops mechanism/i.test(f.claim)));
  if (s.hiddenOwner) { add(45); flags.push("HIDDEN OWNER - control is disguised behind a wallet the renounce doesn't touch"); }
  if (s.mintable) {
    if (authorityRelaxed) warnings.push("Mint authority is live - on this listed token it reads as a governed emissions switch, but confirm who holds it");
    else { add(40); flags.push("Mint authority is LIVE - the team can print supply and dilute you to zero"); }
  }
  if (s.freezable) {
    if (authorityRelaxed) warnings.push("Freeze authority is live - governed on a listed token, but it can still freeze accounts");
    else { add(40); flags.push("Freeze authority is LIVE - your tokens can be frozen in your wallet"); }
  }
  if (s.takeBack && !s.hiddenOwner) {
    if (authorityRelaxed) warnings.push("Ownership can be reclaimed after renouncement - a governed escape hatch here, but verify");
    else { add(40); flags.push("Ownership can be RECLAIMED after renouncement - a renounce announcement means nothing here"); }
  }
  if (s.ownerChangeBalance && confirmedBad("modify holder balances")) { add(50); flags.push("Owner can EDIT your balance - your tokens can be zeroed without a transfer"); }
  if (s.balanceMutable && confirmedBad("balance-mutable")) { add(50); flags.push("A balance-mutable authority can REWRITE your token balance at will"); }
  if (s.transferHook) { add(35); flags.push("A transfer hook runs on every transfer - an external program can BLOCK your sell"); }

  // --- deployer history ---
  if (s.serialScammerCreator) { add(45); flags.push("The deployer has shipped HONEYPOTS before - a serial scammer's wallet"); }
  if (dep.priorRugs > 0) { add(30); flags.push(`This deployer already has ${dep.priorRugs} flagged token${dep.priorRugs === 1 ? "" : "s"} in our ledger - a rug factory pattern`); }
  else if (dep.priorScans.length > 0) warnings.push(`Deployer seen before: ${dep.priorScans.length} prior scan${dep.priorScans.length === 1 ? "" : "s"} in the ledger, none flagged`);

  // --- code review (LYRA) ---
  if (code.verified) {
    positives.push(`Verified contract - the source is public${code.contractName ? ` (${code.contractName})` : ""} and was read line by line`);
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
        if (f.id === "fake-renounce" && s.ownerRenounced) { warnings.push("renounceOwnership is custom-written, though the owner reads as zero on-chain - verify the renounce on the explorer" + cite); soft(8); }
        else { add(45); flags.push(line); }
      } else if (f.severity === "high") {
        if (disarmed) { soft(6); warnings.push(line + (s.ownerRenounced ? " (ownership renounced - the switch has no hand on it)" : "")); }
        else { add(20); warnings.push(line); }
      } else if (f.severity === "medium") { soft(8); warnings.push(line); }
    }
    if (!code.flags.some((f) => f.severity === "critical" || f.severity === "high"))
      positives.push("No dangerous patterns in the source - no hidden mint, balance rewrite, or trading kill-switch found");
  } else if (code.checked && EVM(d.chain)) {
    soft(15);
    warnings.push("UNVERIFIED contract - the source is hidden, so nobody can read what the code really does");
  }

  // --- taxes: the % AND what the tax DOES ---
  // A tax is not automatically bad. Reflections, buyback-burn, and the new
  // real-world-asset/stock distribution pattern are legitimate - even attractive -
  // mechanisms. Read the destination, weigh the percentage against it.
  const rwaTax = tk.tax.destinations.includes("rwa-distribution");
  if (s.sellTax >= 40) { add(40); flags.push(`Sell tax is ${s.sellTax.toFixed(0)}% - a toll booth on the exit`); }
  else if (s.sellTax >= 15 && !rwaTax) { add(20); warnings.push(`Sell tax is ${s.sellTax.toFixed(0)}% - you lose a real cut on every exit`); }
  else if (s.sellTax >= 15 && rwaTax) { soft(8); warnings.push(`Sell tax is ${s.sellTax.toFixed(0)}%, but it funds real-world-asset distribution to holders - weigh the yield against the exit cost`); }
  if (tk.tax.destinations.length) {
    if (rwaTax) positives.push(`Tax → real-world assets: the transfer tax buys stocks/RWAs and distributes them to holders - a yield mechanism, not a rug tax`);
    else if (tk.tax.destinations.includes("reflection")) positives.push(`Tax → reflections: holders earn a share of every taxed transfer`);
    else if (tk.tax.destinations.includes("buyback-burn")) positives.push(`Tax → buyback & burn: collected tax is used to buy back and burn supply`);
    else warnings.push(tk.tax.note);
  } else if (s.available && s.buyTax + s.sellTax > 0 && s.sellTax < 15) warnings.push(`Taxes: buy ${s.buyTax.toFixed(1)}% / sell ${s.sellTax.toFixed(1)}%${d.chain === "solana" ? "" : " (destination not readable from the code)"}`);
  else if (s.available && d.chain !== "solana" && s.buyTax + s.sellTax === 0) positives.push(`No buy or sell tax`);
  if (s.simChecked && !s.honeypot) positives.push("Sell simulation PASSED - a real sell went through");

  // --- liquidity: pool separated, launchpad-lock aware ---
  // Launch provenance can PROVE LP custody where the generic tools read
  // "unconfirmed": a graduated pump.fun/bonk.fun pool is protocol-owned or
  // burned BY THE PLATFORM'S MECHANICS, and an on-curve token has no LP at all
  // yet (the curve contract is the market). That proof overrides the naive
  // "treat as removable" read.
  const launchLpSecured = launch != null
    && (launch.lpDisposition === "burned" || launch.lpDisposition === "protocol-owned" || launch.lpDisposition === "locked")
    && launch.lpNote != null;
  const liq = d.liquidityUsd ?? 0;
  if (s.available) {
    switch (tk.lp.status) {
      case "burned": positives.push(`LP burned ${tk.lp.burnedPct.toFixed(0)}% - the pool can never be pulled`); break;
      case "locked": positives.push(`LP locked ${tk.lp.lockedPct.toFixed(0)}%${tk.lp.lockers.length ? ` (${tk.lp.lockers.join(", ")})` : ""}`); break;
      case "launchpad-locked": positives.push(tk.lp.note); break; // "held by a launchpad locker - auto-locked by design"
      case "nft-position":
        // Concentrated / NFT-position AMM (V3/V4/CLMM). Not a rug signal on its
        // own - it's how these pools work. Surface it as context, not a warning.
        warnings.push(tk.lp.note);
        break;
      case "unlocked":
        if (launchLpSecured) { positives.push(`${launch!.venue}: ${launch!.lpNote}`); break; }
        if (tk.lp.unlockedTopPct >= 80) { add(35); flags.push(`${tk.lp.unlockedTopPct.toFixed(0)}% of the liquidity sits in ONE unlocked wallet - it can be pulled at any moment`); }
        else { add(20); warnings.push(`Most of the liquidity (${tk.lp.unlockedTopPct.toFixed(0)}%) is in one unlocked wallet - treat the pool as removable`); }
        break;
      case "unconfirmed":
        if (launchLpSecured) { positives.push(`${launch!.venue}: ${launch!.lpNote}`); break; }
        if (launch?.onCurve) { warnings.push(`Still on the ${launch.venue ?? "launchpad"} bonding curve${launch.curveProgressPct != null ? ` (${launch.curveProgressPct.toFixed(0)}% to graduation)` : ""} - liquidity lives in the curve contract (no LP to pull), but most curve tokens never graduate`); break; }
        // Don't assert "removable" as fact - on early launchpad chains the lock
        // may be real but not surface here.
        if (!established) soft(10);
        warnings.push(tk.lp.note);
        break;
    }
  }
  // Launch-context signals beyond LP custody: creator-fee behavior and the
  // launch-block snipe read.
  if (launch?.creatorFees) {
    const cf = launch.creatorFees;
    if (cf.usage === "buyback-burn" || cf.usage === "lp-add") {
      positives.push(`Creator claims ${launch.venue} fees and ${cf.usage === "lp-add" ? "adds them to the LP" : "buys back and burns the token"} - fee revenue is recycled into the market. ${cf.note}`);
    } else if (cf.usage === "buyback") {
      positives.push(`Creator claims ${launch.venue} fees and buys the token back. ${cf.note}`);
    } else if (cf.usage === "dump" && !established) {
      soft(8); warnings.push(`Creator claims ${launch.venue} fee revenue and sells it - fees are an income stream, not a reinvestment. ${cf.note}`);
    }
  }
  if (launch?.snipe && !established && !migration?.isPostMigrationToken) {
    const sn = launch.snipe;
    if (sn.sameBlockBuyers >= 4 || (sn.pctOfSupply ?? 0) >= 20) {
      add(15); flags.push(`Launch-block snipe: ${sn.sameBlockBuyers} wallets bought in the deploy block${sn.pctOfSupply != null ? `, taking ~${sn.pctOfSupply.toFixed(0)}% of supply` : ""} (${sn.window}) - a coordinated entry at t=0`);
    } else if (sn.sameBlockBuyers > 0) {
      warnings.push(`${sn.sameBlockBuyers} wallet${sn.sameBlockBuyers === 1 ? "" : "s"} bought in the launch block (${sn.window}) - some sniping, below the coordination threshold`);
    }
  }
  if (launch?.quoteNote) warnings.push(launch.quoteNote);
  // Thin-liquidity flag, cross-chain aware: an OFT's liquidity is spread across
  // chains, so judge it by the total mesh liquidity, not the single-chain pool.
  const oftTotal = xchain?.isOft ? xchain.totalLiquidityUsd : 0;
  const effectiveLiq = Math.max(liq, oftTotal);
  if (xchain?.isOft) {
    const chains = xchain.legs.map((l) => l.chain).join(", ");
    positives.push(`LayerZero OFT - one asset bridged across ${xchain.legs.length} chain${xchain.legs.length === 1 ? "" : "s"} (${chains})${xchain.resolvedLegs > 1 ? `, ~${money(oftTotal)} total liquidity across the mesh` : ""}. Single-chain liquidity understates the real depth.`);
  }
  if (effectiveLiq < 15000) { add(10); warnings.push(`Thin liquidity (${money(effectiveLiq)}${xchain?.isOft ? " across all chains" : ""}) - easy to drain, brutal to exit`); }

  // --- burns ---
  if (tk.burn.burnedSupplyPct >= 1 || tk.burn.hasAutoBurn || tk.burn.ongoing) positives.push(tk.burn.note);

  // --- holders: the POOL and reward contracts are excluded first ---
  if (tk.pools.length) positives.push(`${tk.pools.length} liquidity pool${tk.pools.length === 1 ? "" : "s"} identified and set aside - not counted as holder concentration`);
  if (tk.rewardPools.length) positives.push(`${tk.rewardPools.length} reward/emission pool${tk.rewardPools.length === 1 ? "" : "s"} identified and set aside from holder concentration`);
  // Prefer the pool-excluded top-holder figure; fall back to the base audit's.
  const realTop = tk.realHolderTopPct > 0 ? tk.realHolderTopPct : s.topHolderPct;
  // #5 - distribution vs bundle. A coordinated bundle/snipe = wallets seeded by a
  // COMMON FUNDER buying together. A claim/airdrop/MIGRATION distribution (e.g. a
  // Migrate.fun claim: independent depositors each claiming their new token from a
  // program vault, over time) spreads supply across many wallets that do NOT share
  // a funder - and naively reads as a bundle. On Solana we require RugCheck's
  // common-funder insider proof before calling concentration a "bundle"; without
  // it, we flag it as a distribution and prompt the migration check, rather than
  // falsely branding it a coordinated launch.
  const sol = d.chain === "solana";
  const isMigrationClaim = !!migration?.isPostMigrationToken;
  // A confirmed Migrate.fun migration means the spread IS the claim distribution.
  // Otherwise, on Solana require RugCheck's common-funder proof before calling it
  // a bundle.
  const bundleProven = !sol || (!isMigrationClaim && rc != null && rc.insidersDetected > 0);
  if (d.bundleRisk === "high" && !established && bundleProven) { add(25); flags.push(`${d.insiderPct}% of supply sits in ${d.bundleCount} fresh wallets (pools excluded) - a bundled launch or coordinated snipe`); }
  else if (d.bundleRisk === "high" && !established && isMigrationClaim) { positives.push(`${d.insiderPct}% of supply across ${d.bundleCount} wallets is the Migrate.fun claim distribution to the original holders - expected after a migration, not a coordinated bundle.`); }
  else if (d.bundleRisk === "high" && !established && sol) { soft(10); warnings.push(`${d.insiderPct}% of supply is spread across ${d.bundleCount} wallets, but they don't share a common funder - likely a DISTRIBUTION (airdrop / migration claim), not a coordinated bundle. If the token migrated (e.g. via Migrate.fun) the contract is new and the chart restarted; judge age and holders on that basis.`); }
  else if (d.bundleRisk !== "low") { soft(12); warnings.push(`${d.insiderPct}% of supply is concentrated in ${d.bundleCount} non-contract wallets (pools excluded)`); }
  if (realTop != null && realTop > 50 && !established) { add(25); flags.push(`One non-pool wallet holds ${realTop.toFixed(0)}% of the supply - they ARE the market`); }
  else if (realTop != null && realTop > 25) { soft(12); warnings.push(`Top non-pool holder owns ${realTop.toFixed(0)}% of supply`); }
  if (s.creatorPercent >= 15) { add(12); warnings.push(`The creator still holds ~${s.creatorPercent.toFixed(0)}% of supply`); }
  if (s.holderCount >= 5000) positives.push(`${s.holderCount.toLocaleString()} holders - distribution is real`);

  // --- market conduct ---
  if (d.findings.some((f) => /wash-trading|wash-trade/i.test(f.claim))) { add(25); flags.push("Volume churns without moving the price - a WASH-TRADING signature, the activity is manufactured"); }
  if ((d.priceChange?.h24 ?? 0) <= -60) { add(20); warnings.push(`Down ${Math.abs(d.priceChange!.h24!).toFixed(0)}% in 24h - the dump may already have happened`); }
  // A post-migration token's pair is freshly created by design (the chart
  // restarted at migration) - don't penalize the young age or read it as a
  // fresh-launch rug. Note the migration and skip the age penalty.
  if (migration?.migrated) {
    positives.push(migration.note);
  }
  if (!migration?.isPostMigrationToken) {
    if (d.ageDays != null && d.ageDays < 1) { add(10); warnings.push("Pair created <24h ago - no history to judge, maximum uncertainty"); }
    else if (d.ageDays != null && d.ageDays < 7) { add(6); warnings.push(`Pair is ${Math.round(d.ageDays)} day${Math.round(d.ageDays) === 1 ? "" : "s"} old`); }
  }

  // --- corroboration positives ---
  if (d.cg?.listed) positives.push(`Listed on CoinGecko${d.cg.rank ? ` (rank #${d.cg.rank})` : ""}${d.cg.cexCount ? `, ${d.cg.cexCount} CEX market${d.cg.cexCount === 1 ? "" : "s"}` : ""}`);
  if (s.ownerRenounced && !s.mintable && !s.freezable && !s.takeBack)
    positives.push(d.chain === "solana" ? "Mint and freeze authority revoked - the token is set in stone" : "Ownership renounced - no owner powers remain");

  // --- verdict ---
  risk = trap ? 100 : Math.min(100, Math.round(risk));
  const unknown = !s.available && !code.verified;
  // RUG is reserved for a CONFIRMED trap (honeypot-class or already rugged);
  // everything else, however dark, is DANGER - a claim we can defend.
  const verdict: ThreatVerdict = trap ? "RUG" : unknown ? "UNKNOWN" : risk >= 40 ? "DANGER" : risk >= 16 ? "CAUTION" : "SAFE";
  const action =
    verdict === "RUG" ? "DON'T TOUCH IT"
    : verdict === "DANGER" ? "Walk away - the trap doors outnumber the exits"
    : verdict === "CAUTION" ? "Tradeable, but size it like it can go to zero"
    : verdict === "UNKNOWN" ? "Could not verify - treat unverifiable as hostile"
    : "No mechanical red flags (not financial advice)";

  return { verdict, risk, action, flags, warnings, positives };
}

const EVM = (chain: string) => chain !== "solana";

// ---- the transparent checklist: what was examined, including clean results ----
function buildChecks(
  d: TokenDossier, code: CodeReview, dep: DeployerRep,
  rc: RugcheckReport | null, hp: HoneypotDeep | null, meta: GoPlusMeta | null,
  tk: TokenomicsView, launch: LaunchProvenance | null,
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
      na ? "na" : tk.lp.status === "burned" || tk.lp.status === "locked" || tk.lp.status === "launchpad-locked" ? "pass" : tk.lp.status === "unlocked" ? "fail" : tk.lp.status === "nft-position" || established ? "pass" : "warn",
      na ? "Unchecked"
        : tk.lp.status === "burned" ? `${tk.lp.burnedPct.toFixed(0)}% burned`
        : tk.lp.status === "locked" ? `${tk.lp.lockedPct.toFixed(0)}% secured${tk.lp.lockers.length ? ` (${tk.lp.lockers.join(", ")})` : ""}`
        : tk.lp.status === "launchpad-locked" ? `Launchpad-locked${tk.lp.lockers.length ? ` (${tk.lp.lockers.join(", ")})` : ""}`
        : tk.lp.status === "nft-position" ? "Concentrated/NFT position - LP-token check n/a"
        : tk.lp.status === "unlocked" ? `Pullable - ${tk.lp.unlockedTopPct.toFixed(0)}% in one wallet`
        : "Lock not confirmed by standard tools (may be launchpad-locked)"),
    chk("launch", "market", "Launch provenance",
      launch == null || launch.kind === "unknown" ? "na"
        : launch.snipe && launch.snipe.sameBlockBuyers >= 4 ? "warn"
        : launch.creatorFees?.usage === "dump" ? "warn"
        : "pass",
      launch == null || launch.kind === "unknown" ? "Venue not identified"
        : launch.kind === "fair-launch" ? `Fair launch - listed directly on ${d.dexId}${launch.quote ? ` vs ${launch.quote}` : ""}`
        : `${launch.venue}${launch.onCurve ? ` - on curve${launch.curveProgressPct != null ? ` (${launch.curveProgressPct.toFixed(0)}%)` : ""}` : launch.graduated ? " - graduated" : ""}${launch.quote ? ` · bonded to ${launch.quote}` : ""}${launch.creatorFees && launch.creatorFees.usage !== "unknown" ? ` · creator fees: ${launch.creatorFees.usage}` : ""}`),
    chk("tax", "market", "Buy/sell tax & destination",
      na ? "na" : s.sellTax >= 15 && !tk.tax.destinations.includes("rwa-distribution") ? "fail" : tk.tax.tone === "good" ? "pass" : s.sellTax > 5 ? "warn" : "pass",
      na ? "Unchecked" : tk.tax.note),
    chk("burn", "market", "Burn",
      tk.burn.burnedSupplyPct >= 1 || tk.burn.hasAutoBurn ? "pass" : "na",
      tk.burn.note),
    chk("holders", "holders", "Holder concentration (pools excluded)",
      na ? "na" : (d.bundleRisk === "high" || (tk.realHolderTopPct) > 50 || (rc?.insiderPct ?? 0) >= 25) && !established ? "fail" : d.bundleRisk !== "low" || tk.realHolderTopPct > 25 || (rc?.insiderPct ?? 0) >= 10 ? "warn" : "pass",
      na ? "Unchecked" : `${s.holderCount.toLocaleString()} holders, top non-pool ${tk.realHolderTopPct.toFixed(0)}%${tk.pools.length ? `, ${tk.pools.length} pool(s) set aside` : ""}${rc?.insidersDetected ? `, insider net ${rc.insiderPct}%` : ""}`),
    chk("authenticity", "authority", "Authenticity",
      meta == null ? "na" : meta.fakeToken || meta.airdropScam ? "fail" : meta.trustListed ? "pass" : "pass",
      meta == null ? (sol ? "n/a on Solana" : "Unchecked") : meta.fakeToken ? "Counterfeit of an established token" : meta.airdropScam ? "Airdrop-scam pattern" : meta.trustListed ? "On GoPlus trust list" : "No counterfeit signal"),
    chk("deployer", "deployer", "Deployer history",
      s.serialScammerCreator || dep.priorRugs > 0 ? "fail" : dep.address ? "pass" : "na",
      s.serialScammerCreator ? "Has shipped honeypots before" : dep.priorRugs > 0 ? `${dep.priorRugs} flagged tokens in ledger` : dep.address ? "No adverse history found" : "Deployer not resolvable"),
    chk("code", "code", "Source code read",
      !code.checked ? "na" : code.verified ? (code.flags.some((f) => f.severity === "critical") ? "fail" : code.flags.some((f) => f.severity === "high") ? "warn" : "pass") : "warn",
      !code.checked ? (sol ? "SPL - standard program, no per-token code" : "Not checked") : code.verified ? `${code.stats?.functions ?? 0} functions read, ${code.flags.length} flag${code.flags.length === 1 ? "" : "s"}` : "Source unverified - unreadable"),
    chk("market", "market", "Market conduct",
      d.findings.some((f) => /wash-trad/i.test(f.claim)) ? "fail" : (d.liquidityUsd ?? 0) < 15000 ? "warn" : "pass",
      d.findings.some((f) => /wash-trad/i.test(f.claim)) ? "Wash-trading signature" : `${money(d.liquidityUsd ?? 0)} liquidity, ${money(d.vol24 ?? 0)} 24h volume`),
  ];
}
