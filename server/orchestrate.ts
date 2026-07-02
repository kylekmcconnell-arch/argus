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

import { getProfile, classifySubject, SubjectClass, VentureOutcome } from "../src/engine";
import { assembleDossier, type Dossier } from "../src/data/dossier";
import { findSubject, toEvidence } from "../src/data/subjects";
import { emptyEvidence } from "../src/data/evidence";
import type { CollectedEvidence, Emit, CollectContext, Adapter } from "./adapters/types";
import { analystAvailable, analyzeSubject, extractClaims, scanContradictions } from "./agent";

import { xAdapter, getProfile as xProfile, getRecentPosts, fmtFollowers, discoverAffiliations, discoverByMentions, findTeam, findTeamOnSite, scanPostsForRoles, followsSubject, handleHistory, type DiscoveredAffiliation, type TeamMember } from "./adapters/x";
import { fetchTeamPage } from "./adapters/teampage";
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
  return roles.filter((r) => valid.has(r)).map((r) => r as SubjectClass);
}

// Cold handle: resolve the profile, pull recent posts, and extract self-claims
// so the verification adapters have something to check. Without this an unknown
// subject has no ventures/endorsements/advisory seats to verify.
async function coldIntake(ctx: CollectContext) {
  let siteUrl: string | undefined;
  const prof = await xProfile(ctx.handle);
  if (prof) {
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
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
    ctx.emit({ phase: "P0 · Intake", label: "Handle history", detail: `This account previously went by ${hist.priorHandles.map((p) => "@" + p).join(", ")} — a rebrand. Old posts and mentions are searched too.`, source: "memory.lol", tone: "warn" });
  } else if (hist) {
    ctx.emit({ phase: "P0 · Intake", label: "Handle history", detail: "No prior X handle on record for this account (no rebrand found; memory.lol coverage is partial).", source: "memory.lol", tone: "neutral" });
  }

  const posts = await getRecentPosts(ctx.handle);
  if (posts.length) {
    ctx.evidence.recentActivity = posts;
    ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Pulled ${posts.length} recent posts to mine for self-claims.`, source: "twitterapi.io", tone: "neutral" });
  }

  // Find-wallet: a self-disclosed wallet (a 0x address or ENS/basename/.sol name)
  // in the bio/posts. Resolving it connects this person to their on-chain
  // footprint, feeds the on-chain forensics, and adds a wallet node to the graph.
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
    }));
    ctx.evidence.testimonials = claims.testimonials.map((t) => ({
      claimed_endorser_handle: t.claimed_endorser_handle,
      claimed_relationship: t.claimed_relationship,
      appears_at: "subject surfaces",
    }));
    ctx.evidence.advised = claims.advised.map((p) => ({
      project_name: p.project_name,
      project_handle: p.project_handle,
      claimed_role: p.claimed_role ?? "advisor",
      appears_at: "subject surfaces",
    }));
    ctx.evidence.promotions = claims.promotions.map((p) => ({
      ticker: p.ticker,
      contract_address: p.contract_address,
      chain: p.chain,
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
  const [bySubject, byMentions, people, siteTeam, pageTeam] = await Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name),
    discoverByMentions(ctx.handle, ctx.evidence.profile.display_name, ctx.evidence.profile.prior_handles ?? []),
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
  // Dedup on BOTH handle and normalized name so the same person found once by
  // name (post scan) and once with a handle (site search) doesn't list twice.
  // Richer sources (siteTeam) come first, so the handle/LinkedIn version wins.
  const seenHandle = new Set<string>();
  const seenName = new Set<string>();
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^@/, "");
  for (const t of [...pageTeam, ...siteTeam, ...people, ...postRoleTeam]) {
    const h = t.handle ? norm(t.handle) : "";
    const n = norm(t.name);
    if ((h && seenHandle.has(h)) || (n && seenName.has(n))) continue;
    if (!h && !n) continue;
    if (h) seenHandle.add(h);
    if (n) seenName.add(n);
    webTeam.push({ name: t.name, handle: t.handle, role: t.role, linkedin: t.linkedin, evidence: t.evidence, source: t.source ?? "X content", projects: t.projects });
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
    const leaders = webTeam.filter((t) => isLeader(t.role));
    const leaderWithLinkedin = leaders.some((t) => !!t.linkedin);
    const rank: Record<string, number> = { Unverified: 0, Probable: 1, Confirmed: 2 };
    const cur = ctx.evidence.profile.identity_confidence;
    if (cur !== "SuspectedImpersonation") {
      const target = leaderWithLinkedin ? "Confirmed" : leaders.length || webTeam.length >= 2 ? "Probable" : null;
      if (target && (rank[target] ?? 0) > (rank[cur ?? "Unverified"] ?? 0)) {
        ctx.evidence.profile.identity_confidence = target as typeof cur;
        ctx.emit({ phase: "P1 · Team", label: `Identity ${target.toLowerCase()}`, detail: `Project identity resolved through its named team${leaderWithLinkedin ? " (LinkedIn-corroborated leadership)" : ""}; a brand handle over a public team is not an anonymity flag.`, source: "team-search", tone: "good" });
      }
    }
  } else if (domain) {
    ctx.emit({ phase: "P1 · Team", label: "No named team", detail: `Dug ${domain} and the account's posts; no individual team members could be attributed. For a project raising money, an unnamed team is itself a flag.`, source: "team-search", tone: "warn" });
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
      ctx.evidence.testimonials.push({ claimed_endorser_handle: a.handle, claimed_relationship: "advisor", appears_at: "project X content" });
      addedAdv.push(`${a.name} (${a.handle})`);
    }
    const namedOnly = people.filter((p) => !p.handle).map((p) => `${p.name} (${p.kind === "advisor" ? "advisor" : p.role})`);
    if (addedTeam.length) ctx.emit({ phase: "P0 · Intake", label: "Team surfaced", detail: `${addedTeam.length} team member${addedTeam.length === 1 ? "" : "s"} named in this account's X content: ${addedTeam.slice(0, 6).join(", ")}.`, source: "grok", tone: "good" });
    if (addedAdv.length) ctx.emit({ phase: "P0 · Intake", label: "Advisors surfaced", detail: `${addedAdv.length} advisor${addedAdv.length === 1 ? "" : "s"}/backer${addedAdv.length === 1 ? "" : "s"} claimed in X content (corroborating each): ${addedAdv.slice(0, 6).join(", ")}.`, source: "grok", tone: "neutral" });
    if (namedOnly.length) ctx.emit({ phase: "P0 · Intake", label: "Named only", detail: `Also named without a handle (not auditable): ${namedOnly.slice(0, 5).join(", ")}.`, source: "grok", tone: "neutral" });
  }
  const mergedMap = new Map<string, DiscoveredAffiliation>();
  for (const v of [...bySubject, ...byMentions]) {
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
          role: v.role,
          period: v.year ?? "",
          outcome: VentureOutcome.ACTIVE,
          evidence_url: null as string | null,
          notes: [v.evidence, "single-source lead, unverified"].filter(Boolean).join(" · "),
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
          rec.notes = [v.evidence, `corroborated: ${corrob.join("; ")}`].filter(Boolean).join(" · ");
          ctx.emit({ phase: "P0 · Intake", label: `Affiliation corroborated · ${v.name}`, detail: `${v.role}${v.year ? `, ${v.year}` : ""} — ${corrob.join("; ")}.`, source: "argus", tone: "good" });
        }
      }),
    );
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

export async function runAudit(rawHandle: string, emit: Emit): Promise<Dossier | null> {
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
    return assembleDossier(toEvidence(fixture), false);
  }

  // ── Live pipeline ──
  const evidence: CollectedEvidence = fixture ? toEvidence(fixture) : emptyEvidence(rawHandle);
  emit({ phase: "P0 · Intake", label: "Resolve handle", detail: `Normalizing ${rawHandle} and opening the audit ledger.`, tone: "neutral" });

  const ctx: CollectContext = { handle: evidence.profile.handle, evidence, emit };

  // cold handle: resolve profile + extract self-claims before verification
  if (!fixture) await coldIntake(ctx);

  // run each available adapter
  for (const a of ADAPTERS) {
    if (!a.available()) continue;
    try {
      await a.run(ctx);
    } catch (e) {
      emit({ phase: "Collect", label: `${a.label} error`, detail: String(e), tone: "warn" });
    }
  }

  // route roles if we don't have them yet (unknown subject)
  if (!evidence.roles.length) {
    const route = classifySubject(evidence.profile.bio);
    evidence.roles = route.applicable_classes.length ? route.applicable_classes : [SubjectClass.MEMBER];
    emit({ phase: "P0 · Routing", label: "Classify roles", detail: `Routed to ${evidence.roles.join(", ")} (${route.confidence} confidence).`, tone: "neutral" });
  }

  // Strip ARGUS's OWN analysis fields (identity_confidence/identity_note) from
  // what the LLMs see: the analyst writes identity_note fresh, and the
  // contradiction scanner must never "contradict" our metadata against itself.
  const { identity_confidence: _ic, identity_note: _in, ...profileForLlm } = evidence.profile;
  const baseEvidence = {
    profile: profileForLlm,
    ventures: evidence.ventures,
    testimonials: evidence.testimonials,
    advised: evidence.advised,
    promotions: evidence.promotions,
    wallets: evidence.wallets,
    // The named people behind the project (from the site + LinkedIn + X content),
    // so identity/founder scoring reflects the team we actually found.
    team: (evidence.webTeam ?? []).map((p) => ({ name: p.name, handle: p.handle, role: p.role, linkedin: p.linkedin, otherProjects: p.projects })),
    findings: evidence.findings,
    notableFollowers: evidence.notableFollowers,
    recentActivity: evidence.recentActivity.slice(0, 12),
  };

  // ── Phase 4 contradiction scan + axis scoring, run CONCURRENTLY (both read the
  //    same evidence) so the extra Claude call doesn't extend the critical path. ──
  if (analystAvailable()) {
    emit({ phase: "Contradictions", label: "Scan materials", detail: "Cross-referencing every claim against the collected evidence for internal contradictions…", tone: "neutral" });
    emit({ phase: "Analyst", label: "Score axes", detail: "Claude analyst scoring every axis from the collected evidence…", tone: "neutral" });
    const evidenceJson = JSON.stringify(baseEvidence, null, 0).slice(0, 12000);
    const [found, verdict] = await Promise.all([
      scanContradictions(evidence.profile.handle, evidenceJson),
      analyzeSubject(evidence.profile.handle, evidence.roles, axisCatalog(evidence.roles), evidenceJson),
    ]);
    if (found && found.length) {
      evidence.contradictions = found;
      const worst = found.some((c) => c.severity === "high") ? "bad" : "warn";
      emit({ phase: "Contradictions", label: `${found.length} contradiction${found.length === 1 ? "" : "s"}`, detail: found.slice(0, 3).map((c) => `${c.claim} vs ${c.conflict}`).join(" · "), source: "claude", tone: worst });
    } else {
      emit({ phase: "Contradictions", label: "None found", detail: "No internal contradictions surfaced across the subject's claims and the evidence.", source: "claude", tone: "good" });
    }
    if (verdict) {
      evidence.axes = verdict.axes;
      evidence.headline = verdict.headline || evidence.headline;
      if (verdict.identity_note) evidence.profile.identity_note = verdict.identity_note;
      emit({ phase: "Analyst", label: "Scored", detail: `${verdict.axes.length} axes scored.`, source: "claude", tone: "good" });
    } else {
      emit({ phase: "Analyst", label: "Fell back", detail: "Analyst unavailable; using seeded axis scores.", tone: "warn" });
    }
  }

  // nothing to score on -> can't produce a verdict
  if (!evidence.axes.length && !fixture) {
    emit({ phase: "Finalize", label: "Incomplete", detail: "Not enough evidence to score this subject.", tone: "warn" });
    return null;
  }

  emit({ phase: "Finalize", label: "Govern composite", detail: "Applying caps and selecting the governing role.", tone: "neutral" });
  await delay(300);
  return assembleDossier(evidence, true);
}
