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
        <span className="mono text-[9px] text-ink-faint">/ 100</span>
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
      {a.rationale && <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">{a.rationale}</p>}
    </div>
  );
}

function Check({ label, ok, value, na }: { label: string; ok: boolean; value?: string; na?: boolean }) {
  const color = na ? "var(--color-ink-faint)" : ok ? "var(--color-pass)" : "var(--color-avoid)";
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[12.5px] text-ink-dim">{label}</span>
      <span className="mono flex items-center gap-1.5 text-[11.5px]" style={{ color }}>
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
  evidence?: { reportVersionId?: string; version?: number; privateSession?: boolean },
): string {
  const moneyShort = (n?: number) => (n == null ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "K" : "$" + Math.round(n));
  const age = d.ageDays != null ? (d.ageDays < 1 ? "<1d" : Math.round(d.ageDays) + "d") : "?";
  const qualifiesPass = d.verdict === "PASS" && readiness.status !== "ready";
  const presentedVerdict = qualifiesPass ? readiness.status.toUpperCase() : d.verdict;
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
    `$${d.symbol} — ${presentedVerdict} · ${d.chain}${d.capApplied ? ` (cap: ${d.capApplied.replace(/_/g, " ")})` : ""}`,
    `${readiness.successful}/${readiness.applicable} evidence outcomes recorded · ${readiness.unresolved} unresolved · ${readiness.coveragePercent}% coverage`,
    `Underlying model signal: ${d.verdict} ${d.score ?? "—"}/100`,
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
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2 text-[12.5px] font-medium text-ink">{title}</div>
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
  const m = verdictMeta(d.verdict);
  const tokenSubjectGraphKey = String(d.graph.nodes.find((node) => node.subject)?.key ?? "") || undefined;
  const checks = versionContext
    ? versionContext.checks
    : tokenChecks(d);
  const readiness = deriveDecisionReadiness(checks);
  const qualifiesPass = d.verdict === "PASS" && readiness.status !== "ready";
  const presentedVerdict = qualifiesPass
    ? readiness.status === "provisional" ? "PROVISIONAL" : "INCOMPLETE"
    : m.label;
  const presentationColor = qualifiesPass
    ? readiness.status === "provisional" ? "var(--color-caution)" : "var(--color-ink-dim)"
    : m.color;
  const presentationGlow = qualifiesPass
    ? readiness.status === "provisional" ? "rgba(217,119,6,0.08)" : "transparent"
    : m.glow;
  const negativeSignal = d.verdict === "CAUTION" || d.verdict === "FAIL" || d.verdict === "AVOID";
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
    navigator.clipboard?.writeText(tokenReportText(d, readiness, {
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
        snapshot: { verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, mcap: d.mcap },
      }),
    );
  };

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-72" />

      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Audits
          </button>
          <span className="mono text-[11px] text-ink-faint">/ token</span>
          <span
            className="mono rounded border px-1.5 py-0.5 text-[10px] tracking-wider"
            style={versionContext
              ? { borderColor: "var(--color-line-2)", color: "var(--color-ink-faint)" }
              : { borderColor: "var(--color-signal)", color: "var(--color-signal)" }}
          >
            {versionContext ? `SNAPSHOT v${versionContext.version}` : "● LIVE SCAN"}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button onClick={onRescan} title="Run this audit again, fresh" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
              Rescan
            </button>
            {onOpenBrief && (
              <button
                type="button"
                onClick={onOpenBrief}
                title="Open the analyst decision brief anchored to this exact token case"
                className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:border-signal hover:text-signal"
              >
                Case brief
              </button>
            )}
            <button onClick={copyReport} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink">{copiedTxt ? "Copied ✓" : "Copy report"}</button>
            {canShare && (
              <button
                onClick={() => void share()}
                disabled={shareState === "creating"}
                aria-live="polite"
                title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable report link"}
                className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied ✓" : shareState === "error" ? "Share failed · retry" : "Share"}
              </button>
            )}
            {canMutateWorkspace && (
              <button onClick={watch} className="rounded-lg border px-3 py-1.5 text-[12.5px] transition" style={watched ? { borderColor: "var(--color-signal)", color: "var(--color-signal)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
                {watched ? "★ Watching" : "☆ Watch"}
              </button>
            )}
            <button onClick={onReset} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink">New audit</button>
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
          <div className="mt-4 rounded-xl border border-line bg-panel px-4 py-3 text-[11.5px] text-ink-dim" role="status">
            Saving the immutable scan before post-scan intelligence runs…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="mt-4 rounded-xl border border-caution/40 bg-caution/5 px-4 py-3 text-[11.5px] text-caution" role="alert">
            Post-scan intelligence is paused because this report could not be saved. Rescan before spending on supplemental providers.
          </div>
        )}
        {showCurrentIntelligence && <RingAlert handle={"$" + d.symbol} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* token identity */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {d.imageUrl ? (
            <img src={d.imageUrl} alt="" className="h-14 w-14 rounded-2xl border border-line-2 object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line-2 bg-panel text-xl text-signal">${d.symbol.slice(0, 3)}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">{d.name}</h1>
              <span className="mono text-[13px] text-ink-faint">${d.symbol}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
              <span className="rounded border border-line px-1.5 py-0.5 text-ink-dim capitalize">{d.chain}</span>
              <span>{d.dexId}</span>
              <span className="mono">{d.address.slice(0, 6)}…{d.address.slice(-4)}</span>
            </div>
            <ProjectLinks className="mt-2" website={projectSite} xHandle={d.projectX ?? d.cg?.twitter} links={d.socials} />
          </div>
          <div className="flex gap-5 text-right">
            <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">mcap</div><div className="mono text-[14px] text-ink">{money(d.mcap)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">liquidity</div><div className="mono text-[14px] text-ink">{money(d.liquidityUsd)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">24h vol</div><div className="mono text-[14px] text-ink">{money(d.vol24)}</div></div>
          </div>
        </div>

        {/* what the project actually does — CoinGecko's own blurb */}
        {d.cg?.description && (
          <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-ink-dim">{d.cg.description}</p>
        )}

        {/* Decision layer: model output and evidence completeness are separate.
            A thinly-supported PASS must never read like an investment-ready clearance. */}
        <div className="relative mt-4 overflow-hidden rounded-2xl border bg-panel p-6 soft-shadow" style={{ borderColor: `${presentationColor}55` }}>
          <div className="absolute right-0 top-0 h-full w-1/2" style={{ background: `radial-gradient(400px 200px at 100% 0%, ${presentationGlow}, transparent 70%)` }} />
          <div className="relative flex flex-wrap items-start gap-6">
            <Ring score={d.score} verdict={d.verdict} color={presentationColor} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">{qualifiesPass ? "Decision readiness" : "Token verdict"}</span>
                <span
                  className="mono rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide"
                  style={{
                    background: readiness.status === "ready" ? "rgba(22,163,74,0.10)" : "rgba(217,119,6,0.10)",
                    color: readiness.status === "ready" ? "var(--color-pass)" : "var(--color-caution)",
                  }}
                >
                  {readiness.status === "ready" ? "Evidence complete" : `${readiness.status} coverage`}
                </span>
              </div>
              <div className="text-[34px] font-bold leading-none tracking-tight" style={{ color: presentationColor }}>{presentedVerdict}</div>
              {qualifiesPass && (
                <div className="mono mt-2 text-[11px] text-ink-faint">
                  Underlying model signal <span className="text-ink-dim">PASS · {d.score ?? "—"}/100</span>
                </div>
              )}
              <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">{d.headline}</p>
              <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-ink-faint">
                {negativeSignal && readiness.status !== "ready" ? "Coverage gaps do not cancel recorded risk findings. " : ""}
                {readiness.guidance}
              </p>
              {d.capApplied && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12px]" style={{ borderColor: "var(--color-avoid)", color: "var(--color-avoid)" }}>
                  <span>▲</span> Hard cap · {d.capApplied.replace(/_/g, " ")}
                </div>
              )}
            </div>
          </div>

          <dl className="relative mt-5 grid gap-2 border-t border-line/60 pt-4 sm:grid-cols-3" aria-label="Evidence readiness summary">
            <div className="rounded-lg border border-line/60 bg-void/30 px-3 py-2">
              <dt className="text-[9.5px] uppercase tracking-wider text-ink-faint">Coverage</dt>
              <dd className="mono mt-0.5 text-[15px] text-ink">{readiness.coveragePercent}%</dd>
            </div>
            <div className="rounded-lg border border-line/60 bg-void/30 px-3 py-2">
              <dt className="text-[9.5px] uppercase tracking-wider text-ink-faint">Outcomes</dt>
              <dd className="mono mt-0.5 text-[15px] text-ink">{readiness.successful}<span className="text-[11px] text-ink-faint">/{readiness.applicable}</span></dd>
            </div>
            <div className="rounded-lg border border-line/60 bg-void/30 px-3 py-2">
              <dt className="text-[9.5px] uppercase tracking-wider text-ink-faint">Unresolved</dt>
              <dd className="mono mt-0.5 text-[15px]" style={{ color: readiness.unresolved ? "var(--color-caution)" : "var(--color-pass)" }}>{readiness.unresolved}</dd>
            </div>
          </dl>
          <a href="#token-methodology" className="relative mt-3 inline-flex text-[11.5px] text-signal transition hover:text-signal-dim">Review check-by-check methodology</a>
        </div>

        {/* price momentum */}
        {d.priceChange && (
          <div className="mt-4 grid grid-cols-4 gap-2">
            {([["5m", d.priceChange.m5], ["1h", d.priceChange.h1], ["6h", d.priceChange.h6], ["24h", d.priceChange.h24]] as [string, number | undefined][]).map(([l, v]) => (
              <div key={l} className="rounded-lg border border-line bg-panel px-3 py-2 text-center">
                <div className="text-[10px] uppercase tracking-wider text-ink-faint">{l}</div>
                <div className="mono text-[13px]" style={{ color: v == null ? "var(--color-ink-faint)" : v >= 0 ? "var(--color-pass)" : "var(--color-avoid)" }}>
                  {v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* price performance history */}
        {showCurrentIntelligence && (
          <div className="mt-4 rounded-xl border border-line bg-panel p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[12.5px] font-medium text-ink">Current price performance</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">live supplement · GeckoTerminal</div>
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
          <div className="mt-3 rounded-xl border border-line bg-panel/40 px-4 py-3 text-[12.5px] text-ink-dim">
            Contract-internal safety (honeypot, mint authority, ownership, tax) could not be verified keyless on <span className="capitalize">{d.chain}</span>. Those axes are scored conservatively. Add a Helius/Bitquery key to verify on-chain.
          </div>
        )}

        {/* axes */}
        <section className="mt-5">
          <div className="mb-2.5 text-[13px] font-semibold tracking-tight text-ink">Forensic breakdown</div>
          <div className="rounded-xl border border-line bg-panel px-4 py-1 divide-y divide-line/60">
            {d.axes.map((a) => <Bar key={a.key} a={a} color={m.color} />)}
            <div className="flex items-center justify-between py-2.5 text-[11.5px] text-ink-faint">
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
                  <span key={n} className="mono rounded px-1.5 py-0.5 text-[10.5px]" style={{ background: "rgba(22,163,74,0.10)", color: "var(--color-pass)" }}>{n}</span>
                ))}
                {d.cg.cexCount > 10 && <span className="text-[10px] text-ink-faint">+{d.cg.cexCount - 10} more</span>}
              </div>
            )}
          </Card>
        </div>

        {/* team & provenance + unified graph */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card title="Team & provenance">
            <div className="mb-1 text-[11px] leading-snug text-ink-faint">Vet the people behind it — these run a full audit of the project's account and site.</div>
            {d.projectX ? (
              <div className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-[12.5px] text-ink-dim">Project X account</span>
                <button onClick={() => onAudit(d.projectX!)} className="mono flex items-center gap-1 text-[12px] text-signal transition hover:text-signal-dim">
                  {d.projectX} <span aria-hidden>↗ audit</span>
                </button>
              </div>
            ) : (
              <div className="py-1.5 text-[12.5px] text-ink-faint">No X account linked to this token.</div>
            )}
            {projectSite && (
              <div className="flex items-center justify-between gap-2 border-t border-line/60 py-1.5">
                <span className="text-[12.5px] text-ink-dim">Project site</span>
                <button onClick={() => onAudit(projectSite)} className="mono flex items-center gap-1 text-[12px] text-signal transition hover:text-signal-dim">
                  recon for team <span aria-hidden>↗</span>
                </button>
              </div>
            )}
            {otherLinks.length > 0 && (
              <div className="flex items-center gap-2 border-t border-line/60 py-1.5 text-[12.5px]">
                <span className="text-ink-dim">Other links</span>
                <span className="ml-auto flex flex-wrap justify-end gap-x-2 gap-y-0.5">
                  {otherLinks.map((x) => (
                    <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="mono text-[11.5px] text-ink-faint transition hover:text-ink">{x.label}</a>
                  ))}
                </span>
              </div>
            )}
            {d.deployer && (
              <div className="flex items-center justify-between gap-2 border-t border-line/60 py-1.5">
                <span className="text-[12.5px] text-ink-dim">Deployer</span>
                <span className="mono text-[11.5px] text-ink-faint">{shortAddr(d.deployer)}</span>
              </div>
            )}
            {d.topHolders.length > 0 && (
              <div className="mt-1 border-t border-line/60 pt-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Holder concentration</span>
                  <span className="mono text-[11px]" style={{ color: topSum > 50 ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>top {d.topHolders.length} = {topSum.toFixed(0)}%</span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-line">
                  {d.topHolders.map((h, i) => (
                    <div key={i} title={`${h.tag || shortAddr(h.address)} · ${h.percent.toFixed(1)}%`} style={{ width: `${Math.min(h.percent, 100)}%`, background: h.percent > 25 ? "var(--color-avoid)" : i % 2 ? "var(--color-signal)" : "var(--color-signal-dim)" }} />
                  ))}
                </div>
                <div className="mt-1.5">
                  {d.topHolders.map((h, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5 text-[11.5px]">
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
            <div className="mb-2.5 text-[13px] font-semibold tracking-tight text-ink">Signals</div>
            <div className="space-y-2">
              {d.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-panel p-3.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.tone === "good" ? "var(--color-pass)" : f.tone === "warn" ? "var(--color-caution)" : "var(--color-avoid)" }} />
                  <p className="flex-1 text-[13px] leading-snug text-ink">{f.claim}</p>
                  <span className="mono text-[10.5px] text-ink-faint">{f.source}</span>
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
          <AskReport subject={`$${d.symbol}`} context={[
            `${d.name} ($${d.symbol}) on ${d.chain}`,
            d.headline,
            `underlying model signal ${d.verdict} ${d.score ?? ""}`,
            `decision readiness ${readiness.status}: ${readiness.successful}/${readiness.applicable} evidence outcomes recorded, ${readiness.unresolved} unresolved`,
            d.deployer ? `deployer ${d.deployer}` : "",
            d.cg ? `${d.cg.cexCount} CEX listings${d.cg.rank ? `, rank #${d.cg.rank}` : ""}` : "not on CoinGecko",
            projectSite ? `site ${projectSite}` : "",
            d.projectX ? `project X ${d.projectX}` : "",
          ].filter(Boolean).join(" | ")} />
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

        <div className="mt-8 rounded-xl border border-line bg-panel/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-dim"><ArgusMark size={16} /> How this verdict was reached</div>
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
