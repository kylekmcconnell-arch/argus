import type { Recon } from "../collect/recon";

const GLYPH: Record<string, string> = { good: "✓", warn: "▲", bad: "✗", gap: "◌" };

/** Plain-text site diligence summary with an exact link when evidence is saved. */
export function reconReportText(
  recon: Recon,
  evidence?: { reportVersionId?: string; version?: number; privateSession?: boolean },
  origin = "",
): string {
  let host = recon.retrieval.url;
  try { host = new URL(recon.retrieval.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  const verdict = recon.verdict;
  const base = origin.replace(/\/$/, "");
  const exactLink = evidence?.reportVersionId
    ? `${base}/?version=${encodeURIComponent(evidence.reportVersionId)}`
    : null;
  const provenance = evidence?.version
    ? `— ARGUS immutable snapshot v${evidence.version}`
    : evidence?.reportVersionId
      ? "— ARGUS immutable site recon"
      : evidence?.privateSession
        ? "— private live ARGUS session"
        : "— live ARGUS site recon";

  return [
    `${recon.title || host} — ${verdict ? `${verdict.verdict} ${verdict.score ?? "—"}/100` : recon.retrieval.status} · site${verdict?.capApplied ? ` (cap: ${verdict.capApplied.replace(/_/g, " ")})` : ""}`,
    recon.identityLine,
    "",
    ...(verdict?.reasons ?? []).slice(0, 6).map((reason) => `${GLYPH[reason.tone] ?? "·"} ${reason.text}`),
    "",
    host,
    ...(exactLink ? [exactLink] : []),
    provenance,
  ].join("\n");
}
