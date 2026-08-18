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

export interface DossierReceipt {
  passage: string;
  sourceLabel: string;
  url: string;
  /** [what happened, when] — "never" marks a step the record does not contain. */
  chain: Array<[string, string]>;
}

export interface DossierFigure {
  label: string;
  value: string;
  provenance: ProvenanceState;
  receipt: DossierReceipt | null;
  /** Set when a fact's own sources never bind it to the audited subject. */
  unboundNote: string | null;
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

export interface TeamMember { name: string; role: string; handle: string | null; firstParty: boolean }

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
  cost: { usd: number | null; estimated: boolean } | null;
  beats: DossierBeat[];
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
  sources?: Array<{ url?: unknown; title?: unknown; excerpt?: unknown; capturedAt?: unknown; sourceClass?: unknown; artifactVerified?: unknown; relation?: unknown }>;
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
function bindingNote(fact: RawFact, subject: { handle: string; name: string; website: string | null }): string | null {
  const supporting = arr<NonNullable<RawFact["sources"]>[number]>(fact.sources)
    .filter((s) => str(s.relation) === "" || str(s.relation) === "supports");
  if (!supporting.length) return null;
  const host = (() => { try { return subject.website ? new URL(subject.website).hostname.replace(/^www\./, "") : "" } catch { return "" } })();
  const needles = [subject.handle.replace(/^@/, ""), host].map((n) => n.toLowerCase()).filter(Boolean);
  const bound = supporting.some((s) => {
    const hay = `${str(s.url)} ${str(s.title)} ${str(s.excerpt)}`.toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
  if (bound) return null;
  const hosts = [...new Set(supporting.map((s) => { try { return new URL(str(s.url)).hostname.replace(/^www\./, "") } catch { return "" } }).filter(Boolean))];
  return `${supporting.length} source${supporting.length === 1 ? "" : "s"} on ${hosts.join(", ") || "an external host"}, none naming this subject`;
}

function receiptFor(fact: RawFact, unbound: string | null): DossierReceipt | null {
  const s = arr<NonNullable<RawFact["sources"]>[number]>(fact.sources)[0];
  if (!s || !str(s.url)) return null;
  const chain: Array<[string, string]> = [["Fetched and hashed", clock(s.capturedAt)]];
  if (s.artifactVerified === true) chain.push(["Artifact verified", clock(s.capturedAt)]);
  chain.push(["Bound to this subject", unbound ? "never" : clock(s.capturedAt)]);
  return {
    passage: str(s.excerpt) || "No passage was recorded for this source.",
    sourceLabel: `${(() => { try { return new URL(str(s.url)).hostname.replace(/^www\./, "") } catch { return "source" } })()} · ${str(s.sourceClass) || "unclassified"}`,
    url: str(s.url),
    chain,
  };
}

/**
 * A heading is the report's own sentence about this beat, not a tally of it.
 *
 * The check ledger already writes readable prose — "Posting steady (~2.0d gap,
 * last post 12d ago)" — and an earlier pass here discarded all of it in favour
 * of "2 confirmed, 1 still open", which is accurate and communicates nothing. A
 * reader cannot act on a count. Prefer the confirmed check's note, fall back to
 * the open one, and only tally when the report recorded no sentence at all.
 */
function headingFor(checks: RawCheck[], figures: DossierFigure[]): string {
  const unbound = figures.filter((f) => f.unboundNote);
  if (unbound.length) {
    return unbound.length === 1
      ? `${unbound[0].value} belongs to someone else.`
      : `${unbound.length} of ${figures.length} records here name a different subject.`;
  }

  const noteOf = (c: RawCheck) => str(c.note);
  const confirmed = checks.filter((c) => str(c.status) === "confirmed" && noteOf(c));
  const open = checks.filter((c) => ["unknown", "unavailable", "checked-empty"].includes(str(c.status)));
  const lead = confirmed[0] ?? checks.find(noteOf);
  if (lead) {
    const sentence = noteOf(lead).split(" · ")[0].trim();
    const tidy = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    // Capitalise, because the ledger writes fragments as often as sentences.
    const shown = tidy.charAt(0).toUpperCase() + tidy.slice(1);
    const tail = open.length === 1 ? "1 question remains open." : `${open.length} questions remain open.`;
    return open.length ? `${shown} ${tail}` : shown;
  }

  // No check wrote a sentence, so a tally is the most that can honestly be said.
  const confirmedCount = checks.filter((c) => str(c.status) === "confirmed").length;
  if (!checks.length && !figures.length) return "Nothing was recorded for this section.";
  if (confirmedCount && open.length) return `${confirmedCount} confirmed, ${open.length} still open.`;
  if (confirmedCount) return `${confirmedCount} check${confirmedCount === 1 ? "" : "s"} confirmed, none open.`;
  if (open.length) return `${open.length} check${open.length === 1 ? "" : "s"} open, none confirmed.`;
  return `${figures.length} record${figures.length === 1 ? "" : "s"} on file.`;
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
  const verdict = {
    call: str(report.verdict) || "UNKNOWN",
    score: num(report.score_total),
    headline: str(payload.headline) || null,
  };

  const facts = arr<RawFact>(payload.basicFacts);
  const checks = arr<RawCheck>(payload.checkRuns).filter((c) => str(c.status) !== "not-applicable");
  const leads = arr<unknown>(payload.basicFactLeads);
  const failures = arr<unknown>(payload.providerFailures);

  const figuresByBeat = new Map<string, DossierFigure[]>();
  for (const fact of facts) {
    const predicate = str(fact.predicate);
    const beatId = FACT_BEAT[predicate] ?? "coverage";
    const unboundNote = bindingNote(fact, subject);
    const declared = provenanceForBasicFactStatus(str(fact.status) as never);
    // An unbound fact cannot be sourced regardless of what the ledger declared.
    const provenance: ProvenanceState = unboundNote ? { tier: "unestablished" } : (declared ?? { tier: "derived" });
    const list = figuresByBeat.get(beatId) ?? [];
    list.push({
      label: predicate.replace(/_/g, " "),
      value: str(fact.value) || EMPTY_VALUE,
      provenance,
      receipt: receiptFor(fact, unboundNote),
      unboundNote,
    });
    figuresByBeat.set(beatId, list);
  }

  const claimed = new Set(BEAT_CHECKS.flatMap((b) => b.checks));
  const beats: DossierBeat[] = [];

  for (const spec of BEAT_CHECKS) {
    // Ordered by the beat's own priority so the heading quotes the check that
    // defines the beat, not whichever the payload happened to list first.
    const mine = spec.checks
      .map((id) => checks.find((c) => str(c.checkId) === id))
      .filter((c): c is RawCheck => Boolean(c));
    const figures = figuresByBeat.get(spec.id) ?? [];
    if (!mine.length && !figures.length) continue;
    beats.push({
      id: spec.id, label: spec.label, kicker: spec.kicker,
      heading: headingFor(mine, figures),
      figures,
    });
  }

  // Everything the named beats did not claim, plus leads and provider failures.
  const leftover = checks.filter((c) => !claimed.has(str(c.checkId)));
  const coverageFigures = figuresByBeat.get("coverage") ?? [];
  const openCount = leftover.filter((c) => ["unknown", "unavailable", "checked-empty"].includes(str(c.status))).length;
  beats.push({
    id: "coverage", label: "What is unresolved", kicker: "Coverage",
    heading: [
      leads.length ? `${leads.length} lead${leads.length === 1 ? "" : "s"}` : "",
      openCount ? `${openCount} open check${openCount === 1 ? "" : "s"}` : "",
      failures.length ? `${failures.length} provider${failures.length === 1 ? "" : "s"} that never answered` : "",
    ].filter(Boolean).join(", ") + "." || "Nothing outstanding.",
    figures: [
      ...coverageFigures,
      ...leftover.filter((c) => str(c.status) !== "confirmed").map((c): DossierFigure => ({
        label: str(c.label),
        value: str(c.note) || str(c.status),
        provenance: provenanceForCheckStatus(str(c.status) as never) ?? { tier: "unestablished" },
        receipt: null,
        unboundNote: null,
      })),
    ],
  });

  beats.push({
    id: "verdict", label: "The call", kicker: "Verdict",
    heading: verdict.score === null ? verdict.call : `${verdict.call} · ${verdict.score}/100`,
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
    team: arr<Record<string, unknown>>(payload.webTeamLeads).map((m) => ({
      name: str(m.name), role: str(m.role),
      handle: str(m.handle) || null,
      // A role the official account itself stated is first-party; a web search is not.
      firstParty: /post role-scan|official/i.test(str(m.source)),
    })).filter((m) => m.name),
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
    openQuestions: arr<Record<string, unknown>>((payload.intelligence as Record<string, unknown>)?.signals)
      .filter((sig) => str(sig.kind) === "coverage_gap")
      .map((sig) => str(sig.finding))
      .filter(Boolean),
    cost: num((payload.cost as Record<string, unknown>)?.usd) === null ? null : {
      usd: num((payload.cost as Record<string, unknown>).usd),
      estimated: (payload.cost as Record<string, unknown>).estimated === true,
    },
    beats,
  };
}
