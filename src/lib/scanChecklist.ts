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
  /**
   * Whether this outcome answers a decision-critical diligence question.
   *
   * Provider diagnostics and enrichment paths still belong in the methodology
   * ledger, but they must not be allowed to make an otherwise answered case
   * look incomplete. Older frozen reports omit this field; for those reports
   * every applicable check remains decision-critical for backwards
   * compatibility.
   */
  decisionCritical?: boolean;
  // Frozen server-collected checks carry stable provenance fields. They remain
  // optional so older fixtures and locally derived token checklists continue to
  // deserialize without a migration.
  checkId?: string;
  provider?: string;
  sourceCount?: number;
  completedAt?: string;
}

/**
 * Select the checks that govern the public decision-readiness label.
 *
 * A new checklist snapshot marks every row explicitly. A legacy snapshot has
 * no markers at all and therefore keeps its historical all-check semantics.
 */
export function decisionCriticalChecks(checks: readonly ScanCheck[]): readonly ScanCheck[] {
  const hasExplicitCriticality = checks.some((check) => check.decisionCritical !== undefined);
  return hasExplicitCriticality
    ? checks.filter((check) => check.decisionCritical === true)
    : checks;
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
// Some checks record their honest null as a substantive "finding" (so the axis
// they feed is covered and scores low) even though an absent POSITIVE signal is
// never counter-evidence. The founder repeat-backing assessment is one: "no
// repeat backing on record" must read as a neutral completed outcome, never as an
// adverse finding. Its positive result uses "confirmed", so only its "finding"
// branch is a neutral null.
export const NEUTRAL_NULL_FINDING_CHECK_IDS: ReadonlySet<string> = new Set<string>([
  "founder-repeat-backing",
]);

/** A "finding" that genuinely signals an adverse discovery (not a neutral null). */
export const isAdverseFinding = (check: Pick<ScanCheck, "status" | "checkId">): boolean =>
  check.status === "finding" && !(check.checkId !== undefined && NEUTRAL_NULL_FINDING_CHECK_IDS.has(check.checkId));

export function summarizeChecks(checks: readonly ScanCheck[]): CoverageSummary {
  const count = (status: CheckStatus) => checks.filter((check) => check.status === status).length;
  const notApplicable = count("not-applicable");

  return {
    total: checks.length,
    inScope: checks.length - notApplicable,
    successful: checks.filter((check) => SUCCESSFUL.has(check.status)).length,
    unknownOrFailed: checks.filter((check) => UNKNOWN_OR_FAILED.has(check.status)).length,
    findings: checks.filter(isAdverseFinding).length,
    checkedEmpty: count("checked-empty"),
    notApplicable,
    unavailable: count("unavailable"),
    stale: count("stale"),
    unknown: count("unknown"),
  };
}

/**
 * Full-clearance coverage policy.
 *
 * A recorded outcome for every applicable check is the ideal, but an
 * enrichment path a provider cannot serve must not withhold clearance
 * indefinitely. Clearance instead requires BOTH:
 *   (a) every never-waive safety screen has a recorded outcome, and
 *   (b) recorded coverage meets the clearance floor.
 * Safety screens are never waivable: an unrecorded sanctions, identity, or
 * trust-graph screen always withholds clearance. Legacy snapshots without
 * stable check ids keep the strict everything-recorded rule, preserving
 * historical semantics.
 */
export const NEVER_WAIVE_CHECK_IDS: ReadonlySet<string> = new Set([
  "identity-resolution",
  "ofac-sanctions-name",
  // A sanctioned deployer or holder wallet is a legal-exposure flag no market
  // signal can offset; the address screen is never waivable on token subjects.
  "ofac-sanctions-address",
  "trust-graph-connections",
  // An unresolved token/security candidacy is a capital-risk unknown (the core
  // scam vector), never an enrichment gap.
  "founder-asset-distinction",
]);

/** Minimum recorded share of applicable governing checks for full clearance. */
export const CLEARANCE_COVERAGE_FLOOR_PERCENT = 75;

export interface ClearanceCoverage {
  applicable: number;
  recorded: number;
  /** applicable never-waive screens without a recorded outcome */
  openNeverWaive: string[];
  /** recorded/applicable as a floored percent (never rounds up to the floor) */
  recordedPercent: number;
  /** true when the coverage policy grants full clearance */
  sufficient: boolean;
}

/** Apply the full-clearance coverage policy to a check snapshot. */
export function clearanceCoverage(checks: readonly ScanCheck[]): ClearanceCoverage {
  const governing = decisionCriticalChecks(checks);
  const applicableRows = governing.filter((check) => check.status !== "not-applicable");
  const recordedRows = applicableRows.filter((check) => SUCCESSFUL.has(check.status));
  const hasStableIds = applicableRows.some((check) => typeof check.checkId === "string" && check.checkId);
  const openNeverWaive = hasStableIds
    ? applicableRows
      .filter((check) => check.checkId
        && NEVER_WAIVE_CHECK_IDS.has(check.checkId)
        && !SUCCESSFUL.has(check.status))
      .map((check) => check.checkId as string)
    : [];
  const applicable = applicableRows.length;
  const recorded = recordedRows.length;
  const recordedPercent = applicable > 0 ? Math.floor((recorded / applicable) * 100) : 0;
  const sufficient = applicable > 0 && (hasStableIds
    ? openNeverWaive.length === 0 && recordedPercent >= CLEARANCE_COVERAGE_FLOOR_PERCENT
    : recorded === applicable);
  return { applicable, recorded, openNeverWaive, recordedPercent, sufficient };
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
          checkId: "contract-safety",
          decisionCritical: true,
          label: "Contract safety",
          status: contractSafetyConcerns(dossier).length ? "finding" : "confirmed",
          note: contractSafetyNote(dossier),
        }
      : {
          checkId: "contract-safety",
          decisionCritical: true,
          label: "Contract safety",
          status: "unavailable",
          note: `no contract-safety provider response recorded for ${dossier.chain}`,
        },
  );

  checks.push(
    safety.simChecked
      ? {
          checkId: "buy-sell-simulation",
          decisionCritical: true,
          label: "Buy/sell simulation",
          status: safety.honeypot || safety.cannotSellAll ? "finding" : "confirmed",
          note: `buy ${safety.buyTax}% · sell ${safety.sellTax}%`,
        }
      : evm
        ? { checkId: "buy-sell-simulation", decisionCritical: true, label: "Buy/sell simulation", status: "unknown", note: outcomeNotRecorded }
        : { checkId: "buy-sell-simulation", decisionCritical: true, label: "Buy/sell simulation", status: "not-applicable", note: "Solana: static flags only" },
  );

  const holderCount = safety.holderCount || dossier.topHolders.length;
  const topHolderPct = safety.topHolderPct ?? dossier.topHolders[0]?.percent ?? null;
  checks.push(
    holderCount > 0
      ? {
          checkId: "holder-distribution",
          decisionCritical: true,
          label: "Holder distribution",
          status: (topHolderPct ?? 0) > 50 ? "finding" : "confirmed",
          note: `${holderCount.toLocaleString()} holder${holderCount === 1 ? "" : "s"} · top ${topHolderPct == null ? "unknown" : `${Math.round(topHolderPct)}%`}`,
        }
      : safety.available
        ? { checkId: "holder-distribution", decisionCritical: true, label: "Holder distribution", status: "unknown", note: "safety data returned, but no holder-query outcome was recorded" }
        : { checkId: "holder-distribution", decisionCritical: true, label: "Holder distribution", status: "unavailable", note: "holder provider response unavailable" },
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
          checkId: "wallet-clustering",
          decisionCritical: true,
          label: "Wallet clustering",
          status: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" ? "finding" : "confirmed",
          note: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high"
            ? `${dossier.bundleCount} concentrated wallets · ~${Math.round(dossier.insiderPct)}% (${dossier.bundleRisk} risk)`
            : "holder rows analyzed; no elevated concentration surfaced",
        }
      : hasHolderRows
        ? { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unknown", note: "holder rows exist, but clustering completion/reliability is not recorded" }
      : safety.available
        ? { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unknown", note: "no holder rows available to establish a clustering result" }
        : { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unavailable", note: "requires holder-provider data" },
  );

  // The deployer's funding provenance, traced on Arkham at scan time: backward
  // exposure to a mixer / hacker / sanctioned entity is a finding; a clean trace
  // is a recorded outcome; resolving an address without a trace stays unknown.
  const deployerRisk = dossier.deployerRisk;
  const backwardRisk = deployerRisk?.available
    ? deployerRisk.paths.filter((path) => path.direction === "backward")
    : [];
  checks.push(
    deployerRisk?.available
      ? backwardRisk.length
        ? {
            checkId: "operator-funding-trace",
            decisionCritical: true,
            label: "Operator / funding trace",
            status: "finding",
            note: `Deployer funding traced on Arkham: exposure to ${backwardRisk[0].seedName || backwardRisk[0].category || "a flagged entity"}${backwardRisk[0].hops ? ` (${backwardRisk[0].hops} hop${backwardRisk[0].hops === 1 ? "" : "s"})` : ""}`,
            provider: "arkham",
            completedAt: deployerRisk.completedAt,
          }
        : {
            checkId: "operator-funding-trace",
            decisionCritical: true,
            label: "Operator / funding trace",
            status: "confirmed",
            // "funding source" is inbound only (backward); any outbound exposure
            // still surfaces as a finding, so this note does not overclaim.
            note: dossier.deployer
              ? `Deployer ${shortAddr(dossier.deployer)} funding traced on Arkham; no flagged-entity funding source surfaced`
              : "Deployer funding traced on Arkham; no flagged-entity funding source surfaced",
            provider: "arkham",
            completedAt: deployerRisk.completedAt,
          }
      : {
          checkId: "operator-funding-trace",
          decisionCritical: true,
          label: "Operator / funding trace",
          status: "unknown",
          note: dossier.deployer
            ? `deployer ${shortAddr(dossier.deployer)} resolved; trace ${outcomeNotRecorded}`
            : `deployer unresolved; trace ${outcomeNotRecorded}`,
        },
  );

  // These checks execute in report-page panels today. Their outcomes are not
  // represented in TokenDossier, so mounting the panel must not become "ran".
  checks.push(evm
    ? { checkId: "deployer-trail-evm", decisionCritical: true, label: "Deployer trail (EVM)", status: "unknown", note: outcomeNotRecorded }
    : { checkId: "deployer-trail-evm", decisionCritical: true, label: "Deployer trail (EVM)", status: "not-applicable", note: "Solana" });
  checks.push(evm
    ? { checkId: "bytecode-fingerprint-evm", decisionCritical: true, label: "Bytecode fingerprint (EVM)", status: "unknown", note: `redeployed-rug clone check; ${outcomeNotRecorded}` }
    : { checkId: "bytecode-fingerprint-evm", decisionCritical: true, label: "Bytecode fingerprint", status: "not-applicable", note: "Solana" });

  checks.push(
    dossier.cg?.listed
      ? {
          checkId: "market-intelligence",
          decisionCritical: true,
          label: "Market intelligence",
          status: dossier.cg.cexCount > 0 ? "confirmed" : "finding",
          note: `CoinGecko listing · ${dossier.cg.cexCount} CEX listing${dossier.cg.cexCount === 1 ? "" : "s"}${dossier.cg.rank ? ` · rank #${dossier.cg.rank}` : ""}`,
        }
      : dossier.cg
        ? { checkId: "market-intelligence", decisionCritical: true, label: "Market intelligence", status: "checked-empty", note: "CoinGecko returned no matching asset" }
        : { checkId: "market-intelligence", decisionCritical: true, label: "Market intelligence", status: "unknown", note: outcomeNotRecorded },
  );

  // Recorded at scan time by the token audit (deployer + top holders against
  // the Treasury SDN address list). An unreachable list records unavailable
  // rather than silently passing; a legacy dossier without the field stays
  // unknown so old frozen reports never gain a screen they did not run.
  const sanctionsScreen = dossier.sanctionsScreen;
  checks.push(
    sanctionsScreen?.available
      ? {
          checkId: "ofac-sanctions-address",
          decisionCritical: true,
          label: "OFAC sanctions screen",
          status: sanctionsScreen.sanctioned.length ? "finding" : "confirmed",
          note: sanctionsScreen.sanctioned.length
            ? `${sanctionsScreen.sanctioned.length} of ${sanctionsScreen.checked} screened addresses are on the US Treasury SDN list`
            : `${sanctionsScreen.checked} address${sanctionsScreen.checked === 1 ? "" : "es"} (deployer + top holders) screened against the${sanctionsScreen.listSize ? ` ${sanctionsScreen.listSize.toLocaleString()}-entry` : ""} OFAC SDN list; no matches`,
          provider: "ofac-sdn",
          completedAt: sanctionsScreen.completedAt,
        }
      : sanctionsScreen
        ? { checkId: "ofac-sanctions-address", decisionCritical: true, label: "OFAC sanctions screen", status: "unavailable", note: "OFAC SDN list was unreachable during the scan; screen not completed" }
        : { checkId: "ofac-sanctions-address", decisionCritical: true, label: "OFAC sanctions screen", status: "unknown", note: `deployer + top holders; ${outcomeNotRecorded}` },
  );

  checks.push({ checkId: "documents-audits", decisionCritical: true, label: "Documents & audits", status: "unknown", note: `whitepaper, security audits, docs; ${outcomeNotRecorded}` });
  checks.push({ checkId: "news-press", decisionCritical: true, label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push({ checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unknown", note: `when a repo/org is linked; ${outcomeNotRecorded}` });
  checks.push({ checkId: "trust-graph-connections", decisionCritical: true, label: "Trust-graph reconciliation", status: "unknown", note: `shared deployers/funders with flagged subjects; ${outcomeNotRecorded}` });

  return checks;
}

// ── Investigation reconciliation ────────────────────────────────────────
//
// An investigation carries two evidence ledgers: the token audit and the full
// server scan of the project account the token was bound to. The org-side
// diligence questions on the token checklist (news, docs, GitHub, trust graph)
// are answered by recorded project-scan outcomes, and refusing to credit them
// makes an honestly covered investigation read as incomplete.
//
// The license to credit is the recorded canonical binding: the project scan
// itself confirmed this exact token as the project's official asset. Without
// that confirmed binding (or when the bound address differs), nothing is
// credited. Only rows without a recorded outcome are filled, only from source
// rows that recorded one, and every credited note names where the outcome was
// recorded. Mounting a panel still never becomes "ran".

export interface BoundProjectAccountLike {
  checkRuns?: readonly ScanCheck[] | null;
  handle?: string | null;
  projectToken?: { address?: string | null } | null;
}

const INVESTIGATION_CHECK_BRIDGE: readonly {
  tokenCheckId: string;
  tokenLabel: string;
  projectCheckId: string;
  projectLabel: string;
}[] = [
  { tokenCheckId: "news-press", tokenLabel: "News & press", projectCheckId: "news-press", projectLabel: "News & press" },
  { tokenCheckId: "github-forensics", tokenLabel: "GitHub forensics", projectCheckId: "code-footprint-github", projectLabel: "Code footprint (GitHub)" },
  { tokenCheckId: "documents-audits", tokenLabel: "Documents & audits", projectCheckId: "project-transparency", projectLabel: "Transparency and disclosures" },
  { tokenCheckId: "trust-graph-connections", tokenLabel: "Trust-graph reconciliation", projectCheckId: "trust-graph-connections", projectLabel: "Trust-graph connections" },
];

export function reconcileInvestigationChecks(
  tokenRows: readonly ScanCheck[],
  tokenAddress: string,
  projectAccount: BoundProjectAccountLike | null | undefined,
): ScanCheck[] {
  const rows = tokenRows.map((row) => ({ ...row }));
  const projectRows = projectAccount?.checkRuns;
  if (!projectRows || !projectRows.length) return rows;

  const binding = projectRows.find((row) =>
    row.checkId === "project-token-identity" || row.label === "Canonical project token");
  if (!binding || binding.status !== "confirmed") return rows;
  const boundAddress = (projectAccount?.projectToken?.address ?? "").trim().toLowerCase();
  const subjectAddress = (tokenAddress ?? "").trim().toLowerCase();
  if (boundAddress && boundAddress !== subjectAddress) return rows;

  const handle = (projectAccount?.handle ?? "").trim();
  const provenance = handle
    ? `the bound project account scan (${handle})`
    : "the bound project account scan";

  for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
    const target = rows.find((row) =>
      row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
    if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
    const source = projectRows.find((row) =>
      row.checkId === bridge.projectCheckId || row.label === bridge.projectLabel);
    if (!source || !SUCCESSFUL.has(source.status)) continue;
    target.status = source.status;
    target.note = `recorded on ${provenance}: ${source.note ?? "completed"}`;
    if (source.provider) target.provider = source.provider;
    if (source.completedAt) target.completedAt = source.completedAt;
    if (typeof source.sourceCount === "number") target.sourceCount = source.sourceCount;
  }
  return rows;
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

  const projectChecks: ScanCheck[] = [
    { label: "Canonical project token", status: "unknown", note: outcomeNotRecorded },
    { label: "Product and website substance", status: "unknown", note: outcomeNotRecorded },
    { label: "Project team identity", status: "unknown", note: outcomeNotRecorded },
    { label: "Backing and partners", status: "unknown", note: outcomeNotRecorded },
    { label: "Traction and liveness", status: "unknown", note: outcomeNotRecorded },
    { label: "Transparency and disclosures", status: "unknown", note: outcomeNotRecorded },
  ];
  checks.push(...projectChecks.map((check) => roles.includes("PROJECT")
    ? check
    : { ...check, status: "not-applicable" as const, note: "not a project account" }));

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
