import { useState } from "react";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import type { Dossier } from "../data/dossier";
import type { SourceArtifact } from "../data/evidence";
import type { RoleReport, SubjectClass } from "../engine";
import { verdictMeta, ROLE_META, axisLabel, capLabel } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import { getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { Avatar } from "./Avatar";
import { xAvatar, personAvatar } from "../lib/avatars";
import { explorer, shortAddr, walletTier } from "../lib/wallets";
import { IdentitySweep } from "./IdentitySweep";
import { PfpCheck } from "./PfpCheck";
import { PersonGithub } from "./PersonGithub";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { personChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { coverageQualifiedCompleteness, exactReportPath, presentPublicReport } from "../lib/reportPresentation";
import { AddInfo } from "./AddInfo";
import { LinkEntity } from "./LinkEntity";
import { AskReport } from "./AskReport";
import { KolReport } from "./KolReport";
import { NewsSection } from "./NewsSection";
import { VcReport } from "./VcReport";
import { ProjectIntel } from "./ProjectIntel";
import { changeReportLifecycle } from "../lib/reports";
import { ServiceAlert } from "./ServiceAlert";
import { LegalScreen } from "./LegalScreen";
import { SanctionsNameScreen } from "./SanctionsNameScreen";
import { RingAlert } from "./RingAlert";
import { useArgusAuth } from "../auth-context";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import { DecisionBasis } from "./DecisionBasis";
import { isStrictFundScaleArtifact } from "../lib/fundScaleEvidence";

/* ── small primitives ─────────────────────────────────────────────── */

function VerdictPill({ verdict, size = "sm" }: { verdict: string; size?: "sm" | "lg" }) {
  const m = verdictMeta(verdict);
  const fail = verdict === "FAIL";
  return (
    <span
      className={`verdict-pill ${size === "lg" ? "verdict-pill-lg" : ""} ${fail ? "tint-fail" : "tint-var"}`}
      style={fail ? undefined : ({ "--tint": m.color } as React.CSSProperties)}
    >
      {m.label}
    </span>
  );
}

function ScoreRing({ score, verdict, size = 86 }: { score: number | null; verdict: string; size?: number }) {
  const m = verdictMeta(verdict);
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={m.color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[22px] font-semibold leading-none tabular" style={{ color: m.color }}>
          {score == null ? "—" : score}
        </span>
        <span className="mono text-[10px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
        {kicker && <span className="text-[12.5px] text-ink-faint">{kicker}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>{children}</div>
  );
}

// Copy a full wallet address (the row shows a truncated form).
function CopyAddr({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      className="shrink-0 text-[11px] text-ink-faint transition hover:text-ink"
      title="Copy full address"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

/* ── axis bar ─────────────────────────────────────────────────────── */

function AxisBar({
  axis,
  score,
  weight,
  rationale,
  color,
  evidenceRefs,
  counterEvidenceRefs,
  gaps,
}: {
  axis: string;
  score: number;
  weight: number;
  rationale: string;
  color: string;
  evidenceRefs?: string[];
  counterEvidenceRefs?: string[];
  gaps?: string[];
}) {
  const ratio = weight ? score / weight : 0;
  const weak = ratio < 0.45;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-dim">{axisLabel(axis)}</span>
        <span className="mono shrink-0 text-[11px] tabular text-ink-faint">
          {score}
          <span className="text-ink-faint/60">/{weight}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ background: weak ? "var(--color-caution)" : color, width: `${ratio * 100}%`, transition: "width 0.7s ease-out" }}
        />
      </div>
      {rationale && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-faint">{rationale}</p>}
      {evidenceRefs && (
        <a
          href={`#decision-basis-${axis}`}
          className="mt-1.5 inline-flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-[12.5px] text-signal underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <span>{evidenceRefs.length} evidence {evidenceRefs.length === 1 ? "artifact" : "artifacts"}</span>
          {(counterEvidenceRefs?.length ?? 0) > 0 && <span className="text-caution">{counterEvidenceRefs!.length} counter</span>}
          {(gaps?.length ?? 0) > 0 && <span className="text-caution">{gaps!.length} {gaps!.length === 1 ? "gap" : "gaps"}</span>}
          <span aria-hidden="true">↑</span>
        </a>
      )}
    </div>
  );
}

/* ── role card ────────────────────────────────────────────────────── */

function RoleCard({ rr, governing, coverageReady }: { rr: RoleReport; governing: boolean; coverageReady: boolean }) {
  const [open, setOpen] = useState(governing);
  const m = verdictMeta(rr.verdict);
  const role = ROLE_META[rr.role as SubjectClass];
  const axes = Object.entries(rr.axes);

  return (
    <Card className={governing ? "ring-1" : ""} >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        onClick={() => setOpen((o) => !o)}
        style={governing ? { boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.color} 36%, transparent)` } : undefined}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-panel-2 text-[15px]" style={{ color: m.color }}>
          {role.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{role.label}</span>
            {governing && <span className="chip">governs</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <VerdictPill verdict={rr.verdict} />
            {!coverageReady && rr.verdict === "PASS" && (
              <span className="mono text-[11px] font-medium uppercase tracking-wide text-caution">scored axes only</span>
            )}
            {rr.cap_applied && (
              <span className="mono text-[11px] font-medium text-avoid">
                cap · {capLabel(rr.cap_applied)}
              </span>
            )}
          </div>
        </div>
        <ScoreRing score={rr.score_total} verdict={rr.verdict} size={64} />
      </button>

      {open && axes.length > 0 && (
        <div className="overflow-hidden border-t border-line px-4 pb-3">
          <div className="divide-y divide-line/60">
            {axes.map(([k, a]) => (
              <AxisBar
                key={k}
                axis={k}
                score={a.score}
                weight={a.weight}
                rationale={a.rationale}
                color={m.color}
                evidenceRefs={governing ? a.evidenceRefs : undefined}
                counterEvidenceRefs={governing ? a.counterEvidenceRefs : undefined}
                gaps={governing ? a.gaps : undefined}
              />
            ))}
          </div>
          {rr.dox_bonus > 0 && (
            <div className="panel-inset mt-2 flex items-center justify-between px-3 py-2 text-[12.5px]">
              <span className="text-ink-dim">Disclosure bonus (identity verified)</span>
              <span className="mono text-pass">+{rr.dox_bonus}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between px-1 text-[12.5px] text-ink-faint">
            <span>
              raw {rr.raw_total} {rr.dox_bonus ? `+ ${rr.dox_bonus} bonus` : ""}
            </span>
            <span className="mono">= {rr.score_total ?? "—"}{rr.cap_applied ? " (capped)" : ""}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── corroboration table ──────────────────────────────────────────── */

const TV_TONE: Record<string, string> = {
  Corroborated: "var(--color-pass)",
  PartiallyCorroborated: "var(--color-caution)",
  Unconfirmed: "var(--color-ink-faint)",
  Contradicted: "var(--color-avoid)",
};
const TV_SHORT: Record<string, string> = {
  Corroborated: "Corroborated",
  PartiallyCorroborated: "Partial",
  Unconfirmed: "Unconfirmed",
  Contradicted: "Contradicted",
};

function CorroborationTable({
  rows,
}: {
  rows: { who: string; rel?: string; follows?: boolean | null; ack?: string | null; verdict?: string; note?: string }[];
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[1.4fr_1fr_auto] gap-2 border-b border-line px-4 py-2 eyebrow">
        <span>Claimed endorser</span>
        <span>Public signal</span>
        <span className="text-right">Verdict</span>
      </div>
      <div className="divide-y divide-line/60">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-2 px-4 py-2.5">
            <div className="min-w-0">
              <div className="mono truncate text-[12.5px] text-ink">{r.who}</div>
              {r.rel && <div className="text-[11px] text-ink-faint">claims: {r.rel}</div>}
            </div>
            <div className="text-[12.5px] text-ink-dim">
              <span className={r.follows ? "text-ink-dim" : "text-ink-faint line-through/0"}>
                {r.follows ? "follows" : "no follow"}
              </span>
              <span className="text-ink-faint"> · {r.ack && r.ack !== "none" ? r.ack : "no ack"}</span>
            </div>
            <div className="text-right">
              <span
                className="mono text-[11px] font-medium"
                style={{ color: TV_TONE[r.verdict ?? "Unconfirmed"] }}
              >
                {TV_SHORT[r.verdict ?? "Unconfirmed"]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── findings ledger ──────────────────────────────────────────────── */

type ReportFinding = Dossier["report"]["publishable_findings"][number];

const normalizedEntityHandle = (value?: string | null): string | null => {
  if (!value) return null;
  const match = value.trim().match(/^@?([A-Za-z0-9_]{1,30})$/);
  return match ? match[1].toLowerCase() : null;
};

const findingTarget = (finding: ReportFinding): string | null =>
  finding.finding_scope?.target_entity_key
  ?? finding.claim.match(/@([A-Za-z0-9_]{1,30})/)?.[0]
  ?? null;

/**
 * Stored snapshots are immutable, including early versions produced before the
 * engine enforced entity scope. Apply the current publication boundary as a
 * read-time projection so a historical model lead can never keep appearing as
 * verified subject evidence merely because the underlying payload is frozen.
 */
function isPublishableSubjectFinding(finding: ReportFinding, subject: string): boolean {
  if (finding.evidence_origin === "model_lead" || finding.artifact_verified === false) return false;
  if (finding.independent_source_count < 1) return false;
  if (finding.verification_status !== "Verified" && finding.verification_status !== "Reported") return false;
  const scope = finding.finding_scope;
  if (!scope) {
    // Pre-scope deterministic findings remain readable, but legacy discovery
    // types fail closed because their actual target was not stored separately.
    return !/Lead$/i.test(finding.finding_type);
  }
  return scope.scope === "direct_subject"
    && scope.relationship_to_subject === "self"
    && normalizedEntityHandle(scope.target_entity_key) === normalizedEntityHandle(subject);
}

function FindingsLedger({ findings }: { findings: Dossier["report"]["publishable_findings"] }) {
  if (!findings.length) return null;
  return (
    <div className="space-y-2">
      {findings.map((f, i) => {
        let source: { href: string; label: string } | null = null;
        try {
          const parsed = new URL(f.source_url.trim());
          if (
            (parsed.protocol === "https:" || parsed.protocol === "http:")
            && parsed.hostname
            && !parsed.username
            && !parsed.password
          ) {
            source = {
              href: parsed.href,
              label: parsed.href.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            };
          }
        } catch {
          // Missing or malformed source URLs stay visible as unavailable, never as clickable markup.
        }

        const sourceCountLabel = `${f.independent_source_count} independent source${f.independent_source_count === 1 ? "" : "s"} recorded · ${source ? "1 link stored" : "no link stored"}`;
        const statusColor = f.verification_status === "Verified"
          ? "var(--color-pass)"
          : f.verification_status === "Rumor"
            ? "var(--color-avoid)"
            : "var(--color-caution)";

        return (
          <Card key={i} className="p-3.5">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: f.polarity > 0 ? "var(--color-pass)" : "var(--color-avoid)" }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] leading-snug text-ink">{f.claim}</p>
                <div role="group" aria-label="Evidence provenance" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-faint">
                  <span className="inline-flex items-center gap-1.5 rounded border border-line px-1.5 py-0.5">
                    <span>Status</span>
                    <span className="mono font-medium" style={{ color: statusColor }}>{f.verification_status}</span>
                  </span>
                  <span>
                    Sources <span className="mono text-ink-dim">{sourceCountLabel}</span>
                  </span>
                  {f.source_date && (
                    <span>
                      Date <time className="mono text-ink-dim" dateTime={f.source_date}>{f.source_date}</time>
                    </span>
                  )}
                  {f.source_author && (
                    <span>
                      Author <span className="mono text-ink-dim">{f.source_author}</span>
                    </span>
                  )}
                </div>
                {source ? (
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open evidence source for finding ${i + 1} in a new tab: ${f.claim}`}
                    title={source.href}
                    className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
                  >
                    <span className="shrink-0 text-ink-faint">Source</span>
                    <span className="truncate">{source.label}</span>
                  </a>
                ) : (
                  <p className="mt-2 text-[11px] text-ink-faint">Source link unavailable</p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function InvestigativeLeadsLedger({ leads, subject }: {
  leads: Dossier["report"]["investigative_leads"];
  subject: string;
}) {
  if (!leads.length) return null;
  return (
    <div className="space-y-2">
      {leads.map((lead, index) => {
        const scope = lead.finding_scope;
        const target = findingTarget(lead) || "unresolved target";
        const inferredRelated = !scope
          && normalizedEntityHandle(target) !== null
          && normalizedEntityHandle(target) !== normalizedEntityHandle(subject);
        const relationship = scope?.relationship_to_subject === "associate"
          ? "Associate lead"
          : scope?.relationship_to_subject === "venture"
            ? "Venture lead"
            : inferredRelated
              ? "Related-entity lead"
              : "Subject lead";
        const verifiedAboutTarget = lead.verification_status === "Verified"
          && lead.artifact_verified === true
          && lead.evidence_origin !== "model_lead";
        const attributionStatus = verifiedAboutTarget
          ? "verified about target · outside subject score"
          : "unverified lead · outside subject score";
        const source = safeSourceLink(lead.source_url);
        return (
          <Card key={`${target}:${lead.claim}:${index}`} className="p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip tint-caution">
                {relationship}
              </span>
              <span className="mono text-[11px] text-ink">{target}</span>
              {scope?.relationship_label && <span className="text-[11px] text-ink-faint">· {scope.relationship_label}</span>}
              <span className="chip ml-auto">{attributionStatus}</span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{lead.claim}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              {verifiedAboutTarget
                ? `This artifact is verified about ${target}, but it is not evidence of conduct by ${subject}.`
                : `This is an unverified follow-up lead about ${target}, not verified evidence of conduct by ${subject}.`}
            </p>
            {source ? (
              <a
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open candidate source for investigative lead ${index + 1}: ${lead.claim}`}
                title={source.href}
                className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
              >
                <span className="shrink-0 text-ink-faint">{verifiedAboutTarget ? "Verified target source" : "Candidate source"}</span>
                <span className="truncate">{source.label}</span>
              </a>
            ) : (
              <p className="mt-2 text-[11px] text-ink-faint">Candidate source link unavailable</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

type FrozenSourceArtifact = NonNullable<Dossier["sourceArtifacts"]>[number];
type FrozenProfileAuthenticity = NonNullable<Dossier["profileAuthenticity"]>;
type FrozenTrustGraphScreen = NonNullable<Dossier["trustGraphScreen"]>;

function safeSourceLink(value?: string): { href: string; label: string } | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.hostname
      && !parsed.username
      && !parsed.password
    ) {
      return {
        href: parsed.href,
        label: `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
      };
    }
  } catch {
    // Malformed or non-web sources remain visible as unavailable metadata.
  }
  return null;
}

function frozenSourceDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function compactSourceDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

const PORTFOLIO_SOURCE_LABEL: Record<NonNullable<SourceArtifact["sourceClass"]>, string> = {
  first_party_subject: "subject's official site",
  first_party_investor: "investor's official site",
  first_party_project: "project announcement",
  public_primary: "public primary record",
  independent_press: "independent press",
  other_public: "public corroborating source",
};

const FUND_SCALE_METRIC_LABEL: Record<NonNullable<SourceArtifact["fundScaleMetric"]>, string> = {
  regulatory_aum: "regulatory AUM",
  reported_aum: "reported AUM",
  fund_vehicle: "fund vehicle",
  first_close: "first close",
  final_close: "final close",
};

const FUND_SCALE_BASIS_LABEL: Record<NonNullable<SourceArtifact["fundScaleBasis"]>, string> = {
  regulatory: "regulatory filing",
  manager_reported: "manager reported",
  press_corroborated: "press corroborated",
};

type InvestorSourceRole = "Affiliation source" | "Fund domain source" | "Scale source" | "Deal source";

function InvestorEvidenceLinks({
  sources,
  role,
  context,
}: {
  sources: readonly SourceArtifact[];
  role: InvestorSourceRole;
  context: string;
}) {
  const seen = new Set<string>();
  const references = sources.flatMap((source) => {
    const rawUrl = role === "Affiliation source"
      ? source.attributionSourceUrl
      : role === "Fund domain source"
        ? source.investorDomainSourceUrl
        : source.sourceUrl;
    const link = safeSourceLink(rawUrl);
    if (!link || seen.has(link.href)) return [];
    seen.add(link.href);
    const capturedValue = role === "Affiliation source"
      ? source.attributionCapturedAt ?? source.capturedAt
      : role === "Fund domain source"
        ? source.investorDomainCapturedAt ?? source.capturedAt
      : source.capturedAt;
    const capturedLabel = compactSourceDate(capturedValue);
    const descriptor = role === "Affiliation source"
      ? `${source.subjectName || "subject"} affiliation with ${source.investorEntityName || source.fundName || "fund"}`
      : role === "Fund domain source"
        ? `${source.investorDomainProfileName || source.investorEntityName || source.fundName || "fund"} official domain ${source.investorEntityDomain || "unavailable"}`
      : source.title || (source.sourceClass ? PORTFOLIO_SOURCE_LABEL[source.sourceClass] : "public evidence");
    return [{
      href: link.href,
      hostAndPath: link.label,
      descriptor,
      capturedValue,
      capturedLabel,
    }];
  });

  if (!references.length) {
    return <span className="text-[11px] text-ink-faint">{role} unavailable</span>;
  }

  return references.map((reference) => {
    const dateDescription = reference.capturedLabel ? `captured ${reference.capturedLabel}` : "capture date unavailable";
    return (
      <a
        key={`${role}:${reference.href}`}
        href={reference.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${role.toLowerCase()} for ${context}: ${reference.descriptor}; ${reference.hostAndPath}; ${dateDescription}`}
        className="link-ext mono inline-flex max-w-full flex-wrap items-center gap-x-1 text-[11px]"
      >
        <span className="text-ink-faint">{role}</span>
        <span aria-hidden="true">·</span>
        <span className="max-w-full truncate" title={reference.descriptor}>{reference.descriptor}</span>
        <span aria-hidden="true">·</span>
        <span>{reference.hostAndPath}</span>
        <span aria-hidden="true">·</span>
        {reference.capturedLabel && reference.capturedValue ? (
          <span className="text-ink-faint">captured <time dateTime={reference.capturedValue}>{reference.capturedLabel}</time></span>
        ) : (
          <span className="text-ink-faint">capture date unavailable</span>
        )}
      </a>
    );
  });
}

function fundScaleTemporalLabel(source: SourceArtifact): string {
  const aum = source.fundScaleMetric === "regulatory_aum" || source.fundScaleMetric === "reported_aum";
  // Publication time is not an AUM measurement date. AUM can say "as of"
  // only when the fetched claim itself supplied fundScaleAsOf.
  const asOf = compactSourceDate(aum ? source.fundScaleAsOf : source.fundScaleAsOf ?? source.publishedAt);
  if (aum) {
    if (source.fundScaleTemporalState === "historical") return asOf ? `Historical AUM · As of ${asOf}` : "Historical AUM · as-of unavailable";
    return asOf ? `As of ${asOf}` : source.fundScaleTemporalState === "current" ? "Current AUM · as-of unavailable" : "AUM as-of unavailable";
  }
  if (source.fundScaleTemporalState === "fixed_historical") return asOf ? `Fixed historical · ${asOf}` : "Fixed historical";
  if (source.fundScaleTemporalState === "historical") return asOf ? `Historical · ${asOf}` : "Historical";
  return asOf ? `As of ${asOf}` : "Period unavailable";
}

function formatFundScaleUsd(value?: number): string {
  if (!Number.isFinite(value)) return "amount unavailable";
  const amount = value as number;
  if (amount >= 1_000_000_000_000) return `$${(amount / 1_000_000_000_000).toFixed(amount % 1_000_000_000_000 ? 1 : 0)}T`;
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(amount % 1_000_000_000 ? 1 : 0)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}M`;
  return `$${amount.toLocaleString()}`;
}

const SOURCE_KIND_LABEL: Record<FrozenSourceArtifact["kind"], string> = {
  press: "Press",
  legal_case: "Court record lead",
  sanctions_screen: "Sanctions screen",
  profile_photo: "Profile photo",
  trust_graph: "Trust graph screen",
  portfolio_relationship: "Portfolio relationship",
  fund_scale: "Fund scale",
};

const SOURCE_MATCH_LABEL: Record<FrozenSourceArtifact["match"], string> = {
  exact_name: "exact name",
  exact_handle: "exact handle",
  candidate: "candidate match",
  no_match: "no exact match",
  observed: "observed",
  risk_signal: "risk signal",
  screened_clear: "screened · no qualified match",
  relationship_confirmed: "relationship verified",
  fund_scale_confirmed: "fund size verified",
};

const PROFILE_CLASSIFICATION_LABEL: Record<FrozenProfileAuthenticity["classification"], string> = {
  real_candid: "Visually plausible personal photo",
  studio_or_stock: "Studio or stock-like image",
  ai_generated: "AI-generated image lead",
  celebrity_or_public_figure: "Public-figure image lead",
  logo_or_cartoon: "Logo or illustration",
  no_photo: "No custom profile photo",
  unclear: "Inconclusive image",
};

function validHash(value?: string): string | null {
  return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function safeFrozenImageData(value?: string): string | null {
  return value && /^data:image\/(?:jpeg|png|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : null;
}

function ExactVersionLink({ reportVersionId, version, label = "Open exact report version" }: { reportVersionId?: string; version?: number; label?: string }) {
  if (!reportVersionId) return null;
  return (
    <a
      href={exactReportPath(reportVersionId)}
      target="_blank"
      rel="noopener noreferrer"
      className="link-ext mono text-[11px]"
    >
      {label}{version != null ? ` v${version}` : ""}
    </a>
  );
}

function FrozenProfileAuthenticityPanel({
  result,
  artifact,
  reportVersionId,
  version,
}: {
  result: FrozenProfileAuthenticity;
  artifact?: FrozenSourceArtifact;
  reportVersionId?: string;
  version?: number;
}) {
  const capturedAt = frozenSourceDate(result.capturedAt);
  const imageHash = validHash(result.imageContentHash ?? artifact?.sourceContentHash);
  const artifactHash = validHash(artifact?.contentHash);
  const source = safeSourceLink(result.imageUrl ?? artifact?.sourceUrl);
  const frozenImageData = safeFrozenImageData(result.imageData);
  const imagePreview = frozenImageData ?? source?.href;
  const confidence = typeof result.confidence === "number"
    ? Math.round(Math.max(0, Math.min(1, result.confidence)) * 100)
    : null;
  const inconclusive = result.classification === "unclear";
  const tone = result.flag || inconclusive ? "var(--color-caution)" : "var(--color-signal)";
  const stateLabel = result.flag
    ? "REVIEW LEAD"
    : inconclusive
      ? "INCONCLUSIVE"
      : "VISUAL SCREEN RECORDED";

  return (
    <Section title="Profile-photo integrity" kicker="frozen before scoring · visual triage, not identity proof">
      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {imagePreview && result.classification !== "no_photo" && (
            <img
              src={imagePreview}
              alt="Profile image inspected by ARGUS"
              referrerPolicy="no-referrer"
              className="h-16 w-16 shrink-0 rounded-xl border border-line bg-void object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium text-ink">{PROFILE_CLASSIFICATION_LABEL[result.classification]}</span>
              <span className="chip tint-var" style={{ "--tint": tone } as React.CSSProperties}>
                {stateLabel}
              </span>
              {confidence != null && <span className="mono text-[11px] text-ink-faint">{confidence}% model confidence</span>}
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{result.note}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              This screen can surface synthetic, stock-like, or public-figure image leads. It cannot prove image ownership, identity, or web-wide reuse.
            </p>
            {result.tells.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Visible profile-image indicators">
                {result.tells.map((tell) => (
                  <span key={tell} className="chip">{tell}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 pt-3 text-[11px] text-ink-faint">
          {capturedAt && <span>Captured <time dateTime={result.capturedAt}>{capturedAt}</time></span>}
          <span className="mono" title={imageHash ?? undefined}>Source image SHA-256 {imageHash ? `${imageHash.slice(0, 12)}…` : "unavailable"}</span>
          {artifactHash && <span className="mono" title={artifactHash}>Artifact {artifactHash.slice(0, 12)}…</span>}
          {source && (
            <a href={source.href} target="_blank" rel="noopener noreferrer" className="link-ext mono">
              Open image source
            </a>
          )}
          <ExactVersionLink reportVersionId={reportVersionId} version={version} />
        </div>
        {imageHash && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {frozenImageData
              ? "The preview uses the exact image bytes retained with this report; the source-image hash verifies them."
              : source
                ? "The preview is loaded from the source URL and may change. The source-image hash identifies the exact bytes inspected in this report."
                : "No image preview is embedded in this snapshot. The source-image hash still identifies the exact bytes inspected."}
          </p>
        )}
      </Card>
    </Section>
  );
}

function FrozenTrustGraphPanel({
  screen,
  reportVersionId,
  version,
}: {
  screen: FrozenTrustGraphScreen;
  reportVersionId?: string;
  version?: number;
}) {
  const capturedAt = frozenSourceDate(screen.capturedAt);
  const graphHash = validHash(screen.sourceContentHash);
  const risk = screen.status === "risk";
  const incomplete = screen.status === "incomplete";
  const tone = risk
    ? screen.severity === "avoid" ? "var(--color-avoid)" : "var(--color-caution)"
    : incomplete ? "var(--color-caution)" : "var(--color-signal)";
  const stateLabel = risk
    ? "RISK SIGNAL"
    : incomplete
      ? "INCOMPLETE"
      : "SCREENED · NO QUALIFIED FLAGGED LINK";

  return (
    <Section title="Frozen trust-graph screen" kicker="organization-scoped graph state captured before scoring">
      <Card className="overflow-hidden">
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip tint-var" style={{ "--tint": tone } as React.CSSProperties}>
              {stateLabel}
            </span>
            {screen.severity && risk && <span className="mono text-[11px] uppercase text-ink-faint">{screen.severity} policy tier</span>}
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{screen.line}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            This is the graph state available at capture time. A shared person, wallet, funder, or project is an investigative lead; it is not proof of common control by itself.
          </p>

          <dl className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="stat-tile">
              <dt className="stat-label">Qualified reports</dt>
              <dd className="stat-value mt-0.5 font-semibold">{screen.qualifiedContributionCount} / {screen.contributionCount}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Connections surfaced</dt>
              <dd className="stat-value mt-0.5 font-semibold">{screen.connections.length}</dd>
            </div>
            <div className="stat-tile">
              <dt className="stat-label">Graph snapshot</dt>
              <dd className="mono mt-0.5 truncate text-[11px] text-ink-dim" title={graphHash ?? undefined}>{graphHash ? `${graphHash.slice(0, 16)}…` : "hash unavailable"}</dd>
            </div>
          </dl>
        </div>

        {screen.connections.length > 0 && (
          <div className="divide-y divide-line/60 border-t border-line/60">
            {screen.connections.map((connection) => {
              return (
                <article key={`${connection.other}:${connection.otherReportVersionId ?? "unversioned"}`} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-[12.5px] font-medium text-ink">{connection.other}</span>
                    {connection.otherVerdict && <VerdictPill verdict={connection.otherVerdict} />}
                    <span className={`chip ${connection.qualified ? "tint-pass" : ""}`}>
                      {connection.qualified ? "decision-qualified snapshot" : "context only"}
                    </span>
                    {connection.direct && <span className="text-[11px] text-ink-faint">directly surfaced</span>}
                    <span className="ml-auto">
                      <ExactVersionLink reportVersionId={connection.otherReportVersionId} label="Open exact connected report" />
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                    {connection.otherAttestation && <span>{connection.otherAttestation.replace(/_/g, " ")}</span>}
                    {connection.otherCompleteness && <span>{connection.otherCompleteness} coverage</span>}
                    {!connection.otherReportVersionId && <span>Exact report version unavailable</span>}
                  </div>
                  {connection.ties.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Frozen ties to ${connection.other}`}>
                      {connection.ties.map((tie) => (
                        <span key={`${tie.key}:${tie.strength}`} className="chip normal-case" title={[...tie.subjectEdgeTypes, ...tie.otherEdgeTypes].join(" · ")}>
                          <span className="uppercase text-ink-faint">{tie.strength}</span>
                          {tie.label}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 px-4 py-3 text-[11px] text-ink-faint">
          {capturedAt && <span>Captured <time dateTime={screen.capturedAt}>{capturedAt}</time></span>}
          <span className="mono" title={graphHash ?? undefined}>Graph snapshot SHA-256 {graphHash ? `${graphHash.slice(0, 12)}…` : "unavailable"}</span>
          <ExactVersionLink reportVersionId={reportVersionId} version={version} />
        </div>
      </Card>
    </Section>
  );
}

function FrozenSourceLedger({
  artifacts,
  subjectHandle,
  profile,
}: {
  artifacts: FrozenSourceArtifact[];
  subjectHandle: string;
  profile: unknown;
}) {
  if (!artifacts.length) return null;
  const fundScalePeers = artifacts.filter((artifact) => artifact.kind === "fund_scale");
  return (
    <div id="frozen-source-ledger" className="scroll-mt-24">
      <Section
        title="Frozen source ledger"
        kicker="off-chain sources captured before scoring · tamper-evident artifact records"
      >
        <Card className="divide-y divide-line/60 overflow-hidden">
        {artifacts.map((artifact, index) => {
          const source = safeSourceLink(artifact.sourceUrl);
          const capturedAt = frozenSourceDate(artifact.capturedAt);
          const publishedAt = frozenSourceDate(artifact.publishedAt);
          const hash = validHash(artifact.contentHash);
          const sourceHash = validHash(artifact.sourceContentHash);
          const sourceHashLabel = artifact.kind === "sanctions_screen"
            ? "Source index"
            : artifact.kind === "profile_photo"
              ? "Source image"
              : artifact.kind === "trust_graph"
                ? "Graph snapshot"
                : "Source content";
          const strictFundScaleMatch = artifact.kind === "fund_scale"
            && isStrictFundScaleArtifact(artifact, fundScalePeers, { subjectHandle, profile });
          const matchLabel = artifact.kind === "fund_scale" && artifact.match === "fund_scale_confirmed"
            ? strictFundScaleMatch ? "fund size verified" : "reported · strict verification incomplete"
            : SOURCE_MATCH_LABEL[artifact.match];
          const matchColor = artifact.match === "risk_signal"
            ? "var(--color-caution)"
            : artifact.match === "relationship_confirmed" || strictFundScaleMatch
              ? "var(--color-pass)"
            : artifact.match === "candidate"
              ? "var(--color-caution)"
              : artifact.match === "no_match" || artifact.match === "screened_clear"
                ? "var(--color-ink-dim)"
                : "var(--color-signal)";
          return (
            <article id={`source-${artifact.contentHash}`} key={`${artifact.provider}:${artifact.contentHash}:${index}`} className="scroll-mt-24 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">
                  {SOURCE_KIND_LABEL[artifact.kind]}
                </span>
                <span className="mono text-[11px] uppercase tracking-wide text-ink-faint">{artifact.provider}</span>
                <span className="chip tint-var" style={{ "--tint": matchColor } as React.CSSProperties}>
                  {matchLabel}
                </span>
              </div>
              <h3 className="mt-2 text-[13.5px] font-medium leading-snug text-ink">{artifact.title}</h3>
              {artifact.excerpt && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{artifact.excerpt}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                {publishedAt && <span>Published <time dateTime={artifact.publishedAt}>{publishedAt}</time></span>}
                {capturedAt && <span>Captured <time dateTime={artifact.capturedAt}>{capturedAt}</time></span>}
                <span className="mono" title={hash ?? undefined}>SHA-256 {hash ? `${hash.slice(0, 12)}…` : "unavailable"}</span>
                {sourceHash && <span className="mono" title={sourceHash}>{sourceHashLabel} {sourceHash.slice(0, 12)}…</span>}
              </div>
              {source ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
                  aria-label={`Open frozen ${SOURCE_KIND_LABEL[artifact.kind].toLowerCase()} source in a new tab: ${artifact.title}`}
                >
                  <span className="shrink-0 text-ink-faint">Open source</span>
                  <span className="truncate">{source.label}</span>
                </a>
              ) : (
                <p className="mt-2 text-[11px] text-ink-faint">Source link unavailable</p>
              )}
            </article>
          );
        })}
        </Card>
      </Section>
    </div>
  );
}

/* ── main report ──────────────────────────────────────────────────── */

type ReportTeamMember = Dossier["webTeam"][number];

function groundedTeamMember(member: ReportTeamMember): boolean {
  return member.evidence_origin !== "model_lead" && member.artifact_verified === true;
}

function sanitizedGroundedTeamMember(member: ReportTeamMember): ReportTeamMember {
  return {
    ...member,
    ...(member.identity_link_evidence_origin === "model_lead"
      ? { handle: undefined, linkedin: undefined }
      : {}),
    ...(member.projects_evidence_origin === "model_lead" ? { projects: [] } : {}),
  };
}

function reportTeamLeads(dossier: Dossier): ReportTeamMember[] {
  const inferred = (dossier.webTeam ?? []).flatMap((member) => {
    if (!groundedTeamMember(member)) return [member];
    if (member.identity_link_evidence_origin !== "model_lead" && member.projects_evidence_origin !== "model_lead") return [];
    return [{
      ...member,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
      provider: "grok",
    }];
  });
  const seen = new Set<string>();
  return [...(dossier.webTeamLeads ?? []), ...inferred].filter((member) => {
    const key = [member.name, member.handle ?? "", member.linkedin ?? "", member.role, member.source].join("|").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function Report({ dossier, onReset, onAudit, onRescan, onOpenProject, onOpenBrief }: { dossier: Dossier; onReset: () => void; onAudit?: (q: string) => void; onRescan?: () => void; onOpenProject?: (name: string, domain?: string, panelCostToken?: string) => void; onOpenBrief?: () => void }) {
  const { role } = useArgusAuth();
  const f = dossier;
  const { report, graph, founderSummary, evidence } = dossier;
  const fundScaleProfile = {
    handle: f.handle,
    display_name: f.display_name,
    resolved_name: f.resolved_name,
    bio: f.bio,
    website: f.website,
    profile_collection_state: f.profile_collection_state,
    profile_provider: f.profile_provider,
    profile_captured_at: f.profile_captured_at,
  };
  const webTeam = (dossier.webTeam ?? []).filter(groundedTeamMember).map(sanitizedGroundedTeamMember);
  const webTeamLeads = reportTeamLeads(dossier);
  const groundedVentureNames = (evidence.ventures ?? [])
    .filter((venture) => venture.evidence_origin !== "model_lead" && venture.artifact_verified === true)
    .map((venture) => venture.project_name);
  const portfolioArtifactGroups = [...(f.sourceArtifacts ?? [])
    .filter((artifact) => artifact.kind === "portfolio_relationship" && artifact.projectName)
    .reduce((groups, artifact) => {
      const investor = artifact.investorEntityName || artifact.subjectName || f.display_name || report.handle;
      const subject = artifact.subjectName || f.display_name || report.handle;
      const attribution = artifact.attribution ?? "unattributed";
      const key = `${investor.trim().toLowerCase()}::${artifact.projectName!.trim().toLowerCase()}::${attribution}`;
      const group = groups.get(key) ?? { key, project: artifact.projectName!, investor, subject, attribution: artifact.attribution, sources: [] as SourceArtifact[] };
      group.sources.push(artifact);
      groups.set(key, group);
      return groups;
    }, new Map<string, { key: string; project: string; investor: string; subject: string; attribution?: SourceArtifact["attribution"]; sources: SourceArtifact[] }>())
    .values()]
    .map((group) => ({
      ...group,
      confirmed: group.sources.some((source) => source.match === "relationship_confirmed"),
      confirmedSourceCount: group.sources.filter((source) => source.match === "relationship_confirmed").length,
      reportedSourceCount: group.sources.filter((source) => source.match !== "relationship_confirmed").length,
    }))
    .sort((left, right) => Number(right.confirmed) - Number(left.confirmed) || left.project.localeCompare(right.project));
  const verifiedPortfolioProjects = portfolioArtifactGroups.filter((group) => group.confirmed).map((group) => group.project);
  const reportedPortfolioProjects = portfolioArtifactGroups.filter((group) => !group.confirmed).map((group) => group.project);
  const fundScaleArtifacts = (f.sourceArtifacts ?? []).filter((artifact) => artifact.kind === "fund_scale");
  const fundScaleArtifactGroups = [...fundScaleArtifacts
    .filter((artifact) => artifact.kind === "fund_scale" && artifact.fundName && Number.isFinite(artifact.fundSizeUsd))
    .reduce((groups, artifact) => {
      const key = artifact.fundScaleClaimId?.trim() || [
        "legacy",
        artifact.fundName!.trim().toLowerCase(),
        artifact.fundVehicle?.trim().toLowerCase() ?? "vehicle-unknown",
        artifact.fundScaleMetric ?? "metric-unknown",
        artifact.fundSizeUsd,
        artifact.fundAmountQualifier ?? "qualifier-unknown",
        artifact.attribution ?? "attribution-unknown",
      ].join("::");
      const group = groups.get(key) ?? {
        key,
        fundName: artifact.fundName!,
        amountUsd: artifact.fundSizeUsd!,
        metric: artifact.fundScaleMetric,
        qualifier: artifact.fundAmountQualifier,
        attribution: artifact.attribution,
        sources: [] as SourceArtifact[],
      };
      group.sources.push(artifact);
      groups.set(key, group);
      return groups;
    }, new Map<string, {
      key: string;
      fundName: string;
      amountUsd: number;
      metric?: SourceArtifact["fundScaleMetric"];
      qualifier?: SourceArtifact["fundAmountQualifier"];
      attribution?: SourceArtifact["attribution"];
      sources: SourceArtifact[];
    }>())
    .values()]
    .map((group) => {
      const strictSources = group.sources.filter((source) => isStrictFundScaleArtifact(source, fundScaleArtifacts, {
        subjectHandle: report.handle,
        profile: fundScaleProfile,
      }));
      const representative = strictSources[0] ?? group.sources[0];
      return {
        ...group,
        subject: representative.subjectName || f.display_name || report.handle,
        investor: representative.investorEntityName || group.fundName,
        fundVehicle: representative.fundVehicle,
        basis: representative.fundScaleBasis,
        temporalLabel: fundScaleTemporalLabel(representative),
        confirmed: strictSources.length > 0,
        confirmedSourceCount: strictSources.length,
        reportedSourceCount: group.sources.length - strictSources.length,
      };
    })
    .sort((left, right) => Number(right.confirmed) - Number(left.confirmed) || right.amountUsd - left.amountUsd);
  const verifiedFundScaleClaims = fundScaleArtifactGroups.filter((group) => group.confirmed);
  const reportedFundScaleClaims = fundScaleArtifactGroups.filter((group) => !group.confirmed);
  const portfolioLeads = f.portfolioLeads ?? [];
  const verifiedPortfolioProjectKeys = new Set(verifiedPortfolioProjects.map((project) => project.trim().toLowerCase()));
  const unmatchedPortfolioLeadCount = portfolioLeads.filter((lead) =>
    !verifiedPortfolioProjectKeys.has(lead.projectName.trim().toLowerCase())).length;
  const roles = report.roles as SubjectClass[];
  const derivedDiligenceChecks = personChecks({
    identityConfidence: report.identity_confidence ?? undefined,
    realName: (f.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
    roles,
    hasAssociates: (evidence.associates?.length ?? 0) > 0,
  });
  const versionContext = f.versionContext ?? f.viewVersionContext;
  const diligenceChecks = versionContext
    ? versionContext.checks
    : f.checkRuns?.length
      ? f.checkRuns
      : derivedDiligenceChecks;
  const legacyCoverageNotCaptured = versionContext?.attestationState === "legacy_unattested"
    && versionContext.checks.length === 0;
  const readiness = deriveDecisionReadiness(diligenceChecks);
  const recordedCompleteness = versionContext?.completenessState ?? f.completeness_state;
  const presentationCompleteness = coverageQualifiedCompleteness({
    completeness: recordedCompleteness ?? (readiness.status === "ready" ? "complete" : "partial"),
    attestation: versionContext?.attestationState ?? (f.live ? "server_collected" : undefined),
    checks: diligenceChecks,
  });
  const presentation = presentPublicReport({
    verdict: report.composite_verdict,
    score: report.governing_score,
    completeness: presentationCompleteness,
  });
  const readinessTitle = legacyCoverageNotCaptured ? "Coverage not captured" : readiness.title;
  const readinessGuidance = legacyCoverageNotCaptured
    ? "This legacy snapshot predates frozen check-level coverage. Its saved score is preserved for historical auditability, not as proof that due diligence was completed."
    : readiness.guidance;
  const presentedVerdict = presentation.displayVerdict === "UNVERIFIABLE"
    ? "UNVERIFIABLE_IDENTITY"
    : presentation.displayVerdict;
  const m = verdictMeta(presentedVerdict);
  const readinessColor = readiness.status === "ready" ? "var(--color-pass)" : "var(--color-caution)";
  const embeddedFacet = Boolean(f.viewVersionContext || f.viewPersistence);
  const livePersistence = f.viewPersistence ?? f.persistence;
  const panelCostToken = !versionContext && livePersistence?.state === "persisted"
    ? livePersistence.panelCostToken ?? undefined
    : undefined;
  const evidenceReportVersionId = versionContext?.reportVersionId
    ?? (livePersistence?.state === "persisted" ? livePersistence.reportVersionId ?? undefined : undefined);
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const persistencePending = !versionContext && livePersistence?.state === "pending";
  const persistenceFailed = !versionContext && livePersistence?.state === "failed";
  const persistenceMissingCapability = !versionContext
    && livePersistence?.state === "persisted"
    && !panelCostToken;
  const privateSession = livePersistence?.state === "private";
  const showCurrentIntelligence = versionContext
    ? currentIntelligenceEnabled
    : !privateSession && !persistencePending && !persistenceFailed && !persistenceMissingCapability;
  const frozenOutcomeChecks = versionContext?.checks ?? f.checkRuns ?? [];
  const recordedFrozenCheck = (checkId: string) => frozenOutcomeChecks.some((check) =>
    check.checkId === checkId
    && check.status !== "unknown"
    && check.status !== "stale",
  );
  const profilePhotoArtifact = f.sourceArtifacts?.find((artifact) => artifact.kind === "profile_photo");
  const trustGraphArtifact = f.sourceArtifacts?.find((artifact) => artifact.kind === "trust_graph");
  const hasFrozenProfilePhotoOutcome = Boolean(
    f.profileAuthenticity
    || profilePhotoArtifact
    || recordedFrozenCheck("profile-photo-authenticity"),
  );
  const hasFrozenTrustGraphOutcome = Boolean(
    f.trustGraphScreen
    || trustGraphArtifact
    || recordedFrozenCheck("trust-graph-connections"),
  );
  const explicitCurrentOverlay = Boolean(versionContext && currentIntelligenceEnabled);
  const hasFrozenOffchainOutcomes = ["news-press", "us-legal-history", "ofac-sanctions-name"].every(
    (checkId) => frozenOutcomeChecks.some((check) =>
      check.checkId === checkId && check.status !== "unknown" && check.status !== "stale",
    ),
  );
  const showOffchainSupplemental = showCurrentIntelligence
    && (explicitCurrentOverlay || !hasFrozenOffchainOutcomes);
  const showProfilePhotoSupplemental = showCurrentIntelligence
    && (explicitCurrentOverlay || !hasFrozenProfilePhotoOutcome);
  const showTrustGraphSupplemental = showCurrentIntelligence
    && (explicitCurrentOverlay || !hasFrozenTrustGraphOutcome);
  const canRecordCurrentIntelligence = !versionContext && livePersistence?.state !== "private";
  const canMutateWorkspace = !versionContext && livePersistence?.state !== "private";
  const canShare = !embeddedFacet && Boolean(
    f.versionContext?.reportVersionId
    || (f.persistence?.state === "persisted" && f.persistence.reportVersionId),
  );
  const canArchive = role === "owner" && Boolean(
    f.versionContext?.reportVersionId
    || (f.persistence?.state === "persisted" && f.persistence.reportVersionId),
  );
  const attestationLabel = versionContext?.attestationState === "server_collected"
    ? "server-collected snapshot"
    : versionContext?.attestationState === "analyst_submitted"
      ? "analyst-submitted snapshot"
      : versionContext
        ? "legacy snapshot"
        : null;
  const capturedLabel = versionContext?.createdAt
    ? new Date(versionContext.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;
  const governingRoleReport = report.role_reports.find((rr) => rr.role === report.governing_role)
    ?? report.role_reports[0];
  const publishableSubjectFindings = report.publishable_findings.filter((finding) =>
    isPublishableSubjectFinding(finding, report.handle),
  );
  const quarantinedLegacyFindings = report.publishable_findings.filter((finding) =>
    !isPublishableSubjectFinding(finding, report.handle),
  );
  const investigativeLeads = [...(report.investigative_leads ?? []), ...quarantinedLegacyFindings]
    .filter((finding, index, all) => all.findIndex((candidate) =>
      candidate.finding_type === finding.finding_type
      && candidate.claim === finding.claim
      && candidate.source_url === finding.source_url,
    ) === index);
  const quarantinedRelatedHandles = new Set(quarantinedLegacyFindings
    .map((finding) => normalizedEntityHandle(findingTarget(finding)))
    .filter((target): target is string => Boolean(target && target !== normalizedEntityHandle(report.handle))));
  const visibleContradictions = f.contradictions.filter((contradiction) => {
    const text = `${contradiction.claim}\n${contradiction.conflict}`.toLowerCase();
    return ![...quarantinedRelatedHandles].some((target) => text.includes(`@${target}`));
  });
  const [watched, setWatched] = useState(() => isWatched(report.handle));
  // The compounding web: who else (from your past audits) this subject is tied to.
  const connections = subjectConnections(report.handle, getContributions());
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [archiveState, setArchiveState] = useState<"idle" | "archiving" | "error">("idle");

  const archive = async () => {
    if (archiveState === "archiving") return;
    if (!window.confirm(
      `Archive ${report.handle}? Its immutable report, evidence, audit history, and trust-graph intelligence will be preserved. Active public share links will be revoked.`,
    )) return;
    setArchiveState("archiving");
    try {
      await changeReportLifecycle("archive", [{ kind: "person", ref: report.handle }]);
      onReset();
    } catch (archiveError) {
      console.error("[case] archive failed", archiveError);
      setArchiveState("error");
    }
  };
  const share = async () => {
    if (shareState === "creating") return;
    setShareState("creating");
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "person",
          ref: report.handle,
          reportVersionId: f.versionContext?.reportVersionId
            ?? (f.persistence?.state === "persisted" ? f.persistence.reportVersionId : undefined),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: unknown; message?: unknown };
      if (!response.ok || typeof body.url !== "string") {
        throw new Error(typeof body.message === "string" ? body.message : "Secure share link creation failed.");
      }
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(new URL(body.url, location.origin).toString());
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 1800);
    } catch (error) {
      console.error("[share] principal report failed", error);
      setShareState("error");
      setTimeout(() => setShareState("idle"), 3000);
    }
  };
  const watch = () => {
    if (!canMutateWorkspace) return;
    const watchVerdict = presentation.displayVerdict === "UNVERIFIABLE"
      ? "UNVERIFIABLE_IDENTITY"
      : presentation.displayVerdict;
    setWatched(
      toggleWatch({
        id: report.handle, kind: "person", label: report.handle, addedAt: 0,
        snapshot: {
          verdict: watchVerdict,
          score: presentation.primaryScore ? report.governing_score : null,
          completenessState: presentationCompleteness,
        },
      }),
    );
  };

  const corroborationRows = [
    ...evidence.testimonials.map((t) => ({
      who: t.claimed_endorser_handle ?? t.claimed_endorser_name ?? "—",
      rel: t.claimed_relationship,
      follows: t.follows_subject,
      ack: t.public_acknowledgment,
      verdict: t.corroboration_verdict,
      note: t.notes,
    })),
  ];

  const advisedRows = evidence.advised;

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-72" />

      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13.5px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Audits
          </button>
          <span className="mono text-[11px] text-ink-faint">/ {report.audit_id}</span>
          <span
            className={`chip ${!versionContext && f.live ? "tint-signal" : ""}`}
            title={versionContext ? `Frozen immutable report version ${versionContext.version}` : f.live ? "Collected live from data providers" : "Curated dossier (no provider keys configured)"}
          >
            {versionContext ? `SNAPSHOT v${versionContext.version}` : f.live ? "● LIVE SCAN" : "CURATED"}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {onRescan && (
              <button onClick={onRescan} title="Run this audit again, fresh" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] tint-signal transition">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
                Rescan
              </button>
            )}
            {onOpenBrief && (
              <button
                type="button"
                onClick={onOpenBrief}
                title="Open the analyst decision brief anchored to this exact person case"
                className="btn-secondary px-3 py-1.5 text-[12.5px] font-medium"
              >
                Case brief
              </button>
            )}
            {canShare && (
              <button
                onClick={() => void share()}
                disabled={shareState === "creating"}
                aria-live="polite"
                title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable report link"}
                className="btn-secondary px-3 py-1.5 text-[12.5px] disabled:cursor-wait disabled:opacity-60"
              >
                {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied ✓" : shareState === "error" ? "Share failed · retry" : "Share"}
              </button>
            )}
            {canMutateWorkspace && (
              <button onClick={watch} className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition ${watched ? "tint-signal" : "btn-secondary"}`}>
                {watched ? "★ Watching" : "☆ Watch"}
              </button>
            )}
            <button
              onClick={onReset}
              className="btn-secondary px-3 py-1.5 text-[12.5px]"
            >
              New audit
            </button>
            {canArchive && (
              <details className="relative">
                <summary className="btn-secondary list-none cursor-pointer px-3 py-1.5 text-[12.5px] [&::-webkit-details-marker]:hidden">
                  More
                </summary>
                <div className="panel absolute right-0 top-full z-30 mt-1.5 w-56 p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => void archive()}
                    disabled={archiveState === "archiving"}
                    title="Remove this case from active work while preserving its immutable evidence and history"
                    className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] text-ink-dim transition hover:bg-signal/10 hover:text-signal disabled:cursor-wait disabled:opacity-60"
                  >
                    {archiveState === "archiving" ? "Archiving case…" : archiveState === "error" ? "Archive failed · retry" : "Archive case"}
                  </button>
                </div>
              </details>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5">
        {!versionContext && <div className="mt-4"><ServiceAlert /></div>}
        {versionContext && (
          <div className="mt-4">
            <SnapshotEvidenceControl
              snapshotVersion={versionContext.version}
              capturedAt={versionContext.createdAt}
              currentIntelligenceEnabled={currentIntelligenceEnabled}
              onLoadCurrentIntelligence={() => setCurrentIntelligenceVersionId(versionContext.reportVersionId)}
            />
          </div>
        )}
        {!versionContext && (showCurrentIntelligence || privateSession) && (
          <div className="mt-4">
            <LiveSupplementalNotice private={privateSession} persisted={livePersistence?.state === "persisted"} />
          </div>
        )}
        {persistencePending && (
          <div className="panel mt-4 px-4 py-3 text-[12.5px] text-ink-dim" role="status">
            Saving the immutable audit before post-scan intelligence runs…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="finding tint-caution mt-4 px-4 py-3 text-[12.5px]" role="alert">
            Post-scan intelligence is paused because this audit is not safely bound to an immutable version. Rescan before spending on supplemental providers.
          </div>
        )}
        {showTrustGraphSupplemental && <RingAlert handle={report.handle} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* subject identity */}
        <div className="mt-6 flex flex-wrap items-start gap-4">
          <Avatar src={f.avatar_url || xAvatar(f.handle)} letter={f.avatar} size={56} rounded="rounded-2xl" letterClass="text-2xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h1 className="display-sm text-[24px] leading-tight text-ink">{f.display_name}</h1>
              <span className="mono text-[13.5px] text-ink-faint">{f.handle}</span>
            </div>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">{f.bio}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-faint">
              <span><span className="text-ink-dim">{f.followers}</span> followers</span>
              <span>joined {f.joined}</span>
              {typeof f.days_since_post === "number" && (
                <span className={f.days_since_post >= 21 ? "text-avoid" : "text-ink-faint"}>
                  {f.days_since_post >= 21 ? "⚠ " : ""}
                  {f.days_since_post === 0 ? "posted today" : f.days_since_post === 1 ? "posted yesterday" : `last posted ${f.days_since_post}d ago`}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                {roles.map((r) => (
                  <span key={r} className="chip">
                    {ROLE_META[r].glyph} {ROLE_META[r].label}
                  </span>
                ))}
              </span>
            </div>
            {/* follower quality: high-reach + known accounts that follow this subject */}
            {f.notableFollowers.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-faint">Top followers</span>
                {f.notableFollowers.slice(0, 10).map((n) => {
                  const big = (n.count ?? 0) >= 1e6;
                  return (
                    <a
                      key={n.handle}
                      href={`https://x.com/${n.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className={`chip normal-case tracking-normal transition hover:text-ink ${big ? "tint-pass" : ""}`}
                      title={`${n.label} · ${n.size} followers`}
                    >
                      @{n.handle} <span className="opacity-70">{n.size}{n.label && n.label !== "high reach" ? ` · ${n.label}` : ""}</span>
                    </a>
                  );
                })}
                {f.notableFollowers.length > 10 && <span className="text-[11px] text-ink-faint">+{f.notableFollowers.length - 10} more</span>}
              </div>
            )}
          </div>
        </div>

        {/* verdict hero */}
        <div
          className="relative mt-6 overflow-hidden rounded-2xl border bg-panel soft-shadow"
          style={{ borderColor: `color-mix(in oklab, ${m.color} 42%, transparent)` }}
        >
          <div className="absolute right-0 top-0 h-full w-1/2" style={{ background: `radial-gradient(400px 200px at 100% 0%, color-mix(in oklab, ${m.color} 13%, transparent), transparent 70%)` }} />
          <div className="relative flex flex-wrap items-center gap-6 p-6 pb-5">
            <div className="shrink-0 text-center">
              <ScoreRing score={presentation.primaryScore ? report.governing_score : null} verdict={presentedVerdict} size={104} />
              <div className="mono mt-1.5 text-[11px] uppercase tracking-wider text-ink-dim">
                {presentation.scoreLabel?.toLowerCase() ?? "score withheld"}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="eyebrow mb-1.5">{presentation.resultLabel}</div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="display text-[44px] uppercase leading-none max-md:text-[32px]" style={{ color: m.color }}>
                  {m.label}
                </span>
                {presentation.secondarySignal && (
                  <span className="chip tint-caution">{presentation.secondarySignal}</span>
                )}
                {report.governing_role && (
                  <span className="mono text-[11px] text-ink-dim">
                    governed by {ROLE_META[report.governing_role as SubjectClass].label.toLowerCase()}
                  </span>
                )}
              </div>
              <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
                {presentation.final ? f.headline : legacyCoverageNotCaptured ? readinessGuidance : presentation.note}
              </p>
              {!presentation.final && f.headline && (
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-ink-faint">
                  <span className="text-ink-dim">Stored scored-evidence summary — not clearance:</span> {f.headline}
                </p>
              )}
              {report.cap_applied && (
                <div className="chip tint-avoid mt-3 font-medium">
                  ▲ Hard cap · {capLabel(report.cap_applied)}
                </div>
              )}
            </div>
          </div>
          <div
            className="finding tint-var relative px-6 py-4"
            style={{ "--tint": readinessColor } as React.CSSProperties}
            aria-label="Due-diligence readiness"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-[12.5px] font-semibold uppercase tracking-[0.14em]">
                {readinessTitle}
              </span>
              <span className="text-[11px] text-ink-faint">
                {legacyCoverageNotCaptured
                  ? "this snapshot contains no frozen check-level outcomes"
                  : "observable outcomes stored in this report"}
              </span>
              {!legacyCoverageNotCaptured && diligenceChecks.length > 0 && (
                <a href="#scan-methodology" className="ml-auto text-[11px] text-signal-dim underline-offset-2 hover:underline">
                  Review coverage gaps
                </a>
              )}
            </div>
            {versionContext && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint" aria-label="Immutable report version metadata">
                <span className="mono uppercase tracking-wide">{versionContext.completenessState} version</span>
                {attestationLabel && <span>{attestationLabel}</span>}
                {capturedLabel && <span>captured {capturedLabel}</span>}
                {versionContext.methodologyVersion && <span className="mono">methodology {versionContext.methodologyVersion}</span>}
              </div>
            )}
            {legacyCoverageNotCaptured ? (
              <>
                <div className="panel-inset mt-3 flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-ink">Frozen coverage unavailable</div>
                    <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">{readinessGuidance}</p>
                  </div>
                  {onRescan && (
                    <button
                      type="button"
                      onClick={onRescan}
                      className="btn-chip tint-signal min-h-11 shrink-0 font-medium"
                    >
                      Rescan to capture coverage
                    </button>
                  )}
                </div>
                <div className="mt-3">
                  <DecisionBasis
                    roleReport={governingRoleReport}
                    catalog={f.axisEvidenceCatalog}
                    lineageVersion={f.axisCitationVersion}
                  />
                </div>
              </>
            ) : (
              <>
                <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="stat-tile">
                    <dt className="stat-label">Evidence coverage</dt>
                    <dd className="stat-value mt-0.5 font-semibold">{readiness.coveragePercent}%</dd>
                  </div>
                  <div className="stat-tile">
                    <dt className="stat-label">Recorded outcomes</dt>
                    <dd className="stat-value mt-0.5 font-semibold">{readiness.successful} / {readiness.applicable}</dd>
                  </div>
                  <div className="stat-tile">
                    <dt className="stat-label">Unresolved checks</dt>
                    <dd className="stat-value mt-0.5 font-semibold" style={{ color: readiness.unresolved ? readinessColor : "var(--color-ink)" }}>{readiness.unresolved}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <DecisionBasis
                    roleReport={governingRoleReport}
                    catalog={f.axisEvidenceCatalog}
                    lineageVersion={f.axisCitationVersion}
                    onRescan={onRescan}
                  />
                </div>
                {presentation.final && (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{readinessGuidance}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Supplemental live checks are deliberately separated from the frozen
            score. They self-gate on a resolved real name and never imply broad
            legal or sanctions clearance. */}
        {showOffchainSupplemental && (
          <div className="mt-3 space-y-2">
            <SanctionsNameScreen name={f.display_name} resolved={report.identity_confidence === "Confirmed" || report.identity_confidence === "Probable"} />
            <LegalScreen name={f.display_name} resolved={report.identity_confidence === "Confirmed" || report.identity_confidence === "Probable"} />
          </div>
        )}

        {/* identity: when a named team resolved it, SHOW the team here (the note
            would just narrate the same names); otherwise show the note.
            NOT for KOLs: a KOL's display name colliding with a real project (e.g.
            "@KaminoCrypto" vs the Kamino protocol) pulled that project's team in by
            NAME and wrongly presented it as this handle's identity. A KOL is a
            pseudonymous individual, not a project team — the name-search team is a
            collision, and the contradictions section already explains it. */}
        {report.governing_role !== "KOL" && webTeam && webTeam.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="chip normal-case">{report.identity_confidence}</span>
              <span className="text-[11px] text-ink-faint">identity resolved through the named team · click a handle to audit them</span>
            </div>
            <Card className="divide-y divide-line/60">
              {webTeam.map((p, i) => (
                <div key={i} className="px-4 py-2.5 text-[12.5px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Avatar src={personAvatar(p.handle, p.linkedin)} letter={(p.name.replace(/^@/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[10px]" />
                      <span className="text-ink">{p.name}</span>
                      {p.handle && <span className="mono text-[11px] text-ink-faint">{p.handle}</span>}
                      <span className="chip shrink-0">{p.role}</span>
                      {p.linkedin && (
                        <a href={`https://${p.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>
                      )}
                      {p.evidence && <span className="text-[11px] text-ink-faint">· {p.evidence}</span>}
                      <span className="text-[11px] text-ink-faint">({p.source})</span>
                    </span>
                    {p.handle && onAudit ? (
                      <button onClick={() => onAudit(p.handle!)} className="btn-chip tint-signal shrink-0">audit →</button>
                    ) : (
                      <span className="mono shrink-0 text-[11px] text-ink-faint">named only</span>
                    )}
                  </div>
                  {p.projects && p.projects.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[26px] text-[11px] text-ink-faint">
                      <span>also:</span>
                      {p.projects.map((pr, j) => (
                        onOpenProject ? (
                          <button key={j} onClick={() => onOpenProject(pr.name, undefined, panelCostToken)} title="Dig everyone on this project" className="btn-chip tint-signal normal-case">
                            {pr.name}{pr.role ? <span className="text-ink-faint"> · {pr.role}</span> : null}
                          </button>
                        ) : (
                          <span key={j} className="chip normal-case">{pr.name}{pr.role ? ` · ${pr.role}` : ""}</span>
                        )
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Card>
            {f.prior_handles && f.prior_handles.length > 0 && (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-caution">
                ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
              </p>
            )}
          </div>
        ) : (
          <div className="panel mt-3 flex items-start gap-3 px-4 py-3">
            <span className={`chip normal-case mt-0.5 ${report.identity_confidence === "SuspectedImpersonation" ? "tint-unverifiable" : ""}`}>
              {report.identity_confidence}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] leading-relaxed text-ink-dim">{f.identity_note}</p>
              {f.prior_handles && f.prior_handles.length > 0 && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-caution">
                  ▲ Rebrand: previously {f.prior_handles.map((h) => `@${h}`).join(", ")}. A handle change can be a fresh-start move to shed an old reputation.
                </p>
              )}
            </div>
          </div>
        )}

        {webTeamLeads.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="chip tint-caution">Investigative team candidates</span>
              <span className="text-[11px] text-ink-faint">unverified leads · not identity proof · not scored or sent to report chat</span>
            </div>
            <Card className="divide-y divide-line/60 border-caution/25">
              {webTeamLeads.map((member, index) => (
                <div key={`${member.name}:${member.role}:${member.source}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-[12.5px]">
                  <span className="font-medium text-ink-dim">{member.name}</span>
                  <span className="chip">{member.role}</span>
                  {member.handle && <span className="mono text-[11px] text-caution">candidate {member.handle}</span>}
                  {member.linkedin && <span className="text-[11px] text-ink-faint">LinkedIn candidate recorded</span>}
                  <span className="text-[11px] text-ink-faint">{member.provider ?? member.source}</span>
                  {member.evidence && <span className="min-w-full text-[11px] leading-relaxed text-ink-faint">{member.evidence}</span>}
                  {member.handle && onAudit && (
                    <button
                      type="button"
                      onClick={() => onAudit(member.handle!)}
                      className="btn-chip tint-caution ml-auto min-h-11"
                    >
                      verify →
                    </button>
                  )}
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* contradictions — claims that do not match the evidence */}
        {visibleContradictions.length > 0 && (
          <Section title="Contradictions" kicker="claims that do not match the collected evidence">
            <Card className="divide-y divide-line/60">
              {visibleContradictions.map((c, i) => {
                const sc = c.severity === "high" ? "var(--color-avoid)" : c.severity === "medium" ? "var(--color-caution)" : "var(--color-ink-faint)";
                return (
                  <div key={i} className="flex items-start gap-2.5 px-4 py-3">
                    <span className="chip tint-var mt-0.5 shrink-0" style={{ "--tint": sc } as React.CSSProperties}>{c.severity}</span>
                    <div className="min-w-0 text-[12.5px] leading-snug">
                      <span className="text-ink">{c.claim}</span>
                      <span className="text-ink-faint"> — but </span>
                      <span className="text-ink-dim">{c.conflict}</span>
                      {c.confidence === "low" && <span className="ml-1.5 text-[11px] text-ink-faint">(low confidence)</span>}
                    </div>
                  </div>
                );
              })}
            </Card>
          </Section>
        )}

        {f.profileAuthenticity && (
          <FrozenProfileAuthenticityPanel
            result={f.profileAuthenticity}
            artifact={profilePhotoArtifact}
            reportVersionId={evidenceReportVersionId}
            version={versionContext?.version}
          />
        )}

        {f.trustGraphScreen && (
          <FrozenTrustGraphPanel
            screen={f.trustGraphScreen}
            reportVersionId={evidenceReportVersionId}
            version={versionContext?.version}
          />
        )}

        <FrozenSourceLedger artifacts={f.sourceArtifacts ?? []} subjectHandle={report.handle} profile={fundScaleProfile} />

        {/* connections — the compounding web: other audited subjects tied to this one */}
        {showTrustGraphSupplemental && connections.length > 0 && (
          <Section title="Connections" kicker="the web · others you've audited who share projects, people or wallets with this subject">
            <Card className="divide-y divide-line/60">
              {connections.map((c) => {
                const vm = c.otherVerdict ? verdictMeta(c.otherVerdict) : null;
                return (
                  <div key={c.other} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 items-start gap-2">
                      <Avatar src={/^@[A-Za-z0-9_]{2,30}$/.test(c.other) ? xAvatar(c.other) : null} letter={(c.other.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={20} rounded="rounded-full" letterClass="text-[10px]" />
                      <div className="min-w-0">
                      <span className="mono text-[12.5px] text-ink">{c.other}</span>
                      {vm && <span className={`verdict-pill ml-2 ${c.otherVerdict === "FAIL" ? "tint-fail" : "tint-var"}`} style={c.otherVerdict === "FAIL" ? undefined : ({ "--tint": vm.color } as React.CSSProperties)}>{vm.label}</span>}
                      <div className="mt-0.5 text-[12.5px] leading-snug text-ink-dim">
                        {c.direct && <span>directly linked{c.ties.length > 0 ? " · " : ""}</span>}
                        {c.ties.length > 0 && (
                          <span>via {c.ties.map((t, ti) => (
                            <span key={t.key}>
                              {ti > 0 && ", "}
                              {onOpenProject && t.type === "Company" ? (
                                <button onClick={() => onOpenProject(t.label, undefined, panelCostToken)} className="text-ink underline-offset-2 transition hover:text-signal-dim hover:underline">{t.label}</button>
                              ) : (
                                <span className="text-ink">{t.label}</span>
                              )}
                            </span>
                          ))}</span>
                        )}
                      </div>
                      </div>
                    </div>
                    {onAudit && (
                      <button onClick={() => onAudit(c.other)} className="btn-chip tint-signal shrink-0">open →</button>
                    )}
                  </div>
                );
              })}
            </Card>
          </Section>
        )}

        {/* role breakdown — governing role full-width and expanded, the rest below */}
        <Section title="Role breakdown" kicker="each role scored on its own track · never averaged">
          {(() => {
            const gov = report.role_reports.find((rr) => rr.role === report.governing_role);
            const others = report.role_reports.filter((rr) => rr.role !== report.governing_role);
            return (
              <div className="space-y-3">
                {gov && <RoleCard key={gov.role} rr={gov} governing coverageReady={presentation.final} />}
                {others.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {others.map((rr) => (
                      <RoleCard key={rr.role} rr={rr} governing={false} coverageReady={presentation.final} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </Section>


        {/* signature modules */}
        <div className="grid gap-3 lg:grid-cols-2">
          {evidence.wallets.length > 0 && (
            <div className="min-w-0">
              <Section title="Wallets & on-chain links" kicker="addresses tied to them · ranked by attribution strength">
                <Card className="divide-y divide-line/60">
                  {[...evidence.wallets]
                    .sort((a, b) => walletTier(a).rank - walletTier(b).rank)
                    .map((w, i) => {
                      const t = walletTier(w);
                      const flags = [
                        w.sold_into_own_promo ? "sold into own promo" : "",
                        w.scam_adjacent_flow ? "scam-adjacent flow" : "",
                      ].filter(Boolean);
                      return (
                        <div key={i} className="px-4 py-2.5 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="chip shrink-0">
                              {w.chain === "solana" ? "SOL" : "EVM"}
                            </span>
                            <a href={explorer(w)} target="_blank" rel="noreferrer" className="mono link-ext truncate">{shortAddr(w.address)}</a>
                            <CopyAddr text={w.address} />
                            {w.link_evidence_url && (
                              <a href={w.link_evidence_url} target="_blank" rel="noreferrer" className="link-ext shrink-0 text-[11px]">proof</a>
                            )}
                            <span className="chip tint-var ml-auto shrink-0" style={{ "--tint": t.color } as React.CSSProperties}>
                              {t.label}
                            </span>
                          </div>
                          {(w.notes || w.activity_summary) && (
                            <div className="mt-1 text-[11px] leading-snug text-ink-faint">
                              {[w.notes, w.activity_summary].filter(Boolean).join(" · ")}
                            </div>
                          )}
                          {(flags.length > 0 || w.positive_signals) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {flags.map((fl) => (
                                <span key={fl} className="chip tint-avoid">{fl}</span>
                              ))}
                              {w.positive_signals && (
                                <span className="chip tint-pass">{w.positive_signals}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </Card>
              </Section>
            </div>
          )}

          {(fundScaleArtifactGroups.length > 0 || portfolioArtifactGroups.length > 0 || (roles.some((role) => role === "INVESTOR") && portfolioLeads.length > 0)) && (
            <div className="min-w-0 lg:col-span-2">
              <Section
                title="Investor evidence"
                kicker={`${verifiedPortfolioProjects.length} verified relationship${verifiedPortfolioProjects.length === 1 ? "" : "s"} · ${verifiedFundScaleClaims.length} verified scale claim${verifiedFundScaleClaims.length === 1 ? "" : "s"} · ${reportedFundScaleClaims.length} reported-only scale claim${reportedFundScaleClaims.length === 1 ? "" : "s"} · ${reportedPortfolioProjects.length} reported-only relationship${reportedPortfolioProjects.length === 1 ? "" : "s"}`}
              >
                <Card className="divide-y divide-line/60">
                  {fundScaleArtifactGroups.length > 0 && (
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">Fund scale</h3>
                      <span className="text-[10.5px] text-ink-faint">Capital managed by the named entity, never assumed to be the subject's personal capital</span>
                    </div>
                  )}
                  {fundScaleArtifactGroups.map((group) => (
                    <article key={group.key} className="px-4 py-3 text-[12.5px]">
                      {group.attribution === "affiliated_fund" && (
                        <p className="mb-2 text-[12px] font-medium text-ink-dim">
                          {group.subject} → affiliated with {group.fundName}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <h4 className="font-medium text-ink">{group.fundVehicle || group.fundName}</h4>
                        {group.fundVehicle && (
                          <span className="text-[10.5px] text-ink-faint">fund vehicle · {group.fundName}</span>
                        )}
                        <span className="mono text-[12px] font-medium text-ink-dim">
                          {group.qualifier === "at_least" ? "≥ " : group.qualifier === "approximate" ? "≈ " : ""}
                          {formatFundScaleUsd(group.amountUsd)}
                        </span>
                        <span className="chip">
                          {group.metric ? FUND_SCALE_METRIC_LABEL[group.metric] : "fund scale"}
                        </span>
                        {group.basis && <span className="chip">{FUND_SCALE_BASIS_LABEL[group.basis]}</span>}
                        <span className="chip">{group.temporalLabel}</span>
                        <span className={`chip chip-wrap ${group.confirmed ? "tint-pass" : "tint-caution"}`}>
                          {group.confirmed
                            ? group.attribution === "affiliated_fund"
                              ? "fund scale verified · not personal capital"
                              : "fund scale verified"
                            : "reported scale · strict verification incomplete"}
                        </span>
                        <span className="ml-auto text-[10.5px] text-ink-faint">
                          {group.confirmedSourceCount > 0
                            ? `${group.confirmedSourceCount} source${group.confirmedSourceCount === 1 ? "" : "s"} passed strict gate`
                            : "no source passed the strict gate"}
                          {group.reportedSourceCount ? ` · ${group.reportedSourceCount} other source${group.reportedSourceCount === 1 ? "" : "s"}` : ""}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-col items-start gap-1">
                        {group.attribution === "affiliated_fund" && (
                          <>
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Affiliation source"
                              context={`${group.subject} affiliation with ${group.fundName}`}
                            />
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Fund domain source"
                              context={`${group.fundName} official domain`}
                            />
                          </>
                        )}
                        <InvestorEvidenceLinks
                          sources={group.sources}
                          role="Scale source"
                          context={`${group.fundVehicle || group.fundName} fund scale`}
                        />
                      </div>
                    </article>
                  ))}
                  {(portfolioArtifactGroups.length > 0 || portfolioLeads.length > 0) && (
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim">Portfolio relationships</h3>
                      <span className="text-[10.5px] text-ink-faint">Entity attribution and deal evidence are shown separately</span>
                    </div>
                  )}
                  {portfolioArtifactGroups.map((group) => (
                    <article key={group.key} className="px-4 py-3 text-[12.5px]">
                      <h4 className="font-medium text-ink">
                        {group.attribution === "affiliated_fund"
                          ? `${group.subject} → affiliated with ${group.investor} → invested in ${group.project}`
                          : `${group.subject} → invested in ${group.project}`}
                      </h4>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className={`chip chip-wrap ${group.confirmed ? "tint-pass" : "tint-caution"}`}>
                          {group.confirmed
                            ? group.attribution === "affiliated_fund"
                              ? "fund investment verified · not attributed personally"
                              : "direct investment verified"
                            : "reported · needs corroboration"}
                        </span>
                        <span className="ml-auto text-[10.5px] text-ink-faint">
                          {group.confirmedSourceCount} verified source{group.confirmedSourceCount === 1 ? "" : "s"}
                          {group.reportedSourceCount ? ` · ${group.reportedSourceCount} reported source${group.reportedSourceCount === 1 ? "" : "s"}` : ""}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-col items-start gap-1">
                        {group.attribution === "affiliated_fund" && (
                          <>
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Affiliation source"
                              context={`${group.subject} affiliation with ${group.investor}`}
                            />
                            <InvestorEvidenceLinks
                              sources={group.sources}
                              role="Fund domain source"
                              context={`${group.investor} official domain`}
                            />
                          </>
                        )}
                        <InvestorEvidenceLinks
                          sources={group.sources}
                          role="Deal source"
                          context={`${group.investor} investment in ${group.project}`}
                        />
                      </div>
                    </article>
                  ))}
                  {portfolioArtifactGroups.length === 0 && portfolioLeads.length > 0 && (
                    <div className="px-4 py-3 text-[12px] leading-relaxed text-ink-dim">
                      {portfolioLeads.length} source-linked candidate{portfolioLeads.length === 1 ? " was" : "s were"} discovered, but none passed deterministic relationship verification. Candidates remain outside the score and graph.
                    </div>
                  )}
                </Card>
                {unmatchedPortfolioLeadCount > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                    Discovery breadth is not verification: unmatched or single-source candidates remain leads and cannot improve the frozen investor score.
                  </p>
                )}
              </Section>
            </div>
          )}

          {evidence.ventures.length > 0 && (
            <div className="min-w-0">
              <Section title="Ventures & affiliations" kicker="founding, employment and operating ties · separate from investments">
                <Card className="divide-y divide-line/60">
                  {evidence.ventures.map((v, i) => {
                    const sourceBacked = v.evidence_origin !== "model_lead" && v.artifact_verified === true;
                    const isLead = v.evidence_origin === "model_lead" || v.artifact_verified === false;
                    const evidenceState = sourceBacked ? "source-backed" : isLead ? "unverified lead" : "legacy curated";
                    return (
                      <div key={i} className="flex items-center gap-2 px-4 py-2.5 text-[12.5px]">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: v.outcome === "Rug" ? "var(--color-avoid)" : v.outcome === "Acquisition" || v.outcome === "IPO" ? "var(--color-pass)" : "var(--color-ink-faint)" }}
                        />
                        {onOpenProject ? (
                          <button onClick={() => onOpenProject(v.project_name, undefined, panelCostToken)} className="truncate text-left text-ink underline-offset-2 transition hover:text-signal-dim hover:underline" title="See everyone who worked on this">{v.project_name}</button>
                        ) : (
                          <span className="truncate text-ink">{v.project_name}</span>
                        )}
                        <span className="chip shrink-0">{v.role}</span>
                        {v.period && <span className="shrink-0 text-[11px] text-ink-faint">{v.period}</span>}
                        {v.evidence_url && (
                          <a href={v.evidence_url} target="_blank" rel="noreferrer" className="link-ext shrink-0 text-[11px]">source</a>
                        )}
                        <span className={`mono ml-auto shrink-0 text-[11px] ${sourceBacked ? "text-pass" : "text-ink-faint"}`}>
                          {evidenceState}
                        </span>
                      </div>
                    );
                  })}
                </Card>
              </Section>
            </div>
          )}

          {corroborationRows.length > 0 && (
            <div className="min-w-0">
              <Section title="Testimonial corroboration" kicker="claimed vs. acknowledged">
                <CorroborationTable rows={corroborationRows} />
              </Section>
            </div>
          )}

          {founderSummary && (
            <div className="min-w-0">
              <Section title="Founder pattern" kicker="outcomes + repeat backing">
                <Card className="p-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="eyebrow">Pattern</div>
                      <div className="mono text-[15px] font-medium text-ink">{founderSummary.pattern}</div>
                    </div>
                    <div className="h-8 w-px bg-line" />
                    <div>
                      <div className="eyebrow">Repeat backing</div>
                      <div
                        className="mono text-[15px] font-medium"
                        style={{
                          color:
                            founderSummary.repeat_backing.strength === "strong"
                              ? "var(--color-pass)"
                              : founderSummary.repeat_backing.strength === "weak"
                              ? "var(--color-caution)"
                              : "var(--color-ink-faint)",
                        }}
                      >
                        {founderSummary.repeat_backing.strength}
                      </div>
                    </div>
                  </div>
                  {founderSummary.repeat_backing.repeat_backers.length > 0 && (
                    <p className="mt-2 text-[12.5px] text-ink-faint">
                      Returning backers: <span className="text-ink-dim">{founderSummary.repeat_backing.repeat_backers.join(", ")}</span>
                    </p>
                  )}
                </Card>
              </Section>
            </div>
          )}

          {advisedRows.length > 0 && (
            <div className="min-w-0">
              <Section title="Advisory graveyard" kicker="projects lent their name to">
                <Card className="divide-y divide-line/60">
                  {advisedRows.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-faint)" }}
                      />
                      <span className="text-[12.5px] text-ink">{p.project_name}</span>
                      {p.paid_or_allocated && (
                        <span className="chip tint-caution">allocation</span>
                      )}
                      <span className="mono ml-auto text-[11px]" style={{ color: p.project_outcome === "Rug" ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>
                        {p.project_outcome}
                      </span>
                      <span className="mono text-[11px]" style={{ color: TV_TONE[p.corroboration_verdict ?? "Unconfirmed"] }}>
                        {TV_SHORT[p.corroboration_verdict ?? "Unconfirmed"]}
                      </span>
                    </div>
                  ))}
                </Card>
              </Section>
            </div>
          )}

          {showProfilePhotoSupplemental && panelCostToken && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="Profile photo" kicker="current supplemental overlay · outside the frozen core evidence and stored verdict">
                <PfpCheck handle={report.handle} brand={roles.some((role) => String(role) === "PROJECT") && !roles.some((role) => String(role) === "FOUNDER")} panelCostToken={panelCostToken} />
              </Section>
            </div>
          )}

          {/* code footprint — resolve the subject's GitHub from their handle/name/bio
              and analyse it (self-hides when no account is confidently matched) */}
          {showCurrentIntelligence && panelCostToken && <PersonGithub className="min-w-0 lg:col-span-2" handle={report.handle} name={f.display_name} bio={f.bio} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />}

          {/* The old "On-chain reality check" (a single promoted token → deployer)
              was removed: for KOLs the KOL report below is the richer superset, for
              funds a portfolio token isn't a promotion, and for everyone else it
              duplicated the token's own audit. Deployer/funder forensics live on
              each token's audit page. */}

          {showCurrentIntelligence && panelCostToken && roles.some((r) => r === "INVESTOR") && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="VC portfolio leads" kicker="paid current supplemental search · unverified candidates · excluded from graph and verdict">
                <VcReport key={`${report.handle}:${panelCostToken}`} handle={report.handle} name={f.display_name || report.handle} verifiedProjects={verifiedPortfolioProjects} panelCostToken={panelCostToken} onAudit={onAudit} />
              </Section>
            </div>
          )}

          {showCurrentIntelligence && panelCostToken && roles.some((r) => r === "KOL") && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="KOL report" kicker="a promoter's threat model: did their shilled tokens rug, and is their reach real?">
                <KolReport handle={report.handle} promotions={evidence.promotions ?? []} associates={evidence.associates ?? []} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} onAudit={onAudit} />
              </Section>
            </div>
          )}

          {(() => {
            // PROJECT accounts: domain age + audit-claim check from the bio link.
            const dom = (f.bio.match(/\b([a-z0-9][a-z0-9-]*\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1] ?? "").toLowerCase();
            return showCurrentIntelligence && roles.some((r) => r === "PROJECT") && dom ? (
              <div className="min-w-0 lg:col-span-2">
                <Section title="Project intelligence" kicker="domain age + claimed security audits — an established brand on a fresh domain is a contradiction">
                  <ProjectIntel domain={dom} />
                </Section>
              </div>
            ) : null;
          })()}

          {showOffchainSupplemental && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="In the news" kicker="current supplemental search · not part of the stored score">
                <NewsSection query={f.display_name || report.handle} handle={report.handle} />
              </Section>
            </div>
          )}

          {showCurrentIntelligence && panelCostToken && (
            <div className="min-w-0 lg:col-span-2">
              <Section title="Identity continuity" kicker="current supplemental search · not part of the stored score">
                <IdentitySweep handle={report.handle} auto panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />
              </Section>
            </div>
          )}

          {/* transparent scan methodology — what ARGUS checked on this person */}
          {diligenceChecks.length > 0 && (
            <div className="min-w-0 lg:col-span-2">
              <MethodologyChecklist id="scan-methodology" checks={diligenceChecks} />
            </div>
          )}

          <div className="min-w-0 lg:col-span-2">
            <Section title="Connection web" kicker="click any node to open it · subject → projects → the people behind them">
              <Card className="p-2">
                <TrustGraph nodes={graph.nodes} edges={graph.edges} connections={showTrustGraphSupplemental ? connections : []} onAudit={onAudit} onOpenProject={onOpenProject ? (name) => onOpenProject(name, undefined, panelCostToken) : undefined} />
              </Card>
            </Section>
          </div>

          {/* ask-the-report chat — grounded in this person's own evidence */}
          <div className="min-w-0 lg:col-span-2">
            <AskReport subject={report.handle} context={[
              f.headline,
              `roles: ${roles.join(", ")}`,
              showTrustGraphSupplemental && !versionContext && connections.length ? `already connected to: ${connections.map((c) => c.other).join(", ")}` : "",
              groundedVentureNames.length ? `ventures: ${groundedVentureNames.join(", ")}` : "",
              (webTeam ?? []).length ? `team/associates: ${webTeam.map((p) => p.name).join(", ")}` : "",
            ].filter(Boolean).join(" | ")} />
          </div>

          {/* analyst augmentation — add a piece the scan missed (verified before publish) */}
          {showCurrentIntelligence && canMutateWorkspace && (
            <div className="min-w-0 lg:col-span-2">
              <AddInfo subject={report.handle} subjectKind="person" canonicalRef={report.handle} subjectGraphKey={report.handle} />
            </div>
          )}

          {/* hard link — manually bridge this person to another entity in the graph */}
          {showCurrentIntelligence && canMutateWorkspace && (
            <div className="min-w-0 lg:col-span-2">
              <LinkEntity subject={report.handle} subjectKind="person" canonicalRef={report.handle} graphSubjectKey={report.handle} />
            </div>
          )}
        </div>

        {/* findings ledger */}
        {publishableSubjectFindings.length > 0 && (
          <Section title="Publishable findings" kicker="sourced · dated · independently corroborated">
            <FindingsLedger findings={publishableSubjectFindings} />
          </Section>
        )}

        {investigativeLeads.length > 0 && (
          <Section title="Investigative leads" kicker="entity-scoped follow-up · target verification shown separately · never scored as subject evidence">
            <InvestigativeLeadsLedger leads={investigativeLeads} subject={report.handle} />
          </Section>
        )}

        {/* methodology footer */}
        <div className="panel mt-8 p-5">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-dim">
            <ArgusMark size={16} /> How this verdict was reached
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            Each role is scored to 100 on its own axes. Disqualifying findings act as hard caps that
            override the weighted total rather than averaging into it, so a single rug or contradicted
            endorsement cannot be diluted. The composite is the most severe role band, never a mean.
            Identity is rewarded, not gated: pseudonymity is neutral, disclosure earns a bonus, and only
            impersonation blocks a verdict. API-only acquisition, evidence-disciplined, reproducible.
          </p>
        </div>
      </div>
    </div>
  );
}
