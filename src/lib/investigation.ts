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
import { resolveInput } from "./resolveInput";
import { runRecon, type Recon } from "../collect/recon";
import { streamAudit, probeBackend } from "./live";
import type { RetrievalStage } from "../collect/retrieve";
import type { TraceStep } from "../data/evidence";
import type { Dossier } from "../data/dossier";
import type { ReportVersionContext } from "./reportVersion";

export interface FounderCandidate {
  name: string;          // display name or @handle
  handle: string | null; // observed @handle (auditable), or null (named only)
  source: "site" | "project"; // named on the site vs surfaced from the project account
}

// The deployer's money trail: the one thing a pseudonymous deployer can't hide.
export interface FundingHop { from: string; to: string; label: string | null; kind: string }
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
  firstActivity: string | null;
  note: string;
}

// A person found by the web-deep team search (Google/LinkedIn/Crunchbase/X), with
// their real name connected to handle + LinkedIn where possible.
export interface WebPerson { name: string; handle?: string; linkedin?: string; role: string; evidence?: string }

export interface Investigation {
  rootRef: string;
  token: TokenDossier;
  projectX: string | null;
  siteUrl: string | null;
  recon: Recon | null;
  projectAccount: Dossier | null; // people-audit of the project X account
  founders: FounderCandidate[];
  founderNote: string;            // honest founder-identity summary
  deployerTrail: DeployerTrail | null; // who funded the deployer (Solana)
  webTeam: WebPerson[];           // team found by the web/LinkedIn deep search
  /** Frozen server-side evidence/check context for a persisted report version. */
  versionContext?: ReportVersionContext;
}

async function fetchDeployerTrail(wallet: string): Promise<DeployerTrail | null> {
  try {
    const res = await fetch(`/api/deployer?wallet=${encodeURIComponent(wallet)}`);
    if (!res.ok) return null;
    const d = await res.json() as Partial<DeployerTrail> & { available?: boolean; error?: unknown };
    if (d.available === false || d.error) return null;
    return d as DeployerTrail;
  } catch {
    return null;
  }
}

export async function fetchWebTeam(siteUrl: string, projectName: string, recon: Recon | null): Promise<WebPerson[]> {
  try {
    const host = new URL(siteUrl).hostname.replace(/^www\./, "");
    const qs = new URLSearchParams({ domain: host, name: projectName || "", names: (recon?.team.names ?? []).slice(0, 8).join(",") });
    // The project's own X handle (from the site's social links) unlocks the
    // X-content angle of the team search — the team named in its own posts.
    const NOISE = /^(home|share|intent|i|status|explore|search|hashtag|messages)$/i;
    const xh = (recon?.socials ?? [])
      .map((s) => s.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i)?.[1])
      .find((h) => h && !NOISE.test(h));
    if (xh) qs.set("x", xh);
    // GitHub org from the site's links unlocks the org-members/contributors angle.
    const ghOrg = (recon?.socials ?? [])
      .map((s) => s.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
      .find((g) => g && !/^(orgs|sponsors|topics|features|about)$/i.test(g));
    if (ghOrg) qs.set("gh", ghOrg);
    const res = await fetch(`/api/recon-team?${qs}`);
    if (!res.ok) return [];
    const d = await res.json() as { people?: WebPerson[] };
    return Array.isArray(d.people) ? d.people : [];
  } catch {
    return [];
  }
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
  if (!siteUrl) base = "No project website surfaced from the token's sources — the team is not stated on-site.";
  else if (!recon || recon.retrieval.status === "gap") base = "Could not render the project site — the team could not be assessed there (a coverage gap, not an absence claim).";
  else if (recon.team.state === "named") base = `Named on the project site: ${recon.team.names.slice(0, 5).join(", ")}.`;
  else if (recon.team.state === "unnamed-section") base = "The project site has a team section but names no individuals — stated-but-unnamed.";
  else base = "The project site rendered, but no team section was found.";

  // Surface accounts the project account itself links to (e.g. a backing VC).
  const linked = founders.filter((f) => f.handle && f.source === "project").map((f) => f.handle!);
  if (linked.length) base += ` The project account links to ${linked.slice(0, 4).join(", ")} — background ${linked.length === 1 ? "it" : "them"} below.`;
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

export function streamInvestigation(rootRef: string, h: InvestigationHandlers): () => void {
  let aborted = false;
  let abortLive: (() => void) | null = null;
  const abort = () => { aborted = true; abortLive?.(); };

  (async () => {
    try {
      // ── Hop 1: on-chain token audit (free) ──
      h.onHop("auditing the token on-chain");
      h.onStep(milestone("Step 1 · On-chain token audit", "DexScreener + GoPlus, keyless.", "neutral"));
      const token = await auditToken(resolveInput(rootRef), (s) => { if (!aborted) h.onStep(s); });
      if (aborted) return;
      if (!token) { h.onError("Could not resolve that contract on any DEX."); return; }

      let projectX = token.projectX;
      let siteUrl = token.socials.find((s) => /^https?:\/\//i.test(s.url) && !/x\.com|twitter\.com|t\.me|discord|github\.com/i.test(s.url))?.url ?? null;
      h.onStep(milestone("Token audited", `$${token.symbol}: ${token.verdict} ${token.score ?? "—"}/100.${projectX ? ` Project X ${projectX}.` : " No project X linked."}${siteUrl ? ` Site ${shorten(siteUrl)}.` : " No site linked."}`, token.verdict === "PASS" ? "good" : "warn"));

      // If the token's own sources (DexScreener + CoinGecko) yielded no site OR no
      // X account, resolve the OFFICIAL identity from knowledge (Grok) so an
      // obscure token doesn't dead-end on "no website / no team". Also surfaces the
      // founder to seed the people section directly.
      let resolvedFounder: FounderCandidate | null = null;
      if (!siteUrl || !projectX) {
        h.onHop("resolving the project's official identity");
        h.onStep(milestone("Step 1c · Resolve identity", `On-chain sources are thin — resolving $${token.symbol}'s official site, X account, and founder from knowledge…`, "neutral"));
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
        deployerTrail = await fetchDeployerTrail(token.deployer);
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
        h.onStep(milestone("Step 2 · Project site", "No project website surfaced from the token's sources — skipping site recon.", "warn"));
      }
      if (aborted) return;

      // ── Hop 2b: dig the web + LinkedIn for the team (the render-based recon is
      //    shallow; this searches Google/LinkedIn/Crunchbase/X and connects names
      //    to real identities + profiles). ──
      let webTeam: WebPerson[] = [];
      if (siteUrl) {
        h.onHop("digging the web + LinkedIn for the team");
        h.onStep(milestone("Step 2b · Deep team search", `Searching Google, LinkedIn, Crunchbase and X for the people behind ${shorten(siteUrl)}…`, "neutral"));
        webTeam = await fetchWebTeam(siteUrl, token.name, recon);
        if (!aborted && webTeam.length) {
          const withLi = webTeam.filter((p) => p.linkedin).length;
          h.onStep(milestone("Team dug up", `${webTeam.length} ${webTeam.length === 1 ? "person" : "people"} via web/LinkedIn: ${webTeam.map((p) => p.handle ? `${p.name} (${p.handle})` : p.name).join(", ")}.${withLi ? ` ${withLi} with a LinkedIn.` : ""}`, "good"));
        } else if (!aborted) {
          h.onStep(milestone("Team search", "No team members could be dug up via web/LinkedIn/X search.", "neutral"));
        }
      }
      if (aborted) return;

      // ── Hop 3: background the project's X account (ONE paid people-audit, auto) ──
      let projectAccount: Dossier | null = null;
      if (projectX) {
        const providers = await probeBackend();
        const analystLive = !!providers?.some((p) => p.id === "analyst" && p.configured);
        if (analystLive) {
          h.onHop("backgrounding the project's X account");
          h.onStep(milestone("Step 3 · Background the project account", `Live people-audit of ${projectX}. This is the project's own account, not a named founder.`, "neutral"));
          projectAccount = await new Promise<Dossier | null>((resolve) => {
            // PRIVATE: the project account is audited AS PART OF this investigation
            // and shown inside it — it must NOT be saved as a separate standalone
            // report (that's what made @Uniswap appear as a loose "PERSON" card).
            abortLive = streamAudit(projectX, true, {
              onStep: (s) => { if (!aborted) h.onStep(s); },
              onDone: (d) => resolve(d),
              onError: () => resolve(null),
            });
          });
          abortLive = null;
          if (!aborted && projectAccount) h.onStep(milestone("Project account audited", `${projectX}: ${projectAccount.report.composite_verdict} ${projectAccount.report.governing_score}/100.`, projectAccount.report.composite_verdict === "PASS" ? "good" : "warn"));
        } else {
          h.onStep(milestone("Step 3 · Project account", `Found ${projectX}, but the live people-audit needs provider keys (off in this environment). It can still be audited one-click.`, "warn"));
        }
      } else {
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
      h.onDone({ rootRef, token, projectX, siteUrl, recon, projectAccount, founders, founderNote: note, deployerTrail, webTeam });
    } catch (e) {
      if (!aborted) h.onError(String(e));
    }
  })();

  return abort;
}
