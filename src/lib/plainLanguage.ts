/**
 * Rewrite internal research shorthand when it appears in generated summaries.
 *
 * This is intentionally conservative. It is for analyst-written or
 * model-written explanation, not direct source quotations, provider names,
 * URLs, legal text, or raw evidence records.
 */
export function plainLanguageSummary(value: string): string {
  return value
    .replace(/\bcanonical project token\b/gi, "official token")
    .replace(/\bcanonical token\b/gi, "official token")
    .replace(/\bcanonical\b/gi, "official")
    .replace(/\bfirst-party\b/gi, "official")
    .replace(/\bon-chain liveness\b/gi, "blockchain activity")
    .replace(/\bmarket liveness\b/gi, "market activity")
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
