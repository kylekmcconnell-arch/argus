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

export interface FounderCandidate {
  name: string;          // display name or @handle
  handle: string | null; // observed @handle (auditable), or null (named only)
  source: "site";
}

export interface Investigation {
  rootRef: string;
  token: TokenDossier;
  projectX: string | null;
  siteUrl: string | null;
  recon: Recon | null;
  projectAccount: Dossier | null; // people-audit of the project X account
  founders: FounderCandidate[];
  founderNote: string;            // honest founder-identity summary
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

function deriveFounders(recon: Recon | null, projectX: string | null): FounderCandidate[] {
  const out: FounderCandidate[] = [];
  const seen = new Set<string>();
  const px = projectX ? normHandle(projectX) : "";

  // Named individuals on the site — shown, but NO handle is synthesized.
  if (recon?.team.state === "named") {
    for (const name of recon.team.names) {
      const k = name.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push({ name, handle: null, source: "site" }); }
    }
  }
  // Personal X accounts OBSERVED on the project site (not the project account).
  for (const s of recon?.socials ?? []) {
    const m = s.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i);
    if (!m || SITE_NOISE.test(m[1])) continue;
    const handle = "@" + m[1];
    const k = normHandle(handle);
    if (k === px || seen.has(k)) continue;
    seen.add(k);
    out.push({ name: handle, handle, source: "site" });
  }
  return out.slice(0, 8);
}

function founderNote(siteUrl: string | null, recon: Recon | null, founders: FounderCandidate[]): string {
  if (!siteUrl) return "No project website surfaced from the token's sources — founder identity is not established from available evidence (not an absence claim).";
  if (!recon || recon.retrieval.status === "gap") return "Could not render the project site — the team could not be assessed. This is a coverage gap, not an absence claim.";
  if (recon.team.state === "named") return `Named on the project site: ${recon.team.names.slice(0, 5).join(", ")}${founders.some((f) => f.handle) ? ". Linked X accounts can be backgrounded below." : " (no verified handles to background)."}`;
  if (recon.team.state === "unnamed-section") return "A team section is present but names no individuals — stated-but-unnamed, distinct from anonymous.";
  return "The site rendered, but no team section was found — the founders are not stated on it.";
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

      const projectX = token.projectX;
      const siteUrl = token.socials.find((s) => /^https?:\/\//i.test(s.url) && !/x\.com|twitter\.com|t\.me|discord|github\.com/i.test(s.url))?.url ?? null;
      h.onStep(milestone("Token audited", `$${token.symbol}: ${token.verdict} ${token.score ?? "—"}/100.${projectX ? ` Project X ${projectX}.` : " No project X linked."}${siteUrl ? ` Site ${shorten(siteUrl)}.` : " No site linked."}`, token.verdict === "PASS" ? "good" : "warn"));

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

      // ── Hop 3: background the project's X account (ONE paid people-audit, auto) ──
      let projectAccount: Dossier | null = null;
      if (projectX) {
        const providers = await probeBackend();
        const analystLive = !!providers?.some((p) => p.id === "analyst" && p.configured);
        if (analystLive) {
          h.onHop("backgrounding the project's X account");
          h.onStep(milestone("Step 3 · Background the project account", `Live people-audit of ${projectX}. This is the project's own account, not a named founder.`, "neutral"));
          projectAccount = await new Promise<Dossier | null>((resolve) => {
            abortLive = streamAudit(projectX, {
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
      const founders = deriveFounders(recon, projectX);
      const note = founderNote(siteUrl, recon, founders);
      h.onStep(milestone("Investigation complete", note, founders.length ? "good" : "neutral"));
      h.onDone({ rootRef, token, projectX, siteUrl, recon, projectAccount, founders, founderNote: note });
    } catch (e) {
      if (!aborted) h.onError(String(e));
    }
  })();

  return abort;
}
