import { profileOf, type Recon } from "../collect/recon";
import { AVAILABILITY_LABEL, KIND_LABEL } from "../collect/siteProfile";

const GLYPH: Record<string, string> = { good: "✓", warn: "▲", bad: "✗", gap: "◌" };

function safeProfile(recon: Recon): ReturnType<typeof profileOf> | null {
  try { return profileOf(recon); } catch { return null; }
}

// A crawler-read og:title can run to a paragraph; the brand is the headline.
function headline(recon: Recon, host: string): string {
  const title = (recon.title ?? "").trim();
  if (title && title.length <= 80) return title;
  return safeProfile(recon)?.brand ?? title ?? host;
}

// The first-pass answer as plain text lines, in the order an analyst asks it.
function profileLines(recon: Recon): string[] {
  const profile = safeProfile(recon);
  if (!profile) return [];
  const people = profile.people.slice(0, 6).map((p) => (p.role ? `${p.name} (${p.role})` : p.name));
  return [
    `What: ${KIND_LABEL[profile.kind]} · ${AVAILABILITY_LABEL[profile.availability]}`,
    profile.summary,
    `Official accounts: ${profile.officialAccounts.length ? profile.officialAccounts.map((a) => a.url).join(", ") : "none linked on the page"}`,
    ...(profile.linkedAccounts.length ? [`Also linked (not claimed as its own): ${profile.linkedAccounts.map((a) => a.label).join(", ")}`] : []),
    `Named with a role: ${people.length ? people.join(", ") + (profile.people.length > 6 ? `, and ${profile.people.length - 6} more` : "") : "no one on the rendered page"}`,
    `Next step: ${profile.nextStep.kind === "none" ? profile.nextStep.reason : `${profile.nextStep.label}. ${profile.nextStep.reason}`}`,
  ];
}

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
    ? `· ARGUS saved report v${evidence.version}`
    : evidence?.reportVersionId
      ? "· ARGUS saved website report"
      : evidence?.privateSession
        ? "· private / not saved"
        : "· new ARGUS website check";

  return [
    `${headline(recon, host) || host} · ${verdict ? `${verdict.verdict} ${verdict.score ?? "N/A"}/100` : recon.retrieval.status} · website${verdict?.capApplied ? ` (score limit: ${verdict.capApplied.replace(/_/g, " ")})` : ""}`,
    recon.identityLine,
    "",
    ...profileLines(recon),
    "",
    ...(verdict?.reasons ?? []).slice(0, 6).map((reason) => `${GLYPH[reason.tone] ?? "·"} ${reason.text}`),
    "",
    host,
    ...(exactLink ? [exactLink] : []),
    provenance,
  ].join("\n");
}
