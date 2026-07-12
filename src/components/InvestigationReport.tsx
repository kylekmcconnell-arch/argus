import { useRef, useState } from "react";
import { verdictMeta } from "../lib/verdict";
import type { Investigation } from "../lib/investigation";
import { Avatar } from "./Avatar";
import { xAvatar, personAvatar } from "../lib/avatars";
import { OnChainForensics } from "./OnChainForensics";
import { ProjectResearch } from "./ProjectResearch";
import { ProjectLinks } from "./ProjectLinks";
import { MethodologyChecklist } from "./MethodologyChecklist";
import { personChecks, tokenChecks } from "../lib/scanChecklist";
import { deriveDecisionReadiness } from "../lib/decisionReadiness";
import { ArkhamName } from "./ArkhamName";
import { useArkhamLabels } from "../lib/useArkhamLabels";
import { AddInfo } from "./AddInfo";
import { LinkEntity } from "./LinkEntity";
import { AskReport } from "./AskReport";
import { ArkhamGraphBridge } from "./ArkhamGraphBridge";
import { Counterparties } from "./Counterparties";
import { RiskPaths } from "./RiskPaths";
import { Holdings } from "./Holdings";
import { TokenSparkline } from "./TokenSparkline";
import { NamesakeCheck } from "./NamesakeCheck";
import { ServiceAlert } from "./ServiceAlert";
import { RingAlert } from "./RingAlert";
import { TrustGraph } from "./TrustGraph";
import { PanelRequestNotice } from "./PanelRequestNotice";
import { investigationContribution, getContributions } from "../graph/store";
import { subjectConnections } from "../graph/network";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";
import {
  ArrowClockwise,
  ArrowLeft,
  Briefcase,
  ClipboardText,
  Database,
  Graph,
  IdentificationBadge,
  ShareNetwork,
  ShieldWarning,
} from "@phosphor-icons/react";
import { InvestigationDecisionCanvas } from "./InvestigationDecisionCanvas";
import { ReportCanvasSectionNav } from "./ReportCanvasPrimitives";

const initial = (s: string) => (s.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();

const MAX_FOUNDER_AUDITS = 5;

function money(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

function VerdictPill({ verdict, score }: { verdict: string; score: number | null }) {
  const m = verdictMeta(verdict);
  const fail = verdict === "FAIL";
  return (
    <span
      className={`verdict-pill ${fail ? "tint-fail" : "tint-var"}`}
      style={fail ? undefined : ({ "--tint": m.color } as React.CSSProperties)}
    >
      {m.label}{typeof score === "number" ? ` ${score}` : ""}
    </span>
  );
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className={`panel p-4 ${accent ? "tint-var" : ""}`} style={accent ? ({ "--tint": accent } as React.CSSProperties) : undefined}>
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </div>
  );
}

export function InvestigationReport({
  inv,
  onAudit,
  onReset,
  onOpenToken,
  onOpenProjectAccount,
  onReAudit,
  onOpenBrief,
}: {
  inv: Investigation;
  onAudit: (q: string) => void;
  onReset: () => void;
  onOpenToken: () => void;
  onOpenProjectAccount: () => void;
  onReAudit?: () => void;
  onOpenBrief?: () => void;
}) {
  const [spent, setSpent] = useState(0);
  const spentRef = useRef(0); // synchronous guard so a rapid double-click can't overshoot the cap
  const versionContext = inv.versionContext;
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const persistencePending = !versionContext && inv.persistence?.state === "pending";
  const persistenceFailed = !versionContext && inv.persistence?.state === "failed";
  const panelCostToken = !versionContext && inv.persistence?.state === "persisted"
    ? inv.persistence.panelCostToken ?? undefined
    : undefined;
  const persistenceMissingCapability = !versionContext
    && inv.persistence?.state === "persisted"
    && !panelCostToken;
  const privateSession = inv.persistence?.state === "private";
  const showCurrentIntelligence = versionContext
    ? currentIntelligenceEnabled
    : !privateSession && !persistencePending && !persistenceFailed && !persistenceMissingCapability;
  const canRecordCurrentIntelligence = !versionContext && inv.persistence?.state !== "private";
  const canMutateWorkspace = !versionContext && inv.persistence?.state !== "private";
  const canShare = Boolean(
    versionContext?.reportVersionId
    || (inv.persistence?.state === "persisted" && inv.persistence.reportVersionId),
  );
  const { token, projectX, recon, projectAccount, founders, deployerTrail } = inv;
  const tokenSubjectGraphKey = String(token.graph.nodes.find((node) => node.subject)?.key ?? "") || undefined;
  const diligenceChecks = inv.versionContext
    ? inv.versionContext.checks
    : tokenChecks(token);
  const readiness = deriveDecisionReadiness(diligenceChecks);
  const positiveVerdictNeedsQualification = token.verdict === "PASS" && readiness.status !== "ready";
  const presentedTokenVerdict = positiveVerdictNeedsQualification ? "INCOMPLETE" : token.verdict;
  const preliminaryTokenMeta = verdictMeta(token.verdict);
  const readinessColor = readiness.status === "ready" ? "var(--color-pass)" : "var(--color-caution)";
  const projectChecks = projectAccount
    ? projectAccount.versionContext
      ? projectAccount.versionContext.checks
      : projectAccount.checkRuns?.length
        ? projectAccount.checkRuns
        : personChecks({
            identityConfidence: projectAccount.report.identity_confidence ?? undefined,
            realName: (projectAccount.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
            roles: projectAccount.report.roles ?? [],
            hasAssociates: (projectAccount.evidence.associates ?? []).length > 0,
          })
    : [];
  const projectReadiness = projectAccount ? deriveDecisionReadiness(projectChecks) : null;
  const projectPositiveNeedsQualification = Boolean(
    projectAccount?.report.composite_verdict === "PASS" && projectReadiness?.status !== "ready",
  );
  const presentedProjectVerdict = projectPositiveNeedsQualification
    ? "INCOMPLETE"
    : projectAccount?.report.composite_verdict;
  const projectSourceBackedVentures = (projectAccount?.evidence.ventures ?? [])
    .filter((venture) => venture.evidence_origin !== "model_lead" && venture.artifact_verified === true);
  const projectUnverifiedVentureCount = (projectAccount?.evidence.ventures ?? [])
    .filter((venture) => venture.evidence_origin === "model_lead" || venture.artifact_verified === false).length;
  const projectLegacyVentureCount = (projectAccount?.evidence.ventures ?? []).length
    - projectSourceBackedVentures.length
    - projectUnverifiedVentureCount;
  // Arkham entity labels for the deployer + funder wallets.
  const { labels: arkham, state: arkhamState } = useArkhamLabels(
    showCurrentIntelligence && panelCostToken ? [token.deployer, deployerTrail?.funder?.address] : [],
    panelCostToken,
  );
  const tm = verdictMeta(presentedTokenVerdict);
  // The project's GitHub org (from its site links), for commit forensics.
  // The project's own website (first non-social link) → domain intelligence.
  const projectDomain = [...(recon?.socials ?? []), ...(token.socials ?? [])]
    .map((s) => s.url)
    .find((u) => /^https?:\/\//i.test(u) && !/x\.com|twitter\.com|t\.me|telegram|discord|github\.com|medium\.com|linktr\.ee/i.test(u))
    ?.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "") ?? null;
  const ghOrg = (recon?.socials ?? [])
    .map((s) => s.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
    .find((g) => g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing)$/i.test(g)) ?? null;
  // Unified team: members named in the project's X content (associates) merged
  // with people dug up via the web/LinkedIn search, deduped by handle so a
  // pseudonymous handle gets enriched with its real name + LinkedIn.
  const teamUnified: { name: string; handle?: string; role: string; linkedin?: string }[] = (() => {
    const map = new Map<string, { name: string; handle?: string; role: string; linkedin?: string }>();
    for (const a of projectAccount?.evidence.associates ?? []) {
      if (!/^team:/i.test(a.relation ?? "")) continue;
      map.set(a.associate_key.toLowerCase(), { name: a.associate_key, handle: a.associate_key, role: (a.relation ?? "team").replace(/^team:\s*/i, "") });
    }
    for (const p of inv.webTeam ?? []) {
      const ex = p.handle ? map.get(p.handle.toLowerCase()) : undefined;
      if (ex) { ex.name = p.name || ex.name; ex.linkedin = ex.linkedin ?? p.linkedin; if (!ex.role || ex.role === "team") ex.role = p.role; }
      else map.set((p.handle ?? p.name).toLowerCase(), { name: p.name, handle: p.handle, role: p.role, linkedin: p.linkedin });
    }
    return [...map.values()];
  })();
  // The full team, from EVERY source: site names, site-linked handles, project
  // bio handles, X-content team, and the web/LinkedIn dig — merged into one list.
  const teamPeople: { name: string; handle?: string; role?: string; linkedin?: string; source: string }[] = (() => {
    const map = new Map<string, { name: string; handle?: string; role?: string; linkedin?: string; source: string }>();
    const k = (h?: string | null, n?: string) => (h ? h.replace(/^@/, "").toLowerCase() : (n ?? "").toLowerCase());
    for (const m of teamUnified) map.set(k(m.handle, m.name), { name: m.name, handle: m.handle, role: m.role, linkedin: m.linkedin, source: m.linkedin ? "web/LinkedIn" : "X content" });
    for (const f of founders) {
      const key = k(f.handle, f.name);
      const ex = map.get(key);
      if (ex) { if (!ex.handle && f.handle) ex.handle = f.handle; }
      else map.set(key, { name: f.name, handle: f.handle ?? undefined, source: f.source === "site" ? "site" : "project account" });
    }
    return [...map.values()];
  })();
  const advisors = (projectAccount?.evidence.testimonials ?? []).filter((t) => t.claimed_relationship === "advisor");
  const advisorChip = (v?: string): { label: string; color: string } => {
    const s = (v ?? "").toLowerCase();
    if (s.includes("corrobor")) return { label: "corroborated", color: "var(--color-pass)" };
    if (s.includes("contradict")) return { label: "contradicted", color: "var(--color-avoid)" };
    return { label: "unconfirmed", color: "var(--color-ink-faint)" };
  };
  const auditFounder = (handle: string) => {
    if (spentRef.current >= MAX_FOUNDER_AUDITS) return;
    spentRef.current += 1;
    setSpent(spentRef.current);
    onAudit(handle);
  };
  const share = async () => {
    if (shareState === "creating") return;
    setShareState("creating");
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "investigation",
          ref: token.address,
          reportVersionId: versionContext?.reportVersionId
            ?? (inv.persistence?.state === "persisted" ? inv.persistence.reportVersionId : undefined),
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
      console.error("[share] investigation report failed", error);
      setShareState("error");
      setTimeout(() => setShareState("idle"), 3000);
    }
  };

  // The connection web: this token's own subgraph (deployer → funder trail, project
  // account, site) plus every cross-audit tie to other subjects you've scanned.
  const invGraph = investigationContribution(inv);
  const connections = subjectConnections("$" + token.symbol, getContributions());
  const recordedChecks = diligenceChecks.filter((check) => ["confirmed", "finding", "checked-empty"].includes(check.status));
  const gapChecks = diligenceChecks.filter((check) => ["unknown", "unavailable", "stale"].includes(check.status));
  const supportItems = [
    ...token.findings
      .filter((finding) => finding.tone === "good")
      .map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...(teamPeople.length > 0 ? [{
      label: `${teamPeople.length} publicly tied team ${teamPeople.length === 1 ? "member" : "members"} identified`,
      detail: teamPeople.slice(0, 4).map((person) => person.name).filter(Boolean).join(", "),
    }] : []),
    ...recordedChecks
      .filter((check) => check.status !== "finding")
      .map((check) => ({ label: check.label, detail: check.note })),
  ].slice(0, 6);
  const concernItems = [
    ...token.findings
      .filter((finding) => finding.tone !== "good")
      .map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...recordedChecks
      .filter((check) => check.status === "finding")
      .map((check) => ({ label: check.label, detail: check.note })),
    ...(readiness.status !== "ready" ? [{ label: readiness.title, detail: readiness.guidance }] : []),
  ].slice(0, 6);
  const nextStepItems = gapChecks.slice(0, 6).map((check) => ({ label: `Resolve ${check.label.toLowerCase()}`, detail: check.note }));
  const verifiedItems = recordedChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const openQuestionItems = gapChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const capturedAt = versionContext?.createdAt
    ? new Date(versionContext.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : undefined;
  const favorableVerdict = presentedTokenVerdict === "PASS";
  const decisionCanvasTone = favorableVerdict
    ? "pass"
    : presentedTokenVerdict === "CAUTION" || presentedTokenVerdict === "INCOMPLETE" || presentedTokenVerdict === "UNVERIFIABLE_IDENTITY"
      ? "caution"
      : "avoid";

  return (
    <div className="relative min-h-full pb-24">
      <header className="border-b border-line bg-void/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <button onClick={onReset} className="btn-ghost flex min-h-9 items-center gap-1.5 px-1 text-[12.5px]">
            <ArrowLeft size={15} weight="bold" aria-hidden="true" /> New investigation
          </button>
          <span className="mono text-[11px] text-ink-faint">/ full investigation</span>
          <span className={`chip ${versionContext ? "" : "tint-signal"}`}>
            {versionContext ? `snapshot v${versionContext.version}` : "live scan"}
          </span>
          <div className="scrollbar-none order-3 flex w-full items-center gap-2 overflow-x-auto pb-1 sm:order-none sm:ml-auto sm:w-auto sm:justify-end sm:overflow-visible sm:pb-0">
            {onOpenBrief && (
              <button type="button" onClick={onOpenBrief} title="Open the analyst decision brief anchored to this exact investigation case" className="btn-primary flex min-h-10 items-center gap-2 px-3 text-[12.5px] font-medium">
                <Briefcase size={16} weight="duotone" aria-hidden="true" /> Case brief
              </button>
            )}
            {canShare && (
              <button type="button" onClick={() => void share()} disabled={shareState === "creating"} aria-live="polite" title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable investigation link"} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] disabled:cursor-wait disabled:opacity-60">
                <ShareNetwork size={16} weight="duotone" aria-hidden="true" />
                {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied" : shareState === "error" ? "Retry share" : "Share"}
              </button>
            )}
            {onReAudit && (
              <button onClick={onReAudit} title="Run this investigation again with current evidence" className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px]">
                <ArrowClockwise size={16} weight="duotone" aria-hidden="true" /> Rescan
              </button>
            )}
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
            <LiveSupplementalNotice private={privateSession} persisted={inv.persistence?.state === "persisted"} />
          </div>
        )}
        {persistencePending && (
          <div className="mt-4 panel px-4 py-3 text-[12.5px] text-ink-dim" role="status">
            Saving the immutable investigation before post-scan intelligence runs…
          </div>
        )}
        {(persistenceFailed || persistenceMissingCapability) && (
          <div className="finding tint-caution mt-4 px-4 py-3 text-[12.5px]" role="alert">
            Post-scan intelligence is paused because this investigation could not be saved. Rescan before spending on supplemental providers.
          </div>
        )}
        {showCurrentIntelligence && <RingAlert handle={"$" + token.symbol} onAudit={onAudit} snapshotVersion={versionContext?.version} />}
        {/* headline */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            {token.imageUrl && <img src={token.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-lg border border-line object-cover" />}
            <h1 className="display-sm text-[24px] text-ink">{`Investigation · $${token.symbol}`}</h1>
          </div>
          {/* Two DISTINCT scores, labelled so it's obvious what each grades. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-1.5">
              <span className="eyebrow">Token risk</span>
              <VerdictPill verdict={presentedTokenVerdict} score={positiveVerdictNeedsQualification ? null : token.score} />
            </span>
            {projectAccount && (
              <span className="flex items-center gap-1.5">
                <span className="eyebrow">Project account</span>
                <VerdictPill verdict={presentedProjectVerdict ?? "INCOMPLETE"} score={projectPositiveNeedsQualification ? null : projectAccount.report.governing_score} />
              </span>
            )}
          </div>
          <div
            className="finding tint-var mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
            style={{ "--tint": readinessColor } as React.CSSProperties}
          >
            <span className="chip tint-var" style={{ "--tint": readinessColor } as React.CSSProperties}>
              {readiness.status}
            </span>
            <span className="text-[12.5px] font-medium text-ink">{readiness.title}</span>
            <span className="mono text-[11px] text-ink-faint">
              {readiness.successful}/{readiness.applicable} outcomes · {readiness.coveragePercent}% coverage
            </span>
            {positiveVerdictNeedsQualification && (
              <span className="mono text-[11px]" style={{ color: preliminaryTokenMeta.color }}>
                preliminary model signal · {preliminaryTokenMeta.label} {token.score ?? "—"}
              </span>
            )}
            {projectAccount && projectReadiness && (
              <span className="mono text-[11px] text-ink-faint">
                project account · {projectReadiness.status} · {projectReadiness.successful}/{projectReadiness.applicable} outcomes
              </span>
            )}
            <a href="#investigation-methodology" className="ml-auto text-[11px] text-signal-dim underline-offset-2 hover:text-signal hover:underline">
              Review checks
            </a>
            <p className="w-full text-[11px] leading-snug text-ink-faint">{readiness.guidance}</p>
          </div>
          {/* Lead with the TEAM when we know it — don't declare "no team" when it's named below. */}
          {teamPeople.length > 0 ? (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">
              Built by {teamPeople.slice(0, 3).map((p) => p.name).filter(Boolean).join(", ")}{teamPeople.length > 3 ? ` +${teamPeople.length - 3} more` : ""}{projectX ? ` · project account ${projectX}` : ""} — full team below.
            </p>
          ) : (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">{inv.founderNote}</p>
          )}
          {/* What the project actually IS — CoinGecko's own blurb, else the project's X bio. */}
          {(() => {
            const blurb = token.cg?.description || projectAccount?.bio || null;
            return blurb ? <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-dim">{blurb}</p> : null;
          })()}
          {/* official website + socials */}
          <ProjectLinks
            className="mt-3"
            website={projectDomain}
            xHandle={projectX ?? token.cg?.twitter}
            links={[...(recon?.socials ?? []), ...(token.socials ?? [])]}
          />
          <p className="mono mt-2 break-all text-[11px] text-ink-faint">{inv.rootRef}</p>
        </div>

        <div className="sticky top-0 z-10 mt-5">
          <ReportCanvasSectionNav
            sticky={false}
            items={[
              { href: "#report-summary", label: "Summary", icon: <ClipboardText size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#report-risks", label: "Risks", icon: <ShieldWarning size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#investigation-evidence", label: "Evidence", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
              ...((teamPeople.length > 0 || advisors.length > 0) ? [{ href: "#investigation-team" as const, label: "Team", icon: <IdentificationBadge size={16} weight="duotone" aria-hidden="true" /> }] : []),
              ...(invGraph && invGraph.nodes.length > 1 ? [{ href: "#investigation-relationships" as const, label: "Relationships", icon: <Graph size={16} weight="duotone" aria-hidden="true" /> }] : []),
              { href: "#investigation-methodology", label: "Sources & checks", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
            ]}
          />
        </div>

        <InvestigationDecisionCanvas
          verdictLabel={verdictMeta(presentedTokenVerdict).label}
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
          evidenceHref="#investigation-evidence"
          methodologyHref="#investigation-methodology"
        />

        <div id="investigation-evidence" className="scroll-mt-28 mt-5 grid gap-3 lg:grid-cols-2">
          {/* on-chain */}
          <Card title="On-chain" accent={tm.color}>
            <div className="flex items-center justify-between">
              <span className="mono text-[13.5px] text-ink">{`$${token.symbol}`}</span>
              <VerdictPill verdict={presentedTokenVerdict} score={positiveVerdictNeedsQualification ? null : token.score} />
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{token.headline}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
              <span>liq <span className="mono text-ink-dim">{money(token.liquidityUsd)}</span></span>
              <span>mc <span className="mono text-ink-dim">{money(token.mcap)}</span></span>
              <span>chain <span className="mono text-ink-dim capitalize">{token.chain}</span></span>
            </div>
            {/* price history — the shape of the chart IS forensic context (pump, dump, drawdown) */}
            {showCurrentIntelligence && (
              <div className="mt-3 border-t border-line/60 pt-2.5">
                <TokenSparkline address={token.address} chain={token.chain} pairAddress={token.pairAddress} />
              </div>
            )}
            {/* CEX listings — real centralized-exchange listings are a strong legitimacy signal */}
            {token.cg?.cexNames && token.cg.cexNames.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/60 pt-2">
                <span className="text-[11px] text-ink-faint">listed on</span>
                {token.cg.cexNames.slice(0, 8).map((n) => (
                  <span key={n} className="chip tint-pass normal-case tracking-normal">{n}</span>
                ))}
                {token.cg.cexCount > 8 && <span className="text-[11px] text-ink-faint">+{token.cg.cexCount - 8} more</span>}
              </div>
            ) : token.cg && !token.cg.listed ? (
              <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-ink-faint">Not on CoinGecko · no centralized-exchange listings (DEX-only).</div>
            ) : token.cg && token.cg.cexCount === 0 ? (
              <div className="mt-2 border-t border-line/60 pt-2 text-[11px] text-ink-faint">No centralized-exchange listings (DEX-only).</div>
            ) : null}
            <button onClick={onOpenToken} className="btn-chip tint-signal mt-3">full on-chain report →</button>
          </Card>

          {/* the people behind it (summary; the full team is its own section below) */}
          <Card title="The people behind it">
            {teamPeople.length > 0 ? (
              <>
                <p className="text-[12.5px] leading-relaxed text-ink-dim">
                  {teamPeople.length} {teamPeople.length === 1 ? "person is" : "people are"} publicly tied to this project: {teamPeople.slice(0, 4).map((p) => p.name).filter(Boolean).join(", ")}{teamPeople.length > 4 ? ", …" : ""}.
                </p>
                <p className="mt-1.5 text-[12.5px] text-ink-faint">Full roster with roles &amp; links in the Team section below.</p>
              </>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-ink-dim">{recon ? recon.identityLine : inv.founderNote}</p>
            )}

            {/* project account — explicitly NOT a founder */}
            <div className="mt-2.5 border-t border-line/60 pt-2.5">
              <div className="eyebrow">Project account (not a founder)</div>
              {projectX ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="mono text-[12.5px] text-ink">{projectX}</span>
                  {projectAccount ? (
                    <VerdictPill verdict={presentedProjectVerdict ?? "INCOMPLETE"} score={projectPositiveNeedsQualification ? null : projectAccount.report.governing_score} />
                  ) : (
                    <button onClick={() => auditFounder(projectX)} disabled={spent >= MAX_FOUNDER_AUDITS} className="btn-chip tint-signal shrink-0 disabled:opacity-40">
                      {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "audit →"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] text-ink-faint">No X account linked to this token.</p>
              )}
            </div>

            {token.deployer && (
              <div className="mt-2.5 border-t border-line/60 pt-2.5 text-[11px] text-ink-faint">
                <div>
                  Deployed by <ArkhamName address={token.deployer} chain={token.chain} labels={arkham} fallback={shortAddr(token.deployer)} className="text-ink-dim" />
                  {deployerTrail?.walletAgeDays != null && <> · wallet <span className="text-ink-dim">{deployerTrail.walletAgeDays}d</span> old</>}
                  {deployerTrail?.tokensCreated != null && <> · <span className="text-ink-dim">{deployerTrail.tokensCreated}</span> tokens minted</>}
                </div>
                {deployerTrail?.chain && deployerTrail.chain.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-ink-faint">money trail</span>
                    <span className="chip normal-case tracking-normal">{shortAddr(token.deployer)}</span>
                    {deployerTrail.chain.map((h, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="text-ink-faint">←</span>
                        {h.label ? (
                          <span className="chip tint-pass normal-case tracking-normal">{h.label}</span>
                        ) : (
                          <span className="chip normal-case tracking-normal">{shortAddr(h.to)}</span>
                        )}
                      </span>
                    ))}
                    {!deployerTrail.terminatesAtCex && <span className="text-ink-faint">· trail cold</span>}
                  </div>
                ) : deployerTrail?.funder ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span>funded by</span>
                    {deployerTrail.funder.label ? (
                      <span className="chip tint-pass normal-case tracking-normal">{deployerTrail.funder.label}</span>
                    ) : (
                      <ArkhamName address={deployerTrail.funder.address} chain={token.chain} labels={arkham} fallback={shortAddr(deployerTrail.funder.address)} className="text-ink-dim" />
                    )}
                  </div>
                ) : null}
                {deployerTrail?.serialDeployer && (
                  <span className="chip tint-avoid mt-1">serial deployer · {deployerTrail.tokensCreated}+ tokens</span>
                )}
                {deployerTrail && <div className="mt-1 leading-snug">{deployerTrail.note}</div>}
                {!deployerTrail && <div className="mt-0.5">deployer wallet, no identity verification available.</div>}
              </div>
            )}
          </Card>
        </div>

        {/* TEAM — the headline section, merged from every source, each clickable */}
        {(teamPeople.length > 0 || advisors.length > 0) && (
          <div id="investigation-team" className="scroll-mt-28 mt-3">
            <Card title="Team · from X content, the site, and web/LinkedIn">
              {teamPeople.length > 0 && (
                <div>
                  <div className="eyebrow">Team & founders ({teamPeople.length}) · click to run a full audit</div>
                  <div className="mt-1.5 space-y-1.5">
                    {teamPeople.map((m) => (
                      <div key={m.handle ?? m.name} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <Avatar src={personAvatar(m.handle, m.linkedin)} letter={initial(m.name)} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                          <span className="text-[12.5px] text-ink">{m.name}</span>
                          {m.handle && m.handle.replace(/^@/, "").toLowerCase() !== m.name.toLowerCase() && <span className="mono text-[11px] text-ink-faint">{m.handle}</span>}
                          {m.role && <span className="text-[11px] text-ink-faint">{m.role}</span>}
                          {m.linkedin && (
                            <a href={`https://${m.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>
                          )}
                          <span className="chip normal-case tracking-normal">{m.source}</span>
                        </span>
                        {m.handle ? (
                          <button
                            onClick={() => auditFounder(m.handle!)}
                            disabled={spent >= MAX_FOUNDER_AUDITS}
                            className="btn-chip tint-signal shrink-0 disabled:opacity-40"
                          >
                            {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "audit →"}
                          </button>
                        ) : (
                          <span className="mono shrink-0 text-[11px] text-ink-faint">no handle</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {advisors.length > 0 && (
                <div className={teamPeople.length > 0 ? "mt-3 border-t border-line/60 pt-3" : ""}>
                  <div className="eyebrow">Advisors / backers ({advisors.length}) · claimed, corroborated</div>
                  <div className="mt-1.5 space-y-1.5">
                    {advisors.map((a) => {
                      const c = advisorChip(a.corroboration_verdict);
                      return (
                        <div key={a.claimed_endorser_handle} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <Avatar src={a.claimed_endorser_handle ? xAvatar(a.claimed_endorser_handle) : null} letter={initial(a.claimed_endorser_handle ?? "?")} size={20} rounded="rounded-full" letterClass="text-[9px]" />
                            <span className="mono text-[12.5px] text-ink">{a.claimed_endorser_handle}</span>
                            <span className="chip tint-var" style={{ "--tint": c.color } as React.CSSProperties}>{c.label}</span>
                            {a.follows_subject === false && <span className="text-[11px] text-ink-dim">does not follow project</span>}
                          </span>
                          {a.claimed_endorser_handle && (
                            <button
                              onClick={() => auditFounder(a.claimed_endorser_handle!)}
                              disabled={spent >= MAX_FOUNDER_AUDITS}
                              className="btn-chip tint-signal shrink-0 disabled:opacity-40"
                            >
                              {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "background →"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[12.5px] leading-snug text-ink-faint">A claimed advisor who does not follow or has never acknowledged the project is a classic fake-name-drop signal.</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* on-chain forensic suite — the same cluster the token report uses:
            market intel, holders, clustering, operator trace, EVM deployer +
            bytecode, and the OFAC sanctions screen, in one canonical order. */}
        {showCurrentIntelligence && panelCostToken && (
          <div className="mt-3">
            <OnChainForensics token={token} onAudit={onAudit} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />
            {(arkhamState === "rescan_required" || arkhamState === "unavailable") && (
              <PanelRequestNotice failure={arkhamState} label="Wallet identity labels" className="mt-3" />
            )}
            {canRecordCurrentIntelligence && <ArkhamGraphBridge subject={`$${token.symbol}`} labels={arkham} />}
            {token.deployer && <Counterparties address={token.deployer} subject={`$${token.symbol}`} chain={token.chain} panelCostToken={panelCostToken} record={canRecordCurrentIntelligence} />}
            {token.deployer && <RiskPaths address={token.deployer} panelCostToken={panelCostToken} />}
            {token.deployer && <div className="mt-3"><Holdings address={token.deployer} symbol={token.symbol} panelCostToken={panelCostToken} /></div>}
          </div>
        )}

        {/* token provenance: who it's named after, and whether they're behind it */}
        {showCurrentIntelligence && panelCostToken && (
          <div className="mt-3">
            <NamesakeCheck symbol={token.symbol} name={token.name} contract={token.address} chain={token.chain} panelCostToken={panelCostToken} onAudit={onAudit} />
          </div>
        )}

        {/* unified project research: news & press, documents & resources, domain
            intelligence, and GitHub forensics — the same cluster every report uses */}
        {showCurrentIntelligence && (
          <div className="mt-3">
            <ProjectResearch name={token.name} symbol={token.symbol} domain={projectDomain} githubOrg={ghOrg} subjectKey={`$${token.symbol}`} newsHandle={projectX} record={canRecordCurrentIntelligence} {...(panelCostToken ? { panelCostToken } : {})} />
          </div>
        )}

        {/* Connection web: the subject's graph + its ties to everything else you've
            audited — the deeper map, below the team. */}
        {invGraph && invGraph.nodes.length > 1 && (
          <div id="investigation-relationships" className="scroll-mt-28 mt-3">
            <Card title="Connection web · click any node to open it">
              <TrustGraph nodes={invGraph.nodes} edges={invGraph.edges} connections={showCurrentIntelligence ? connections : []} onAudit={onAudit} onOpenProject={(name) => onAudit(name)} />
            </Card>
          </div>
        )}

        {/* project account dossier detail */}
        {projectAccount && (
          <div className="mt-3">
            <Card title={`Project account · ${projectAccount.handle}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Avatar src={projectAccount.avatar_url || token.imageUrl || xAvatar(projectAccount.handle)} letter={initial(projectAccount.handle)} size={28} rounded="rounded-lg" letterClass="text-[12px]" />
                <span className="text-[13.5px] font-medium text-ink">{projectAccount.display_name || projectAccount.handle}</span>
                <VerdictPill verdict={presentedProjectVerdict ?? "INCOMPLETE"} score={projectPositiveNeedsQualification ? null : projectAccount.report.governing_score} />
                <span className="ml-auto text-[11px] text-ink-faint">{projectAccount.followers} followers · joined {projectAccount.joined}</span>
              </div>
              {/* why the score landed where it did */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                {projectAccount.report.governing_role
                  ? <span>governed by <span className="text-ink-dim">{String(projectAccount.report.governing_role).toLowerCase()}</span></span>
                  : <span>governing role withheld</span>}
                {projectAccount.report.cap_applied && <span className="chip tint-avoid">cap · {String(projectAccount.report.cap_applied).replace(/_/g, " ")}</span>}
                <button onClick={onOpenProjectAccount} className="btn-chip tint-signal ml-auto">why this score · full report →</button>
              </div>
              {projectAccount.bio && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{projectAccount.bio}</p>}
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{projectAccount.headline}</p>
              {projectAccount.evidence.ventures.length > 0 && (
                <div className="mt-2 border-t border-line/60 pt-2">
                  <div className="eyebrow">Source-backed ventures & affiliations</div>
                  {projectSourceBackedVentures.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">
                    {projectSourceBackedVentures.slice(0, 6).map((v, i) => (
                      <span key={i} className="chip normal-case tracking-normal">{v.project_name}</span>
                    ))}
                  </div>}
                  <div className="mt-1 text-[10.5px] text-ink-faint">
                    {projectSourceBackedVentures.length} source-backed
                    {projectLegacyVentureCount > 0 ? ` · ${projectLegacyVentureCount} legacy curated` : ""}
                    {projectUnverifiedVentureCount > 0 ? ` · ${projectUnverifiedVentureCount} unverified lead${projectUnverifiedVentureCount === 1 ? "" : "s"} hidden here` : ""}
                    {projectUnverifiedVentureCount > 0 ? " · open the full report to inspect" : ""}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* transparent scan methodology — what ARGUS checked + the outcome of each */}
        <div className="mt-4">
          <MethodologyChecklist id="investigation-methodology" checks={diligenceChecks} />
        </div>
        {projectAccount && projectChecks.length > 0 && (
          <div className="mt-3">
            <div className="eyebrow mb-1.5">Project-account evidence coverage</div>
            <MethodologyChecklist id="investigation-project-methodology" checks={projectChecks} />
          </div>
        )}

        {/* ask-the-report chat — grounded in this investigation's own evidence */}
        <div className="mt-3">
          <AskReport
            subject={`$${token.symbol}`}
            reportVersionId={versionContext?.reportVersionId
              ?? (inv.persistence?.state === "persisted" ? inv.persistence.reportVersionId : undefined)
              ?? undefined}
            context={[
            inv.founderNote,
            token.headline,
            `scored token verdict ${token.verdict} ${token.score ?? ""}; decision readiness ${readiness.status}; ${readiness.successful}/${readiness.applicable} evidence outcomes recorded`,
            projectAccount && projectReadiness ? `project account scored verdict ${projectAccount.report.composite_verdict} ${projectAccount.report.governing_score ?? ""}; decision readiness ${projectReadiness.status}; ${projectReadiness.successful}/${projectReadiness.applicable} evidence outcomes recorded` : "",
            teamPeople.length ? `team: ${teamPeople.map((p) => p.name + (p.handle ? ` ${p.handle}` : "")).join(", ")}` : "",
            projectX ? `project X account ${projectX}` : "",
            token.deployer ? `deployer wallet ${token.deployer}` : "",
            deployerTrail?.funder ? `funder ${deployerTrail.funder.label ?? deployerTrail.funder.address}` : "",
            !versionContext && connections.length ? `already connected to: ${connections.map((c) => c.other).join(", ")}` : "",
            invGraph ? `graph entities: ${[...new Set(invGraph.nodes.map((n) => String(n.key)))].slice(0, 30).join(", ")}` : "",
            ].filter(Boolean).join(" | ")}
          />
        </div>

        {/* analyst augmentation — add a piece the scan missed (verified before publish) */}
        {showCurrentIntelligence && canMutateWorkspace && (
          <div className="mt-3">
            <AddInfo subject={`$${token.symbol}`} subjectKind="investigation" canonicalRef={token.address} subjectGraphKey={tokenSubjectGraphKey} />
          </div>
        )}

        {/* hard link — manually bridge this subject to another entity in the graph */}
        {showCurrentIntelligence && canMutateWorkspace && (
          <div className="mt-3">
            <LinkEntity subject={`$${token.symbol}`} subjectKind="investigation" canonicalRef={token.address} graphSubjectKey={tokenSubjectGraphKey} />
          </div>
        )}

        <div className="mt-4 panel p-4 text-[12.5px] leading-relaxed text-ink-faint">
          <span className="text-ink-dim">How to read this:</span> the token and site recon run keyless and free; the project account is backgrounded automatically (one live people-audit). Per-founder deep-dives are one-click and capped at {MAX_FOUNDER_AUDITS} per investigation to bound cost. ARGUS never invents a founder: names without a verified handle are shown but not audited, and a project account is never treated as a person behind the project.
        </div>
      </div>
    </div>
  );
}
