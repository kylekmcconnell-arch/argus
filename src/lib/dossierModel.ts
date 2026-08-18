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

export interface Dossier {
  subject: { handle: string; name: string; joined: string | null; followers: string | null; website: string | null };
  verdict: { call: string; score: number | null; headline: string | null };
  beats: DossierBeat[];
}

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

/** Counts, never characterisations. */
function headingFor(checks: RawCheck[], figures: DossierFigure[]): string {
  const by = (state: string) => checks.filter((c) => str(c.status) === state).length;
  const confirmed = by("confirmed");
  const open = by("unknown") + by("unavailable") + by("checked-empty");
  const unbound = figures.filter((f) => f.unboundNote).length;
  if (unbound) {
    return unbound === 1
      ? `One record here names a different subject.`
      : `${unbound} of ${figures.length} records here name a different subject.`;
  }
  if (!checks.length && !figures.length) return "Nothing was recorded for this section.";
  if (confirmed && !open) return `${confirmed} check${confirmed === 1 ? "" : "s"} confirmed, none open.`;
  if (confirmed && open) return `${confirmed} confirmed, ${open} still open.`;
  if (open) return `${open} check${open === 1 ? "" : "s"} open, none confirmed.`;
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
      value: str(fact.value) || "—",
      provenance,
      receipt: receiptFor(fact, unboundNote),
      unboundNote,
    });
    figuresByBeat.set(beatId, list);
  }

  const claimed = new Set(BEAT_CHECKS.flatMap((b) => b.checks));
  const beats: DossierBeat[] = [];

  for (const spec of BEAT_CHECKS) {
    const mine = checks.filter((c) => spec.checks.includes(str(c.checkId)));
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

  return { subject, verdict, beats };
}
