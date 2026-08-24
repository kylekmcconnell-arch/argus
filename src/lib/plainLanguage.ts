/**
 * Rewrite internal research shorthand when it appears in generated summaries.
 *
 * This is intentionally conservative. It is for analyst-written or
 * model-written explanation, not direct source quotations, provider names,
 * URLs, legal text, or raw evidence records.
 */
export function plainLanguageSummary(value: string): string {
  return humanizeAxisIds(value)
    .replace(/\bproject[- _]attributed role\b/gi, "named by the project")
    .replace(/\bproject[- _]attributed\b/gi, "named by the project")
    .replace(/\bsource[- ]reported\b/gi, "reported by a source")
    .replace(/\bscore floor\b/gi, "minimum score")
    .replace(/\bdeployer wallet's\b/gi, "creator wallet's")
    .replace(/\bdeployer's\b/gi, "token creator's")
    .replace(/\bdeployer wallet\b/gi, "creator wallet")
    .replace(/\bdeployer\b/gi, "token creator")
    .replace(/\bhot wallet\b/gi, "operating wallet")
    .replace(/\bcanonical project token\b/gi, "official token")
    .replace(/\bcanonical token\b/gi, "official token")
    .replace(/\bcanonical\b/gi, "official")
    .replace(/\bfirst-party\b/gi, "official")
    .replace(/\bon-chain liveness\b/gi, "blockchain activity")
    .replace(/\bmarket liveness\b/gi, "market activity")
    .replace(/\bon-chain\b/gi, "blockchain")
    .replace(/\bliveness\b/gi, "activity")
    .replace(/\bevidence-backed\b/gi, "source-supported")
    .replace(/\bdecision readiness\b/gi, "safety check status")
    .replace(/\bevidence readiness\b/gi, "safety check status")
    .replace(/\bsource coverage\b/gi, "source availability")
    .replace(/\bcoverage gap\b/gi, "missing source result")
    .replace(/\bcoverage limitation\b/gi, "limit of the available sources")
    .replace(/\bIdentity resolution\b/g, "Identity check")
    .replace(/\bidentity resolution\b/gi, "identity check")
    .replace(/\bdecision basis\b/gi, "reasons behind the score")
    .replace(/\bscoring pass\b/gi, "scoring step")
    .replace(/\bgoverning role\b/gi, "role used for the final score")
    .replace(/\bgoverning score\b/gi, "final score")
    .replace(/\bsubstantive\b/gi, "meaningful")
    .replace(/\bprovenance\b/gi, "source trail")
    .replace(/\bcorroborated\b/gi, "confirmed")
    .replace(/\bforensics\b/gi, "checks")
    .replace(/\bforensic\b/gi, "detailed")
    .replace(/\btrust[- ]graph reconciliation\b/gi, "connection cross-check")
    .replace(/\btrust[- ]graph\b/gi, "connection map")
    .replace(/\bterminal outcome\b/gi, "final result")
    .replace(/\bmodel-enriched\b/gi, "AI-suggested")
    .replace(/\bmodel-only\b/gi, "suggested by AI only")
    .replace(/\bCEX listings?\b/gi, "centralized exchange listings")
    .replace(/\bFDV\b/g, "all-token value")
    .replace(/\s+/g, " ")
    .trim();
}

const PUBLIC_RELATIONSHIP_LABELS: Record<string, string> = {
  ASSOCIATES_WITH: "is associated with",
  FOUNDED: "founded",
  PROMOTED: "promoted",
  CLAIMED_ENDORSEMENT: "claims an endorsement from",
  ADVISED: "advised",
  SERVICED: "provided services to",
  CONTROLS_WALLET: "controls",
  FLAGS: "raised a warning about",
  WORKED_ON: "worked on",
  FUNDED: "funded",
  FUNDED_BY: "was funded by",
  DEPLOYED_BY: "was created by",
  ATTRIBUTED_CREATOR: "was linked by a source to",
  HELD_BY: "is held by",
  TEAM: "is on the team for",
  INVESTED_IN: "invested in",
  AFFILIATED_WITH: "is affiliated with",
  COMMIT_EMAIL: "used a matching code email with",
};

/** Public label for a typed relationship. The raw enum stays in technical details. */
export function publicRelationshipLabel(value: string): string {
  const normalized = value.trim().replace(/[\s-]+/g, "_").toUpperCase();
  return PUBLIC_RELATIONSHIP_LABELS[normalized]
    ?? normalized.toLowerCase().replaceAll("_", " ");
}

/**
 * Human label for graph entity keys such as `wallet:base:0x…`.
 * The canonical key remains unchanged and is exposed in technical details.
 */
export function publicEntityLabel(value: string, type?: string, explicitLabel?: string): string {
  const named = explicitLabel?.trim();
  if (named && named !== value) return plainLanguageSummary(named);
  const raw = value.trim();
  const parts = raw.split(":");
  const prefix = parts[0]?.toLowerCase();
  const identifier = parts.at(-1) || raw;
  if (prefix === "wallet") return `Wallet ${identifier}`;
  if (prefix === "holder") return `Holder wallet ${identifier}`;
  if (prefix === "token") return `Token ${identifier}`;
  if (prefix === "project") return `Project ${identifier}`;
  if (prefix === "x") return `X account ${identifier.startsWith("@") ? identifier : `@${identifier}`}`;
  if (type?.toLowerCase() === "identity" && /^0x[a-f0-9]+$/i.test(identifier)) return `Wallet ${identifier}`;
  return raw;
}

const PUBLIC_CHECK_LABELS: Record<string, string> = {
  "contract-safety": "Contract controls",
  "buy-sell-simulation": "Tradeability check",
  "holder-distribution": "Large holders",
  "wallet-clustering": "Connected holder wallets",
  "operator-funding-trace": "Where the token creator's funds came from",
  "market-intelligence": "Market data",
  "deployer-trail-evm": "Who created the token",
  "deployer-trail-solana": "Who created the token",
  "bytecode-fingerprint-evm": "Copied contract code",
  "bytecode-fingerprint-solana": "Copied contract code",
  "documents-audits": "Documents and security audits",
  "documents-and-audits": "Documents and security audits",
  "news-press": "News and press",
  "github-forensics": "Code history",
  "trust-graph-reconciliation": "Known connections",
  "ofac-sanctions-screen": "Sanctions screening",
};

/** One public label for check IDs and collector-written check names. */
export function publicCheckLabel(value: string): string {
  const key = value.trim().toLowerCase().replace(/&/g, "and").replace(/[\s_]+/g, "-");
  const mapped = PUBLIC_CHECK_LABELS[key];
  if (mapped) return mapped;
  return plainLanguageSummary(value)
    .replace(/\s*\((?:evm|solana)\)\s*/gi, " ")
    .replace(/\btoken creator[- ]trail(?:-(?:evm|solana))?\b/gi, "Who created the token")
    .replace(/\bbytecode[- ]fingerprint(?:-(?:evm|solana))?\b/gi, "Copied contract code")
    .replace(/\bwallet clustering\b/gi, "Connected holder wallets")
    .replace(/\boperator\s*\/\s*funding trace\b/gi, "Where the token creator's funds came from")
    .replace(/\bbuy\s*\/\s*sell simulation\b/gi, "Buy and sell test")
    .replace(/\bholder distribution\b/gi, "Large holders")
    .replace(/\bcontract safety\b/gi, "Contract controls")
    .replace(/\bgithub checks\b/gi, "Code history")
    .replace(/\bcode footprint\s*\(github\)\b/gi, "GitHub code history")
    .replace(/\bconnection cross-check connections\b/gi, "Known connections")
    .trim();
}

/** Reader explanation for a saved check outcome. */
export function publicCheckNote(value: string): string {
  return plainLanguageSummary(value)
    .replace(/token creator unresolved;\s*trace completion outcome not recorded/gi, "ARGUS could not identify the token creator, so the funding check did not finish.")
    .replace(/redeployed-rug clone check;\s*completion outcome not recorded/gi, "We could not finish checking whether this contract copies code from a known scam.")
    .replace(/completion outcome not recorded/gi, "This check did not finish.")
    .replace(/provider unavailable/gi, "The data source did not respond.")
    .replace(/mint authority active/gi, "more tokens can be created")
    .replace(/owner active/gi, "contract owner still has control")
    .replace(/transfers can be paused/gi, "the owner can stop transfers")
    .replace(/no elevated concentration surfaced/gi, "no unusual wallet concentration found")
    .replace(/frozen/gi, "saved");
}

import { axisLabel } from "./verdict";

/** "substantive evidence is missing for I2_portfolio_quality" reads as jargon; swap axis ids for their labels. */
function humanizeAxisIds(value: string): string {
  return value.replace(/\b[A-Z]{1,3}\d+_[a-z0-9_]+\b/g, (token) => {
    const label = axisLabel(token);
    return label === token ? token : label.toLowerCase();
  });
}

const ROLE_ACRONYMS = new Set(["ceo", "cto", "coo", "cfo", "cmo", "cio", "ciso", "vp"]);

/** One casing for role chips everywhere: "ceo" and "CEO" both render "CEO", "co-founder" renders "Co-Founder". */
export function formatRoleLabel(value: string | undefined): string {
  const raw = (value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw
    .split(" ")
    .map((word) => word
      .split("-")
      .map((part) => {
        if (ROLE_ACRONYMS.has(part.toLowerCase())) return part.toUpperCase();
        if (/^(?:of|and|the|for|at|&)$/i.test(part)) return part.toLowerCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join("-"))
    .join(" ");
}

/** Plain labels for the report's result and check-status banners. */
export function plainReportStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    "DECISION READINESS": "REPORT STATUS",
    "RISK SIGNAL": "RISK WARNING",
    VERDICT: "RESULT",
    "EVIDENCE COVERAGE COMPLETE": "SAFETY CHECKS FINISHED",
    "ASSESSMENT PROVISIONAL": "SOME CHECKS OPEN",
    "INVESTIGATION INCOMPLETE": "CHECKS INCOMPLETE",
    "INVESTIGATION FAILED": "SCAN FAILED",
    "DECISION OUTPUT INCOMPLETE": "SCORE INCOMPLETE",
  };
  return labels[value.trim().toUpperCase()] ?? value;
}
