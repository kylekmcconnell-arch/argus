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
import { analystAvailable, analyzeSubject, extractClaims } from "./agent";

import { xAdapter, getProfile as xProfile, getRecentPosts, fmtFollowers, discoverAffiliations, discoverByMentions, followsSubject, type DiscoveredAffiliation } from "./adapters/x";
import { peopledatalabsAdapter } from "./adapters/peopledatalabs";
import { githubAdapter } from "./adapters/github";
import { crunchbaseAdapter } from "./adapters/crunchbase";
import { dexscreenerAdapter } from "./adapters/dexscreener";
import { coingeckoAdapter } from "./adapters/coingecko";
import { redditAdapter } from "./adapters/reddit";
import { onchainAdapter } from "./adapters/onchain";
import { archivedAffiliation } from "./adapters/wayback";

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
  const prof = await xProfile(ctx.handle);
  if (prof) {
    ctx.evidence.profile.display_name = prof.name ?? ctx.evidence.profile.display_name;
    ctx.evidence.profile.bio = prof.bio ?? "";
    if (prof.followers != null) ctx.evidence.profile.followers = fmtFollowers(prof.followers);
    if (prof.createdAt) {
      const d = new Date(prof.createdAt);
      if (!isNaN(d.getTime())) ctx.evidence.profile.joined = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    ctx.emit({ phase: "P0 · Intake", label: "Resolve profile", detail: `${prof.name ?? ctx.handle} · ${ctx.evidence.profile.followers} followers · joined ${ctx.evidence.profile.joined}`, source: "twitterapi.io", tone: "neutral" });
  } else {
    // Be honest about a missing profile (twitterapi 429 / not-found) instead of
    // silently rendering "— followers" — discovery below can still proceed.
    ctx.emit({ phase: "P0 · Intake", label: "Profile unavailable", detail: "Couldn't resolve this handle on twitterapi.io (rate-limited or not found). Continuing with web/X discovery.", source: "twitterapi.io", tone: "warn" });
  }
  const posts = await getRecentPosts(ctx.handle);
  if (posts.length) {
    ctx.evidence.recentActivity = posts;
    ctx.emit({ phase: "P0 · Intake", label: "Recent activity", detail: `Pulled ${posts.length} recent posts to mine for self-claims.`, source: "twitterapi.io", tone: "neutral" });
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
  ctx.emit({ phase: "P0 · Intake", label: "Discover affiliations", detail: "Two angles in parallel: what this person is tied to, AND who has ever named them as founder/team (incl. old posts)…", source: "grok", tone: "neutral" });
  // Two blind search angles run concurrently (each Grok call is 45s-capped, so
  // parallel keeps wall-clock to one). Subject-first finds what they claim/built;
  // reverse-mention finds projects whose OWN timeline named them — the angle that
  // catches a co-founder role the subject never tweeted about.
  const [bySubject, byMentions] = await Promise.all([
    discoverAffiliations(ctx.handle, ctx.evidence.profile.display_name),
    discoverByMentions(ctx.handle, ctx.evidence.profile.display_name),
  ]);
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
        try {
          if (v.domain) {
            const arch = await archivedAffiliation(v.domain, ctx.evidence.profile.display_name);
            if (arch) { corrob.push(`archived ${arch.where} page (${arch.year})`); rec.evidence_url = arch.url; }
          }
          if (v.x_handle) {
            const follows = await followsSubject(v.x_handle, ctx.handle);
            if (follows) corrob.push(`${v.x_handle} follows the subject`);
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

  // analyst scoring
  if (analystAvailable()) {
    emit({ phase: "Analyst", label: "Score axes", detail: "Claude analyst scoring every axis from the collected evidence…", tone: "neutral" });
    const evidenceJson = JSON.stringify(
      {
        profile: evidence.profile,
        ventures: evidence.ventures,
        testimonials: evidence.testimonials,
        advised: evidence.advised,
        promotions: evidence.promotions,
        wallets: evidence.wallets,
        findings: evidence.findings,
      },
      null,
      0,
    ).slice(0, 12000);
    const verdict = await analyzeSubject(evidence.profile.handle, evidence.roles, axisCatalog(evidence.roles), evidenceJson);
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
