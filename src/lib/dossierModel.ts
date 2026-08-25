// Derives the interactive-dossier structure from a frozen report payload, so a
// report narrates itself instead of being narrated by hand
// (docs/REPORT-EXPERIENCE-BRIEF-2026-08-17.md, step 4).
//
// Every heading here is built from counts and recorded states. Nothing is
// inferred, characterised, or editorialised: if the payload does not establish
// something, the beat says how many things are open rather than guessing what
// they mean. That constraint is the point — a narrative layer is exactly where a
// report would otherwise acquire a confident sentence its evidence cannot carry.

import {
  provenanceForBasicFactStatus,
  provenanceForCheckStatus,
  type ProvenanceState,
} from "./provenance";
import type { EntityLedgerRow, EntityScorecard } from "../intelligence/entityScorecards";
import { teamIdentityKeys } from "./teamIdentity";

export interface DossierReceiptSource {
  url: string;
  sourceLabel: string;
  passage: string;
  /** ISO timestamp if the record has one. Never invented. */
  capturedAt: string | null;
}

export interface DossierReceipt {
  passage: string;
  sourceLabel: string;
  url: string;
  /** [what happened, when] — "never" is a bind state, not a clock. */
  chain: Array<[string, string]>;
  /** Every supporting source, bound document first. */
  sources: DossierReceiptSource[];
}

export interface DossierSourceRow {
  url: string;
  /** hostname · class */
  label: string;
  factsCited: number;
  /** Display clock from the latest recorded capturedAt, or null. */
  lastCaptured: string | null;
  citedLabels: string[];
  /** False when every citing figure is unbound. */
  established: boolean;
}

export interface DossierFigure {
  label: string;
  value: string;
  provenance: ProvenanceState;
  receipt: DossierReceipt | null;
  /** Set when a fact's own sources never bind it to the audited subject. */
  unboundNote: string | null;
  /** Paid/locked module that has not run. Never a provenance tier. */
  locked?: boolean;
}

export interface DossierBeat {
  id: string;
  label: string;
  kicker: string;
  heading: string;
  figures: DossierFigure[];
}

export interface StrengthBand {
  axis: string;
  label: string;
  tier: string;
  minScore: number;
  maxScore: number;
  reasons: string[];
}

export interface CoverageStat { state: string; count: number }

export interface TeamProfileLink {
  provider: "x" | "linkedin" | "github" | "huggingface";
  label: string;
  url: string;
}

export interface TeamMember {
  name: string;
  role: string;
  handle: string | null;
  /** Identity-bound public profiles preserved by the frozen team record. */
  profiles: TeamProfileLink[];
  /** True only when the subject's own account named this person. */
  firstParty: boolean;
  /**
   * Present only for a first-party named person. A face attached to a handle
   * nobody confirmed is the namesake error wearing a photograph, so an
   * unconfirmed member stays deliberately bare even if an image is available.
   */
  avatarUrl: string | null;
  avatarCapturedAt: string | null;
  /** True only when a fetched artifact independently verified this person. */
  independentlyConfirmed: boolean;
}

export interface Lens {
  id: string;
  label: string;
  question: string;
  /** Findings this reader should care about, in the report's own words. */
  findings: string[];
}

export interface KeyMeasure { label: string; value: string; unit: string; domain: string }

export interface PressClaim { outlet: string; verified: boolean; url: string | null }

export interface Dossier {
  subject: {
    handle: string; name: string; joined: string | null; followers: string | null;
    website: string | null; avatarUrl: string | null; bio: string | null;
    avatarNote: string | null;
  };
  verdict: { call: string; score: number | null; headline: string | null };
  timeline: Array<{ label: string; when: string; detail: string | null }>;
  strengthBands: StrengthBand[];
  coverage: { checks: CoverageStat[]; questionsAnswered: number; questionsTotal: number; leads: number; failedProviders: string[] };
  team: TeamMember[];
  nextActions: Array<{ rank: number; action: string; whyNow: string | null }>;
  links: Array<{ label: string; url: string }>;
  pressClaims: PressClaim[];
  openQuestions: string[];
  lenses: Lens[];
  measures: KeyMeasure[];
  entityScorecards: EntityScorecard[];
  entityLedger: EntityLedgerRow[];
  cost: { usd: number | null; estimated: boolean } | null;
  beats: DossierBeat[];
  /** Recorded documents only, sorted by how many dossier figures cite them. */
  sources: DossierSourceRow[];
}

const AXIS_LABELS: Record<string, string> = {
  P1_team_and_identity: "Team & identity",
  P2_product_substance: "Product substance",
  P3_token_conduct: "Token conduct",
  P4_backing_and_partners: "Backing & partners",
  P5_traction_and_liveness: "Traction & liveness",
  P6_transparency_integrity: "Transparency & integrity",
};

/** Which checks speak to which beat. Unlisted checks fall to the coverage beat. */
const BEAT_CHECKS: Array<{ id: string; label: string; kicker: string; checks: string[] }> = [
  { id: "subject", label: "The subject", kicker: "Identity", checks: ["identity-resolution", "identity-continuity", "profile-photo-authenticity"] },
  { id: "team", label: "Who is behind it", kicker: "Team", checks: ["project-team-identity", "project-leadership-currency", "affiliations-associates"] },
  { id: "product", label: "What is built", kicker: "Product", checks: ["project-product-substance", "code-footprint-github", "project-transparency"] },
  { id: "perimeter", label: "The perimeter", kicker: "Entity and screening", checks: ["organization-registration", "organization-sanctions"] },
  { id: "activity", label: "Signs of life", kicker: "Traction", checks: ["project-traction-liveness", "project-backing-partners", "news-press"] },
];

const FACT_BEAT: Record<string, string> = {
  official_identity: "subject",
  founder: "team", executive: "team",
  product: "product", repository: "product", audit: "product", network: "product",
  legal_entity: "perimeter", legal_regulatory_event: "perimeter", public_security: "perimeter",
  funding: "activity", investor: "activity", traction: "activity",
  official_token: "coverage", tokenomics: "coverage", control: "coverage", governance: "coverage",
};

interface RawFact {
  predicate?: unknown; value?: unknown; status?: unknown;
  providerProjection?: unknown;
  sources?: Array<{ url?: unknown; title?: unknown; excerpt?: unknown; capturedAt?: unknown; sourceClass?: unknown; artifactVerified?: unknown; relation?: unknown; provider?: unknown }>;
}
interface RawCheck { checkId?: unknown; label?: unknown; status?: unknown; note?: unknown; decisionCritical?: unknown }

/** Placeholder for a fact with no recorded value. */
const EMPTY_VALUE = "not recorded";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clock = (iso: unknown): string => {
  const s = str(iso);
  const m = s.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : s.slice(0, 10);
};

const sourceHost = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/**
 * Aggregator pages are namesake indexes (defillama.com/protocol/{name}). A slug
 * or excerpt that repeats the display name is the Dynex Capital collision, not a
 * unique-id bind. Funding facts therefore cannot bind through these sources.
 */
function isAggregatorSource(s: { url?: unknown; provider?: unknown }): boolean {
  const provider = str(s.provider);
  const host = sourceHost(str(s.url));
  return provider === "defillama" || provider === "monid" || host === "defillama.com";
}

function looksLikeAggregatorFundingValue(value: string): boolean {
  return /\$[\d,.]+/.test(value) || /\bled by\b/i.test(value) || /\bpublic funding rounds\b/i.test(value);
}

/**
 * A fact is bound when at least one supporting source names an identifier that
 * is unique to the subject — its handle or its own site host.
 *
 * The display name is deliberately NOT a binding needle. The display name is the
 * collision vector: "Dynex Capital, Inc." contains "Dynex", so accepting the bare
 * name as evidence of binding would ratify precisely the namesake match this
 * exists to catch. An earlier draft of this function did exactly that and passed
 * the SEC filings as bound. Retrieval proves a page says a sentence; only a
 * unique identifier proves the sentence is about this subject.
 */
type RawSource = NonNullable<RawFact["sources"]>[number];

function supportingSources(fact: RawFact): RawSource[] {
  return arr<RawSource>(fact.sources).filter((s) => {
    const rel = str(s.relation);
    return (rel === "" || rel === "supports") && Boolean(str(s.url));
  });
}

function sourceBindsToSubject(
  s: RawSource,
  fact: RawFact,
  subject: { handle: string; website: string | null },
): boolean {
  // Aggregator funding is namesake-indexed. A /protocol/uniswap slug is not
  // unique-id evidence that the raised figure or "led by" names this subject.
  if (str(fact.predicate) === "funding" && isAggregatorSource(s)) return false;
  const host = sourceHost(subject.website ?? "");
  const needles = [subject.handle.replace(/^@/, ""), host].map((n) => n.toLowerCase()).filter(Boolean);
  const hay = `${str(s.url)} ${str(s.title)} ${str(s.excerpt)}`.toLowerCase();
  return needles.some((n) => hay.includes(n));
}

function sourceLabelOf(s: RawSource): string {
  return `${sourceHost(str(s.url)) || "source"} · ${str(s.sourceClass) || "unclassified"}`;
}

function sourceDocumentKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return url;
  }
}

function bindingNote(fact: RawFact, subject: { handle: string; name: string; website: string | null }): string | null {
  const supporting = supportingSources(fact);
  if (!supporting.length) return null;
  const bound = supporting.some((s) => sourceBindsToSubject(s, fact, subject));
  if (bound) return null;
  const hosts = [...new Set(supporting.map((s) => sourceHost(str(s.url))).filter(Boolean))];
  return `${supporting.length} source${supporting.length === 1 ? "" : "s"} on ${hosts.join(", ") || "an external host"}, none naming this subject`;
}

function receiptFor(
  fact: RawFact,
  unbound: string | null,
  subject: { handle: string; website: string | null },
): DossierReceipt | null {
  const supporting = supportingSources(fact);
  if (!supporting.length) return null;
  const ordered = [...supporting].sort((a, b) => {
    const av = sourceBindsToSubject(a, fact, subject) ? 0 : 1;
    const bv = sourceBindsToSubject(b, fact, subject) ? 0 : 1;
    return av - bv;
  });
  const primary = ordered[0];
  const chain: Array<[string, string]> = [];
  const fetched = clock(primary.capturedAt);
  if (fetched) chain.push(["Fetched", fetched]);
  // Bind state is recorded, not a second copy of capturedAt.
  chain.push(["Bound to this subject", unbound ? "never" : "recorded"]);
  return {
    passage: str(primary.excerpt) || "No passage was recorded for this source.",
    sourceLabel: sourceLabelOf(primary),
    url: str(primary.url),
    chain,
    sources: ordered.map((s) => ({
      url: str(s.url),
      sourceLabel: sourceLabelOf(s),
      passage: str(s.excerpt) || "No passage was recorded for this source.",
      capturedAt: str(s.capturedAt) || null,
    })),
  };
}

function collectSourceRows(figures: DossierFigure[]): DossierSourceRow[] {
  type Acc = {
    url: string;
    className: string;
    citedLabels: string[];
    latestIso: string | null;
    established: boolean;
  };
  const groups = new Map<string, Acc>();
  for (const fig of figures) {
    const rec = fig.receipt;
    if (!rec) continue;
    const listed = rec.sources.length > 0
      ? rec.sources
      : [{ url: rec.url, sourceLabel: rec.sourceLabel, passage: rec.passage, capturedAt: null }];
    const seen = new Set<string>();
    for (const s of listed) {
      if (!s.url) continue;
      const key = sourceDocumentKey(s.url);
      if (seen.has(key)) continue;
      seen.add(key);
      const cls = s.sourceLabel.includes(" · ")
        ? s.sourceLabel.split(" · ").slice(1).join(" · ")
        : "unclassified";
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          url: s.url,
          className: cls,
          citedLabels: [fig.label],
          latestIso: s.capturedAt,
          established: !fig.unboundNote,
        });
        continue;
      }
      existing.citedLabels.push(fig.label);
      if (s.capturedAt && (!existing.latestIso || s.capturedAt > existing.latestIso)) {
        existing.latestIso = s.capturedAt;
        existing.url = s.url;
      }
      if (!fig.unboundNote) existing.established = true;
    }
  }
  return [...groups.values()]
    .map((g) => {
      const display = g.latestIso ? clock(g.latestIso) : "";
      return {
        url: g.url,
        label: `${sourceHost(g.url) || "source"} · ${g.className}`,
        factsCited: g.citedLabels.length,
        lastCaptured: display || null,
        citedLabels: g.citedLabels,
        established: g.established,
      };
    })
    .sort((a, b) => b.factsCited - a.factsCited || a.label.localeCompare(b.label));
}

/**
 * A heading is two short sentences built only from recorded counts and states.
 * Check notes stay in the ledger: quoting them here reprints engine jargon
 * ("Posting steady (~2.0d gap)") as if it were the report's voice. A tally
 * like "2 confirmed, 1 still open" is accurate and tells a reader nothing
 * they can act on. Display name is never a bind key and never appears here.
 */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function auditedHandle(handle: string): string {
  const h = handle.trim();
  if (!h || h === "unknown") return "the subject";
  return h.startsWith("@") ? h : `@${h}`;
}

function namedRoleLabel(named: TeamMember[]): { count: number; one: string; many: string } {
  if (named.length === 1 && /founder/i.test(named[0].role)) {
    return { count: 1, one: "founder", many: "founders" };
  }
  if (named.length > 0 && named.every((m) => /founder/i.test(m.role))) {
    return { count: named.length, one: "founder", many: "founders" };
  }
  return { count: named.length, one: "person", many: "people" };
}

function unboundHeading(figures: DossierFigure[]): string | null {
  const unbound = figures.filter((f) => f.unboundNote);
  if (!unbound.length) return null;
  if (unbound.length === 1 && !looksLikeAggregatorFundingValue(unbound[0].value)) {
    return `${unbound[0].value} belongs to someone else.`;
  }
  return `${unbound.length} of ${figures.length} records here name a different subject.`;
}

function headingFor(
  beatId: string,
  figures: DossierFigure[],
  ctx: {
    subject: { handle: string; website: string | null };
    team: TeamMember[];
    leadCount: number;
    openCheckCount: number;
    verdict: { call: string; score: number | null };
  },
): string {
  if (beatId === "subject") {
    const who = auditedHandle(ctx.subject.handle);
    const first = who === "the subject"
      ? "This is the subject we audited."
      : `This is the ${who} we audited.`;
    const site = ctx.subject.website ? "The site is bound." : "No official site is bound.";
    return `${first} ${site}`;
  }

  if (beatId === "team") {
    const named = ctx.team.filter((m) => m.firstParty);
    const confirmed = ctx.team.filter((m) => m.independentlyConfirmed);
    const role = namedRoleLabel(named);
    const first = named.length === 0
      ? "The project named nobody."
      : `The project named ${plural(role.count, role.one, role.many)}.`;
    const second = confirmed.length === 0
      ? (named.length === 1 ? "Nobody else confirmed them." : "Nobody is independently confirmed.")
      : confirmed.length === 1
        ? "1 is independently confirmed."
        : `${confirmed.length} are independently confirmed.`;
    return `${first} ${second}`;
  }

  if (beatId === "product") {
    const products = figures.filter((f) => f.label === "product" && !f.unboundNote);
    const repos = figures.filter((f) => f.label === "repository" && !f.unboundNote);
    const parts: string[] = [];
    if (products.length) parts.push(`${plural(products.length, "product is", "products are")} on file.`);
    if (repos.length) parts.push(`${plural(repos.length, "repository is", "repositories are")} on file.`);
    if (parts.length) return parts.join(" ");
    return unboundHeading(figures) ?? "No product or repository is recorded.";
  }

  if (beatId === "activity") {
    const boundFunding = figures.filter((f) => f.label === "funding" && !f.unboundNote);
    const boundTraction = figures.filter((f) => f.label === "traction" && !f.unboundNote);
    const boundInvestor = figures.filter((f) => f.label === "investor" && !f.unboundNote);
    const parts: string[] = [];
    if (boundTraction.length) {
      parts.push(`${plural(boundTraction.length, "traction record is", "traction records are")} on file.`);
    }
    if (boundFunding.length) {
      parts.push(`${plural(boundFunding.length, "funding record is", "funding records are")} bound to this subject.`);
    } else {
      parts.push("No bound funding is on file.");
    }
    if (boundInvestor.length) {
      parts.push(`${plural(boundInvestor.length, "investor is", "investors are")} bound to this subject.`);
    }
    return parts.join(" ");
  }

  if (beatId === "perimeter") {
    const bound = figures.filter((f) => !f.unboundNote);
    const unbound = figures.filter((f) => f.unboundNote);
    if (unbound.length && !bound.length) return unboundHeading(figures) ?? "No legal entity is recorded.";
    if (bound.length && unbound.length) {
      return `${plural(bound.length, "record is", "records are")} bound to this subject. ${unbound.length} name a different subject.`;
    }
    if (bound.length) return `${plural(bound.length, "record is", "records are")} bound to this subject.`;
    return "No legal entity is recorded.";
  }

  if (beatId === "coverage") {
    const researchCopy = ctx.openCheckCount === 0
      ? "No research questions still need evidence."
      : plural(
        ctx.openCheckCount,
        "research question still needs evidence",
        "research questions still need evidence",
      );
    return `${plural(ctx.leadCount, "lead", "leads")}. ${researchCopy}`.replace(/\.?$/, ".");
  }

  if (beatId === "verdict") {
    return ctx.verdict.score === null ? ctx.verdict.call : `${ctx.verdict.call} · ${ctx.verdict.score}/100`;
  }

  return unboundHeading(figures)
    ?? (figures.length ? `${plural(figures.length, "record is", "records are")} on file.` : "Nothing was recorded for this section.");
}


function collectTeam(payload: Record<string, unknown>): TeamMember[] {
  // Union collector leads with grounded webTeam rows the leads list may
  // omit. firstParty is only the durable marker — never inferred from a
  // display name, a face, or the word "official". Independently confirmed
  // is artifact_verified, a separate bar from first-party naming.
  const rows = [
    ...arr<Record<string, unknown>>(payload.webTeamLeads),
    ...arr<Record<string, unknown>>(payload.webTeam),
  ];
  const indexByIdentity = new Map<string, number>();
  const team: TeamMember[] = [];

  const normalizedProfileUrl = (
    provider: TeamProfileLink["provider"],
    offered: string,
  ): TeamProfileLink | null => {
    const candidate = /^https?:\/\//i.test(offered) ? offered : `https://${offered}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      const allowed = provider === "linkedin"
        ? host === "linkedin.com" && /^\/in\/[A-Za-z0-9_%.-]+\/?$/i.test(parsed.pathname)
        : provider === "github"
          ? host === "github.com" && /^\/[A-Za-z0-9-]+\/?$/i.test(parsed.pathname)
          : provider === "huggingface"
            ? host === "huggingface.co" && /^\/[A-Za-z0-9_.-]+\/?$/i.test(parsed.pathname)
            : false;
      if (!allowed) return null;
      parsed.hash = "";
      parsed.search = "";
      parsed.pathname = parsed.pathname.replace(/\/$/, "");
      return {
        provider,
        label: provider === "linkedin" ? "LinkedIn" : provider === "github" ? "GitHub" : "Hugging Face",
        url: parsed.toString().replace(/\/$/, ""),
      };
    } catch {
      return null;
    }
  };

  const profileLinks = (member: Record<string, unknown>): TeamProfileLink[] => {
    const links: TeamProfileLink[] = [];
    const handle = str(member.handle).replace(/^@/, "");
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      links.push({ provider: "x", label: "X", url: `https://x.com/${handle}` });
    }
    const linkedin = normalizedProfileUrl("linkedin", str(member.linkedin));
    if (linkedin) links.push(linkedin);

    const github = (member.github ?? {}) as Record<string, unknown>;
    if (str(github.confidence) === "gold") {
      const profile = normalizedProfileUrl("github", `github.com/${str(github.login)}`);
      if (profile) links.push(profile);
    }
    for (const profile of arr<Record<string, unknown>>(member.developerProfiles)) {
      const provider = str(profile.provider);
      if (provider !== "github" && provider !== "huggingface") continue;
      const normalized = normalizedProfileUrl(provider, str(profile.url));
      if (normalized) links.push(normalized);
    }
    return [...new Map(links.map((link) => [`${link.provider}:${link.url.toLowerCase()}`, link])).values()];
  };

  for (const m of rows) {
    const name = str(m.name);
    if (!name) continue;
    const firstParty = str(m.handleProvenance) === "subject_first_party";
    const candidate: TeamMember = {
      name,
      role: str(m.role),
      handle: str(m.handle) || null,
      profiles: profileLinks(m),
      firstParty,
      avatarUrl: firstParty ? str(m.avatarUrl) || null : null,
      avatarCapturedAt: firstParty ? str(m.avatarCapturedAt) || null : null,
      independentlyConfirmed: m.artifact_verified === true || m.artifactVerified === true,
    };
    const identityKeys = teamIdentityKeys(candidate);
    const existingIndex = identityKeys
      .map((key) => indexByIdentity.get(key))
      .find((index): index is number => index !== undefined);
    if (existingIndex === undefined) {
      team.push(candidate);
      for (const key of identityKeys) indexByIdentity.set(key, team.length - 1);
      continue;
    }

    const existing = team[existingIndex];
    const preferred = candidate.firstParty && !existing.firstParty ? candidate : existing;
    const secondary = preferred === existing ? candidate : existing;
    const merged: TeamMember = {
      ...preferred,
      handle: preferred.handle ?? secondary.handle,
      role: preferred.role || secondary.role,
      firstParty: preferred.firstParty || secondary.firstParty,
      independentlyConfirmed: preferred.independentlyConfirmed || secondary.independentlyConfirmed,
      avatarUrl: preferred.avatarUrl ?? secondary.avatarUrl,
      avatarCapturedAt: preferred.avatarCapturedAt ?? secondary.avatarCapturedAt,
      profiles: [...new Map(
        [...preferred.profiles, ...secondary.profiles]
          .map((link) => [`${link.provider}:${link.url.toLowerCase()}`, link]),
      ).values()],
    };
    team[existingIndex] = merged;
    for (const key of [...identityKeys, ...teamIdentityKeys(merged)]) {
      indexByIdentity.set(key, existingIndex);
    }
  }
  return team;
}

export function buildDossier(payload: Record<string, unknown>): Dossier {
  const subject = {
    handle: str(payload.handle) || "unknown",
    name: str(payload.display_name) || str(payload.handle) || "Unknown",
    joined: str(payload.joined) || null,
    followers: str(payload.followers) || null,
    website: str(payload.website) || null,
  };
  const report = (payload.report ?? {}) as Record<string, unknown>;
  // Live AuditReport stores both pairs. The dynex fixture only has
  // verdict / score_total. Prefer those; fall back to the composite fields
  // so a production dossier is not UNKNOWN when only the live names exist.
  const verdict = {
    call: str(report.verdict) || str(report.composite_verdict) || "UNKNOWN",
    score: num(report.score_total) ?? num(report.governing_score),
    headline: str(payload.headline) || null,
  };

  const facts = arr<RawFact>(payload.basicFacts);
  const checks = arr<RawCheck>(payload.checkRuns).filter((c) => str(c.status) !== "not-applicable");
  const leads = arr<unknown>(payload.basicFactLeads);

  const figuresByBeat = new Map<string, DossierFigure[]>();
  for (const fact of facts) {
    const predicate = str(fact.predicate);
    const beatId = FACT_BEAT[predicate] ?? "coverage";
    const unboundNote = bindingNote(fact, subject);
    // Aggregator/namesake funding that is not unique-id bound must not print as
    // a raised figure or "led by". Skip the figure; provenance/unboundNote
    // would still reprint the same sentence if we kept the value.
    if (
      predicate === "funding"
      && unboundNote
      && (
        fact.providerProjection === true
        || arr<NonNullable<RawFact["sources"]>[number]>(fact.sources).some(isAggregatorSource)
        || looksLikeAggregatorFundingValue(str(fact.value))
      )
    ) continue;
    const declared = provenanceForBasicFactStatus(str(fact.status) as never);
    // An unbound fact cannot be sourced regardless of what the ledger declared.
    const provenance: ProvenanceState = unboundNote ? { tier: "unestablished" } : (declared ?? { tier: "derived" });
    const list = figuresByBeat.get(beatId) ?? [];
    list.push({
      label: predicate.replace(/_/g, " "),
      value: str(fact.value) || EMPTY_VALUE,
      provenance,
      receipt: receiptFor(fact, unboundNote, subject),
      unboundNote,
    });
    figuresByBeat.set(beatId, list);
  }

  const team = collectTeam(payload);
  const claimed = new Set(BEAT_CHECKS.flatMap((b) => b.checks));
  const leftover = checks.filter((c) => !claimed.has(str(c.checkId)));
  // checked-empty is a completed search with no result, not unfinished work.
  // Calling it "open" contradicted the canonical required-check counter on
  // otherwise complete reports such as SuperGemma.
  const openCount = leftover.filter((c) => ["unknown", "unavailable", "stale"].includes(str(c.status))).length;
  const headingCtx = {
    subject,
    team,
    leadCount: leads.length,
    openCheckCount: openCount,
    verdict,
  };
  const beats: DossierBeat[] = [];

  for (const spec of BEAT_CHECKS) {
    const mine = spec.checks
      .map((id) => checks.find((c) => str(c.checkId) === id))
      .filter((c): c is RawCheck => Boolean(c));
    const figures = figuresByBeat.get(spec.id) ?? [];
    if (!mine.length && !figures.length) continue;
    beats.push({
      id: spec.id, label: spec.label, kicker: spec.kicker,
      heading: headingFor(spec.id, figures, headingCtx),
      figures,
    });
  }

  // Everything the named beats did not claim. Headings use lead + open counts
  // only; leftover check notes stay on the figure, never in the sentence.
  const coverageFigures = figuresByBeat.get("coverage") ?? [];
  beats.push({
    id: "coverage", label: "What is unresolved", kicker: "Coverage",
    heading: headingFor("coverage", coverageFigures, headingCtx),
    figures: [
      ...coverageFigures,
      ...leftover.filter((c) => str(c.status) !== "confirmed").map((c): DossierFigure => ({
        label: str(c.label),
        value: str(c.note) || str(c.status) || EMPTY_VALUE,
        provenance: provenanceForCheckStatus(str(c.status) as never) ?? { tier: "unestablished" },
        receipt: null,
        unboundNote: null,
      })),
    ],
  });

  beats.push({
    id: "verdict", label: "The call", kicker: "Verdict",
    heading: headingFor("verdict", [], headingCtx),
    figures: [],
  });

  const bands = (payload.projectStrengthBands ?? {}) as Record<string, Record<string, unknown>>;
  const strengthBands: StrengthBand[] = Object.entries(bands)
    .map(([axis, band]) => ({
      axis,
      label: AXIS_LABELS[axis] ?? axis.replace(/^P\d_/, "").replace(/_/g, " "),
      tier: str(band?.tier) || "unknown",
      minScore: num(band?.minScore) ?? 0,
      maxScore: num(band?.maxScore) ?? 0,
      reasons: arr<unknown>(band?.reasons).map(str).filter(Boolean),
    }))
    .sort((a, b) => a.axis.localeCompare(b.axis));

  const counts = new Map<string, number>();
  for (const c of arr<RawCheck>(payload.checkRuns)) {
    const state = str(c.status) || "unknown";
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const ledger = arr<{ status?: unknown }>(payload.basicFactQuestionLedger);
  const domain = (payload.domainRegistration ?? {}) as Record<string, unknown>;
  const authenticity = (payload.profileAuthenticity ?? {}) as Record<string, unknown>;

  const timeline: Dossier["timeline"] = [];
  if (num(domain.ageMonths) !== null) {
    timeline.push({ label: "Domain registered", when: str(domain.registeredAt).slice(0, 10), detail: `${num(domain.ageMonths)} months old · ${str(domain.hostname)}` });
  }
  if (subject.joined) timeline.push({ label: "Account created", when: subject.joined, detail: null });
  const lastPost = str(payload.last_post_at);
  if (lastPost) {
    const days = num(payload.days_since_post);
    timeline.push({ label: "Last post", when: lastPost.slice(0, 10), detail: days === null ? null : `${days} days ago` });
  }

  return {
    subject: {
      ...subject,
      avatarUrl: str(payload.avatar_url) || null,
      bio: str(payload.bio) || null,
      avatarNote: str(authenticity.note) || null,
    },
    verdict,
    timeline,
    strengthBands,
    coverage: {
      checks: [...counts.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
      questionsAnswered: ledger.filter((q) => str(q.status) === "answered").length,
      questionsTotal: ledger.length,
      leads: leads.length,
      failedProviders: arr<{ provider?: unknown }>(payload.providerFailures).map((f) => str(f.provider)).filter(Boolean),
    },
    team,
    nextActions: arr<Record<string, unknown>>((payload.researchPlan as Record<string, unknown>)?.nextActions)
      .map((a) => ({ rank: num(a.rank) ?? 0, action: str(a.action), whyNow: str(a.whyNow) || null }))
      .filter((a) => a.action).sort((a, b) => a.rank - b.rank),
    links: [
      ...(subject.website ? [{ label: "Website", url: subject.website }] : []),
      ...(subject.handle && subject.handle !== "unknown" ? [{ label: "X", url: `https://x.com/${subject.handle.replace(/^@/, "")}` }] : []),
      ...arr<RawFact>(payload.basicFacts)
        .filter((f) => str(f.predicate) === "repository")
        .map((f) => ({ label: "Repository", url: `https://${str(f.value).replace(/^https?:\/\//, "")}` })),
    ],
    // Claimed coverage that no artifact confirms. Naming the outlet without the
    // caveat would lend a report the credibility of a masthead it never checked.
    pressClaims: arr<Record<string, unknown>>((payload.evidence as Record<string, unknown>)?.testimonials)
      .map((t): PressClaim => {
        const text = `${str(t.claimed_relationship)} ${str(t.notes)}`;
        const outlet = /bloomberg|forbes|fox business|reuters|coindesk|wsj|cnbc/i.exec(text)?.[0] ?? "";
        const url = /https?:\/\/[^\s)]+/.exec(text)?.[0] ?? null;
        return { outlet: outlet ? outlet[0].toUpperCase() + outlet.slice(1) : "", verified: t.artifact_verified === true, url };
      })
      .filter((c) => c.outlet),
    lenses: (() => {
      const intel = (payload.intelligence ?? {}) as Record<string, unknown>;
      const byId = new Map(arr<Record<string, unknown>>(intel.signals).map((sig) => [str(sig.id), str(sig.finding)]));
      return arr<Record<string, unknown>>(intel.lenses).map((l): Lens => ({
        id: str(l.id), label: str(l.label), question: str(l.question),
        findings: arr<unknown>(l.signalIds).map((sid) => byId.get(str(sid)) ?? "").filter(Boolean),
      })).filter((l) => l.id && l.findings.length);
    })(),
    // Every frozen measurement, grouped by domain in the UI. The band minima and
    // maxima also appear as ranges on the verdict chart; they are kept here too
    // because this is the measurement ledger, and a ledger that hides rows is a
    // summary pretending to be a record.
    measures: arr<Record<string, unknown>>((payload.intelligence as Record<string, unknown>)?.measurements)
      .map((m): KeyMeasure => ({
        label: str(m.label),
        value: String(m.value ?? ""),
        unit: str(m.unit),
        domain: str(m.domain) || "other",
      }))
      .filter((m) => m.label && m.value),
    entityScorecards: arr<EntityScorecard>((payload.intelligence as Record<string, unknown>)?.entityScorecards),
    entityLedger: arr<EntityLedgerRow>((payload.intelligence as Record<string, unknown>)?.entityLedger),
    openQuestions: arr<Record<string, unknown>>((payload.intelligence as Record<string, unknown>)?.signals)
      .filter((sig) => str(sig.kind) === "coverage_gap")
      .map((sig) => str(sig.finding))
      .filter(Boolean),
    cost: num((payload.cost as Record<string, unknown>)?.usd) === null ? null : {
      usd: num((payload.cost as Record<string, unknown>).usd),
      estimated: (payload.cost as Record<string, unknown>).estimated === true,
    },
    beats,
    sources: collectSourceRows(beats.flatMap((b) => b.figures)),
  };
}
