import { useState } from "react";
import { ArgusMark } from "./ArgusMark";
import { TrustGraph } from "./TrustGraph";
import { verdictMeta } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import type { TokenDossier } from "../token/audit";
import { TokenSparkline } from "./TokenSparkline";
import { OnChainForensics } from "./OnChainForensics";
import { ProjectResearch } from "./ProjectResearch";
import { ProjectLinks } from "./ProjectLinks";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { tokenChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness, type DecisionReadiness } from "../lib/decisionReadiness";
import {
  coverageQualifiedCompleteness,
  presentPublicReport,
  type PublicReportPresentation,
} from "../lib/reportPresentation";
import { AddInfo } from "./AddInfo";
import { Counterparties } from "./Counterparties";
import { RiskPaths } from "./RiskPaths";
import { Holdings } from "./Holdings";
import { LinkEntity } from "./LinkEntity";
import { AskReport } from "./AskReport";
import { Unknowns } from "./Unknowns";
import { SecondOpinion } from "./SecondOpinion";
import { ServiceAlert } from "./ServiceAlert";
import { RingAlert } from "./RingAlert";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import {
  ArrowClockwise,
  ArrowLeft,
  Briefcase,
  ChartDonut,
  ClipboardText,
  Database,
  Graph,
  Plus,
  ShareNetwork,
  Star,
} from "@phosphor-icons/react";
import { InvestigationDecisionCanvas } from "./InvestigationDecisionCanvas";
import { ReportCanvasSectionNav } from "./ReportCanvasPrimitives";

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

function money(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function Ring({ score, verdict, color, size = 96 }: { score: number | null; verdict: string; color?: string; size?: number }) {
  const m = verdictMeta(verdict);
  const ringColor = color ?? m.color;
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 0.8s ease-out" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[24px] font-semibold leading-none tabular" style={{ color: ringColor }}>{score ?? "—"}</span>
        <span className="mono text-[10px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

function Bar({ a, color }: { a: TokenDossier["axes"][number]; color: string }) {
  const ratio = a.weight ? a.score / a.weight : 0;
  const weak = ratio < 0.45;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-dim">{a.label}</span>
        <span className="mono shrink-0 text-[11px] tabular text-ink-faint">{a.score}<span className="text-ink-faint/60">/{a.weight}</span></span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ background: weak ? "var(--color-caution)" : color, width: `${ratio * 100}%`, transition: "width 0.7s ease-out" }} />
      </div>
      {a.rationale && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-faint">{a.rationale}</p>}
    </div>
  );
}

function Check({ label, ok, value, na }: { label: string; ok: boolean; value?: string; na?: boolean }) {
  const color = na ? "var(--color-ink-faint)" : ok ? "var(--color-pass)" : "var(--color-avoid)";
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[12.5px] text-ink-dim">{label}</span>
      <span className="mono flex items-center gap-1.5 text-[11px]" style={{ color }}>
        {value ?? (na ? "unchecked" : ok ? "ok" : "risk")}
        <span>{na ? "•" : ok ? "✓" : "✗"}</span>
      </span>
    </div>
  );
}

const TONE_RANK: Record<string, number> = { bad: 3, warn: 2, good: 1 };
const TONE_GLYPH: Record<string, string> = { bad: "✗", warn: "⚠", good: "✓" };

// A clean plain-text DD summary for pasting into a chat / channel.
function tokenReportText(
  d: TokenDossier,
  readiness: DecisionReadiness,
  presentation: PublicReportPresentation,
  evidence?: { reportVersionId?: string; version?: number; privateSession?: boolean },
): string {
  const moneyShort = (n?: number) => (n == null ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "K" : "$" + Math.round(n));
  const age = d.ageDays != null ? (d.ageDays < 1 ? "<1d" : Math.round(d.ageDays) + "d") : "?";
  const findings = [...d.findings]
    .sort((a, b) => (TONE_RANK[b.tone] ?? 0) - (TONE_RANK[a.tone] ?? 0))
    .slice(0, 6)
    .map((f) => `${TONE_GLYPH[f.tone] ?? "·"} ${f.claim}`);
  const exactLink = evidence?.reportVersionId
    ? `${location.origin}/?version=${encodeURIComponent(evidence.reportVersionId)}`
    : null;
  const provenance = evidence?.version
    ? `— ARGUS immutable snapshot v${evidence.version}`
    : evidence?.reportVersionId
      ? "— ARGUS immutable scan"
      : evidence?.privateSession
        ? "— private live ARGUS session"
        : "— live ARGUS analysis";
  return [
    `$${d.symbol} — ${presentation.resultLabel}: ${presentation.displayVerdict} · ${d.chain}${d.capApplied ? ` (cap: ${d.capApplied.replace(/_/g, " ")})` : ""}`,
    presentation.readinessLabel,
    `${readiness.successful}/${readiness.applicable} evidence outcomes recorded · ${readiness.unresolved} unresolved · ${readiness.coveragePercent}% coverage`,
    `Stored model output: ${d.verdict} ${d.score ?? "—"}/100`,
    presentation.note,
    d.headline,
    "",
    ...findings,
    "",
    `liq ${moneyShort(d.liquidityUsd)} · mc ${moneyShort(d.mcap)} · age ${age}${d.cg?.cexCount ? ` · ${d.cg.cexCount} CEX` : ""}`,
    d.address,
    ...(exactLink ? [exactLink] : []),
    provenance,
  ].join("\n");
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </div>
  );
}

export function TokenReport({ dossier: d, onReset, onAudit, onRescan, onOpenBrief }: { dossier: TokenDossier; onReset: () => void; onAudit: (h: string) => void; onRescan: () => void; onOpenBrief?: () => void }) {
  const versionContext = d.versionContext ?? d.viewVersionContext;
  const embeddedFacet = Boolean(d.viewVersionContext || d.viewPersistence);
  const livePersistence = d.viewPersistence ?? d.persistence;
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const persistencePending = !versionContext && livePersistence?.state === "pending";
  const persistenceFailed = !versionContext && livePersistence?.state === "failed";
  const panelCostToken = !versionContext && livePersistence?.state === "persisted"
    ? livePersistence.panelCostToken ?? undefined
    : undefined;
  const persistenceMissingCapability = !versionContext
    && livePersistence?.state === "persisted"
    && !panelCostToken;
  const privateSession = livePersistence?.state === "private";
  const showCurrentIntelligence = versionContext
    ? currentIntelligenceEnabled
    : !privateSession && !persistencePending && !persistenceFailed && !persistenceMissingCapability;
  const canRecordCurrentIntelligence = !versionContext && livePersistence?.state !== "private";
  const canMutateWorkspace = !versionContext && livePersistence?.state !== "private";
  const canShare = !embeddedFacet && Boolean(
    d.versionContext?.reportVersionId
    || (d.persistence?.state === "persisted" && d.persistence.reportVersionId),
  );
  const tokenSubjectGraphKey = String(d.graph.nodes.find((node) => node.subject)?.key ?? "") || undefined;
  const checks = versionContext
    ? versionContext.checks
    : tokenChecks(d);
  const readiness = deriveDecisionReadiness(checks);
  const readinessColor = readiness.status === "ready" ? "var(--color-pass)" : "var(--color-caution)";
  const presentationCompleteness = coverageQualifiedCompleteness({
    completeness: versionContext?.completenessState ?? (readiness.status === "ready" ? "complete" : "partial"),
    attestation: versionContext?.attestationState ?? (d.live ? "server_collected" : "analyst_submitted"),
    checks,
  });
  const presentation = presentPublicReport({
    verdict: d.verdict,
    score: d.score,
    completeness: presentationCompleteness,
  });
  const presentedVerdict = presentation.displayVerdict === "UNVERIFIABLE"
    ? "UNVERIFIABLE_IDENTITY"
    : presentation.displayVerdict;
  const presentationMeta = verdictMeta(presentedVerdict);
  const presentationColor = presentationMeta.color;
  const s = d.safety;
  const gp = d.safetyChecked;
  const isSol = d.chain === "solana";
  const topSum = d.topHolders.reduce((a, h) => a + h.percent, 0);
  const projectSite = d.socials.find((x) => x.label === "site" && /^https?:\/\//i.test(x.url))?.url;
  const projectDomain = projectSite ? projectSite.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase() : null;
  // The project's GitHub org (from its socials), for commit forensics — same
  // derivation the investigation report uses.
  const ghOrg = d.socials
    .map((s) => s.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
    .find((g) => g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing)$/i.test(g)) ?? null;
  const otherLinks = d.socials.filter((x) => x.label !== "site" && !/x\.com|twitter\.com/i.test(x.url));
  const [watched, setWatched] = useState(() => isWatched(d.address));
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [copiedTxt, setCopiedTxt] = useState(false);
  const copyReport = () => {
    navigator.clipboard?.writeText(tokenReportText(d, readiness, presentation, {
      reportVersionId: versionContext?.reportVersionId
        ?? (livePersistence?.state === "persisted" ? livePersistence.reportVersionId ?? undefined : undefined),
      version: versionContext?.version,
      privateSession: livePersistence?.state === "private",
    }));
    setCopiedTxt(true);
    setTimeout(() => setCopiedTxt(false), 1500);
  };
  const share = async () => {
    if (shareState === "creating") return;
    setShareState("creating");
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "token",
          ref: d.address,
          reportVersionId: d.versionContext?.reportVersionId
            ?? (d.persistence?.state === "persisted" ? d.persistence.reportVersionId : undefined),
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
      console.error("[share] token report failed", error);
      setShareState("error");
      setTimeout(() => setShareState("idle"), 3000);
    }
  };
  const watch = () => {
    if (!canMutateWorkspace) return;
    setWatched(
      toggleWatch({
        id: d.address, kind: "token", label: "$" + d.symbol, chain: d.chain,
        via: isSol ? "solana" : "evm", addedAt: 0,
        snapshot: {
          verdict: presentedVerdict,
          score: presentation.primaryScore ? d.score : null,
          completenessState: presentationCompleteness,
          liquidityUsd: d.liquidityUsd,
          mcap: d.mcap,
        },
      }),
    );
  };
  const recordedChecks = checks.filter((check) => ["confirmed", "finding", "checked-empty"].includes(check.status));
  const gapChecks = checks.filter((check) => ["unknown", "unavailable", "stale"].includes(check.status));
  const supportingFindings = d.findings.filter((finding) => finding.tone === "good");
  const limitingFindings = d.findings.filter((finding) => finding.tone !== "good");
  const supportItems = [
    ...supportingFindings.map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...recordedChecks
      .filter((check) => check.status !== "finding")
      .map((check) => ({ label: check.label, detail: check.note })),
  ].slice(0, 6);
  const concernItems = [
    ...limitingFindings.map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...recordedChecks
      .filter((check) => check.status === "finding")
      .map((check) => ({ label: check.label, detail: check.note })),
    ...(readiness.status !== "ready" ? [{ label: readiness.title, detail: readiness.guidance }] : []),
  ].slice(0, 6);
  const nextStepItems = gapChecks.slice(0, 6).map((check) => ({
    label: `Resolve ${check.label.toLowerCase()}`,
    detail: check.note,
  }));
  const verifiedItems = recordedChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const openQuestionItems = gapChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const capturedAt = versionContext?.createdAt
    ? new Date(versionContext.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : undefined;
  const favorableVerdict = presentedVerdict === "PASS";
  const decisionCanvasTone = favorableVerdict
    ? "pass"
    : presentedVerdict === "CAUTION" || presentedVerdict === "INCOMPLETE" || presentedVerdict === "UNVERIFIABLE_IDENTITY"
      ? "caution"
      : "avoid";

  return (
    <div className="relative min-h-full pb-24">
      <header className="border-b border-line bg-void/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <button onClick={onReset} className="btn-ghost flex min-h-9 items-center gap-1.5 px-1 text-[12.5px]">
            <ArrowLeft size={15} weight="bold" aria-hidden="true" />
            New investigation
          </button>
          <span className="mono text-[11px] text-ink-faint">/ token investigation</span>
          <span className={`chip ${versionContext ? "" : "tint-signal"}`}>
            {versionContext ? `snapshot v${versionContext.version}` : "live scan"}
          </span>
          <div className="scrollbar-none order-3 flex w-full items-center gap-2 overflow-x-auto pb-1 sm:order-none sm:ml-auto sm:w-auto sm:justify-end sm:overflow-visible sm:pb-0">
            {onOpenBrief && (
              <button type="button" onClick={onOpenBrief} title="Open the analyst decision brief anchored to this exact token case" className="btn-primary flex min-h-10 items-center gap-2 px-3 text-[12.5px] font-medium">
                <Briefcase size={16} weight="duotone" aria-hidden="true" /> Case brief
              </button>
            )}
            {canShare && (
              <button onClick={() => void share()} disabled={shareState === "creating"} aria-live="polite" title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable report link"} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] disabled:cursor-wait disabled:opacity-60">
                <ShareNetwork size={16} weight="duotone" aria-hidden="true" />
                {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied" : shareState === "error" ? "Retry share" : "Share"}
              </button>
            )}
            <button onClick={onRescan} title="Run this audit again with current evidence" className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px]">
              <ArrowClockwise size={16} weight="duotone" aria-hidden="true" /> Rescan
            </button>
            <button onClick={copyReport} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px]">
              <ClipboardText size={16} weight="duotone" aria-hidden="true" /> {copiedTxt ? "Copied" : "Copy report"}
            </button>
            {canMutateWorkspace && (
              <button onClick={watch} className={`btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] ${watched ? "tint-signal" : ""}`}>
                <Star size={16} weight={watched ? "fill" : "duotone"} aria-hidden="true" /> {watched ? "Watching" : "Watch"}
              </button>
            )}
            <button onClick={onReset} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px]">
              <Plus size={16} weight="bold" aria-hidden="true" /> New
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-5">
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
          <div className="mt-4 panel px-4 py-3 text-[12.5px] text-ink-dim" role="status">
            Saving the immutable scan before post-scan intelligence runs…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="finding tint-caution mt-4 px-4 py-3 text-[12.5px]" role="alert">
            Post-scan intelligence is paused because this report could not be saved. Rescan before spending on supplemental providers.
          </div>
        )}
        {showCurrentIntelligence && <RingAlert handle={"$" + d.symbol} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* token identity */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {d.imageUrl ? (
            <img src={d.imageUrl} alt="" className="h-14 w-14 rounded-2xl border border-line-2 object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line-2 bg-panel text-xl text-signal-lift">${d.symbol.slice(0, 3)}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display-sm text-[24px] text-ink">{d.name}</h1>
              <span className="mono text-[13.5px] text-ink-faint">${d.symbol}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
              <span className="rounded border border-line px-1.5 py-0.5 text-ink-dim capitalize">{d.chain}</span>
              <span>{d.dexId}</span>
              <span className="mono">{d.address.slice(0, 6)}…{d.address.slice(-4)}</span>
            </div>
            <ProjectLinks className="mt-2" website={projectSite} xHandle={d.projectX ?? d.cg?.twitter} links={d.socials} />
          </div>
          <div className="flex gap-2">
            <div className="stat-tile"><div className="stat-label">mcap</div><div className="stat-value mt-0.5">{money(d.mcap)}</div></div>
            <div className="stat-tile"><div className="stat-label">liquidity</div><div className="stat-value mt-0.5">{money(d.liquidityUsd)}</div></div>
            <div className="stat-tile"><div className="stat-label">24h vol</div><div className="stat-value mt-0.5">{money(d.vol24)}</div></div>
          </div>
        </div>

        {/* what the project actually does — CoinGecko's own blurb */}
        {d.cg?.description && (
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-ink-dim">{d.cg.description}</p>
        )}

        {/* Decision layer: model output and evidence completeness are separate.
            A thinly-supported PASS must never read like an investment-ready clearance. */}
        <div className="panel tint-var tint-strong relative mt-4 overflow-hidden soft-shadow" style={{ "--tint": presentationColor } as React.CSSProperties}>
          <div className="relative flex flex-wrap items-start gap-6 p-6 pb-5">
            <div className="shrink-0 text-center">
              <Ring score={presentation.primaryScore ? d.score : null} verdict={presentedVerdict} color={presentationColor} />
              <div className="mono mt-1.5 text-[11px] uppercase tracking-wider text-ink-dim">
                {presentation.scoreLabel?.toLowerCase() ?? "score withheld"}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="eyebrow mb-1.5">{presentation.resultLabel}</div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="display text-[32px] uppercase leading-none" style={{ color: presentationColor }}>{presentationMeta.label}</span>
                {presentation.secondarySignal && (
                  <span className="chip tint-caution">{presentation.secondarySignal}</span>
                )}
              </div>
              <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
                {presentation.final ? d.headline : presentation.note}
              </p>
              <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
                {presentation.final ? readiness.guidance : <>Stored scored-evidence summary — not clearance: {d.headline}</>}
              </p>
              {d.capApplied && (
                <div className="chip tint-avoid mt-3 font-medium">
                  ▲ Hard cap · {d.capApplied.replace(/_/g, " ")}
                </div>
              )}
            </div>
          </div>

          <div
            className="finding tint-var relative px-6 py-4"
            style={{ "--tint": readinessColor } as React.CSSProperties}
            aria-label="Evidence readiness"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="mono text-[12.5px] font-semibold uppercase tracking-[0.14em]">
                {readiness.status === "ready" ? "Evidence complete" : `${readiness.status} coverage`}
              </span>
              <span className="text-[11px] text-ink-faint">observable outcomes stored in this report</span>
              <a href="#token-methodology" className="ml-auto text-[11px] text-signal-lift underline-offset-2 hover:underline">Review check-by-check methodology</a>
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Evidence readiness summary">
              <div className="stat-tile">
                <dt className="stat-label">Coverage</dt>
                <dd className="stat-value mt-0.5 font-semibold">{readiness.coveragePercent}%</dd>
              </div>
              <div className="stat-tile">
                <dt className="stat-label">Outcomes</dt>
                <dd className="stat-value mt-0.5 font-semibold">{readiness.successful}<span className="text-[11px] text-ink-faint">/{readiness.applicable}</span></dd>
              </div>
              <div className="stat-tile">
                <dt className="stat-label">Unresolved</dt>
                <dd className="stat-value mt-0.5 font-semibold" style={{ color: readiness.unresolved ? readinessColor : "var(--color-ink)" }}>{readiness.unresolved}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="sticky top-0 z-10 mt-5">
          <ReportCanvasSectionNav
            sticky={false}
            items={[
              { href: "#report-summary", label: "Summary", icon: <ClipboardText size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#report-risks", label: "Risks", icon: <ChartDonut size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#token-evidence", label: "Evidence", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#token-relationships", label: "Relationships", icon: <Graph size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#token-methodology", label: "Sources & checks", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
            ]}
          />
        </div>

        <InvestigationDecisionCanvas
          verdictLabel={presentationMeta.label}
          favorable={favorableVerdict}
          verdictTone={decisionCanvasTone}
          supports={supportItems}
          concerns={concernItems}
          nextSteps={nextStepItems}
          verified={verifiedItems}
          openQuestions={openQuestionItems}
          coveragePercent={readiness.coveragePercent}
          successful={readiness.successful}
          applicable={readiness.applicable}
          capturedAt={capturedAt}
        />

        <div id="token-evidence" className="scroll-mt-28" aria-hidden="true" />

        {/* price momentum */}
        {d.priceChange && (
          <div className="mt-4 grid grid-cols-4 gap-2">
            {([["5m", d.priceChange.m5], ["1h", d.priceChange.h1], ["6h", d.priceChange.h6], ["24h", d.priceChange.h24]] as [string, number | undefined][]).map(([l, v]) => (
              <div key={l} className="stat-tile text-center">
                <div className="stat-label">{l}</div>
                <div className="mono mt-0.5 text-[13.5px]" style={{ color: v == null ? "var(--color-ink-faint)" : v >= 0 ? "var(--color-pass)" : "var(--color-avoid)" }}>
                  {v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* price performance history */}
        {showCurrentIntelligence && (
          <div className="mt-4 panel p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="eyebrow">Current price performance</div>
              <div className="text-[11px] uppercase tracking-wider text-ink-faint">live supplement · GeckoTerminal</div>
            </div>
            <TokenSparkline address={d.address} chain={d.chain} pairAddress={d.pairAddress} />
          </div>
        )}

        {/* on-chain forensic suite — the same cluster the investigation report uses */}
        {showCurrentIntelligence && panelCostToken && (
          <div className="mt-4">
            <OnChainForensics token={d} onAudit={onAudit} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />
            {d.deployer && <div className="mt-3"><Counterparties address={d.deployer} subject={`$${d.symbol}`} chain={d.chain} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} /></div>}
            {d.deployer && <div className="mt-3"><RiskPaths address={d.deployer} panelCostToken={panelCostToken} /></div>}
            {d.deployer && <div className="mt-3"><Holdings address={d.deployer} symbol={d.symbol} panelCostToken={panelCostToken} /></div>}
          </div>
        )}

        {/* unified project research: news & press, documents & resources, domain
            intelligence, and GitHub forensics — the same cluster every report uses */}
        {showCurrentIntelligence && (
          <div className="mt-4">
            <ProjectResearch name={d.name} symbol={d.symbol} domain={projectDomain} githubOrg={ghOrg} subjectKey={`$${d.symbol}`} newsHandle={d.projectX} record={canRecordCurrentIntelligence} {...(panelCostToken ? { panelCostToken } : {})} />
          </div>
        )}

        {/* negative space — what the scan couldn't confirm (unknowns are signal) */}
        <div className="mt-4">
          <Unknowns dossier={d} />
        </div>

        {/* adversarial review — auto-run second opinion that stress-tests the verdict */}
        {showCurrentIntelligence && panelCostToken && (
          <div className="mt-3">
            <SecondOpinion dossier={d} panelCostToken={panelCostToken} />
          </div>
        )}

        {!gp && (
          <div className="mt-3 panel px-4 py-3 text-[12.5px] text-ink-dim">
            Contract-internal safety (honeypot, mint authority, ownership, tax) could not be verified by a supported collector on <span className="capitalize">{d.chain}</span>. Those axes are scored conservatively; this report cannot claim that path is complete.
          </div>
        )}

        {/* axes */}
        <section className="mt-5">
          <div className="mb-2.5 text-[13.5px] font-semibold tracking-tight text-ink">Forensic breakdown</div>
          <div className="panel px-4 py-1 divide-y divide-line/60">
            {d.axes.map((a) => <Bar key={a.key} a={a} color={presentationColor} />)}
            <div className="flex items-center justify-between py-2.5 text-[11px] text-ink-faint">
              <span>weighted total</span>
              <span className="mono">= {d.score}{d.capApplied ? " (capped)" : ""}</span>
            </div>
          </div>
        </section>

        {/* panels */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card title="Contract safety">
            <div className="divide-y divide-line/60">
              <Check label="Not a honeypot" ok={!s.honeypot} na={!gp} value={s.simChecked && !s.honeypot ? "simulated ✓" : undefined} />
              <Check label={isSol ? "Mint authority revoked" : "Supply not mintable"} ok={!s.mintable} na={!gp} />
              {isSol ? (
                <>
                  <Check label="Freeze authority revoked" ok={!s.freezable} na={!gp} />
                  <Check label="No balance-mutable authority" ok={!s.balanceMutable} na={!gp} />
                  <Check label="No transfer hook" ok={!s.transferHook} na={!gp} />
                  <Check label="No transfer fee" ok={!s.transferFee} na={!gp} />
                  <Check label="Metadata immutable" ok={!s.metadataMutable} na={!gp} />
                  <Check label="Transferable" ok={!s.nonTransferable} na={!gp} />
                </>
              ) : (
                <>
                  <Check label="Ownership renounced" ok={!!s.ownerRenounced} na={!gp} />
                  <Check label="No take-back ownership" ok={!s.takeBack} na={!gp} />
                  <Check label="No hidden owner" ok={!s.hiddenOwner} na={!gp} />
                  <Check label="Not upgradeable (proxy)" ok={!s.proxy} na={!gp} />
                  <Check label="Owner can't rewrite balances" ok={!s.ownerChangeBalance} na={!gp} />
                  <Check label="Transfers not pausable" ok={!s.pausable} na={!gp} />
                  <Check label="Source verified" ok={!!s.openSource} na={!gp} />
                </>
              )}
              <Check label="Taxes" ok={s.buyTax + s.sellTax < 10} value={gp ? (isSol ? "0%" : `${s.buyTax.toFixed(0)}/${s.sellTax.toFixed(0)}%`) : undefined} na={!gp} />
              {!isSol && <Check label="Tax not modifiable" ok={!s.slippageModifiable} na={!gp} />}
            </div>
          </Card>

          <Card title="Liquidity & holders">
            <div className="divide-y divide-line/60">
              <Check
                label="Liquidity locked / burned"
                ok={s.lpBurnedPct >= 50 || s.lpLockedPct >= 50}
                value={gp ? (s.lpBurnedPct >= 50 ? `burned ${s.lpBurnedPct.toFixed(0)}%` : s.lpLockedPct >= 50 ? `locked ${s.lpLockedPct.toFixed(0)}%` : s.lpTopUnlockedEoaPct >= 50 ? `1 wallet ${s.lpTopUnlockedEoaPct.toFixed(0)}%` : "not locked") : undefined}
                na={!gp}
              />
              <Check label="Liquidity depth" ok={(d.liquidityUsd ?? 0) >= 50000} value={money(d.liquidityUsd)} />
              {!isSol && <Check label="Creator holdings" ok={s.creatorPercent < 5} value={gp ? `${s.creatorPercent.toFixed(0)}%` : undefined} na={!gp} />}
              <Check label="Holders" ok={Number(s.holderCount) >= 500} value={gp ? Number(s.holderCount).toLocaleString() : undefined} na={!gp} />
              <Check label="Top holder concentration" ok={s.topHolderPct == null || Number(s.topHolderPct) <= 25} value={s.topHolderPct != null ? `${Number(s.topHolderPct).toFixed(0)}%` : undefined} na={s.topHolderPct == null} />
              <Check label="Bundle / snipe concentration" ok={d.bundleRisk === "low"} value={gp ? `${d.insiderPct}% · ${d.bundleCount} wallets` : undefined} na={!gp} />
              <Check label="Pair age" ok={(d.ageDays ?? 0) >= 30} value={d.ageDays != null ? (d.ageDays < 1 ? "<1d" : Math.round(d.ageDays) + "d") : undefined} />
              <Check
                label="CoinGecko corroboration"
                ok={!!d.cg?.listed && (d.cg?.cexCount ?? 0) > 0}
                value={d.cg ? (d.cg.listed ? `${d.cg.rank ? "#" + d.cg.rank + " · " : ""}${d.cg.cexCount} CEX` : "unlisted") : undefined}
                na={!d.cg}
              />
            </div>
            {d.cg?.cexNames && d.cg.cexNames.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-line/60 pt-2.5">
                <span className="text-[11px] text-ink-faint">listed on</span>
                {d.cg.cexNames.slice(0, 10).map((n) => (
                  <span key={n} className="chip tint-pass normal-case tracking-normal">{n}</span>
                ))}
                {d.cg.cexCount > 10 && <span className="text-[11px] text-ink-faint">+{d.cg.cexCount - 10} more</span>}
              </div>
            )}
          </Card>
        </div>

        {/* team & provenance + unified graph */}
        <div id="token-relationships" className="scroll-mt-28 mt-3 grid gap-3 lg:grid-cols-2">
          <Card title="Team & provenance">
            <div className="mb-1 text-[11px] leading-snug text-ink-faint">Vet the people behind it — these run a full audit of the project's account and site.</div>
            {d.projectX ? (
              <div className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-[12.5px] text-ink-dim">Project X account</span>
                <button onClick={() => onAudit(d.projectX!)} className="btn-chip tint-signal">
                  {d.projectX} <span aria-hidden>audit →</span>
                </button>
              </div>
            ) : (
              <div className="py-1.5 text-[12.5px] text-ink-faint">No X account linked to this token.</div>
            )}
            {projectSite && (
              <div className="flex items-center justify-between gap-2 border-t border-line/60 py-1.5">
                <span className="text-[12.5px] text-ink-dim">Project site</span>
                <button onClick={() => onAudit(projectSite)} className="btn-chip tint-signal">
                  recon for team <span aria-hidden>→</span>
                </button>
              </div>
            )}
            {otherLinks.length > 0 && (
              <div className="flex items-center gap-2 border-t border-line/60 py-1.5 text-[12.5px]">
                <span className="text-ink-dim">Other links</span>
                <span className="ml-auto flex flex-wrap justify-end gap-x-2 gap-y-0.5">
                  {otherLinks.map((x) => (
                    <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="link-ext mono text-[11px]">{x.label}</a>
                  ))}
                </span>
              </div>
            )}
            {d.deployer && (
              <div className="flex items-center justify-between gap-2 border-t border-line/60 py-1.5">
                <span className="text-[12.5px] text-ink-dim">Deployer</span>
                <span className="mono text-[11px] text-ink-faint">{shortAddr(d.deployer)}</span>
              </div>
            )}
            {d.topHolders.length > 0 && (
              <div className="mt-1 border-t border-line/60 pt-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="eyebrow">Holder concentration</span>
                  <span className="mono text-[11px]" style={{ color: topSum > 50 ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>top {d.topHolders.length} = {topSum.toFixed(0)}%</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-line">
                  {d.topHolders.map((h, i) => (
                    <div key={i} title={`${h.tag || shortAddr(h.address)} · ${h.percent.toFixed(1)}%`} style={{ width: `${Math.min(h.percent, 100)}%`, background: h.percent > 25 ? "var(--color-avoid)" : i % 2 ? "var(--color-signal)" : "var(--color-signal-dim)" }} />
                  ))}
                </div>
                <div className="mt-1.5">
                  {d.topHolders.map((h, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5 text-[11px]">
                      <span className="mono text-ink-dim">{h.tag || shortAddr(h.address)}{h.isContract ? " ·c" : ""}</span>
                      <span className="mono" style={{ color: h.percent > 25 ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>{h.percent.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <Card title="Panoptes graph">
            <TrustGraph nodes={d.graph.nodes} edges={d.graph.edges} />
          </Card>
        </div>

        {/* findings */}
        {d.findings.length > 0 && (
          <section className="mt-5">
            <div className="mb-2.5 text-[13.5px] font-semibold tracking-tight text-ink">Signals</div>
            <div className="space-y-2">
              {d.findings.map((f, i) => (
                <div key={i} className="panel flex items-start gap-3 p-3.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.tone === "good" ? "var(--color-pass)" : f.tone === "warn" ? "var(--color-caution)" : "var(--color-avoid)" }} />
                  <p className="flex-1 text-[13.5px] leading-snug text-ink">{f.claim}</p>
                  <span className="mono text-[11px] text-ink-faint">{f.source}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* transparent scan methodology — what ARGUS checked + the outcome of each */}
        <div className="mt-5">
          <MethodologyChecklist id="token-methodology" checks={checks} />
        </div>

        {/* ask-the-report chat — grounded in this token's own evidence */}
        <div className="mt-3">
          <AskReport
            subject={`$${d.symbol}`}
            reportVersionId={versionContext?.reportVersionId
              ?? (livePersistence?.state === "persisted" ? livePersistence.reportVersionId : undefined)
              ?? undefined}
            context={[
            `${d.name} ($${d.symbol}) on ${d.chain}`,
            d.headline,
            `underlying model signal ${d.verdict} ${d.score ?? ""}`,
            `decision readiness ${readiness.status}: ${readiness.successful}/${readiness.applicable} evidence outcomes recorded, ${readiness.unresolved} unresolved`,
            d.deployer ? `deployer ${d.deployer}` : "",
            d.cg ? `${d.cg.cexCount} CEX listings${d.cg.rank ? `, rank #${d.cg.rank}` : ""}` : "not on CoinGecko",
            projectSite ? `site ${projectSite}` : "",
            d.projectX ? `project X ${d.projectX}` : "",
            ].filter(Boolean).join(" | ")}
          />
        </div>

        {/* analyst augmentation — add a piece the scan missed (verified before publish) */}
        {showCurrentIntelligence && canMutateWorkspace && (
          <div className="mt-3">
            <AddInfo subject={`$${d.symbol}`} subjectKind="token" canonicalRef={d.address} subjectGraphKey={tokenSubjectGraphKey} />
          </div>
        )}

        {/* hard link — manually bridge this subject to another entity in the graph */}
        {showCurrentIntelligence && canMutateWorkspace && (
          <div className="mt-3">
            <LinkEntity subject={`$${d.symbol}`} subjectKind="token" canonicalRef={d.address} graphSubjectKey={tokenSubjectGraphKey} />
          </div>
        )}

        <div className="mt-8 panel p-5">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-dim"><ArgusMark size={16} /> How this verdict was reached</div>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            Scored live from DexScreener (market, liquidity, trading) and GoPlus (contract safety, holders), with no keys.
            Disqualifying findings, a honeypot, mintable supply, or reclaimable ownership, act as hard caps that override the
            weighted total. A clean market never papers over an unsafe contract. Real-time, reproducible.
          </p>
        </div>
      </div>
    </div>
  );
}
