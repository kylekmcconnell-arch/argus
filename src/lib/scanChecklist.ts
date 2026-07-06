import type { TokenDossier } from "../token/audit";

// Enigma's ask: ARGUS should output the list of what it checks and how, so the
// analyst sees exactly what ran, what was skipped (and why), and what couldn't be
// verified. These builders derive that checklist from the finished dossier — the
// status is the REAL outcome, not a fixed script, so a Solana token honestly shows
// the EVM-only checks as skipped, a keyless scan shows contract safety as
// unavailable, and a token with no press shows the news check as "nothing found".

export type CheckStatus =
  | "pass"   // ran, clean / found what it looked for
  | "flag"   // ran, surfaced a concern
  | "empty"  // ran, nothing found (itself often a signal)
  | "skip"   // not applicable to this subject (chain / role)
  | "na"     // could not run (needs a key, or a coverage gap)
  | "run";   // performed — the result is in its own section below

export interface ScanCheck { label: string; status: CheckStatus; note?: string }

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

// ── Token / investigation ────────────────────────────────────────────────
export function tokenChecks(d: TokenDossier): ScanCheck[] {
  const evm = d.chain !== "solana";
  const s = d.safety;
  const checks: ScanCheck[] = [];

  checks.push(
    s.available
      ? {
          label: "Contract safety",
          status: s.honeypot || s.honeypotOnchain || s.serialScammerCreator || s.nonTransferable || s.cannotSellAll ? "flag" : "pass",
          note: s.serialScammerCreator ? "deployer has shipped honeypots before"
            : s.honeypot || s.honeypotOnchain ? "honeypot indicators"
            : s.nonTransferable || s.cannotSellAll ? "transfer restrictions"
            : `open-source ${s.openSource ? "✓" : "✗"}, mint ${s.mintable ? "active" : "none"}, owner ${s.ownerRenounced ? "renounced" : s.hiddenOwner ? "hidden" : "present"}`,
        }
      : { label: "Contract safety", status: "na", note: `keyless safety unavailable on ${d.chain} — add a Helius/Bitquery key` },
  );

  checks.push(
    s.simChecked
      ? { label: "Buy/sell simulation", status: s.honeypot ? "flag" : "pass", note: `buy ${s.buyTax}% · sell ${s.sellTax}%` }
      : evm
        ? { label: "Buy/sell simulation", status: "na", note: "not simulated" }
        : { label: "Buy/sell simulation", status: "skip", note: "Solana — static flags only" },
  );

  const holders = s.holderCount || d.topHolders.length;
  checks.push(
    holders
      ? { label: "Holder distribution", status: (s.topHolderPct ?? 0) > 50 ? "flag" : "pass", note: `${(s.holderCount || d.topHolders.length).toLocaleString()} holders · top ${d.topHolders[0] ? Math.round(d.topHolders[0].percent) + "%" : "n/a"}` }
      : { label: "Holder distribution", status: "empty", note: "holder data unavailable" },
  );

  checks.push({
    label: "Wallet clustering",
    status: d.insiderPct > 0 || d.bundleCount > 0 ? "flag" : "pass",
    note: d.bundleCount > 0 ? `${d.bundleCount} bundled buys (${d.bundleRisk} risk)` : d.insiderPct > 0 ? `${Math.round(d.insiderPct)}% in one insider cluster` : "no single-hand clusters",
  });

  checks.push(
    d.deployer
      ? { label: "Operator / funding trace", status: "pass", note: `deployer ${shortAddr(d.deployer)} — funding chased` }
      : { label: "Operator / funding trace", status: "empty", note: "deployer not resolved" },
  );

  checks.push(evm ? { label: "Deployer trail (EVM)", status: "run" } : { label: "Deployer trail (EVM)", status: "skip", note: "Solana" });
  checks.push(evm ? { label: "Bytecode fingerprint (EVM)", status: "run", note: "redeployed-rug clone check" } : { label: "Bytecode fingerprint", status: "skip", note: "Solana" });

  checks.push(
    d.cg
      ? { label: "Market intelligence", status: "pass", note: `${d.cg.cexCount} CEX listing${d.cg.cexCount === 1 ? "" : "s"}${d.cg.rank ? ` · rank #${d.cg.rank}` : ""}` }
      : { label: "Market intelligence", status: "empty", note: "not on CoinGecko (DEX-only)" },
  );

  checks.push({ label: "OFAC sanctions screen", status: "run", note: "deployer + top holders" });
  checks.push({ label: "Documents & audits", status: "run", note: "whitepaper, security audits, docs" });
  checks.push({ label: "News & press", status: "run" });
  checks.push({ label: "GitHub forensics", status: "run", note: "when a repo/org is linked" });
  checks.push({ label: "Trust-graph reconciliation", status: "run", note: "shared deployers/funders with flagged subjects" });

  return checks;
}

// ── Person ───────────────────────────────────────────────────────────────
export function personChecks(opts: {
  identityConfidence?: string;
  realName?: boolean;
  roles: string[];
  hasAssociates: boolean;
}): ScanCheck[] {
  const { identityConfidence, realName, roles, hasAssociates } = opts;
  const resolved = identityConfidence === "Confirmed" || identityConfidence === "Probable";
  const checks: ScanCheck[] = [];

  checks.push({
    label: "Identity resolution",
    status: identityConfidence === "Confirmed" ? "pass" : identityConfidence === "Probable" ? "pass" : "flag",
    note: identityConfidence ? `${identityConfidence.toLowerCase()} confidence` : "unresolved",
  });
  checks.push({ label: "Profile-photo authenticity", status: "run", note: "AI / stock / celebrity / logo" });
  checks.push({ label: "Code footprint (GitHub)", status: "run", note: "resolved from handle / name / bio" });
  checks.push({ label: "Identity continuity", status: "run", note: "prior handles, cross-platform accounts" });
  checks.push(hasAssociates ? { label: "Affiliations & associates", status: "pass", note: "serial-project web" } : { label: "Affiliations & associates", status: "empty", note: "none surfaced" });
  checks.push(roles.includes("KOL") ? { label: "Promoted-token performance", status: "run", note: "post-call peak grading + reach authenticity" } : { label: "Promoted-token performance", status: "skip", note: "not a KOL" });
  checks.push(roles.includes("INVESTOR") ? { label: "VC portfolio track record", status: "run" } : { label: "VC portfolio track record", status: "skip", note: "not a fund" });
  checks.push({ label: "News & press", status: "run" });
  checks.push(resolved && realName ? { label: "US legal history", status: "run", note: "CourtListener litigation / enforcement" } : { label: "US legal history", status: "skip", note: "needs a resolved real name" });
  checks.push(resolved && realName ? { label: "OFAC sanctions (name)", status: "run" } : { label: "OFAC sanctions (name)", status: "skip", note: "needs a resolved real name" });
  checks.push({ label: "Trust-graph connections", status: "run", note: "ties to other audited subjects" });

  return checks;
}
