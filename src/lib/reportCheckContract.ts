import type { ScanCheck } from "./scanChecklist";

export type CanonicalReportKind = "person" | "token" | "investigation";

/**
 * The only token checks allowed to govern the public completion label.
 *
 * Everything else is useful enrichment. It remains visible in the evidence
 * and methodology ledgers, but an unavailable news, documents, GitHub, social,
 * or paid-provider lane cannot turn a finished safety report into an
 * "incomplete" report.
 */
export const TOKEN_REQUIRED_CHECK_IDS: ReadonlySet<string> = new Set([
  "contract-safety",
  "buy-sell-simulation",
  "holder-distribution",
  "wallet-clustering",
  "market-intelligence",
  "ofac-sanctions-address",
]);

/**
 * A full project investigation has one additional never-waive screen. The
 * standalone token collector does not run the prior-report trust-graph join,
 * so putting that row in its denominator made every otherwise complete token
 * scan read 6/7 forever. Investigations do run and persist this screen through
 * the bound project-account collector.
 */
export const INVESTIGATION_REQUIRED_CHECK_IDS: ReadonlySet<string> = new Set([
  ...TOKEN_REQUIRED_CHECK_IDS,
  "trust-graph-connections",
]);

const TOKEN_REQUIRED_CHECK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "contract-safety": "Contract safety",
  "buy-sell-simulation": "Tradeability check",
  "holder-distribution": "Holder distribution",
  "wallet-clustering": "Wallet clustering",
  "market-intelligence": "Market intelligence",
  "ofac-sanctions-address": "OFAC sanctions screen",
  "trust-graph-connections": "Trust-graph reconciliation",
});

export const TOKEN_SUPPLEMENTAL_CHECK_IDS: ReadonlySet<string> = new Set([
  "operator-funding-trace",
  "deployer-trail-evm",
  "bytecode-fingerprint-evm",
  "documents-audits",
  "news-press",
  "github-forensics",
  "trust-graph-connections",
]);

/**
 * Person/project roles are selected before their checklist is frozen. These
 * rows are always supplemental when they appear in an older snapshot without
 * an explicit decisionCritical marker. All other applicable legacy rows keep
 * their historical required status; current snapshots retain the role-specific
 * marker written by server/checks.ts.
 */
export const PERSON_SUPPLEMENTAL_CHECK_IDS: ReadonlySet<string> = new Set([
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "news-press",
  "project-leadership-currency",
  "founder-repeat-backing",
  "investor-fund-scale",
]);

/**
 * Apply one explicit completion contract at every read and write boundary.
 * Persisted flags are evidence metadata, not authority over current public
 * completion semantics, so token/investigation rows are normalized even when
 * an older report froze supplemental work as required.
 */
export function applyReportCheckContract(
  kind: CanonicalReportKind,
  checks: readonly ScanCheck[],
): ScanCheck[] {
  const requiredIds = kind === "investigation"
    ? INVESTIGATION_REQUIRED_CHECK_IDS
    : TOKEN_REQUIRED_CHECK_IDS;
  const normalized = checks.map((check) => {
    const checkId = check.checkId?.trim() ?? "";
    if (kind === "token" || kind === "investigation") {
      if (checkId && requiredIds.has(checkId)) {
        return { ...check, decisionCritical: true };
      }
      if (checkId && TOKEN_SUPPLEMENTAL_CHECK_IDS.has(checkId)) {
        return { ...check, decisionCritical: false };
      }
      // Preserve an unknown future/legacy row until its semantics are added to
      // this contract. Silently waiving an unclassified safety row is the
      // dangerous direction.
      return {
        ...check,
        ...(check.decisionCritical === undefined ? {} : { decisionCritical: check.decisionCritical }),
      };
    }

    if (check.decisionCritical !== undefined) return { ...check };
    return {
      ...check,
      decisionCritical: !checkId || !PERSON_SUPPLEMENTAL_CHECK_IDS.has(checkId),
    };
  });

  if (kind === "person") return normalized;
  const present = new Set(normalized.map((check) => check.checkId).filter(Boolean));
  const missingRequired = [...requiredIds]
    .filter((checkId) => !present.has(checkId))
    .map((checkId): ScanCheck => ({
      checkId,
      label: TOKEN_REQUIRED_CHECK_LABELS[checkId] ?? checkId,
      status: "unknown",
      decisionCritical: true,
      note: "required completion outcome was not saved",
    }));
  return [...normalized, ...missingRequired];
}

/** True only when the snapshot itself records an explicit current contract. */
export function hasExplicitReportCheckContract(
  kind: CanonicalReportKind,
  checks: readonly ScanCheck[],
): boolean {
  if (kind === "token" || kind === "investigation") {
    const ids = new Set(checks.map((check) => check.checkId).filter(Boolean));
    const requiredIds = kind === "investigation"
      ? INVESTIGATION_REQUIRED_CHECK_IDS
      : TOKEN_REQUIRED_CHECK_IDS;
    return [...requiredIds].every((checkId) => ids.has(checkId));
  }
  return checks.length > 0
    && checks.every((check) => typeof check.decisionCritical === "boolean")
    && checks.some((check) => check.decisionCritical === true);
}
