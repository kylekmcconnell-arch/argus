import type { TokenDossier } from "../token/audit";

// The checklist is an evidence-coverage view, not a promise about work that may
// have happened in a lazily mounted report panel. A status is only successful
// when the finished dossier contains an observable outcome for that check.
export type CheckStatus =
  | "confirmed"       // completed with a confirmed, non-empty result
  | "finding"         // completed and surfaced a concern
  | "checked-empty"   // completed with an explicit empty / not-found response
  | "not-applicable"  // the check does not apply to this subject
  | "unknown"         // no completion outcome is present (not run is possible)
  | "unavailable"     // a required provider / coverage path was unavailable
  | "stale";          // a completion exists, but is outside its freshness window

export interface ScanCheck {
  label: string;
  status: CheckStatus;
  note?: string;
  // Frozen server-collected checks carry stable provenance fields. They remain
  // optional so older fixtures and locally derived token checklists continue to
  // deserialize without a migration.
  checkId?: string;
  provider?: string;
  sourceCount?: number;
  completedAt?: string;
}

export interface CoverageSummary {
  total: number;
  inScope: number;
  successful: number;
  unknownOrFailed: number;
  findings: number;
  checkedEmpty: number;
  notApplicable: number;
  unavailable: number;
  stale: number;
  unknown: number;
}

const SUCCESSFUL = new Set<CheckStatus>(["confirmed", "finding", "checked-empty"]);
const UNKNOWN_OR_FAILED = new Set<CheckStatus>(["unknown", "unavailable", "stale"]);

/** Summarize execution coverage separately from what the checks found. */
export function summarizeChecks(checks: readonly ScanCheck[]): CoverageSummary {
  const count = (status: CheckStatus) => checks.filter((check) => check.status === status).length;
  const notApplicable = count("not-applicable");

  return {
    total: checks.length,
    inScope: checks.length - notApplicable,
    successful: checks.filter((check) => SUCCESSFUL.has(check.status)).length,
    unknownOrFailed: checks.filter((check) => UNKNOWN_OR_FAILED.has(check.status)).length,
    findings: count("finding"),
    checkedEmpty: count("checked-empty"),
    notApplicable,
    unavailable: count("unavailable"),
    stale: count("stale"),
    unknown: count("unknown"),
  };
}

const shortAddr = (address: string) =>
  address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;

function contractSafetyConcerns(dossier: TokenDossier): string[] {
  const safety = dossier.safety;
  const concerns: string[] = [];
  if (safety.serialScammerCreator) concerns.push("prior honeypots by creator");
  if (safety.honeypot || safety.honeypotOnchain) concerns.push("honeypot indicator");
  if (safety.nonTransferable || safety.cannotSellAll) concerns.push("transfer restriction");
  if (safety.mintable) concerns.push("mint authority active");
  if (safety.freezable) concerns.push("freeze authority active");
  if (!safety.ownerRenounced) concerns.push(dossier.chain === "solana" ? "authorities retained" : "owner active");
  if (safety.hiddenOwner || safety.takeBack) concerns.push("owner-control risk");
  if (dossier.chain !== "solana" && !safety.openSource) concerns.push("source not verified");
  if (safety.selfdestruct) concerns.push("contract can self-destruct/close");
  if (safety.pausable) concerns.push("transfers can be paused");
  if (safety.proxy) concerns.push("upgradeable proxy");
  if (safety.metadataMutable) concerns.push("metadata mutable");
  if (safety.balanceMutable || safety.ownerChangeBalance) concerns.push("balances can be changed");
  if (safety.transferHook || safety.transferFee) concerns.push("programmable transfer controls");
  if (safety.slippageModifiable) concerns.push("tax/slippage modifiable");
  if (safety.blacklist || safety.tradingCooldown) concerns.push("wallet/trading restrictions");
  if (safety.externalCall) concerns.push("external calls enabled");
  return concerns;
}

function contractSafetyNote(dossier: TokenDossier): string {
  const concerns = contractSafetyConcerns(dossier);
  if (concerns.length) return concerns.slice(0, 3).join(" · ");
  return "provider response recorded; no surfaced contract-control concern";
}

const outcomeNotRecorded = "completion outcome not recorded";

// ── Token / investigation ────────────────────────────────────────────────
export function tokenChecks(dossier: TokenDossier): ScanCheck[] {
  const evm = dossier.chain !== "solana";
  const safety = dossier.safety;
  const checks: ScanCheck[] = [];

  checks.push(
    safety.available
      ? {
          label: "Contract safety",
          status: contractSafetyConcerns(dossier).length ? "finding" : "confirmed",
          note: contractSafetyNote(dossier),
        }
      : {
          label: "Contract safety",
          status: "unavailable",
          note: `no contract-safety provider response recorded for ${dossier.chain}`,
        },
  );

  checks.push(
    safety.simChecked
      ? {
          label: "Buy/sell simulation",
          status: safety.honeypot || safety.cannotSellAll ? "finding" : "confirmed",
          note: `buy ${safety.buyTax}% · sell ${safety.sellTax}%`,
        }
      : evm
        ? { label: "Buy/sell simulation", status: "unknown", note: outcomeNotRecorded }
        : { label: "Buy/sell simulation", status: "not-applicable", note: "Solana — static flags only" },
  );

  const holderCount = safety.holderCount || dossier.topHolders.length;
  const topHolderPct = safety.topHolderPct ?? dossier.topHolders[0]?.percent ?? null;
  checks.push(
    holderCount > 0
      ? {
          label: "Holder distribution",
          status: (topHolderPct ?? 0) > 50 ? "finding" : "confirmed",
          note: `${holderCount.toLocaleString()} holder${holderCount === 1 ? "" : "s"} · top ${topHolderPct == null ? "unknown" : `${Math.round(topHolderPct)}%`}`,
        }
      : safety.available
        ? { label: "Holder distribution", status: "unknown", note: "safety data returned, but no holder-query outcome was recorded" }
        : { label: "Holder distribution", status: "unavailable", note: "holder provider response unavailable" },
  );

  const hasHolderRows = dossier.topHolders.length > 0;
  const hasClusteringOutcome = hasHolderRows && (
    dossier.bundleRisk === "elevated"
    || dossier.bundleRisk === "high"
    || dossier.bundleCount > 0
    || dossier.insiderPct > 0
  );
  checks.push(
    hasClusteringOutcome
      ? {
          label: "Wallet clustering",
          status: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" ? "finding" : "confirmed",
          note: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high"
            ? `${dossier.bundleCount} concentrated wallets · ~${Math.round(dossier.insiderPct)}% (${dossier.bundleRisk} risk)`
            : "holder rows analyzed; no elevated concentration surfaced",
        }
      : hasHolderRows
        ? { label: "Wallet clustering", status: "unknown", note: "holder rows exist, but clustering completion/reliability is not recorded" }
      : safety.available
        ? { label: "Wallet clustering", status: "unknown", note: "no holder rows available to establish a clustering result" }
        : { label: "Wallet clustering", status: "unavailable", note: "requires holder-provider data" },
  );

  // Resolving an address is not evidence that its funding trail was chased.
  checks.push({
    label: "Operator / funding trace",
    status: "unknown",
    note: dossier.deployer
      ? `deployer ${shortAddr(dossier.deployer)} resolved; trace ${outcomeNotRecorded}`
      : `deployer unresolved; trace ${outcomeNotRecorded}`,
  });

  // These checks execute in report-page panels today. Their outcomes are not
  // represented in TokenDossier, so mounting the panel must not become "ran".
  checks.push(evm
    ? { label: "Deployer trail (EVM)", status: "unknown", note: outcomeNotRecorded }
    : { label: "Deployer trail (EVM)", status: "not-applicable", note: "Solana" });
  checks.push(evm
    ? { label: "Bytecode fingerprint (EVM)", status: "unknown", note: `redeployed-rug clone check; ${outcomeNotRecorded}` }
    : { label: "Bytecode fingerprint", status: "not-applicable", note: "Solana" });

  checks.push(
    dossier.cg?.listed
      ? {
          label: "Market intelligence",
          status: dossier.cg.cexCount > 0 ? "confirmed" : "finding",
          note: `CoinGecko listing · ${dossier.cg.cexCount} CEX listing${dossier.cg.cexCount === 1 ? "" : "s"}${dossier.cg.rank ? ` · rank #${dossier.cg.rank}` : ""}`,
        }
      : dossier.cg
        ? { label: "Market intelligence", status: "checked-empty", note: "CoinGecko returned no matching asset" }
        : { label: "Market intelligence", status: "unknown", note: outcomeNotRecorded },
  );

  checks.push({ label: "OFAC sanctions screen", status: "unknown", note: `deployer + top holders; ${outcomeNotRecorded}` });
  checks.push({ label: "Documents & audits", status: "unknown", note: `whitepaper, security audits, docs; ${outcomeNotRecorded}` });
  checks.push({ label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push({ label: "GitHub forensics", status: "unknown", note: `when a repo/org is linked; ${outcomeNotRecorded}` });
  checks.push({ label: "Trust-graph reconciliation", status: "unknown", note: `shared deployers/funders with flagged subjects; ${outcomeNotRecorded}` });

  return checks;
}

// ── Person ─────────────────────────────────────────────────────────────
export function personChecks(opts: {
  identityConfidence?: string;
  realName?: boolean;
  roles: string[];
  hasAssociates: boolean;
}): ScanCheck[] {
  const { identityConfidence, realName, roles, hasAssociates } = opts;
  const resolved = identityConfidence === "Confirmed" || identityConfidence === "Probable";
  const checks: ScanCheck[] = [];

  checks.push(
    identityConfidence === "Confirmed"
      ? { label: "Identity resolution", status: "confirmed", note: "confirmed confidence" }
      : identityConfidence
        ? { label: "Identity resolution", status: "finding", note: `${identityConfidence.toLowerCase()} confidence` }
        : { label: "Identity resolution", status: "unknown", note: outcomeNotRecorded },
  );

  checks.push({ label: "Profile-photo authenticity", status: "unknown", note: `AI / stock / celebrity / logo; ${outcomeNotRecorded}` });
  checks.push({ label: "Code footprint (GitHub)", status: "unknown", note: `resolved from handle / name / bio; ${outcomeNotRecorded}` });
  checks.push({ label: "Identity continuity", status: "unknown", note: `prior handles, cross-platform accounts; ${outcomeNotRecorded}` });
  checks.push(hasAssociates
    ? { label: "Affiliations & associates", status: "confirmed", note: "associate records present in the dossier" }
    : { label: "Affiliations & associates", status: "unknown", note: "no collection outcome recorded; an empty dossier is not a confirmed clean result" });

  checks.push(roles.includes("KOL")
    ? { label: "Promoted-token performance", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` }
    : { label: "Promoted-token performance", status: "not-applicable", note: "not a KOL" });
  checks.push(roles.includes("INVESTOR")
    ? { label: "Portfolio track record", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` }
    : { label: "Portfolio track record", status: "not-applicable", note: "not a fund/investor" });

  checks.push({ label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(resolved && realName
    ? { label: "US legal history", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` }
    : { label: "US legal history", status: "not-applicable", note: "needs a resolved real name" });
  checks.push(resolved && realName
    ? { label: "OFAC sanctions (name)", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` }
    : { label: "OFAC sanctions (name)", status: "not-applicable", note: "needs a resolved real name" });
  checks.push({ label: "Trust-graph connections", status: "unknown", note: `ties to other audited subjects; ${outcomeNotRecorded}` });

  return checks;
}
