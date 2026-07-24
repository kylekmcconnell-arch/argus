import { useRef, useState } from "react";
import { verdictMeta } from "../lib/verdict";
import { isWatched, toggleWatch } from "../lib/watchlist";
import type { Investigation } from "../lib/investigation";
import { Avatar } from "./Avatar";
import { xAvatar, personAvatar } from "../lib/avatars";
import { OnChainForensics } from "./OnChainForensics";
import { ProjectResearch } from "./ProjectResearch";
import { ProjectLinks } from "./ProjectLinks";
import { MethodologyChecklist } from "./MethodologyChecklist";
import {
  clearanceCoverage,
  personChecks,
  reconcileInvestigationChecks,
  tokenChecks,
} from "../lib/scanChecklist";
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
import { TokenSnapshotVisuals } from "./TokenSnapshotVisuals";
import { MarketPerformancePanel } from "./MarketPerformancePanel";
import { UsageVisuals } from "./UsageVisuals";
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
  ChartLineUp,
  ClipboardText,
  Database,
  DotsThree,
  Graph,
  IdentificationBadge,
  ShareNetwork,
  ShieldWarning,
  Star,
} from "@phosphor-icons/react";
import { InvestigationDecisionCanvas } from "./InvestigationDecisionCanvas";
import { SecondOpinion } from "./SecondOpinion";
import { ExpandableText } from "./ExpandableText";
import { ReportDisclaimer } from "./ReportDisclaimer";
import { CopyTldrButton, ScoreContextStrip } from "./ScoreContext";
import { ReportCanvasSectionNav } from "./ReportCanvasPrimitives";
import {
  BasicFactsPanel,
  type BasicFactLeadView,
  type BasicFactView,
} from "./BasicFactsPanel";

const initial = (s: string) => (s.replace(/^[@$]/, "")[0] ?? "?").toUpperCase();

const MAX_FOUNDER_AUDITS = 5;

type TeamIdentity = {
  name?: string;
  handle?: string;
  linkedin?: string;
};

function normalizedTeamIdentity(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function teamIdentityKeys(person: TeamIdentity): Set<string> {
  const keys = new Set<string>();
  const handle = normalizedTeamIdentity(person.handle?.replace(/^@/, ""));
  const linkedin = (person.linkedin ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  const nameTokens = (person.name ?? "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const compactName = nameTokens.join("");

  if (handle) keys.add(`person:${handle}`);
  if (linkedin) keys.add(`linkedin:${linkedin}`);
  if (compactName) keys.add(`person:${compactName}`);
  if (nameTokens.length >= 2) {
    keys.add(`person:${nameTokens[0]}${nameTokens[nameTokens.length - 1]}`);
  }
  return keys;
}

function sameTeamIdentity(a: TeamIdentity, b: TeamIdentity): boolean {
  const aKeys = teamIdentityKeys(a);
  return [...teamIdentityKeys(b)].some((key) => aKeys.has(key));
}

function humanTeamName(current: TeamIdentity, incoming: TeamIdentity): string {
  const currentName = current.name ?? "";
  const incomingName = incoming.name ?? "";
  const currentLooksLikeHandle = currentName.startsWith("@")
    || (!/[\s._-]/.test(currentName)
      && normalizedTeamIdentity(currentName) === normalizedTeamIdentity(current.handle));
  const incomingLooksLikeHandle = incomingName.startsWith("@")
    || (!/[\s._-]/.test(incomingName)
      && normalizedTeamIdentity(incomingName) === normalizedTeamIdentity(incoming.handle));
  if (currentLooksLikeHandle && incomingName && !incomingLooksLikeHandle) return incomingName;
  return currentName || incomingName;
}

function mergeTeamSources(...sources: string[]): string {
  return [...new Set(sources.flatMap((source) => source.split(" + ")).filter(Boolean))].join(" + ");
}

function ReportSectionHeading({
  index,
  title,
  description,
}: {
  index: string;
  title: string;
  description: string;
}) {
  return (
    <header className="report-section-heading">
      <div>
        <p className="eyebrow text-signal-lift">{index}</p>
        <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">{description}</p>
      </div>
    </header>
  );
}

function money(n?: number): string {
  if (n == null) return "N/A";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

function StatusPill({
  label,
  color,
  score,
  title,
  fail = false,
  large = false,
}: {
  label: string;
  color: string;
  score: number | null;
  title?: string;
  fail?: boolean;
  large?: boolean;
}) {
  return (
    <span
      className={`verdict-pill ${large ? "verdict-pill-lg" : ""} ${fail ? "tint-fail" : "tint-var"}`}
      style={fail ? undefined : ({ "--tint": color } as React.CSSProperties)}
      title={title}
    >
      {label}{typeof score === "number" ? ` ${score}` : ""}
    </span>
  );
}

function VerdictPill({ verdict, score, large = false }: { verdict: string; score: number | null; large?: boolean }) {
  const m = verdictMeta(verdict);
  return (
    <StatusPill
      label={m.label}
      color={m.color}
      score={score}
      fail={verdict === "FAIL"}
      large={large}
    />
  );
}

function ProjectAccountStatusPill({
  reviewOpen,
  verdict,
  score,
}: {
  reviewOpen: boolean;
  verdict?: string;
  score: number | null;
}) {
  if (reviewOpen || !verdict) {
    return (
      <StatusPill
        label="Checks still open"
        color="var(--color-caution)"
        score={null}
        title="One or more required checks did not finish. Open the report to see what is missing."
      />
    );
  }
  return <VerdictPill verdict={verdict} score={score} />;
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
  const [watched, setWatched] = useState(() => isWatched(inv.token.address));
  const spentRef = useRef(0); // synchronous guard so a rapid double-click can't overshoot the cap
  const versionContext = inv.versionContext;
  const [currentIntelligenceVersionId, setCurrentIntelligenceVersionId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const currentIntelligenceEnabled = Boolean(
    versionContext && currentIntelligenceVersionId === versionContext.reportVersionId,
  );
  const loadCurrentIntelligence = () => {
    if (versionContext) setCurrentIntelligenceVersionId(versionContext.reportVersionId);
  };
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
  const { token, projectX, siteUrl, recon, projectAccount, founders, deployerTrail } = inv;
  const investigationBasicFactSnapshot = inv as Investigation & {
    basicFacts?: BasicFactView[];
    basicFactLeads?: BasicFactLeadView[];
  };
  const rawProjectBasicFacts = projectAccount?.basicFacts
    ?? investigationBasicFactSnapshot.basicFacts
    ?? [];
  const projectBasicFactLeads = projectAccount?.basicFactLeads
    ?? investigationBasicFactSnapshot.basicFactLeads
    ?? [];
  const tokenSubjectGraphKey = String(token.graph.nodes.find((node) => node.subject)?.key ?? "") || undefined;
  // Credit org-side outcomes the bound project scan recorded in this same
  // payload; without a confirmed canonical binding this is a no-op.
  const diligenceChecks = reconcileInvestigationChecks(
    inv.versionContext ? inv.versionContext.checks : tokenChecks(token),
    token.address,
    projectAccount,
    inv.projectAccountAudit,
  );
  const readiness = deriveDecisionReadiness(diligenceChecks);
  const clearance = clearanceCoverage(diligenceChecks);
  const observedTokenMeta = verdictMeta(token.verdict);
  const readinessLabel = readiness.status === "ready"
    ? "READY TO REVIEW"
    : readiness.status === "provisional"
      ? "REVIEW WITH GAPS"
      : "NOT READY";
  const readinessColor = readiness.status === "ready"
    ? "var(--color-pass)"
    : readiness.status === "provisional"
      ? "var(--color-caution)"
      : "var(--color-avoid)";
  const recordedChecks = diligenceChecks.filter((check) => ["confirmed", "finding", "checked-empty"].includes(check.status));
  const gapChecks = diligenceChecks.filter((check) => ["unknown", "unavailable", "stale"].includes(check.status));
  const requiredGapChecks = gapChecks.filter((check) =>
    check.checkId ? clearance.openNeverWaive.includes(check.checkId) : false);
  const enrichmentGapChecks = gapChecks.filter((check) => !requiredGapChecks.includes(check));
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
  const projectReviewOpen = Boolean(
    projectPositiveNeedsQualification || projectAccount?.report.composite_verdict === "INCOMPLETE",
  );
  const presentedProjectVerdict = projectAccount?.report.composite_verdict;
  const projectAccountHeadline = projectAccount
    ? projectReviewOpen
      ? "This project account review is missing one or more required checks. Open the full report to see what is still needed."
      : projectAccount.headline
    : undefined;
  const marketCap = token.mcap ?? token.cg?.mcapUsd ?? undefined;
  const fullyDilutedValue = token.fdv
    ?? projectAccount?.projectToken?.fdvUsd
    ?? undefined;
  const establishedAsset = Boolean(
    (token.cg?.rank != null && token.cg.rank <= 250)
    || (marketCap != null && marketCap >= 100_000_000)
    || (token.cg?.cexCount != null && token.cg.cexCount >= 10),
  );
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
  const tm = observedTokenMeta;
  // The project's GitHub org (from its site links), for commit forensics.
  // The project's own website (first non-social link) → domain intelligence.
  const projectDomain = [siteUrl, ...(recon?.socials ?? []).map((s) => s.url), ...(token.socials ?? []).map((s) => s.url)]
    .filter((url): url is string => Boolean(url))
    .find((u) => /^https?:\/\//i.test(u) && !/x\.com|twitter\.com|t\.me|telegram|discord|github\.com|medium\.com|linktr\.ee/i.test(u))
    ?.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "") ?? null;
  const ghOrg = (recon?.socials ?? [])
    .map((s) => s.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
    .find((g) => g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing)$/i.test(g)) ?? null;
  const projectBasicFacts = rawProjectBasicFacts.filter((fact) => {
    const monidSources = (fact.sources ?? []).filter((source) =>
      source.provider === "monid" || /Monid\/Akta/i.test(source.title ?? ""));
    if (!fact.providerProjection || !monidSources.length) return true;
    if (!projectDomain) return false;
    return monidSources.some((source) => {
      try {
        const sourceHost = new URL(source.url ?? "").hostname.replace(/^www\./, "").toLowerCase();
        return sourceHost === projectDomain
          || sourceHost.endsWith(`.${projectDomain}`)
          || projectDomain.endsWith(`.${sourceHost}`);
      } catch {
        return false;
      }
    });
  });
  const showProjectBasicFacts = Boolean(projectAccount)
    || projectBasicFacts.length > 0
    || projectBasicFactLeads.length > 0;
  // Unified team: members named in the project's X content (associates) merged
  // with people dug up via the web/LinkedIn search, deduped by handle so a
  // pseudonymous handle gets enriched with its real name + LinkedIn.
  const teamUnified: { name: string; handle?: string; role: string; linkedin?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string }[] = (() => {
    type TeamRow = { name: string; handle?: string; role: string; linkedin?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string };
    const map = new Map<string, TeamRow>();
    const findExisting = (person: { name: string; handle?: string; linkedin?: string }) => {
      return [...map.entries()].find(([, row]) => sameTeamIdentity(row, person));
    };
    const add = (person: TeamRow) => {
      const existing = findExisting(person);
      if (!existing) {
        map.set([...teamIdentityKeys(person)][0] ?? person.name.toLowerCase(), person);
        return;
      }
      const [key, row] = existing;
      map.set(key, {
        ...row,
        name: humanTeamName(row, person),
        handle: row.handle ?? person.handle,
        linkedin: row.linkedin ?? person.linkedin,
        role: !row.role || /^team$/i.test(row.role) ? person.role : row.role,
        developerProfiles: row.developerProfiles ?? person.developerProfiles,
        source: mergeTeamSources(row.source, person.source),
      });
    };
    for (const a of projectAccount?.evidence.associates ?? []) {
      if (!/^team:/i.test(a.relation ?? "")) continue;
      add({ name: a.associate_key, handle: a.associate_key, role: (a.relation ?? "team").replace(/^team:\s*/i, ""), source: "project account" });
    }
    for (const p of projectAccount?.webTeam ?? []) {
      if (p.provider === "monid") {
        if (!projectDomain || !p.sourceUrl) continue;
        try {
          const sourceHost = new URL(p.sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
          if (sourceHost !== projectDomain
            && !sourceHost.endsWith(`.${projectDomain}`)
            && !projectDomain.endsWith(`.${sourceHost}`)) continue;
        } catch {
          continue;
        }
      }
      add({
        name: p.name,
        handle: p.handle,
        role: p.role,
        linkedin: p.linkedin,
        developerProfiles: p.developerProfiles,
        source: p.linkedin ? "project scan + LinkedIn" : "project scan",
      });
    }
    for (const p of inv.webTeam ?? []) {
      add({
        name: p.name,
        handle: p.handle,
        role: p.role,
        linkedin: p.linkedin,
        developerProfiles: p.developerProfiles,
        source: p.linkedin ? "web/LinkedIn" : "X content",
      });
    }
    return [...map.values()];
  })();
  // The full team, from EVERY source: site names, site-linked handles, project
  // bio handles, X-content team, and the web/LinkedIn dig — merged into one list.
  const teamPeople: { name: string; handle?: string; role?: string; linkedin?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string }[] = (() => {
    type TeamPerson = { name: string; handle?: string; role?: string; linkedin?: string; developerProfiles?: Array<{ provider: "github" | "huggingface"; url: string; sourceUrl: string }>; source: string };
    const people: TeamPerson[] = [];
    const add = (person: TeamPerson) => {
      const existing = people.find((candidate) => sameTeamIdentity(candidate, person));
      if (!existing) {
        people.push(person);
        return;
      }
      existing.name = humanTeamName(existing, person);
      existing.handle ??= person.handle;
      existing.linkedin ??= person.linkedin;
      existing.role = !existing.role || /^team$/i.test(existing.role) ? person.role : existing.role;
      existing.developerProfiles ??= person.developerProfiles;
      existing.source = mergeTeamSources(existing.source, person.source);
    };
    for (const m of teamUnified) {
      add({ name: m.name, handle: m.handle, role: m.role, linkedin: m.linkedin, developerProfiles: m.developerProfiles, source: m.source });
    }
    for (const f of founders) {
      add({ name: f.name, handle: f.handle ?? undefined, source: f.source === "site" ? "site" : "project account" });
    }
    return people;
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
  const watch = () => {
    if (!canMutateWorkspace) return;
    setWatched(toggleWatch({
      id: token.address,
      kind: "token",
      label: `$${token.symbol}`,
      chain: token.chain,
      via: token.chain === "solana" ? "solana" : "evm",
      addedAt: 0,
      snapshot: {
        verdict: token.verdict,
        score: token.score,
        completenessState: readiness.status === "ready" ? "complete" : "partial",
        liquidityUsd: token.liquidityUsd,
        mcap: marketCap,
      },
    }));
  };

  // Same mint the Share button uses, composed into the TLDR at copy time so a
  // pasted summary opens without sign-in and unfurls into the report card.
  const mintShareUrl = async (): Promise<string | null> => {
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
      const body = (await response.json().catch(() => ({}))) as { url?: unknown };
      if (!response.ok || typeof body.url !== "string") return null;
      return new URL(body.url, location.origin).toString();
    } catch {
      return null;
    }
  };

  // The connection web: this token's own subgraph (deployer → funder trail, project
  // account, site) plus every cross-audit tie to other subjects you've scanned.
  const invGraph = investigationContribution(inv);
  const connections = subjectConnections("$" + token.symbol, getContributions());
  const supportItems = [
    ...token.findings
      .filter((finding) => finding.tone === "good")
      .map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...(teamPeople.length > 0 ? [{
      label: `${teamPeople.length} publicly tied team ${teamPeople.length === 1 ? "member" : "members"} identified`,
      detail: teamPeople.slice(0, 4).map((person) => person.name).filter(Boolean).join(", "),
    }] : []),
    // Checked-empty rows are coverage, never support: a completed no-result
    // search must not render as positive evidence pulling against the verdict.
    // They stay visible in the recorded-outcomes rail below.
    ...recordedChecks
      .filter((check) => check.status === "confirmed")
      .map((check) => ({ label: check.label, detail: check.note })),
  ].slice(0, 6);
  const concernItems = [
    ...token.findings
      .filter((finding) => finding.tone !== "good")
      .map((finding) => ({ label: finding.claim, detail: finding.source })),
    ...recordedChecks
      .filter((check) => check.status === "finding")
      .map((check) => ({ label: check.label, detail: check.note })),
    ...(readiness.status !== "ready" ? [{
      label: readinessLabel,
      detail: requiredGapChecks.length
        ? `Finish ${requiredGapChecks.map((check) => check.label).join(", ")} before relying on this report.`
        : readiness.guidance,
    }] : []),
  ].slice(0, 6);
  const nextStepItems = [...requiredGapChecks, ...enrichmentGapChecks]
    .slice(0, 6)
    .map((check) => ({
      label: `${requiredGapChecks.includes(check) ? "Required: " : ""}Resolve ${check.label.toLowerCase()}`,
      detail: check.note,
    }));
  // One paste, whole verdict: composed for group chats. The link is appended
  // at copy time (share link when mintable, app URL else).
  const tldrBase = [
    `ARGUS · $${token.symbol} investigation · risk score ${observedTokenMeta.label}${token.score == null ? "" : ` ${token.score}/100`} · safety checks ${readinessLabel}`,
    token.headline,
    nextStepItems[0] ? `Top open item: ${nextStepItems[0].label}.` : "",
  ].filter(Boolean).join("\n");
  const verifiedItems = recordedChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const openQuestionItems = gapChecks.slice(0, 6).map((check) => ({ label: check.label, detail: check.note }));
  const capturedAt = versionContext?.createdAt
    ? new Date(versionContext.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : undefined;
  const favorableVerdict = token.verdict === "PASS";
  const decisionCanvasTone = favorableVerdict
    ? "pass"
    : token.verdict === "CAUTION" || token.verdict === "INCOMPLETE" || token.verdict === "UNVERIFIABLE_IDENTITY"
      ? "caution"
      : "avoid";

  return (
    <div className="relative min-h-full pb-24">
      <header className="sticky top-0 z-30 border-b border-line bg-void/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <button onClick={onReset} className="btn-ghost flex min-h-9 items-center gap-1.5 px-1 text-[12.5px]">
            <ArrowLeft size={15} weight="bold" aria-hidden="true" /> New investigation
          </button>
          <span className="mono text-[11px] text-ink-faint">/ full investigation</span>
          <span className={`chip ${versionContext ? "" : "tint-signal"}`}>
            {versionContext ? `snapshot v${versionContext.version}` : "live scan"}
          </span>
          <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:ml-auto sm:w-auto sm:justify-end">
            {onOpenBrief && (
              <button type="button" onClick={onOpenBrief} title="Open the analyst decision brief anchored to this exact investigation case" className="btn-primary flex min-h-10 items-center gap-2 px-3 text-[12.5px] font-medium">
                <Briefcase size={16} weight="duotone" aria-hidden="true" /> Case brief
              </button>
            )}
            <a href="#investigation-challenge" title="Tell ARGUS what looks wrong or missing in this report" className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] font-medium">
              <ShieldWarning size={16} weight="duotone" aria-hidden="true" /> Challenge
            </a>
            <div className="hidden items-center gap-2 sm:flex">
              {canShare && (
                <button type="button" onClick={() => void share()} disabled={shareState === "creating"} aria-live="polite" title={shareState === "error" ? "Secure share could not be created or copied. Retry when ready." : "Copy a 30-day immutable investigation link"} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] disabled:cursor-wait disabled:opacity-60">
                  <ShareNetwork size={16} weight="duotone" aria-hidden="true" />
                  {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied" : shareState === "error" ? "Retry share" : "Share"}
                </button>
              )}
              {onReAudit && readiness.status === "ready" && (
                <button onClick={onReAudit} title="Run this investigation again with current evidence" className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px]">
                  <ArrowClockwise size={16} weight="duotone" aria-hidden="true" />
                  Rescan
                </button>
              )}
              {canMutateWorkspace && (
                <button type="button" onClick={watch} aria-pressed={watched} title="Add this report to your watchlist so later scans can flag changes" className={`btn-secondary flex min-h-10 items-center gap-2 px-3 text-[12.5px] ${watched ? "tint-signal" : ""}`}>
                  <Star size={16} weight={watched ? "fill" : "duotone"} aria-hidden="true" />
                  {watched ? "Watching" : "Watch"}
                </button>
              )}
            </div>
            {(canShare || (onReAudit && readiness.status === "ready")) && (
              <details className="group relative ml-auto sm:hidden">
                <summary
                  aria-label="More report actions"
                  className="btn-secondary flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center px-2.5 [&::-webkit-details-marker]:hidden"
                >
                  <DotsThree size={19} weight="bold" aria-hidden="true" />
                  <span className="sr-only">More report actions</span>
                </summary>
                <div className="absolute right-0 top-[calc(100%+0.4rem)] z-20 min-w-44 overflow-hidden rounded-lg border border-line bg-panel py-1 soft-shadow">
                  {canShare && (
                    <button type="button" onClick={() => void share()} disabled={shareState === "creating"} aria-live="polite" className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-60">
                      <ShareNetwork size={16} weight="duotone" aria-hidden="true" />
                      {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Copied" : shareState === "error" ? "Retry share" : "Share report"}
                    </button>
                  )}
                  {onReAudit && readiness.status === "ready" && (
                    <button onClick={onReAudit} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-dim transition hover:bg-panel-2 hover:text-ink">
                      <ArrowClockwise size={16} weight="duotone" aria-hidden="true" />
                      Rescan current evidence
                    </button>
                  )}
                </div>
              </details>
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
              subjectKind="investigation"
              currentIntelligenceEnabled={currentIntelligenceEnabled}
              onLoadCurrentIntelligence={loadCurrentIntelligence}
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
          <div className="flex flex-wrap items-end gap-3">
            {token.imageUrl && <img src={token.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-xl border border-line object-cover soft-shadow" />}
            <div>
              <p className="eyebrow">Token investigation</p>
              <h1 className="display-sm mt-0.5 text-[30px] leading-none text-ink sm:text-[34px]">{`$${token.symbol}`}</h1>
            </div>
            {establishedAsset && (
              <span className="chip tint-signal mb-0.5">
                Large market
              </span>
            )}
            {canShare && <CopyTldrButton base={tldrBase} mint={mintShareUrl} className="mb-0.5 ml-auto" />}
          </div>

          <div className="investigation-hero-grid mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <section className="panel investigation-hero-card flex flex-col p-5" aria-label="Risk score">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eyebrow">Risk score</span>
                <VerdictPill verdict={token.verdict} score={token.score} large />
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-dim">
                This score uses the checks that finished. It is not an approval to buy or invest.
              </p>
              <div className="mt-auto border-t border-line/70 pt-3">
                <p className="mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">Score only · not financial advice</p>
                <ScoreContextStrip
                  subjectRef={token.address}
                  score={token.score}
                  peerKind="token"
                  align="start"
                />
              </div>
            </section>

            <section
              className="panel investigation-hero-card investigation-readiness-card flex flex-col p-5 tint-var"
              style={{ "--tint": readinessColor } as React.CSSProperties}
              aria-label="Investigation readiness"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="eyebrow">Safety checks</span>
                <StatusPill label={readinessLabel} color={readinessColor} score={null} large />
              </div>
              <h2 className="mt-4 text-[17px] font-semibold leading-snug text-ink">
                {requiredGapChecks.length
                  ? `${requiredGapChecks.length} required safety ${requiredGapChecks.length === 1 ? "check is" : "checks are"} not finished`
                  : readiness.status === "ready"
                    ? "Required safety checks are finished"
                    : "This report does not have enough finished checks"}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                {requiredGapChecks.length
                  ? "You can still see the score, but this report is not ready until that check finishes."
                  : readiness.status === "ready"
                    ? "Extra research may still be open. We list it below so nothing is hidden."
                    : "Read the open questions below. Do not rely on this score yet."}
              </p>
              <div className="mt-auto pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">Checks finished</span>
                  <span className="mono text-[11px] text-ink-dim">
                    {readiness.successful}/{readiness.applicable} · {readiness.coveragePercent}%
                  </span>
                </div>
                <progress
                  className="readiness-progress mt-2"
                  value={readiness.coveragePercent}
                  max={100}
                  aria-label={`Evidence outcomes recorded: ${readiness.coveragePercent}%`}
                />
              </div>
            </section>

            <section className="panel investigation-hero-card investigation-market-card p-5 lg:col-span-2 xl:col-span-1" aria-label="Market size">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow">Market size</span>
                {establishedAsset && <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-signal-lift">Large market</span>}
              </div>
              <div className="mt-4">
                <p className="display-sm text-[27px] leading-none text-ink">{money(marketCap)}</p>
                <p className="mono mt-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">Market capitalization</p>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 xl:grid-cols-2" aria-label="Market size details">
                <div>
                  <dt className="stat-label">CoinGecko rank</dt>
                  <dd className="stat-value mt-1 text-signal-lift">{token.cg?.rank ? `#${token.cg.rank}` : "N/A"}</dd>
                </div>
                <div>
                  <dt className="stat-label">Fully diluted value</dt>
                  <dd className="stat-value mt-1">{money(fullyDilutedValue)}</dd>
                </div>
                <div>
                  <dt className="stat-label">Liquidity</dt>
                  <dd className="stat-value mt-1">{money(token.liquidityUsd)}</dd>
                </div>
                <div>
                  <dt className="stat-label">Holders</dt>
                  <dd className="stat-value mt-1">{token.safety.holderCount ? token.safety.holderCount.toLocaleString() : "N/A"}</dd>
                </div>
              </dl>
              <p className="mono mt-5 border-t border-line/70 pt-3 text-[10.5px] uppercase tracking-[0.08em] text-signal-lift">
                Size helps with context · it does not make an asset safe
              </p>
            </section>
          </div>

          {(requiredGapChecks.length > 0 || readiness.status !== "ready") && <section
            className="panel clearance-boundary mt-3 flex flex-col gap-4 p-4 tint-var sm:flex-row sm:items-center sm:justify-between"
            style={{ "--tint": readinessColor } as React.CSSProperties}
            aria-label="Report warning"
          >
            <div>
              <p className="eyebrow">Before you use this report</p>
              <h2 className="mt-1 text-[14px] font-semibold text-ink">
                {requiredGapChecks.length
                  ? `${requiredGapChecks.map((check) => check.label).join(", ")} must finish before this report is ready.`
                  : readiness.status === "ready"
                    ? "Required safety checks are finished."
                    : "This report is not ready to rely on yet."}
              </h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
                {requiredGapChecks.length
                  ? `${enrichmentGapChecks.length} extra ${enrichmentGapChecks.length === 1 ? "check is" : "checks are"} also open and listed below.`
                  : readiness.status === "ready"
                    ? `${enrichmentGapChecks.length} extra ${enrichmentGapChecks.length === 1 ? "check is" : "checks are"} still open. ${enrichmentGapChecks.length === 1 ? "It does" : "They do"} not block review.`
                    : "Open the check list to see what is missing."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <a href="#investigation-methodology" className="text-[12px] font-medium text-signal-lift underline-offset-2 hover:underline">
                See every check
              </a>
              {onReAudit && readiness.status !== "ready" && (
                <button type="button" onClick={onReAudit} className="btn-primary min-h-10 px-3 text-[12px] font-medium">
                  <ArrowClockwise size={15} weight="duotone" aria-hidden="true" />
                  Retry required scan
                </button>
              )}
            </div>
          </section>}

          {projectAccount && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-dim">
              <span className="eyebrow">Project account</span>
              <ProjectAccountStatusPill
                reviewOpen={projectReviewOpen}
                verdict={presentedProjectVerdict}
                score={projectReviewOpen ? null : projectAccount.report.governing_score}
              />
              {projectReadiness && <span>{projectReadiness.successful}/{projectReadiness.applicable} checks finished</span>}
            </div>
          )}
          {/* Lead with the TEAM when we know it — don't declare "no team" when it's named below. */}
          {teamPeople.length > 0 ? (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">
              Built by {teamPeople.slice(0, 3).map((p) => p.name).filter(Boolean).join(", ")}{teamPeople.length > 3 ? ` +${teamPeople.length - 3} more` : ""}{projectX ? ` · project account ${projectX}` : ""}. Full team below.
            </p>
          ) : (
            <p className="mt-3 max-w-3xl text-[13.5px] font-medium leading-relaxed text-ink">{inv.founderNote}</p>
          )}
          {/* What the project actually IS — CoinGecko's own blurb, else the project's X bio. */}
          {(() => {
            const blurb = token.cg?.description || projectAccount?.bio || null;
            return blurb ? (
              <ExpandableText
                text={blurb}
                className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-dim"
              />
            ) : null;
          })()}
          <ReportDisclaimer className="mt-2 max-w-3xl" />
          {/* official website + socials */}
          <ProjectLinks
            className="mt-3"
            website={projectDomain}
            xHandle={projectX ?? token.cg?.twitter}
            links={[...(recon?.socials ?? []), ...(token.socials ?? [])]}
          />
          {canMutateWorkspace && (
            <div className="mt-3 flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2/40 px-3 py-2.5">
              <span className="text-[12.5px] text-ink-dim">Get an alert when a later scan finds a change.</span>
              <button type="button" onClick={watch} aria-pressed={watched} className={`btn-chip ml-auto ${watched ? "tint-signal" : ""}`}>
                {watched ? "Watching report" : "Add to watchlist"}
              </button>
            </div>
          )}
          <p className="mono mt-2 break-all text-[11px] text-ink-faint">{inv.rootRef}</p>
        </div>

        <div className="sticky top-[65px] z-20 mt-5">
          <ReportCanvasSectionNav
            sticky={false}
            items={[
              { href: "#report-summary", label: "Summary", icon: <ClipboardText size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#report-risks", label: "Risks", icon: <ShieldWarning size={16} weight="duotone" aria-hidden="true" /> },
              ...(showProjectBasicFacts ? [{ href: "#investigation-basic-facts" as const, label: "Key facts", icon: <IdentificationBadge size={16} weight="duotone" aria-hidden="true" /> }] : []),
              { href: "#investigation-visuals", label: "Visuals", icon: <ChartLineUp size={16} weight="duotone" aria-hidden="true" /> },
              { href: "#investigation-evidence", label: "Evidence", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
              ...((teamPeople.length > 0 || advisors.length > 0) ? [{ href: "#investigation-team" as const, label: "Team", icon: <IdentificationBadge size={16} weight="duotone" aria-hidden="true" /> }] : []),
              ...(invGraph && invGraph.nodes.length > 1 ? [{ href: "#investigation-relationships" as const, label: "Relationships", icon: <Graph size={16} weight="duotone" aria-hidden="true" /> }] : []),
              { href: "#investigation-methodology", label: "Sources & checks", icon: <Database size={16} weight="duotone" aria-hidden="true" /> },
            ]}
          />
        </div>

        <InvestigationDecisionCanvas
          verdictLabel={observedTokenMeta.label}
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

        <div className="mt-4">
          <SecondOpinion
            id="investigation-challenge"
            dossier={token}
            panelCostToken={panelCostToken}
            onRescan={onReAudit}
          />
        </div>

        {showProjectBasicFacts && (
          <div className="report-section mt-7">
            <ReportSectionHeading
              index="02 · Core facts"
              title="What we verified about the project"
              description="Verified facts are shown first. Unconfirmed leads are kept in a separate list."
            />
            <BasicFactsPanel
              id="investigation-basic-facts"
              facts={projectBasicFacts}
              leads={projectBasicFactLeads}
              fillRequired
            />
          </div>
        )}

        <div id="investigation-visuals" className="report-section scroll-mt-28 mt-7">
          <ReportSectionHeading
            index="03 · Charts"
            title="Market and ownership charts"
            description="These charts use the data saved with this report. Live updates are labeled separately."
          />
          <div className="mt-3 space-y-3">
            <MarketPerformancePanel
              token={token}
              projectToken={projectAccount?.projectToken}
              showCurrentIntelligence={showCurrentIntelligence}
              refreshCurrentMarket={currentIntelligenceEnabled}
              onLoadCurrentIntelligence={loadCurrentIntelligence}
            />
            <TokenSnapshotVisuals token={token} showPriceMomentum={false} />
            {(projectAccount?.protocolTvl || projectAccount?.protocolFees || projectAccount?.holderProfile) && (
              <UsageVisuals
                tvl={projectAccount.protocolTvl}
                fees={projectAccount.protocolFees}
                holders={projectAccount.holderProfile}
              />
            )}
          </div>
        </div>

        <div className="report-section mt-7">
          <ReportSectionHeading
            index="04 · Evidence"
            title="Token, ownership, and team"
            description="See the token checks and the people publicly tied to the project."
          />
        </div>
        <div id="investigation-evidence" className="scroll-mt-28 mt-3 grid gap-3 lg:grid-cols-2">
          {/* on-chain */}
          <Card title="On-chain" accent={tm.color}>
            <div className="flex items-center justify-between">
              <span className="mono text-[13.5px] text-ink">{`$${token.symbol}`}</span>
              <VerdictPill verdict={token.verdict} score={token.score} />
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{token.headline}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
              <span>liq <span className="mono text-ink-dim">{money(token.liquidityUsd)}</span></span>
              <span>mc <span className="mono text-ink-dim">{money(token.mcap)}</span></span>
              <span>chain <span className="mono text-ink-dim capitalize">{token.chain}</span></span>
            </div>
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
                    <ProjectAccountStatusPill
                      reviewOpen={projectReviewOpen}
                      verdict={presentedProjectVerdict}
                      score={projectReviewOpen ? null : projectAccount.report.governing_score}
                    />
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
          <div id="investigation-team" className="report-section scroll-mt-28 mt-7">
            <ReportSectionHeading
              index="05 · People"
              title="Team and named relationships"
              description="Each person links back to the source that tied them to this project."
            />
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
                          {m.developerProfiles?.map((profile) => (
                            <a key={profile.url} href={profile.url} target="_blank" rel="noreferrer" title={`Linked from ${m.handle}'s X profile`} className="link-ext text-[11px]">
                              {profile.provider === "github" ? "GitHub" : "Hugging Face"}
                            </a>
                          ))}
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
          <div id="investigation-relationships" className="report-section scroll-mt-28 mt-7">
            <ReportSectionHeading
              index="06 · Relationships"
              title="How the subjects connect"
              description="The graph shows recorded links. A link by itself does not mean wrongdoing."
            />
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
                <ProjectAccountStatusPill
                  reviewOpen={projectReviewOpen}
                  verdict={presentedProjectVerdict}
                  score={projectReviewOpen ? null : projectAccount.report.governing_score}
                />
                <span className="ml-auto text-[11px] text-ink-faint">{projectAccount.followers} followers · joined {projectAccount.joined}</span>
              </div>
              {/* why the score landed where it did */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                {projectAccount.report.governing_role
                  ? <span><span className="text-ink-dim">{String(projectAccount.report.governing_role).toLowerCase()}</span> score used</span>
                  : <span>Score not ready</span>}
                {projectAccount.report.cap_applied && <span className="chip tint-avoid">score limited · {String(projectAccount.report.cap_applied).replace(/_/g, " ")}</span>}
                <button onClick={onOpenProjectAccount} className="btn-chip tint-signal ml-auto">Open full report →</button>
              </div>
              {projectAccount.bio && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{projectAccount.bio}</p>}
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{projectAccountHeadline}</p>
              {projectAccount.evidence.ventures.length > 0 && (
                <div className="mt-2 border-t border-line/60 pt-2">
                  <div className="eyebrow">Verified links</div>
                  {projectSourceBackedVentures.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">
                    {projectSourceBackedVentures.slice(0, 6).map((v, i) => (
                      <span key={i} className="chip normal-case tracking-normal">{v.project_name}</span>
                    ))}
                  </div>}
                  <div className="mt-1 text-[10.5px] text-ink-faint">
                    {projectSourceBackedVentures.length} verified
                    {projectLegacyVentureCount > 0 ? ` · ${projectLegacyVentureCount} saved` : ""}
                    {projectUnverifiedVentureCount > 0 ? ` · ${projectUnverifiedVentureCount} possible lead${projectUnverifiedVentureCount === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* transparent scan methodology — what ARGUS checked + the outcome of each */}
        <div className="report-section mt-7">
          <ReportSectionHeading
            index="07 · Sources & checks"
            title="What ARGUS checked"
            description="See which checks finished, which found a problem, and which are still open."
          />
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
          ARGUS checked the token, website, project account, and public team. Open a person to run a deeper review. Names without a verified profile stay unconfirmed.
        </div>
      </div>
    </div>
  );
}
