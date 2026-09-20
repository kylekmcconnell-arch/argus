/* What the saved report records about one named person.

   The report collects evidence against the subject as a whole: role facts and
   their sources, investigative leads, adverse posts, contradictions and other
   affiliations. Most of it names people, but until now a person card showed
   only the role. This joins the saved pools back to each person so the roster
   can say what else is on record about them, and link the artifact.

   Matching is deliberately strict. A handle matches exactly. A name matches
   only as a whole phrase, and only when it carries at least two words, so a
   common first name can never pull in an unrelated record. Nothing here
   judges a person: an adverse lead is published as a lead, with its source,
   and never as a finding. */

import type { Tone } from "./model";

export type PersonRecordKind = "role" | "lead" | "post" | "contradiction" | "affiliation" | "source";

export interface PersonRecord {
  kind: PersonRecordKind;
  label: string;
  detail: string;
  url?: string | null;
  date?: string | null;
  tone: Tone;
}

interface LeadLike {
  claim?: string;
  polarity?: number;
  source_url?: string;
  source_date?: string;
  finding_type?: string;
  finding_scope?: { target_entity_key?: string; relationship_label?: string } | null;
}

interface FactLike {
  value?: string;
  qualifier?: string;
  predicate?: string;
  status?: string;
  sources?: Array<{ url?: string; title?: string }> | null;
}

interface PostLike {
  text?: string;
  handle?: string;
  tweetUrl?: string;
  category?: string;
  specificity?: string;
  postedAt?: string;
}

interface SourceLike {
  title?: string;
  excerpt?: string;
  sourceUrl?: string;
  provider?: string;
  capturedAt?: string;
}

interface AffiliationLike {
  name?: string;
  role?: string;
  relation?: string;
  evidence?: string;
  provider?: string;
  source?: string;
  sourceUrl?: string;
}

interface ContradictionLike {
  claim?: string;
  conflict?: string;
  confidence?: string;
}

export interface PersonEvidenceInput {
  name: string;
  handle?: string | null;
  basicFacts?: FactLike[] | null;
  leads?: LeadLike[] | null;
  adverseMentions?: PostLike[] | null;
  contradictions?: ContradictionLike[] | null;
  ventures?: AffiliationLike[] | null;
  associates?: AffiliationLike[] | null;
  intelligenceSources?: SourceLike[] | null;
}

const MAX_PER_KIND = 6;

function normalizeHandle(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase();
}

/** A person's name is usable for matching only when it is distinctive enough. */
function namePattern(name: string): RegExp | null {
  const words = name.trim().split(/\s+/).filter((word) => word.length >= 2);
  if (words.length < 2) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b${escaped.join("\\s+")}\\b`, "i");
}

function mentions(text: string | null | undefined, pattern: RegExp | null, handle: string): boolean {
  const hay = String(text ?? "");
  if (!hay.trim()) return false;
  if (handle && new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay)) return true;
  return pattern ? pattern.test(hay) : false;
}

function trim(text: string, max = 260): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Everything the saved report records about this person, newest evidence first within each kind. */
export function personRecords(input: PersonEvidenceInput): PersonRecord[] {
  const pattern = namePattern(input.name);
  const handle = normalizeHandle(input.handle);
  if (!pattern && !handle) return [];
  const records: PersonRecord[] = [];

  for (const fact of input.basicFacts ?? []) {
    if (!mentions(fact.value, pattern, handle) && !mentions(fact.qualifier, pattern, handle)) continue;
    const source = (fact.sources ?? []).find((entry) => entry?.url);
    records.push({
      kind: "role",
      label: fact.qualifier ? `${fact.qualifier}` : fact.predicate ? `Recorded as ${fact.predicate}` : "Recorded role",
      detail: `${fact.status === "verified" ? "Verified against the recorded source" : `Recorded status: ${fact.status ?? "unstated"}`}.`,
      url: source?.url ?? null,
      tone: "neutral",
    });
  }

  for (const lead of input.leads ?? []) {
    const target = normalizeHandle(lead.finding_scope?.target_entity_key);
    const hit = (handle && target && target === handle) || mentions(lead.claim, pattern, handle);
    if (!hit) continue;
    const adverse = (lead.polarity ?? 0) < 0;
    records.push({
      kind: "lead",
      label: adverse ? "Adverse lead recorded" : lead.finding_type ? `Lead: ${lead.finding_type}` : "Lead recorded",
      detail: trim(lead.claim ?? "A lead is recorded without a claim."),
      url: lead.source_url ?? null,
      date: lead.source_date || null,
      tone: adverse ? "amber" : "neutral",
    });
  }

  for (const post of input.adverseMentions ?? []) {
    if (!mentions(post.text, pattern, handle)) continue;
    records.push({
      kind: "post",
      label: `Warning post${post.handle ? ` from ${post.handle.startsWith("@") ? post.handle : `@${post.handle}`}` : ""}`,
      detail: trim(post.text ?? ""),
      url: post.tweetUrl ?? null,
      date: post.postedAt ?? null,
      tone: "amber",
    });
  }

  for (const contradiction of input.contradictions ?? []) {
    if (!mentions(contradiction.claim, pattern, handle) && !mentions(contradiction.conflict, pattern, handle)) continue;
    records.push({
      kind: "contradiction",
      label: "Contradiction on record",
      detail: trim(`${contradiction.claim ?? ""} Conflicts with: ${contradiction.conflict ?? ""}`),
      tone: "amber",
    });
  }

  for (const affiliation of [...(input.ventures ?? []), ...(input.associates ?? [])]) {
    if (!mentions(affiliation.name, pattern, handle) && !mentions(affiliation.evidence, pattern, handle)) continue;
    records.push({
      kind: "affiliation",
      label: affiliation.role || affiliation.relation || "Other affiliation",
      detail: trim(affiliation.evidence || `Recorded by ${affiliation.provider ?? affiliation.source ?? "an unnamed provider"}.`),
      url: affiliation.sourceUrl ?? null,
      tone: "neutral",
    });
  }

  for (const source of input.intelligenceSources ?? []) {
    if (!mentions(source.title, pattern, handle) && !mentions(source.excerpt, pattern, handle)) continue;
    records.push({
      kind: "source",
      label: trim(source.title ?? "Recorded source", 90),
      detail: trim(source.excerpt ?? `Collected by ${source.provider ?? "an unnamed provider"}.`),
      url: source.sourceUrl ?? null,
      date: source.capturedAt ?? null,
      tone: "neutral",
    });
  }

  // Cap each kind so one noisy pool cannot bury the rest, and drop duplicates.
  const seen = new Set<string>();
  const counts = new Map<PersonRecordKind, number>();
  return records.filter((record) => {
    const key = `${record.kind}:${record.label}:${record.detail}`;
    if (seen.has(key)) return false;
    const used = counts.get(record.kind) ?? 0;
    if (used >= MAX_PER_KIND) return false;
    seen.add(key);
    counts.set(record.kind, used + 1);
    return true;
  });
}

/** The card badge: adverse material outranks a plain record count. */
export function personRecordSummary(records: PersonRecord[]): { label: string; tone: Tone } | null {
  if (records.length === 0) return null;
  const adverse = records.filter((record) => record.tone === "amber").length;
  if (adverse > 0) return { label: `${adverse} adverse record${adverse === 1 ? "" : "s"} on file`, tone: "amber" };
  return { label: `${records.length} record${records.length === 1 ? "" : "s"} on file`, tone: "neutral" };
}
