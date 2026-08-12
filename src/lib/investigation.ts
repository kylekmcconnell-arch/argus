// The autonomous investigation cascade — the "detective". Paste a token
// contract and ARGUS runs the whole trail itself, streamed as one live feed:
//   1. on-chain token audit (free, browser)
//   2. recon the project site for the team (free, browser)
//   3. background the project's X account (ONE paid people-audit, auto)
//   4. surface founders honestly — per-founder deep-dives are one-click, never auto.
//
// It is client-orchestrated: auditToken + runRecon already run keyless in the
// browser, and streamAudit gives abortable per-hop SSE. Only the project-account
// hop spends money, so the auto cascade costs exactly one analyst run.
//
// Honesty invariants (never fabricate a founder):
//   - projectX is the PROJECT account, never labeled a founder.
//   - a deployer is a wallet, never an identity hop.
//   - a founder handle must be an OBSERVED @handle (on the site), never
//     synthesized from a name. Names without a handle are shown, not audited.
//   - recon.team.state drives the founder section verbatim; a coverage gap is a
//     gap, not an absence claim.
import { auditToken, type TokenDossier } from "../token/audit";
import type { RunnableTokenInput } from "./resolveInput";
import { runRecon, type Recon } from "../collect/recon";
import { streamAudit, probeBackend } from "./live";
import type { RetrievalStage } from "../collect/retrieve";
import type { TraceStep } from "../data/evidence";
import type { Dossier } from "../data/dossier";
import type { ReportPersistenceContext, ReportVersionContext } from "./reportVersion";

export interface FounderCandidate {
  name: string;          // display name or @handle
  handle: string | null; // observed @handle (auditable), or null (named only)
  source: "site" | "project"; // named on the site vs surfaced from the project account
}

// The deployer's money trail: the one thing a pseudonymous deployer can't hide.
export interface FundingHop { from: string; to: string; label: string | null; kind: string }
// The first money into the deployer: who paid, how much, and when. Strictly
// inbound, so nothing built from it may claim where that money went afterwards.
export interface DeployerSeedFunding {
  from: string;
  label: string | null;
  lamports: number | null;
  sol: number | null;
  at: string | null;
}
export interface DeployerTrail {
  wallet: string;
  funder: { address: string; label: string | null; kind: string } | null;
  chain?: FundingHop[];
  origin?: { address: string; label: string | null; kind: string } | null;
  terminatesAtCex?: boolean;
  hops?: number;
  tokensCreated: number | null;
  serialDeployer: boolean;
  walletAgeDays: number | null;
  // Whole minutes of age, for a launch wallet far too young to register in days.
  walletAgeMinutes?: number | null;
  // "mint" when the age is measured to the launch instant the scan pinned,
  // "scan" when it is measured to the scan itself and therefore drifts. Older
  // frozen investigations predate both fields.
  walletAgeBasis?: "mint" | "scan";
  walletAgeAsOf?: string;
  seedFunding?: DeployerSeedFunding | null;
  firstActivity: string | null;
  note: string;
}

export type WebPersonProvider = "grok" | "twitterapi" | "github";
export type WebPersonEvidenceKind =
  | "team_attribution"
  | "project_association"
  | "code_contribution"
  | "model_candidate";

// A person surfaced by supplemental team discovery. Identity and relationship
// provenance travel with every row so an observed association or code
// contribution can never silently become proof of employment.
export interface WebPerson {
  name: string;
  handle?: string;
  linkedin?: string;
  role: string;
  evidence?: string;
  provider?: WebPersonProvider;
  evidence_origin?: "deterministic" | "model_lead";
  artifact_verified?: boolean;
  evidenceKind?: WebPersonEvidenceKind;
  developerProfiles?: Array<{
    provider: "github" | "huggingface";
    url: string;
    sourceUrl: string;
  }>;
}

export interface WebTeamDiscoveryResult {
  available: boolean;
  attempted: boolean;
  completed: boolean;
  partial: boolean;
  providerFailed: boolean;
  people: WebPerson[];
  providers?: Array<{
    provider: WebPersonProvider;
    status: "succeeded" | "partial" | "failed";
  }>;
}

export function isConfirmedWebTeamPerson(person: WebPerson): boolean {
  return person.evidence_origin === "deterministic"
    && person.artifact_verified === true
    && person.evidenceKind === "team_attribution";
}

export interface ProjectAccountAuditOutcome {
  state: "complete" | "failed" | "unavailable";
  note: string;
}

export interface Investigation {
  rootRef: string;
  token: TokenDossier;
  projectX: string | null;
  siteUrl: string | null;
  recon: Recon | null;
  projectAccount: Dossier | null; // people-audit of the project X account
  /**
   * Terminal outcome for the embedded project-account audit.
   *
   * Older frozen investigations omit this field. New scans always record why
   * the project evidence ledger exists or why it could not be produced.
   */
  projectAccountAudit?: ProjectAccountAuditOutcome;
  founders: FounderCandidate[];
  founderNote: string;            // honest founder-identity summary
  deployerTrail: DeployerTrail | null; // who funded the deployer (Solana)
  webTeam: WebPerson[];           // team found by the web/LinkedIn deep search
  /** Coverage and provenance state for the paid supplemental people search. */
  webTeamDiscovery?: WebTeamDiscoveryResult;
  /** Frozen server-side evidence/check context for a persisted report version. */
  versionContext?: ReportVersionContext;
  /** Transient persistence/cost capability for a scan completed in this tab. */
  persistence?: ReportPersistenceContext;
}

// /api/deployer-origin, not /api/deployer. The panel route requires a signed
// capability bound to a PERSISTED report version, and a live scan has none yet:
// it is still producing the version that token would be issued against. Every
// scan-time call to it answered 409, so this trail came back null on every
// investigation and the report published "we could not confirm who owns the
// wallet that deployed the contract" over a trace the server had already run.
async function fetchDeployerTrail(wallet: string, mintedAt: number | null): Promise<DeployerTrail | null> {
  try {
    const pinned = mintedAt == null ? "" : `&mintedAt=${encodeURIComponent(String(mintedAt))}`;
    const res = await fetch(`/api/deployer-origin?wallet=${encodeURIComponent(wallet)}${pinned}`);
    if (!res.ok) return null;
    const d = await res.json() as Partial<DeployerTrail> & { available?: boolean; error?: unknown };
    if (d.available === false || d.error) return null;
    return d as DeployerTrail;
  } catch {
    return null;
  }
}

// The instant this token's first pool was created, frozen on the dossier at scan
// time. It is what the deployer's age is measured against, so the same report
// reads the same age whenever it is reopened instead of ageing with the calendar.
//
// It is the closest instant ARGUS holds to the mint, not the mint itself: on a
// launchpad the pool is created in the same breath as the mint, but a token that
// migrated to a new pool later would date its launch to the migration. Read
// defensively because dossiers frozen before the field existed do not carry it.
function launchInstant(token: TokenDossier): number | null {
  const raw = (token as TokenDossier & { pairCreatedAt?: number | null }).pairCreatedAt;
  return typeof raw === "number" && raw > 0 ? raw : null;
}

export interface InvestigationHandlers {
  onStep: (s: TraceStep) => void;
  onHop: (subtitle: string) => void;
  onDone: (inv: Investigation) => void;
  onError: (e: string) => void;
}

const milestone = (label: string, detail: string, tone: TraceStep["tone"] = "neutral"): TraceStep => ({ phase: "Investigation", label, detail, tone, source: "argus" });

function reconToStep(st: RetrievalStage): TraceStep {
  return {
    phase: "Site recon",
    label: st.method,
    detail: st.note,
    source: "render",
    tone: st.outcome === "ok" ? "good" : st.outcome === "unreachable" ? "warn" : "neutral",
  };
}

const shorten = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 42);
const normHandle = (h: string) => h.replace(/^@/, "").toLowerCase();
const SITE_NOISE = /^(home|share|intent|i|status|explore|search|hashtag|notifications|messages)$/i;

function deriveFounders(recon: Recon | null, projectX: string | null, projectAccount: Dossier | null): FounderCandidate[] {
  const out: FounderCandidate[] = [];
  const seen = new Set<string>();
  const px = projectX ? normHandle(projectX) : "";
  const add = (name: string, handle: string | null, source: FounderCandidate["source"]) => {
    const k = handle ? normHandle(handle) : name.toLowerCase();
    if (!k || k === px || seen.has(k)) return;
    seen.add(k);
    out.push({ name, handle, source });
  };

  // 1. Site team — only when the site actually NAMES a team (no stray-link
  //    promotion). Named individuals carry no synthesized handle; bare X profile
  //    links observed on the page are auditable.
  if (recon?.team.state === "named") {
    for (const name of recon.team.names) add(name, null, "site");
    for (const s of recon.socials) {
      const m = s.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})\/?(?:\?.*)?$/i);
      if (m && !SITE_NOISE.test(m[1])) add("@" + m[1], "@" + m[1], "site");
    }
  }

  // 2. TEAM the project account explicitly names as its own (relation "team:…").
  //    We do NOT pull generic @-mentions, non-team associates, or "advised"
  //    projects: for a project account those are partners / integrations / other
  //    PROJECTS (e.g. @moonpay, @0xPolygon, @FireblocksHQ for Uniswap), not the
  //    people behind it. The real team comes from the site + web/LinkedIn search.
  if (projectAccount) {
    for (const a of projectAccount.evidence.associates) {
      if (a.associate_key && /^team:/i.test(a.relation ?? "")) add(a.associate_key, a.associate_key, "project");
    }
  }
  return out.slice(0, 10);
}

function founderNote(siteUrl: string | null, recon: Recon | null, founders: FounderCandidate[]): string {
  let base: string;
  if (!siteUrl) base = "No project website surfaced from the token's sources, so the team is not stated on-site.";
  else if (!recon || recon.retrieval.status === "gap") base = "Could not render the project site. The team could not be assessed there (a coverage gap, not an absence claim).";
  else if (recon.team.state === "named") base = `Named on the project site: ${recon.team.names.slice(0, 5).join(", ")}.`;
  else if (recon.team.state === "unnamed-section") base = "The project site has a team section but names no individuals. The team is stated but unnamed.";
  else base = "The project site rendered, but no team section was found.";

  // Surface accounts the project account itself links to (e.g. a backing VC).
  const linked = founders.filter((f) => f.handle && f.source === "project").map((f) => f.handle!);
  if (linked.length) base += ` The project account links to ${linked.slice(0, 4).join(", ")}. Background ${linked.length === 1 ? "it" : "them"} below.`;
  else if (!linked.length && recon?.team.state !== "named") base += " No personal accounts are surfaced to background.";
  return base;
}

// Knowledge fallback: resolve the token's official site / X / founder from Grok
// when its on-chain sources (DexScreener + CoinGecko) came up empty.
interface TokenIdentity { website: string | null; x_handle: string | null; founder: string | null; founder_handle: string | null; confidence: string }
async function fetchTokenIdentity(symbol: string, name: string, contract: string, chain: string): Promise<TokenIdentity | null> {
  try {
    const p = new URLSearchParams({ symbol, name: name || "", contract: contract || "", chain: chain || "" });
    const r = await fetch(`/api/token-identity?${p.toString()}`, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) return null;
    const d = await r.json() as Partial<TokenIdentity> & { available?: boolean };
    if (d.available === false) return null;
    return { website: d.website ?? null, x_handle: d.x_handle ?? null, founder: d.founder ?? null, founder_handle: d.founder_handle ?? null, confidence: d.confidence ?? "low" };
  } catch { return null; }
}

export function streamInvestigation(
  input: RunnableTokenInput,
  h: InvestigationHandlers,
  opts?: { forceTokenAudit?: boolean; intent?: import("./researchDirector").ResearchIntent },
): () => void {
  let aborted = false;
  let abortLive: (() => void) | null = null;
  const abort = () => { aborted = true; abortLive?.(); };

  (async () => {
    try {
      // ── Hop 1: on-chain token audit (free) ──
      h.onHop("auditing the token on-chain");
      h.onStep(milestone("Step 1 · On-chain token audit", "DexScreener + GoPlus, keyless.", "neutral"));
      const token = await auditToken(
        input,
        (s) => { if (!aborted) h.onStep(s); },
        { force: opts?.forceTokenAudit },
      );
      if (aborted) return;
      if (!token) { h.onError("Could not resolve that contract on any DEX."); return; }

      let projectX = token.projectX;
      let siteUrl = token.socials.find((s) => /^https?:\/\//i.test(s.url) && !/x\.com|twitter\.com|t\.me|discord|github\.com/i.test(s.url))?.url ?? null;
      h.onStep(milestone("Token audited", `$${token.symbol}: ${token.verdict} ${token.score ?? "N/A"}/100.${projectX ? ` Project X ${projectX}.` : " No project X linked."}${siteUrl ? ` Site ${shorten(siteUrl)}.` : " No site linked."}`, token.verdict === "PASS" ? "good" : "warn"));

      // If the token's own sources (DexScreener + CoinGecko) yielded no site OR no
      // X account, resolve the OFFICIAL identity from knowledge (Grok) so an
      // obscure token doesn't dead-end on "no website / no team". Also surfaces the
      // founder to seed the people section directly.
      let resolvedFounder: FounderCandidate | null = null;
      if (!siteUrl || !projectX) {
        h.onHop("resolving the project's official identity");
        h.onStep(milestone("Step 1c · Resolve identity", `On-chain sources are thin. Resolving $${token.symbol}'s official site, X account, and founder from knowledge…`, "neutral"));
        const id = await fetchTokenIdentity(token.symbol, token.name, token.address, token.chain);
        if (!aborted && id) {
          if (!siteUrl && id.website) siteUrl = id.website;
          if (!projectX && id.x_handle) projectX = id.x_handle;
          if (id.founder) resolvedFounder = { name: id.founder, handle: id.founder_handle, source: "project" };
          const bits = [id.website && `site ${shorten(id.website)}`, id.x_handle && `X ${id.x_handle}`, id.founder && `founder ${id.founder}${id.founder_handle ? ` (${id.founder_handle})` : ""}`].filter(Boolean) as string[];
          h.onStep(milestone("Identity resolved", bits.length ? `Resolved ${bits.join(", ")} (${id.confidence} confidence).` : "No official identity could be resolved from knowledge either.", bits.length ? "good" : "warn"));
        }
      }
      if (aborted) return;

      // ── Hop 1b: trace who funded the deployer (Solana, Helius) ──
      // The deployer wallet is a pseudonym; its funding source often is not.
      let deployerTrail: DeployerTrail | null = null;
      if (token.deployer && token.chain === "solana") {
        h.onHop("tracing who funded the deployer");
        h.onStep(milestone("Step 1b · Deployer funding trail", `Tracing the SOL that funded deployer ${token.deployer.slice(0, 6)}…${token.deployer.slice(-4)}.`, "neutral"));
        deployerTrail = await fetchDeployerTrail(token.deployer, launchInstant(token));
        if (!aborted && deployerTrail) {
          const tone = deployerTrail.funder?.kind === "cex" ? "good" : deployerTrail.serialDeployer ? "bad" : "neutral";
          h.onStep(milestone("Deployer trail", deployerTrail.note, tone));
        }
      }
      if (aborted) return;

      // ── Hop 2: recon the project site for the team (free) ──
      let recon: Recon | null = null;
      if (siteUrl) {
        h.onHop("reading the project site for the team");
        h.onStep(milestone("Step 2 · Recon the project site", `Rendering ${shorten(siteUrl)} to find the team.`, "neutral"));
        recon = await runRecon(
          siteUrl,
          (st) => { if (!aborted) h.onStep(reconToStep(st)); },
          (note) => { if (!aborted) h.onStep({ phase: "Site recon", label: "on-chain pivot", detail: note, tone: "neutral", source: "argus" }); },
        );
        if (!aborted && recon) h.onStep(milestone("Site read", recon.identityLine, recon.team.state === "named" ? "good" : "warn"));
      } else {
        h.onStep(milestone("Step 2 · Project site", "No project website surfaced from the token's sources, so site recon was skipped.", "warn"));
      }
      if (aborted) return;

      // Paid deep-team discovery runs only after this investigation has been
      // persisted and can present an exact report-bound capability. Keeping it
      // out of the core collector prevents private or failed saves from creating
      // unbound provider spend; App attaches the result as live supplemental data.
      const webTeam: WebPerson[] = [];
      if (siteUrl) {
        h.onStep(milestone("Step 2b · Deep team search", "Scheduled after the immutable investigation version is saved.", "neutral"));
      }

      // ── Hop 3: background the project's X account (ONE paid people-audit, auto) ──
      let projectAccount: Dossier | null = null;
      let projectAccountAudit: ProjectAccountAuditOutcome;
      if (projectX) {
        const providers = await probeBackend();
        const analystLive = !!providers?.some((p) => p.id === "analyst" && p.configured);
        if (analystLive) {
          h.onHop("backgrounding the project's X account");
          h.onStep(milestone("Step 3 · Background the project account", `Live people-audit of ${projectX}. This is the project's own account, not a named founder.`, "neutral"));
          const projectAuditResult = await new Promise<
            { dossier: Dossier; error: null } | { dossier: null; error: string }
          >((resolve) => {
            // PRIVATE: the project account is audited AS PART OF this investigation
            // and shown inside it — it must NOT be saved as a separate standalone
            // report (that's what made @Uniswap appear as a loose "PERSON" card).
            abortLive = streamAudit(projectX, true, {
              onStep: (s) => { if (!aborted) h.onStep(s); },
              onDone: (d) => resolve({ dossier: d, error: null }),
              onError: (error) => resolve({ dossier: null, error }),
            }, opts?.intent);
          });
          projectAccount = projectAuditResult.dossier;
          projectAccountAudit = projectAccount
            ? { state: "complete", note: `Embedded project-account audit completed for ${projectX}.` }
            : { state: "failed", note: `Embedded project-account audit failed for ${projectX}: ${projectAuditResult.error}` };
          abortLive = null;
          if (!aborted && projectAccount) h.onStep(milestone("Project account audited", `${projectX}: ${projectAccount.report.composite_verdict} ${projectAccount.report.governing_score}/100.`, projectAccount.report.composite_verdict === "PASS" ? "good" : "warn"));
          if (!aborted && !projectAccount) h.onStep(milestone("Project account audit blocked", projectAccountAudit.note, "warn"));
        } else {
          projectAccountAudit = {
            state: "unavailable",
            note: `Embedded project-account audit was unavailable for ${projectX}: the analyst provider was not configured.`,
          };
          h.onStep(milestone("Step 3 · Project account", `Found ${projectX}, but the live people-audit needs provider keys (off in this environment). It can still be audited one-click.`, "warn"));
        }
      } else {
        projectAccountAudit = {
          state: "unavailable",
          note: "Embedded project-account audit was unavailable because no official project X account was resolved.",
        };
        h.onStep(milestone("Step 3 · Project account", "No project X account to background.", "warn"));
      }
      if (aborted) return;

      // ── Founders (honesty-gated; no auto-spend beyond the project account) ──
      const founders = deriveFounders(recon, projectX, projectAccount);
      // A knowledge-resolved founder (e.g. Hayden Adams for $UNI) leads the list
      // when the on-chain trail didn't already surface them.
      if (resolvedFounder && !founders.some((f) => f.name.toLowerCase() === resolvedFounder!.name.toLowerCase() || (resolvedFounder!.handle && f.handle?.toLowerCase() === resolvedFounder!.handle.toLowerCase()))) {
        founders.unshift(resolvedFounder);
      }
      const note = founderNote(siteUrl, recon, founders);
      h.onStep(milestone("Investigation complete", note, founders.length ? "good" : "neutral"));
      h.onDone({ rootRef: input.ref, token, projectX, siteUrl, recon, projectAccount, projectAccountAudit, founders, founderNote: note, deployerTrail, webTeam });
    } catch (e) {
      if (!aborted) h.onError(String(e));
    }
  })();

  return abort;
}
