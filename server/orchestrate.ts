// The collector orchestrator: @handle -> populated evidence -> verdict.
//
// Strategy (hybrid, honest):
//  - If the handle is a known subject, seed the evidence bag from its fixture so
//    the live adapters have real CLAIMS to re-verify against fresh data.
//  - Run every configured adapter; each enriches the bag and streams progress.
//  - If the Claude analyst is configured, it (re)scores the axes from the live
//    evidence; otherwise we keep the seeded axes.
//  - With NO live providers configured, replay the curated trace and return the
//    fixture dossier unchanged, so the demo always works.
// The engine always owns caps, banding and the composite verdict.

import { getProfile, classifySubject, SubjectClass, VentureOutcome, canonicalEntityKey } from "../src/engine";
import { env } from "./config";
import { assembleDossier, type Dossier } from "../src/data/dossier";
import { findSubject, toEvidence } from "../src/data/subjects";
import { emptyEvidence } from "../src/data/evidence";
import type { CollectedEvidence, Emit, CollectContext, Adapter } from "./adapters/types";
import { analystAvailable, analyzeSubject, buildAnalystEvidencePacket, extractClaims, scanContradictions } from "./agent";
import { getCost, withCostLedger } from "./cost";
import { PersonCheckTracker } from "./checks";

import { xAdapter, getProfile as xProfile, getRecentPostsMeta, collectCorpus, fmtFollowers, discoverAffiliations, findTeam, findTeamOnSite, enrichTeamIdentities, scanPostsForRoles, followsSubject, handleHistory, searchAdverseSignals, detectManipulationTooling, type DiscoveredAffiliation, type AdverseSignal, type TeamMember } from "./adapters/x";
import { fetchTeamPage } from "./adapters/teampage";
import { checkSiteSubstance } from "./adapters/sitecheck";
import { detectTokenLifecycle } from "./adapters/dexscreener";
import { analyzeCadence } from "../src/lib/cadence";
import { personChecks } from "../src/lib/scanChecklist";
import { peopledatalabsAdapter } from "./adapters/peopledatalabs";
import { githubAdapter } from "./adapters/github";
import { crunchbaseAdapter } from "./adapters/crunchbase";
import { dexscreenerAdapter } from "./adapters/dexscreener";
import { coingeckoAdapter } from "./adapters/coingecko";
import { redditAdapter } from "./adapters/reddit";
import { onchainAdapter } from "./adapters/onchain";
import { archivedAffiliation } from "./adapters/wayback";
import { resolveForHandle } from "./adapters/wallet";

const ADAPTERS: Adapter[] = [
  xAdapter,
  githubAdapter,
  peopledatalabsAdapter,
  crunchbaseAdapter,
  dexscreenerAdapter,
  coingeckoAdapter,
  redditAdapter,
  onchainAdapter,
];

// Adapters that require a key to do anything meaningful (keyless DEX/CG no-op
// without a promoted contract, so they don't count as "live collection").
const KEYED = new Set(["x", "github", "peopledatalabs", "crunchbase", "reddit", "onchain"]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseOutcome(s?: string): VentureOutcome {
  if (!s) return VentureOutcome.UNKNOWN;
  const match = Object.values(VentureOutcome).find((v) => v.toLowerCase() === s.toLowerCase());
  return (match as VentureOutcome) ?? VentureOutcome.UNKNOWN;
}

function asRoles(roles: string[]): SubjectClass[] {
  const valid = new Set(Object.values(SubjectClass) as string[]);
  let out = roles.filter((r) => valid.has(r)).map((r) => r as SubjectClass);
  // Deterministic backstop for a rule the LLM applies inconsistently: a fund IS
  // an organization, so it sometimes tags INVESTOR+PROJECT — but PROJECT is for
  // accounts shipping a product/token, and the combo files funds under Projects.
  // The INVESTOR track fully covers the org case, so PROJECT is dropped.
  if (out.includes(SubjectClass.INVESTOR) && out.includes(SubjectClass.PROJECT)) {
    out = out.filter((r) => r !== SubjectClass.PROJECT);
  }
  return out;
}

// Cold handle: resolve the profile, pull recent posts, and extract self-claims
// so the verification adapters have something to check. Without this an unknown
// subject has no ventures/endorsements/advisory seats to verify.
async function coldIntake(ctx: CollectContext) {
  let siteUrl: string | undefined;
  const prof = await xProfile(ctx.handle);
  if (prof) {
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
    if (prof.image) ctx.evidence.profile.avatar_url = prof.image; // real X photo → reliable avatar
    ctx.evidence.profile.bio = prof.bio ?? "";
    siteUrl = prof.website;
    if (prof.followers != null) ctx.evidence.profile.followers = fmtFollowers(prof.followers);
    if (prof.createdAt) {
      const d = new Date(prof.createdAt);
      if (!isNaN(d.getTime())) ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    ctx.emit({ phase: "P0 · Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle} · ${ctx.evidence.profile.followers} followers · joined ${ctx.evidence.profile.joined}`, source: "twitterapi.io", tone: "neutral" });
  } else {
    // Be honest about a missing profile instead of silently rendering "—
    // followers" — discovery below can still proceed.
    ctx.emit({ phase: "P0 · Intake", label: "Profile unavailable", detail: "twitterapi.io has no record of this handle (not in their index). Continuing with web/X discovery.", source: "twitterapi.io", tone: "warn" });
  }

  // Handle-change history: a rebrand to escape a burned reputation is a real
  // flag, and the old handles let us search the subject's history under them.
  const hist = await handleHistory(ctx.handle);
  if (hist && hist.priorHandles.length) {
    ctx.evidence.profile.prior_handles = hist.priorHandles;
    ctx.recordCheck?.({
      id: "identity-continuity",
      status: "finding",
      note: `prior handles found: ${hist.priorHandles.map((handle) => `@${handle}`).join(", ")}`,
      provider: "memory.lol",
      sourceCount: hist.priorHandles.length,
    });
    ctx.emit({ phase: "P0 · Intake", label: "Handle history", detail: `This account previously went by ${hist.priorHandles.map((p) => "@" + p).join(", ")} — a rebrand. Old posts and mentions are searched too.`, source: "memory.lol", tone: "warn" });
  } else if (hist) {
    ctx.recordCheck?.({
      id: "identity-continuity",
      status: "checked-empty",
      note: "handle-history provider returned no prior handle (provider coverage is partial)",
      provider: "memory.lol",
    });
    ctx.emit({ phase: "P0 · Intake", label: "Handle history", detail: "No prior X handle on record for this account (no rebrand found; memory.lol coverage is partial).", source: "memory.lol", tone: "neutral" });
  }

  // Claim-targeted corpus: recent originals + keyword search over the whole
  // history (pinned/announcement posts where claims actually live), ranked and
  // date-stamped — not just the newest 20 items (mostly replies/gm, and gameable).
  const corpus = await collectCorpus(ctx.handle);
  const posts = corpus.posts;
  if (posts.length) {
    ctx.evidence.recentActivity = corpus.newest.length ? corpus.newest : posts; // newest originals drive tone/dormancy
    ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Assembled a ${posts.length}-post claim corpus (${corpus.count.originals} recent originals + ${corpus.count.searched} from keyword search over full history) to mine for self-claims.`, source: "twitterapi.io", tone: "neutral" });
  }

  // Find-wallet: a self-disclosed wallet (a 0x address or ENS/basename/.sol name)
  // in the bio/posts. The richer corpus surfaces more contract/URL mentions.
  const foundWallets = await resolveForHandle(ctx.handle, [ctx.evidence.profile.bio, ...posts].join(" \n "));
  if (foundWallets.length) {
    for (const w of foundWallets) {
      ctx.evidence.wallets.push({ address: w.address, chain: w.chain, link_tier: w.tier, notes: w.source });
    }
    ctx.emit({ phase: "P0 · Intake", label: "Wallet resolved", detail: `${foundWallets.length} wallet${foundWallets.length > 1 ? "s" : ""}: ${foundWallets.map((w) => `${w.address.slice(0, 8)}… (${w.chain}, ${w.source.includes("Farcaster") ? "Farcaster" : "self-disclosed"})`).join(", ")}. Running on-chain forensics.`, source: "find-wallet", tone: "good" });
  }

  if (!analystAvailable()) return;
  ctx.emit({ phase: "P0 · Intake", label: "Extract claims", detail: "Reading the subject's bio and posts for self-claims to verify…", tone: "neutral" });
  const claims = await extractClaims(ctx.handle, ctx.evidence.profile.bio, posts);
  if (claims) {
    ctx.evidence.roles = asRoles(claims.roles);
    ctx.evidence.ventures = claims.ventures.map((v) => ({
      project_name: v.project_name,
      role: v.role ?? "founder",
      period: v.period ?? "",
      outcome: parseOutcome(v.claimed_outcome),
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    ctx.evidence.testimonials = claims.testimonials.map((t) => ({
      claimed_endorser_handle: t.claimed_endorser_handle,
      claimed_relationship: t.claimed_relationship,
      appears_at: "subject surfaces",
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    ctx.evidence.advised = claims.advised.map((p) => ({
      project_name: p.project_name,
      project_handle: p.project_handle,
      claimed_role: p.claimed_role ?? "advisor",
      appears_at: "subject surfaces",
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    ctx.evidence.promotions = claims.promotions.map((p) => ({
      ticker: p.ticker,
      contract_address: p.contract_address,
      chain: p.chain,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    }));
    const n = claims.ventures.length + claims.testimonials.length + claims.advised.length + claims.promotions.length;
    ctx.emit({ phase: "P0 · Intake", label: "Claims extracted", detail: `${n} self-claims across ${ctx.evidence.roles.join(", ") || "no roles"} — now verifying each.`, source: "claude", tone: "neutral" });
  }

  // ── Affiliation discovery: every venture the subject is publicly tied to in
  //    ANY capacity (founded, led, worked at, contributed to, advised), beyond
  //    their own bio and LinkedIn. Each lead is then corroborated against an
  //    independent source (the venture's X follow-graph, an archived team page)
  //    so a web hit becomes a graded tie, never a bare assertion. ──
  ctx.emit({ phase: "P0 · Intake", label: "Discover affiliations", detail: "Three angles in parallel: what this account is tied to, who has named them, and the team named in their own X posts…", source: "grok", tone: "neutral" });
  // Three blind search angles run concurrently (each Grok call is 45s-capped, so
  // parallel keeps wall-clock to one). Subject-first finds what they claim/built;
  // reverse-mention finds projects whose OWN timeline named them; team-from-X
  // mines THIS account's posts for the people behind it (the project-account case).
  // The project's own website (from its X bio link, or a domain in the bio text)
  // is where the team page actually lives — mine it like Site recon would.
  const bioDomain = ctx.evidence.profile.bio.match(/\b([a-z0-9-]+\.(?:xyz|io|com|fi|net|finance|app|org|co|gg|network|dev|ai|so|money))\b/i)?.[1];
  const domain = (siteUrl ?? (bioDomain ? `https://${bioDomain}` : "")).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // When no domain is in the bio, guess one from the handle so we can still fetch
  // the project's own team page (handle "VulcanForged" -> vulcanforged.com, whose
  // docs.* /team is the canonical roster). Failed guesses just fetch nothing.
  const teamDomain = domain || `${ctx.handle.replace(/^@/, "").toLowerCase()}.com`;
  // discoverAffiliations now covers the reverse-mention angle too (was a second
  // Grok search call — merged to halve intake search spend).
  const [bySubject, people, siteTeam, pageTeam] = await Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.prior_handles ?? []),
    findTeam(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.recentActivity),
    // Run the deeper web/LinkedIn/press team search whenever we have EITHER a
    // domain or a project name — a big public project's roster lives off-X, and
    // many project accounts (e.g. @VulcanForged) put no plain domain in the bio.
    domain || ctx.evidence.profile.display_name
      ? findTeamOnSite(domain, ctx.evidence.profile.display_name)
      : Promise.resolve([] as TeamMember[]),
    // Read the project's own /team page directly (Grok's summary can miss it).
    fetchTeamPage(teamDomain, ctx.evidence.profile.display_name),
  ]);

  // Auto-pivot team: merge everyone found across the website search, the account's
  // own X content, and a deterministic post role-word scan (founder/CEO/CTO...).
  // Named-only people are KEPT here (a real name + role is signal even with no
  // handle to audit) — this is what a plain handle audit used to drop.
  const postRoleTeam = scanPostsForRoles(ctx.evidence.recentActivity);
  const webTeam = ctx.evidence.webTeam ?? (ctx.evidence.webTeam = []);
  // MERGE duplicates instead of dropping them: the team page gives the
  // authoritative name+role but no links; Grok gives the same person WITH their
  // @handle/LinkedIn. Keep the first occurrence and fill its missing fields from
  // later duplicates, so a page-roster name still gets its identity links.
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^@/, "");
  const byHandle = new Map<string, (typeof webTeam)[number]>();
  const byName = new Map<string, (typeof webTeam)[number]>();
  for (const t of [...pageTeam, ...siteTeam, ...people, ...postRoleTeam]) {
    const h = t.handle ? norm(t.handle) : "";
    const n = norm(t.name);
    if (!h && !n) continue;
    const existing = (h && byHandle.get(h)) || (n && byName.get(n)) || null;
    if (existing) {
      if (!existing.handle && t.handle) { existing.handle = t.handle; byHandle.set(norm(t.handle), existing); }
      if (!existing.linkedin && t.linkedin) existing.linkedin = t.linkedin;
      if ((!existing.projects || !existing.projects.length) && t.projects?.length) existing.projects = t.projects;
      continue;
    }
    const rec = { name: t.name, handle: t.handle, role: t.role, linkedin: t.linkedin, evidence: t.evidence, source: t.source ?? "X content", projects: t.projects };
    webTeam.push(rec);
    if (h) byHandle.set(h, rec);
    if (n) byName.set(n, rec);
  }

  // Does the ACCOUNT ITSELF vouch for this team, or was it only matched by NAME?
  // A real project/founder account ties to its team through its OWN evidence: its
  // handle is among them, it links its site in bio (domain), or its own posts name
  // the people (people/postRoleTeam come from the account's content). A KOL whose
  // display name merely COLLIDES with a project (e.g. @KaminoCrypto vs the Kamino
  // protocol) has none of these — so a by-name team lookup returns that project's
  // founders, and attaching them here is a false identity resolution (the exact
  // name collision the contradictions section catches). Drop it at the source
  // rather than present a stranger's team as this account's identity.
  const subj = norm(ctx.handle);
  const accountVouchesTeam = !!domain || people.length > 0 || postRoleTeam.length > 0 || webTeam.some((t) => norm(t.handle) === subj);
  if (webTeam.length && !accountVouchesTeam) {
    ctx.emit({ phase: "P1 · Team", label: "Same-name project (not this account)", detail: `Found a team for the name "${ctx.evidence.profile.display_name || ctx.handle}", but nothing ties THIS account to it — its handle isn't among them, it links no site, and its own posts name no team. Treated as a name collision, not the account's identity.`, source: "team-search", tone: "warn" });
    webTeam.length = 0; // clear in place (shared ref with ctx.evidence.webTeam)
  }

  // Actively resolve identities for members still name-only (the team page names
  // them but links nothing): one batched Grok pass finds each person's X handle
  // and LinkedIn. The co-founder of a known fund should never render "named only".
  const nameOnly = webTeam.filter((m) => !m.handle && !m.linkedin).slice(0, 15);
  if (nameOnly.length >= 1) {
    const found = await enrichTeamIdentities(ctx.evidence.profile.display_name || ctx.handle, nameOnly.map((m) => ({ name: m.name, role: m.role })));
    let linked = 0;
    for (const f of found) {
      const m = byName.get(norm(f.name));
      if (!m) continue;
      if (!m.handle && f.handle) { m.handle = f.handle; linked++; }
      if (!m.linkedin && f.linkedin) { m.linkedin = f.linkedin; if (!f.handle) linked++; }
    }
    if (linked) ctx.emit({ phase: "P1 · Team", label: "Identities linked", detail: `Resolved X/LinkedIn for ${linked} of ${nameOnly.length} name-only team members.`, source: "grok", tone: "good" });
  }
  if (webTeam.length) {
    ctx.emit({ phase: "P1 · Team", label: "Team assembled", detail: `${webTeam.length} people behind the project: ${webTeam.slice(0, 6).map((t) => t.name + (t.handle ? ` ${t.handle}` : "")).join(", ")}${domain ? ` (site + posts)` : " (posts)"}.`, source: "team-search", tone: "good" });
    // A named team resolves the PROJECT's real-world identity even when the X
    // handle itself is a corporate/brand account (e.g. @VulcanForged). Without
    // this, a brand handle stays "Unverified" and the founder verdict gets
    // capped as if anonymous, contradicting a report that names the CEO. Raise
    // the identity floor: a LinkedIn-corroborated leader -> Confirmed, otherwise
    // a named leader / two named people -> Probable. Only ever raises, and never
    // overrides a suspected-impersonation finding.
    const isLeader = (r?: string) => /founder|cofounder|co-founder|ceo|cto|coo|president|chief/i.test(r ?? "");
    // Only directly fetched first-party team pages and deterministic role scans
    // can raise identity confidence. Grok web/X results remain useful leads in
    // the roster, but cannot confirm the very identity it was asked to discover.
    const backedTeam = [...pageTeam, ...postRoleTeam].filter((candidate) =>
      webTeam.some((member) =>
        (!!candidate.handle && norm(candidate.handle) === norm(member.handle)) ||
        (!!candidate.name && norm(candidate.name) === norm(member.name)),
      ),
    );
    const leaders = backedTeam.filter((t) => isLeader(t.role));
    const leaderWithLinkedin = pageTeam.some((t) => isLeader(t.role) && !!t.linkedin);
    const rank: Record<string, number> = { Unverified: 0, Probable: 1, Confirmed: 2 };
    const cur = ctx.evidence.profile.identity_confidence;
    if (backedTeam.length) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "confirmed",
        note: `${backedTeam.length} team identit${backedTeam.length === 1 ? "y" : "ies"} backed by a first-party team page or deterministic post scan`,
        provider: "team-page/post-scan",
        sourceCount: backedTeam.length,
      });
    }
    if (cur !== "SuspectedImpersonation") {
      const target = leaderWithLinkedin ? "Confirmed" : leaders.length || backedTeam.length >= 2 ? "Probable" : null;
      if (target) {
        ctx.recordCheck?.({
          id: "identity-resolution",
          status: "confirmed",
          note: `project identity resolved through ${backedTeam.length} independently collected team record${backedTeam.length === 1 ? "" : "s"}`,
          provider: "team-page/post-scan",
          sourceCount: backedTeam.length,
        });
      }
      if (target && (rank[target] ?? 0) > (rank[cur ?? "Unverified"] ?? 0)) {
        ctx.evidence.profile.identity_confidence = target as typeof cur;
        ctx.emit({ phase: "P1 · Team", label: `Identity ${target.toLowerCase()}`, detail: `Project identity resolved through independently fetched team evidence${leaderWithLinkedin ? " (a first-party team page links its leadership)" : ""}; a brand handle over a public team is not an anonymity flag.`, source: "team-page / post scan", tone: "good" });
      }
    }
  } else if (domain) {
    ctx.emit({ phase: "P1 · Team", label: "No named team", detail: `Dug ${domain} and the account's posts; no individual team members could be attributed. For a project raising money, an unnamed team is itself a flag.`, source: "team-search", tone: "warn" });
  }

  // ── Site substance: is the project's OWN website actually a live product, or
  //    still a coming-soon / waitlist page? Only run on a REAL resolved domain
  //    (never a handle-guess) so a failed guess can't false-flag "unreachable".
  if (domain) {
    const site = await checkSiteSubstance(domain).catch(() => null);
    if (site) {
      ctx.evidence.profile.website = site.url;
      if (site.status === "coming_soon" || site.status === "unreachable") {
        const notLive = site.status === "unreachable" ? "does not resolve" : "is not live yet";
        ctx.evidence.findings.push({
          finding_type: "SiteNotLive",
          claim: `The project's own website (${domain}) ${notLive}: ${site.detail}. No live product surface despite the account promoting a token.`,
          source_url: site.url,
          source_date: "",
          source_author: "site-fetch",
          verification_status: "Verified",
          independent_source_count: 1,
          polarity: -1,
        });
        ctx.emit({ phase: "P2 · Substance", label: "Website not live", detail: `${domain} ${notLive} — ${site.detail}. A project promoting a token with no live site is early/unshipped; weigh against product-substance claims.`, source: "site-fetch", tone: "bad" });
      } else if (site.status === "client_rendered") {
        ctx.emit({ phase: "P2 · Substance", label: "Website live (app)", detail: `${domain} serves a client-rendered app; ${site.detail}.`, source: "site-fetch", tone: "neutral" });
      } else {
        ctx.emit({ phase: "P2 · Substance", label: "Website live", detail: `${domain} is a live site — ${site.detail}.`, source: "site-fetch", tone: "good" });
      }
    }
  }

  // People named in the account's X content, routed by kind:
  //  - TEAM -> associates (the investigation lists them as backgroundable people).
  //  - ADVISORS -> testimonials (claimed endorsers), so the corroboration loop can
  //    check whether the named advisor actually follows/acknowledges the project,
  //    or it's a fake name-drop. Only @-handled people are wired in (a bare name
  //    can't be normalized and isn't auditable); named-only ones are just reported.
  if (people.length) {
    const teamList = people.filter((p) => p.kind === "team");
    const advisorList = people.filter((p) => p.kind === "advisor");
    const haveAssoc = new Set(ctx.evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
    const haveTest = new Set(ctx.evidence.testimonials.map((t) => (t.claimed_endorser_handle ?? "").replace(/^@/, "").toLowerCase()));
    const addedTeam: string[] = [];
    for (const t of teamList) {
      if (!t.handle) continue;
      const key = t.handle.replace(/^@/, "").toLowerCase();
      if (haveAssoc.has(key)) continue;
      haveAssoc.add(key);
      ctx.evidence.associates.push({ associate_handle: t.handle, relation: `team: ${t.role}`, notes: t.evidence });
      addedTeam.push(`${t.name} (${t.handle})`);
    }
    const addedAdv: string[] = [];
    for (const a of advisorList) {
      if (!a.handle) continue;
      const key = a.handle.replace(/^@/, "").toLowerCase();
      if (haveTest.has(key)) continue;
      haveTest.add(key);
      ctx.evidence.testimonials.push({
        claimed_endorser_handle: a.handle,
        claimed_relationship: "advisor",
        appears_at: "model search of project X content",
        evidence_origin: "model_lead",
        artifact_verified: false,
      });
      addedAdv.push(`${a.name} (${a.handle})`);
    }
    const namedOnly = people.filter((p) => !p.handle).map((p) => `${p.name} (${p.kind === "advisor" ? "advisor" : p.role})`);
    if (addedTeam.length) ctx.emit({ phase: "P0 · Intake", label: "Team surfaced", detail: `${addedTeam.length} team member${addedTeam.length === 1 ? "" : "s"} named in this account's X content: ${addedTeam.slice(0, 6).join(", ")}.`, source: "grok", tone: "good" });
    if (addedAdv.length) ctx.emit({ phase: "P0 · Intake", label: "Advisors surfaced", detail: `${addedAdv.length} advisor${addedAdv.length === 1 ? "" : "s"}/backer${addedAdv.length === 1 ? "" : "s"} claimed in X content (corroborating each): ${addedAdv.slice(0, 6).join(", ")}.`, source: "grok", tone: "neutral" });
    if (namedOnly.length) ctx.emit({ phase: "P0 · Intake", label: "Named only", detail: `Also named without a handle (not auditable): ${namedOnly.slice(0, 5).join(", ")}.`, source: "grok", tone: "neutral" });
  }
  const mergedMap = new Map<string, DiscoveredAffiliation>();
  for (const v of bySubject) {
    const k = v.name.toLowerCase();
    const ex = mergedMap.get(k);
    // Keep the richest record: prefer an X handle / domain (so corroboration can run).
    if (!ex) mergedMap.set(k, v);
    else mergedMap.set(k, { ...ex, x_handle: ex.x_handle ?? v.x_handle, domain: ex.domain ?? v.domain, evidence: ex.evidence ?? v.evidence, role: ex.role || v.role });
  }
  const discovered = [...mergedMap.values()];
  if (discovered.length) {
    // 1. Push every fresh lead immediately so the audit never blocks on
    //    corroboration. Each record is a live object we refine in place below.
    const have = new Set(ctx.evidence.ventures.map((v) => v.project_name.toLowerCase()));
    const pending = discovered
      .filter((v) => { const k = v.name.toLowerCase(); if (have.has(k)) return false; have.add(k); return true; })
      .map((v) => {
        const rec = {
          project_name: v.name,
          // Canonical bridge keys — the venture's own X account / domain. Without
          // these the graph keys the project on its fuzzy name and never connects
          // it to the same project seen in another audit.
          x_handle: v.x_handle,
          domain: v.domain,
          role: v.role,
          period: v.year ?? "",
          outcome: VentureOutcome.ACTIVE,
          evidence_url: null as string | null,
          notes: [v.evidence, "single-source lead, unverified"].filter(Boolean).join(" · "),
          evidence_origin: "model_lead" as const,
          artifact_verified: false,
        };
        ctx.evidence.ventures.push(rec);
        return { v, rec };
      });
    const founderish = discovered.some((v) => /founder|cofounder/i.test(v.role));
    if (founderish && (!ctx.evidence.roles.length || ctx.evidence.roles.every((r) => r === SubjectClass.MEMBER))) {
      ctx.evidence.roles = [SubjectClass.FOUNDER];
    }
    ctx.emit({ phase: "P0 · Intake", label: "Affiliations discovered", detail: `${discovered.length} public affiliation${discovered.length === 1 ? "" : "s"} tied to the subject: ${discovered.slice(0, 5).map((v) => v.name).join(", ")}.`, source: "grok", tone: "good" });

    // 2. Corroborate the top leads against a second, independent source, all in
    //    parallel and time-boxed, so wall-clock is one slow check, not N. Each
    //    confirmed tie refines its record in place and emits a step.
    let corroboratedAffiliations = 0;
    await Promise.all(
      pending.slice(0, 5).map(async ({ v, rec }) => {
        const corrob: string[] = [];
        // The project handle / domain is often only in the cited post text, not
        // the structured field — recover it so corroboration can actually run.
        const subjectU = ctx.handle.replace(/^@/, "").toLowerCase();
        const xHandle = v.x_handle ?? (v.evidence?.match(/@([A-Za-z0-9_]{2,30})/g) ?? []).map((s) => s.slice(1)).find((u) => u.toLowerCase() !== subjectU);
        const domain = v.domain ?? v.evidence?.match(/\b([a-z0-9][a-z0-9-]*\.(?:xyz|io|com|fi|app|finance|org|net|co|ai|gg|so))\b/i)?.[1];
        try {
          if (domain) {
            const arch = await archivedAffiliation(domain, ctx.evidence.profile.display_name);
            if (arch) { corrob.push(`archived ${arch.where} page (${arch.year})`); rec.evidence_url = arch.url; }
          }
          if (xHandle) {
            const follows = await followsSubject("@" + xHandle.replace(/^@/, ""), ctx.handle);
            if (follows) corrob.push(`@${xHandle.replace(/^@/, "")} follows the subject`);
          }
        } catch { /* corroboration is best-effort; the lead still stands */ }
        if (corrob.length) {
          corroboratedAffiliations += 1;
          rec.notes = [v.evidence, `corroborated: ${corrob.join("; ")}`].filter(Boolean).join(" · ");
          ctx.emit({ phase: "P0 · Intake", label: `Affiliation corroborated · ${v.name}`, detail: `${v.role}${v.year ? `, ${v.year}` : ""} — ${corrob.join("; ")}.`, source: "argus", tone: "good" });
        }
      }),
    );
    if (corroboratedAffiliations) {
      ctx.recordCheck?.({
        id: "affiliations-associates",
        status: "confirmed",
        note: `${corroboratedAffiliations} discovered affiliation${corroboratedAffiliations === 1 ? "" : "s"} corroborated against an independent artifact or follow-graph result`,
        provider: "wayback/twitterapi.io",
        sourceCount: corroboratedAffiliations,
      });
    }
  } else {
    ctx.emit({ phase: "P0 · Intake", label: "No affiliations found", detail: "No public company affiliations could be attributed to this person via web/X search.", source: "grok", tone: "neutral" });
  }
}

function axisCatalog(roles: SubjectClass[]) {
  const out: { axis: string; weight: number; role: string }[] = [];
  for (const role of roles) {
    const prof = getProfile(role);
    for (const [axis, weight] of Object.entries(prof.axes)) {
      out.push({ axis, weight, role });
    }
  }
  return out;
}

// ── Phase 3.5: adverse-signal sweep, manipulation-tooling flag, cross-project
//    overlap ("the Venn"). This is the playbook's core: for the subject AND every
//    project/associate discovered, hunt real rug/scam/drain complaints; flag a
//    founder who BUILDS the means to manipulate; and surface people who recur
//    across the ventures. Findings feed the engine's existing fraud/manipulation
//    hooks (InvestigatorCallout / DeceptionFinding / manipulation_service_flag),
//    so a confirmed pattern actually moves the verdict, not just the narrative. ──
const handleFrom = (s?: string | null): string | undefined =>
  s?.match(/@([A-Za-z0-9_]{2,30})/)?.[1];

// Grok is discovery, not corroboration. A URL it returns is one candidate
// artifact, never proof that the page exists or supports the claim. These rows
// remain model leads until a deterministic collector fetches and verifies them;
// the engine explicitly excludes model leads from every hard cap.
function toFinding(sig: AdverseSignal, aboutHandle: string) {
  const hasCandidateArtifact = !!sig.source_url;
  return {
    finding_type: "AdverseLead",
    claim: `@${aboutHandle.replace(/^@/, "")} (${sig.category.replace(/_/g, " ")} lead): ${sig.claim}`,
    source_url: sig.source_url ?? "",
    source_date: "",
    source_author: sig.source,
    verification_status: hasCandidateArtifact ? "Reported" : "Rumor",
    independent_source_count: hasCandidateArtifact ? 1 : 0,
    polarity: -1,
    evidence_origin: "model_lead" as const,
    artifact_verified: false,
  };
}

async function adverseSignalsAndTooling(ctx: CollectContext) {
  const { evidence } = ctx;
  const self = ctx.handle.replace(/^@/, "").toLowerCase();
  const ticker = evidence.promotions.find((p) => p.ticker)?.ticker;

  // Targets: the subject (as person), and the top discovered ventures (as
  // projects), each with a recoverable @handle so the search is grounded.
  const projectTargets = evidence.ventures
    .map((v) => ({ name: v.project_name, handle: (v.x_handle ? v.x_handle.replace(/^@/, "") : undefined) ?? handleFrom(v.evidence_url) ?? handleFrom(v.notes) }))
    .filter((v) => v.handle && v.handle.toLowerCase() !== self)
    .slice(0, 4);
  const associateTargets = evidence.associates
    .map((a) => a.associate_handle)
    .filter((h) => h && h.replace(/^@/, "").toLowerCase() !== self)
    .slice(0, 4);

  ctx.emit({ phase: "Adverse", label: "Scam / rug sweep", detail: `Searching for rug, slow-rug, liquidity-pull, drain, and FUD signals across the subject${ticker ? `, $${ticker.replace(/^\$/, "")}` : ""}, ${projectTargets.length} project${projectTargets.length === 1 ? "" : "s"}, and ${associateTargets.length} associate${associateTargets.length === 1 ? "" : "s"}…`, source: "grok", tone: "neutral" });

  // All searches + the tooling probe run concurrently and time-boxed, so the
  // whole sweep costs one slow call, not the sum.
  const [tooling, subjectSigs, projectSigs, assocSigs] = await Promise.all([
    detectManipulationTooling(ctx.handle, evidence.profile.display_name),
    searchAdverseSignals(ctx.handle, "person", ticker),
    Promise.all(projectTargets.map((p) => searchAdverseSignals(p.handle!, "project"))),
    Promise.all(associateTargets.map((h) => searchAdverseSignals(h, "person"))),
  ]);

  // 1. Manipulation-tooling discovery. Grok can surface the page, but cannot
  //    verify either the page or the subject-to-product relationship. Keep the
  //    candidate visible and explicitly non-capping until a deterministic fetch
  //    produces a verified artifact.
  if (tooling?.tools.length) {
    const list = tooling.tools.map((t) => `${t.name} (${t.kind.replace(/_/g, " ")})`).join(", ");
    const candidateUrl = tooling.tools.find((t) => t.url)?.url;
    evidence.findings.push({
      finding_type: "ManipulationToolingLead",
      claim: `Model-discovered lead: subject may be connected as ${tooling.role_claim || "operator"} to manipulation tooling: ${list}.`,
      source_url: candidateUrl ?? "",
      source_date: "",
      source_author: "model-discovered candidate page",
      verification_status: candidateUrl ? "Reported" : "Rumor",
      independent_source_count: candidateUrl ? 1 : 0,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    for (const t of tooling.tools) {
      evidence.clientEngagements.push({
        client_name: t.name,
        service_type: `possible_manipulation_tooling:${t.kind}`,
        manipulation_service_flag: false,
        evidence_url: t.url,
        notes: [t.evidence, "model-discovered lead; relationship not independently verified"].filter(Boolean).join(" · "),
        evidence_origin: "model_lead",
        artifact_verified: false,
      });
    }
    ctx.emit({ phase: "Adverse", label: "Manipulation-tooling lead", detail: `Candidate connection surfaced for ${list}; independent artifact verification is still required before this can affect a hard cap.`, source: "grok", tone: "warn" });
  }

  // 2. Adverse discovery across every target. Every row stays a non-capping lead.
  const pushSigs = (sigs: AdverseSignal[], about: string) => {
    for (const s of sigs) {
      evidence.findings.push(toFinding(s, about));
    }
  };
  let totalSigs = 0;
  pushSigs(subjectSigs, self);
  totalSigs += subjectSigs.length;
  projectSigs.forEach((sigs, i) => { pushSigs(sigs, projectTargets[i].handle!); totalSigs += sigs.length; });
  assocSigs.forEach((sigs, i) => { pushSigs(sigs, associateTargets[i]); totalSigs += sigs.length; });

  if (totalSigs) {
    const top = [...subjectSigs, ...projectSigs.flat(), ...assocSigs.flat()]
      .slice(0, 3)
      .map((s) => `${s.category.replace(/_/g, " ")}: ${s.claim}`)
      .join(" · ");
    ctx.emit({ phase: "Adverse", label: `${totalSigs} adverse lead${totalSigs === 1 ? "" : "s"}`, detail: `Unverified candidate sources for follow-up. ${top}`, source: "grok", tone: "warn" });
  } else {
    ctx.emit({ phase: "Adverse", label: "No adverse leads surfaced", detail: "The model search returned no candidate rug/scam/drain/FUD source URLs for follow-up; this is not proof that none exist.", source: "grok", tone: "neutral" });
  }

  // 3. Cross-project overlap ("the Venn"): second hop over the ventures' teams to
  //    find people who recur across projects. A person wired into multiple of the
  //    subject's ventures is the internal co-occurrence the playbook looks for.
  if (projectTargets.length >= 2) {
    const teams = await Promise.all(projectTargets.map((p) => findTeam(p.handle!, p.name)));
    // Feed the FULL second hop into the graph: subject → venture → each of its
    // people. These teams were already fetched for the Venn below; wiring them as
    // venture→person edges (keyed canonically) is what turns the graph from a
    // shallow star into a web, and cross-links a venture's team member to the
    // subject's associates / another audit automatically. (The Venn overlap logic
    // that follows is unchanged — it still flags people recurring across ventures.)
    ctx.evidence.ventureTeams = projectTargets.map((p, i) => ({
      key: canonicalEntityKey({ handle: p.handle, name: p.name }),
      name: p.name,
      people: (teams[i] ?? [])
        .filter((m) => (m.handle || m.name) && m.handle?.replace(/^@/, "").toLowerCase() !== self)
        .slice(0, 8)
        .map((m) => ({ name: m.name, handle: m.handle, role: m.role })),
    })).filter((vt) => vt.people.length > 0);
    if (ctx.evidence.ventureTeams.length) {
      const total = ctx.evidence.ventureTeams.reduce((n, vt) => n + vt.people.length, 0);
      ctx.emit({ phase: "Network", label: "Venture teams mapped", detail: `${total} people across ${ctx.evidence.ventureTeams.length} venture${ctx.evidence.ventureTeams.length === 1 ? "" : "s"} wired into the graph — subject → venture → the people behind it.`, source: "grok", tone: "good" });
    }
    const appearances = new Map<string, { name: string; projects: Set<string> }>();
    teams.forEach((team, i) => {
      for (const member of team) {
        if (!member.handle) continue;
        const key = member.handle.replace(/^@/, "").toLowerCase();
        if (key === self) continue;
        const rec = appearances.get(key) ?? { name: member.name, projects: new Set<string>() };
        rec.projects.add(projectTargets[i].name);
        appearances.set(key, rec);
      }
    });
    const overlaps = [...appearances.entries()].filter(([, r]) => r.projects.size >= 2);
    if (overlaps.length) {
      const haveAssoc = new Set(evidence.associates.map((a) => a.associate_handle.replace(/^@/, "").toLowerCase()));
      for (const [key, r] of overlaps) {
        const projList = [...r.projects].join(", ");
        if (haveAssoc.has(key)) {
          const existing = evidence.associates.find((a) => a.associate_handle.replace(/^@/, "").toLowerCase() === key);
          if (existing) existing.notes = [existing.notes, `also on: ${projList}`].filter(Boolean).join(" · ");
        } else {
          evidence.associates.push({ associate_handle: "@" + key, relation: "cross-project overlap", notes: `appears across ${projList}` });
        }
      }
      ctx.emit({ phase: "Adverse", label: `${overlaps.length} cross-project overlap${overlaps.length === 1 ? "" : "s"}`, detail: overlaps.slice(0, 5).map(([k, r]) => `@${k} (${[...r.projects].join(", ")})`).join(" · "), source: "grok", tone: "warn" });
    }
  }
}

// ── Token lifecycle: migration / relaunch + post-relaunch dive ──
// For each promoted ticker, group same-ticker contracts into generations (a
// relaunch mints a new one) and check whether the current token launched and
// then collapsed. The collapse is observed on-chain (Verified, but NOT proof of
// fraud, so it surfaces without capping); the multi-generation migration is a
// heuristic, reported as "possible".
async function tokenLifecycle(ctx: CollectContext) {
  const { evidence } = ctx;
  // ONLY analyze tokens the subject verifiably owns — i.e. a contract the subject
  // actually posted. A ticker alone can't attribute on-chain conduct: "$WORLD"
  // (a common word) matches dozens of unrelated copycat tokens, and blaming their
  // collapses / counting them as "the subject's contracts" is exactly the false
  // signal that mislabels a real project by ticker collision.
  const promos = evidence.promotions.filter((p) => p.ticker && p.contract_address).slice(0, 3);
  if (!promos.length) return;
  await Promise.all(
    promos.map(async (p) => {
      const sig = await detectTokenLifecycle(p.ticker, p.contract_address);
      if (!sig) return;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: sig.dive ? "finding" : "confirmed",
        note: sig.dive
          ? `$${sig.ticker} verified contract collapse: ${sig.dive.detail}`
          : `$${sig.ticker} lifecycle lookup completed with no collapse surfaced`,
        provider: "dexscreener",
        sourceCount: 1,
      });
      if (!sig.dive) return; // dive is gated on the verified contract inside detect
      evidence.findings.push({
        finding_type: "TokenCollapse",
        claim: `$${sig.ticker} (${p.contract_address!.slice(0, 8)}…) launched and collapsed to near-zero (${sig.dive.detail}).`,
        source_url: `https://dexscreener.com/search?q=${encodeURIComponent(sig.dive.address)}`,
        source_date: "",
        source_author: "dexscreener",
        verification_status: "Verified",
        independent_source_count: 1,
        polarity: -1,
      });
      ctx.emit({ phase: "Token", label: `$${sig.ticker} collapse`, detail: `${sig.dive.detail}. The dive-after-launch pattern.`, source: "dexscreener", tone: "bad" });
    }),
  );
}

// ── Post cadence: is the account whittling down or going silent? ──
// A team going quiet after a launch is a disappearing-act / soft-rug tell. Pulls
// timestamped posts and runs the pure analyzer; a decaying or silent cadence
// surfaces as a finding (observed, non-capping).
async function postCadence(ctx: CollectContext) {
  const posts = await getRecentPostsMeta(ctx.handle);
  const report = analyzeCadence(posts, Date.now());
  if (!report) return;
  if (report.silent || report.decaying) {
    ctx.evidence.findings.push({
      finding_type: "CadenceDecay",
      claim: `@${ctx.handle.replace(/^@/, "")}: ${report.summary}`,
      source_url: "",
      source_date: "",
      source_author: "twitterapi.io",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
    });
    ctx.emit({ phase: "Cadence", label: report.silent ? "Went quiet" : "Cadence thinning", detail: report.summary, source: "twitterapi.io", tone: report.silent ? "bad" : "warn" });
  } else {
    ctx.emit({ phase: "Cadence", label: "Posting steady", detail: report.summary, source: "twitterapi.io", tone: "neutral" });
  }
}

async function runAuditWithLedger(rawHandle: string, emit: Emit): Promise<Dossier | null> {
  const fixture = findSubject(rawHandle);
  const liveProviders = ADAPTERS.filter((a) => KEYED.has(a.id) && a.available());
  const anyLive = liveProviders.length > 0 || analystAvailable();

  // ── Pure fixture fallback: replay the curated trace, return curated dossier ──
  if (fixture && !anyLive) {
    for (const step of fixture.trace) {
      emit(step);
      await delay(420 + Math.random() * 360);
    }
    await delay(500);
    const dossier = assembleDossier(toEvidence(fixture), false);
    dossier.checkRuns = personChecks({
      identityConfidence: dossier.report.identity_confidence ?? undefined,
      realName: dossier.display_name.trim().split(/\s+/).filter(Boolean).length >= 2,
      roles: dossier.report.roles ?? [],
      hasAssociates: (dossier.evidence.associates ?? []).length > 0,
    });
    dossier.completeness_state = "partial";
    dossier.providerSnapshot = { capturedAt: new Date().toISOString(), runs: [] };
    return dossier;
  }

  // ── Live pipeline ──
  const evidence: CollectedEvidence = fixture ? toEvidence(fixture) : emptyEvidence(rawHandle);
  const checkTracker = new PersonCheckTracker();
  emit({ phase: "P0 · Intake", label: "Resolve handle", detail: `Normalizing ${rawHandle} and opening the audit ledger.`, tone: "neutral" });

  const ctx: CollectContext = {
    handle: evidence.profile.handle,
    evidence,
    emit,
    recordCheck: (observation) => checkTracker.record(observation),
  };

  // cold handle: resolve profile + extract self-claims before verification
  if (!fixture) await coldIntake(ctx);

  // run each available adapter
  for (const a of ADAPTERS) {
    if (!a.available()) {
      checkTracker.provider(a.id, a.label, "unavailable", "provider is not configured");
      if (a.id === "github") {
        checkTracker.record({
          id: "code-footprint-github",
          status: "unavailable",
          note: "GitHub provider is not configured",
          provider: "github",
        });
      } else if (a.id === "crunchbase") {
        checkTracker.record({
          id: "vc-portfolio-track-record",
          status: "unavailable",
          note: "Crunchbase provider is not configured",
          provider: "crunchbase",
        });
      }
      continue;
    }
    try {
      await a.run(ctx);
      checkTracker.provider(a.id, a.label, "executed");
    } catch (e) {
      checkTracker.provider(a.id, a.label, "failed", String(e));
      if (a.id === "github") {
        checkTracker.record({ id: "code-footprint-github", status: "unavailable", note: `GitHub adapter failed: ${String(e)}`, provider: "github" });
      } else if (a.id === "crunchbase") {
        checkTracker.record({ id: "vc-portfolio-track-record", status: "unavailable", note: `Crunchbase adapter failed: ${String(e)}`, provider: "crunchbase" });
      }
      emit({ phase: "Collect", label: `${a.label} error`, detail: String(e), tone: "warn" });
    }
  }

  // Post-discovery signal passes, all before the analyst so their findings feed
  // the scoring. Token lifecycle is keyless (DexScreener); cadence needs the
  // twitterapi key; the adverse/tooling sweep needs Grok or Claude. Each is
  // isolated so one failing never sinks the audit.
  const trackedPass = (
    id: string,
    label: string,
    pass: Promise<void>,
    onError: (error: unknown) => void,
  ) => pass.then(() => {
    checkTracker.provider(id, label, "executed");
  }).catch((error) => {
    checkTracker.provider(id, label, "failed", String(error));
    onError(error);
  });
  const signalPasses: Promise<void>[] = [
    trackedPass("token-lifecycle", "Promoted-token lifecycle", tokenLifecycle(ctx), (e) => {
      emit({ phase: "Token", label: "Lifecycle error", detail: String(e), tone: "warn" });
    }),
  ];
  if (env("TWITTERAPI_KEY")) {
    signalPasses.push(trackedPass("post-cadence", "Posting cadence", postCadence(ctx), (e) => {
      emit({ phase: "Cadence", label: "Cadence error", detail: String(e), tone: "warn" });
    }));
  } else {
    checkTracker.provider("post-cadence", "Posting cadence", "unavailable", "twitterapi.io provider is not configured");
  }
  if (analystAvailable() || env("XAI_API_KEY")) {
    signalPasses.push(trackedPass("adverse-sweep", "Adverse-signal sweep", adverseSignalsAndTooling(ctx), (e) => {
      emit({ phase: "Adverse", label: "Sweep error", detail: String(e), tone: "warn" });
    }));
  } else {
    checkTracker.provider("adverse-sweep", "Adverse-signal sweep", "unavailable", "model search provider is not configured");
  }
  await Promise.all(signalPasses);

  // route roles if we don't have them yet (unknown subject)
  if (!evidence.roles.length) {
    const route = classifySubject(evidence.profile.bio);
    evidence.roles = route.applicable_classes.length ? route.applicable_classes : [SubjectClass.MEMBER];
    emit({ phase: "P0 · Routing", label: "Classify roles", detail: `Routed to ${evidence.roles.join(", ")} (${route.confidence} confidence).`, tone: "neutral" });
  }

  // Strip ARGUS's OWN analysis fields (identity_confidence/identity_note) from
  // what the LLMs see: the analyst writes identity_note fresh, and the
  // contradiction scanner must never "contradict" our metadata against itself.
  const profileForLlm: Record<string, unknown> = { ...evidence.profile };
  delete profileForLlm.identity_confidence;
  delete profileForLlm.identity_note;
  const baseEvidence = {
    profile: profileForLlm,
    ventures: evidence.ventures,
    testimonials: evidence.testimonials,
    advised: evidence.advised,
    promotions: evidence.promotions,
    wallets: evidence.wallets,
    clientEngagements: evidence.clientEngagements,
    associates: evidence.associates,
    // The named people behind the project (from the site + LinkedIn + X content),
    // so identity/founder scoring reflects the team we actually found.
    team: (evidence.webTeam ?? []).map((p) => ({
      name: p.name,
      handle: p.handle,
      role: p.role,
      linkedin: p.linkedin,
      source: p.source,
      evidence: p.evidence,
      otherProjects: p.projects,
    })),
    ventureTeams: evidence.ventureTeams,
    findings: evidence.findings,
    notableFollowers: evidence.notableFollowers,
    recentActivity: evidence.recentActivity.slice(0, 12),
  };

  // ── Phase 4 contradiction scan + axis scoring, run CONCURRENTLY (both read the
  //    same evidence) so the extra Claude call doesn't extend the critical path. ──
  if (analystAvailable()) {
    emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions…", tone: "neutral" });
    emit({ phase: "Analyst", label: "Score axes", detail: "Claude analyst scoring every axis from the collected evidence…", tone: "neutral" });
    const evidenceJson = buildAnalystEvidencePacket(baseEvidence);
    // Never retain fixture/seed scores once a live analyst was requested. The
    // validator below accepts all requested axes or none; a failed/partial call
    // must therefore finalize as INCOMPLETE instead of publishing stale scores.
    evidence.axes = [];
    const [found, verdict] = await Promise.all([
      scanContradictions(evidence.profile.handle, evidenceJson),
      analyzeSubject(evidence.profile.handle, evidence.roles, axisCatalog(evidence.roles), evidenceJson),
    ]);
    if (found && found.length) {
      evidence.contradictions = found;
      const worst = found.some((c) => c.severity === "high") ? "bad" : "warn";
      emit({ phase: "Contradictions", label: `${found.length} contradiction${found.length === 1 ? "" : "s"}`, detail: found.slice(0, 3).map((c) => `${c.claim} vs ${c.conflict}`).join(" · "), source: "claude", tone: worst });
    } else if (found) {
      emit({ phase: "Contradictions", label: "None found", detail: "No internal contradictions surfaced across the subject's claims and the evidence.", source: "claude", tone: "good" });
    } else {
      emit({ phase: "Contradictions", label: "Incomplete", detail: "Contradiction analysis did not return a complete result.", source: "claude", tone: "warn" });
    }
    if (verdict) {
      evidence.axes = verdict.axes;
      evidence.headline = verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({ phase: "Analyst", label: "Scored", detail: `${verdict.axes.length} axes scored.`, source: "claude", tone: "good" });
    } else {
      evidence.headline = "Investigation incomplete: the analyst did not return one valid score for every required axis.";
      emit({ phase: "Analyst", label: "Incomplete", detail: "The analyst response was unavailable, partial, duplicated an axis, or contained an invalid score. No verdict score will be published.", tone: "warn" });
    }
    checkTracker.provider("claude-analyst", "Claude analyst", "executed", verdict ? "complete axis set returned" : "axis result incomplete");
  } else {
    checkTracker.provider("claude-analyst", "Claude analyst", "unavailable", "analyst provider is not configured");
  }

  // A report with no complete axis set is still a useful, honest artifact. The
  // engine emits INCOMPLETE with null totals instead of turning missing data into
  // an adverse score or dropping the investigation entirely.
  if (!evidence.axes.length) {
    if (!evidence.headline) evidence.headline = "Investigation incomplete: not enough validated evidence to score every required axis.";
    emit({ phase: "Finalize", label: "Incomplete", detail: "Not enough validated evidence to score every required axis; publishing an incomplete report with no verdict score.", tone: "warn" });
  }

  emit({ phase: "Finalize", label: "Govern composite", detail: "Applying caps and selecting the governing role.", tone: "neutral" });
  await delay(300);
  const dossier = assembleDossier(evidence, true);
  dossier.checkRuns = checkTracker.snapshot(evidence.roles);
  dossier.completeness_state = checkTracker.completeness(evidence.roles);
  dossier.providerSnapshot = checkTracker.providers();
  // Attach what this run actually spent, so the report library can show it.
  const cost = getCost();
  dossier.cost = cost;
  emit({ phase: "Finalize", label: "Audit cost", detail: `~$${cost.usd.toFixed(2)} this audit (Grok $${cost.grokUsd.toFixed(2)} across ${cost.grokCalls} searches ≈${cost.sources} sources · Claude $${cost.claudeUsd.toFixed(2)} across ${cost.claudeCalls} calls).`, tone: "neutral" });
  return dossier;
}

export function runAudit(rawHandle: string, emit: Emit): Promise<Dossier | null> {
  return withCostLedger(() => runAuditWithLedger(rawHandle, emit));
}
