import {
  ArrowSquareOut,
  CheckCircle,
  MagnifyingGlass,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { canonicalBasicFactComparisonValue } from "../data/evidence";
import {
  basicFactQuestionOutcome,
  basicFactQuestionFor,
  basicFactQuestionsFor,
  canonicalBasicFactPredicate,
  explicitEmptyBasicFactAnswer,
  supportsExplicitEmptyBasicFact,
  type BasicFactQuestionOutcomeInput,
  type BasicFactsAudience,
} from "../lib/basicFactQuestions";
import { ExpandableText } from "./ExpandableText";

export type { BasicFactsAudience } from "../lib/basicFactQuestions";

export type BasicFactStatus =
  | "verified"
  | "corroborated"
  | "conflicted"
  | "lead"
  | "unresolved"
  | "checked_empty"
  | "not_applicable";

export interface BasicFactSourceView {
  url?: string;
  title?: string;
  sourceClass?: string;
  relation?: "supports" | "contradicts";
  excerpt?: string;
  provider?: string;
}

export interface BasicFactView {
  factId?: string;
  predicate: string;
  value?: unknown;
  normalizedValue?: unknown;
  qualifier?: string;
  eventStatus?: string;
  attributedEntity?: string;
  attributionScope?: "direct_subject" | "related_entity" | "identity_unresolved";
  status: BasicFactStatus;
  critical?: boolean;
  providerProjection?: boolean;
  floorEligible?: boolean;
  sources?: BasicFactSourceView[];
}

export interface BasicFactLeadView {
  predicate: string;
  value?: unknown;
  qualifier?: string;
  excerpt?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  candidateUrls?: string[];
  provider?: string;
}

// Most project facts are naturally atomic and repeatable (one founder per row,
// one repository per row). Differing values are only a contradiction for facts
// that should resolve to one governing answer.
const SINGLE_VALUE_PREDICATES = new Set([
  "official_identity",
  "founded",
  "launched",
  "official_token",
]);

const STATUS_META: Record<Exclude<BasicFactStatus, "lead">, { label: string; className: string }> = {
  verified: { label: "Verified", className: "tint-pass text-pass" },
  corroborated: { label: "Confirmed twice", className: "tint-pass text-pass" },
  conflicted: { label: "Conflicted", className: "tint-avoid text-avoid" },
  unresolved: { label: "Unresolved", className: "tint-caution text-caution" },
  checked_empty: { label: "Checked, none found", className: "tint-neutral text-ink-dim" },
  not_applicable: { label: "Not applicable", className: "tint-neutral text-ink-faint" },
};

function displayValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::" || normalized === "::1") return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan")) return true;
  if (normalized.includes(":") && (/^(?:f[cd]|fe[89ab])/.test(normalized) || normalized.startsWith("::ffff:"))) return true;
  if (/^(?:0|127)(?:\.|$)/.test(normalized)) return true;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 10
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function safeHttpUrl(value?: string): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname || isPrivateHostname(parsed.hostname)) return null;
    const sensitiveParameter = [...parsed.searchParams.keys()].some((key) =>
      /^(?:access_?)?token$|^(?:api_?)?key$|^auth(?:orization)?$|^credential$|^jwt$|^passw(?:or)?d$|^secret$|^session$|^sig(?:nature)?$/i.test(key),
    );
    return sensitiveParameter ? null : parsed.toString();
  } catch {
    return null;
  }
}

function sourceLabel(source: BasicFactSourceView, url: string): string {
  if (source.title?.trim()) return source.title.trim();
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return source.provider || "Source";
  }
}

/**
 * Deterministic provider captures repeat across scans with only the numbers
 * moving ("$2.40B market cap · captured 07-22" then "$2.36B · captured
 * 07-23"). Rendering every capture reads as a spilled paragraph and shows
 * stale numbers next to fresh ones. Only recognized dated/liveness provider
 * captures are keyed with numbers stripped and collapsed to their latest
 * occurrence; ordinary facts retain distinct numeric values.
 */
const CAPTURE_DEDUPE_PREDICATES = new Set(["traction", "tokenomics", "product", "network", "funding"]);
const DATED_CAPTURE = /\bcaptured \d{4}-\d{2}-\d{2}\b/i;
const LIVENESS_CAPTURE = /\boperates a live on-chain protocol\b/i;

function numberlessKey(fragment: string): string {
  return fragment.replace(/[\d.,$#%]+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Accumulated captures were pairwise-merged upstream with ", " as the joiner,
// so a frozen value can arrive as ONE pre-joined string. Turning the joiner
// after a capture date into the canonical " · " separator lets the segment
// parser see clean fragments again.
function normalizeCaptureBoundaries(text: string): string {
  return text.replace(/(captured \d{4}-\d{2}-\d{2}),\s+/g, "$1 · ");
}

function keepLatestByShape(pieces: readonly string[]): string[] {
  const lastCaptureIndex = new Map<string, number>();
  pieces.forEach((piece, index) => {
    const text = piece.trim();
    if (text && (DATED_CAPTURE.test(text) || LIVENESS_CAPTURE.test(text))) {
      lastCaptureIndex.set(numberlessKey(text), index);
    }
  });
  return pieces.flatMap((piece, index) => {
    const text = piece.trim();
    if (!text) return [];
    const capture = DATED_CAPTURE.test(text) || LIVENESS_CAPTURE.test(text);
    return !capture || lastCaptureIndex.get(numberlessKey(text)) === index ? [text] : [];
  });
}

function dedupeCaptureValues(fact: BasicFactView): BasicFactView {
  if (!CAPTURE_DEDUPE_PREDICATES.has(canonicalBasicFactPredicate(fact.predicate))) return fact;
  const elements = Array.isArray(fact.value)
    ? fact.value.map(displayValue).filter(Boolean)
    : [displayValue(fact.value)].filter(Boolean);
  if (!elements.length) return fact;
  // Element-level dated captures collapse first. The legacy liveness sentence
  // is the only undated provider projection that needs an internal comma split.
  const deduped = keepLatestByShape(elements)
    .map((element) => {
      // Only the legacy liveness projection was comma-joined without dated
      // boundaries. Ordinary facts such as separate funding rounds retain
      // their commas and every distinct numeric value.
      if (!LIVENESS_CAPTURE.test(element)) return element;
      return keepLatestByShape(element.split(", ")).join(", ");
    });
  return { ...fact, value: deduped.length === 1 ? deduped[0] : deduped };
}

/**
 * Metric segments inside a fact value ("$3.18B total value locked",
 * "CoinGecko rank #39", "up 2.1% vs 30 days ago") rendered as a stat grid
 * instead of prose. Non-metric segments ("Series B", "led by a16z") stay as
 * a supporting line; "captured YYYY-MM-DD" fragments collapse to one date.
 */
const METRIC_GRID_PREDICATES = new Set(["traction", "tokenomics", "funding"]);

interface FactMetric { value: string; label: string }

const METRIC_TOKEN = /(?:\$\s?[\d][\d.,]*\s?[BMK]?\b|#[\d][\d,]*\b|\b[\d][\d.,]*\s?(?:%|B\b|M\b|K\b|x\b)?)/;

function parseFactMetrics(fact: BasicFactView): { metrics: FactMetric[]; notes: string[]; captured: string | null } | null {
  const raw = Array.isArray(fact.value) ? fact.value.map(displayValue) : [displayValue(fact.value)];
  const captureSeries = raw.some((entry) => DATED_CAPTURE.test(entry));
  const segments = raw
    .flatMap((entry) => normalizeCaptureBoundaries(entry).split(" · "))
    .map((segment) => segment.trim())
    .filter(Boolean);
  const metricByLabel = new Map<string, FactMetric>();
  const notes: string[] = [];
  let captured: string | null = null;
  for (const segment of segments) {
    const capturedMatch = segment.match(/^captured (\d{4}-\d{2}-\d{2})$/i);
    if (capturedMatch) {
      if (!captured || capturedMatch[1] > captured) captured = capturedMatch[1];
      continue;
    }
    // Sentences are prose, not metrics; a metric segment is a short label
    // around one number token.
    const token = segment.length <= 64 && !/[;:]/.test(segment) ? segment.match(METRIC_TOKEN) : null;
    if (!token || token.index == null) {
      const noteKey = captureSeries ? numberlessKey(segment) : segment.trim().toLowerCase();
      if (!notes.some((note) =>
        (captureSeries ? numberlessKey(note) : note.trim().toLowerCase()) === noteKey)) notes.push(segment);
      continue;
    }
    const before = segment.slice(0, token.index).trim();
    const after = segment.slice(token.index + token[0].length).trim();
    const direction = /^(?:up|down)$/i.test(before.split(/\s+/).pop() ?? "") ? before.split(/\s+/).pop()! : null;
    const value = direction ? `${direction} ${token[0].trim()}` : token[0].trim();
    const label = [direction ? before.slice(0, before.length - direction.length).trim() : before, after]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!label) {
      const noteKey = captureSeries ? numberlessKey(segment) : segment.trim().toLowerCase();
      if (!notes.some((note) =>
        (captureSeries ? numberlessKey(note) : note.trim().toLowerCase()) === noteKey)) notes.push(segment);
      continue;
    }
    // Latest dated capture of the same metric wins. Outside a capture series,
    // distinct values with the same label are separate facts and both survive.
    const metricKey = captureSeries
      ? label.toLowerCase()
      : `${label.toLowerCase()}:${value.toLowerCase()}`;
    metricByLabel.set(metricKey, { value, label });
  }
  const metrics = [...metricByLabel.values()];
  return metrics.length >= 3 ? { metrics, notes, captured } : null;
}

function FactStatGrid({ parsed }: { parsed: NonNullable<ReturnType<typeof parseFactMetrics>> }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        {parsed.metrics.slice(0, 9).map((metric) => (
          <div key={`${metric.label}:${metric.value}`} className="min-w-0">
            <dd className="text-[15.5px] font-semibold leading-tight tracking-tight text-ink tabular-nums">{metric.value}</dd>
            <dt className="mt-0.5 text-[10px] uppercase leading-snug tracking-[0.08em] text-ink-faint">{metric.label}</dt>
          </div>
        ))}
      </dl>
      {parsed.notes.length > 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{parsed.notes.join(" · ")}</p>
      )}
      {parsed.captured && (
        <p className="mono mt-1.5 text-[10px] text-ink-faint">captured {parsed.captured}</p>
      )}
    </div>
  );
}

/** One row per disclosed round, newest first: what was raised, when, and who led. */
export interface FundingRoundView {
  date: string | null;
  round: string;
  amountUsd: number | null;
  leadInvestors: string[];
  otherInvestors: string[];
  valuationUsd: number | null;
}

function usdShort(amount: number): string {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(amount >= 1e10 ? 0 : 1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(amount >= 1e8 ? 0 : 1)}M`;
  if (amount >= 1e3) return `$${Math.round(amount / 1e3)}K`;
  return `$${Math.round(amount)}`;
}

function FundingRoundsList({ rounds }: { rounds: readonly FundingRoundView[] }) {
  const ordered = [...rounds].sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
  const maxAmount = Math.max(...ordered.map((round) => round.amountUsd ?? 0), 0);
  return (
    <ol className="mt-2.5 divide-y divide-line/50 border-t border-line/60" aria-label="Disclosed funding rounds">
      {ordered.slice(0, 8).map((round, index) => {
        const leads = round.leadInvestors.filter(Boolean);
        const others = round.otherInvestors.filter(Boolean);
        return (
          <li key={`${round.round}:${round.date}:${index}`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-2 text-[12px]">
            <span className="font-medium text-ink">{round.round}</span>
            {round.date && <span className="mono text-[10.5px] text-ink-faint">{String(round.date).slice(0, 7)}</span>}
            <span className="mono ml-auto font-semibold text-ink tabular-nums">{round.amountUsd != null && round.amountUsd > 0 ? usdShort(round.amountUsd) : "undisclosed"}</span>
            {maxAmount > 0 && round.amountUsd != null && round.amountUsd > 0 && (
              <span className="block h-1 min-w-full overflow-hidden rounded-full bg-line/50" aria-hidden="true">
                <span className="block h-full rounded-full bg-signal-lift/70" style={{ width: `${Math.max(2, (round.amountUsd / maxAmount) * 100)}%` }} />
              </span>
            )}
            {(leads.length > 0 || round.valuationUsd != null) && (
              <span className="min-w-full text-[11px] leading-snug text-ink-faint">
                {leads.length > 0 ? `led by ${leads.slice(0, 3).join(", ")}` : ""}
                {leads.length > 0 && others.length > 0 ? ` · +${others.length} more` : ""}
                {round.valuationUsd != null && round.valuationUsd > 0 ? `${leads.length > 0 ? " · " : ""}${usdShort(round.valuationUsd)} valuation` : ""}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function answerFor(fact: BasicFactView): string {
  if (fact.status === "not_applicable") return "Not applicable to this subject.";
  if (fact.status === "checked_empty") {
    return displayValue(fact.value) || explicitEmptyBasicFactAnswer(fact.predicate);
  }
  if (fact.status === "unresolved") return "No verified answer was found in this snapshot.";
  const value = displayValue(fact.value) || displayValue(fact.normalizedValue);
  const qualifier = canonicalBasicFactPredicate(fact.predicate) === "official_token"
    ? undefined
    : fact.qualifier?.trim();
  const answer = value && qualifier && !value.toLowerCase().includes(qualifier.toLowerCase())
    ? `${value} · ${qualifier}`
    : value;
  if (!answer) return fact.status === "conflicted"
    ? "Sources disagree and no governing answer was selected."
    : "A source was verified, but the answer could not be summarized.";
  return answer;
}

// The four answers an investor scans first. Everything else compresses.
const KEY_PREDICATES = new Set(["official_identity", "official_token", "traction", "funding"]);

/**
 * A shield line renders only when the strongest source is one the subject
 * cannot self-publish: the auditor's own domain always qualifies; a
 * registry/on-chain class qualifies only for the token binding, where the
 * hard part is the official-account match. Scarcity is the point: on a
 * healthy report two or three shields land, and the eye lands with them.
 */
function hardVerificationLine(
  sources: BasicFactSourceView[],
  predicate: string,
): { line: string; excerpt?: string } | null {
  const counterparty = sources.find((source) => source.sourceClass === "official_counterparty" && safeHttpUrl(source.url));
  if (counterparty) {
    const hostname = new URL(safeHttpUrl(counterparty.url)!).hostname.replace(/^www\./, "");
    return { line: `Confirmed on ${hostname}, not just claimed`, excerpt: counterparty.excerpt };
  }
  if (predicate === "official_token") {
    const onchain = sources.find((source) => source.sourceClass === "regulatory_or_onchain" && safeHttpUrl(source.url));
    if (onchain) return { line: "Bound via the official account, never a name match", excerpt: onchain.excerpt };
  }
  return null;
}

function compactMetadataValue(value?: string): string {
  const normalized = value?.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return normalized ? normalized.replace(/^./, (letter) => letter.toUpperCase()) : "";
}

function legalAttributionScopeLabel(
  scope: BasicFactView["attributionScope"],
  audience: BasicFactsAudience,
): string {
  if (scope === "direct_subject") return "Directly attributed";
  if (scope === "identity_unresolved") return "Exact name only, identity not confirmed";
  if (scope !== "related_entity") return "";
  if (audience === "founder" || audience === "person") return "Related entity, not this person";
  if (audience === "project") return "Related entity, not this project";
  return "Related entity, not this investor";
}

function LegalEventMetadata({
  fact,
  audience,
}: {
  fact: BasicFactView;
  audience: BasicFactsAudience;
}) {
  if (canonicalBasicFactPredicate(fact.predicate) !== "legal_regulatory_event") return null;
  const attributedEntity = fact.attributedEntity?.trim();
  const eventStatus = compactMetadataValue(fact.eventStatus);
  const scopeLabel = legalAttributionScopeLabel(fact.attributionScope, audience);
  if (!attributedEntity && !eventStatus && !scopeLabel) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="list" aria-label="Legal event details">
      {attributedEntity && (
        <span className="chip tint-neutral max-w-full normal-case tracking-normal text-ink-dim" role="listitem">
          <span className="truncate">Attributed to {attributedEntity}</span>
        </span>
      )}
      {eventStatus && (
        <span className="chip tint-neutral normal-case tracking-normal text-ink-dim" role="listitem">
          Status: {eventStatus}
        </span>
      )}
      {scopeLabel && (
        <span
          className={`chip normal-case tracking-normal ${fact.attributionScope === "direct_subject" ? "tint-signal text-signal-lift" : "tint-caution text-caution"}`}
          role="listitem"
        >
          {scopeLabel}
        </span>
      )}
    </div>
  );
}

function dedupeSources(sources: readonly BasicFactSourceView[]): BasicFactSourceView[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const url = safeHttpUrl(source.url);
    if (!url) return false;
    const key = `${url}:${source.relation ?? "supports"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function factRowKey(fact: BasicFactView, predicate: string): string {
  if (predicate !== "legal_regulatory_event") return predicate;
  const eventIdentity = [
    canonicalBasicFactComparisonValue(predicate, displayValue(fact.normalizedValue) || displayValue(fact.value)),
    fact.attributedEntity?.trim().toLowerCase() ?? "",
    fact.eventStatus?.trim().toLowerCase() ?? "",
  ].join("::");
  return `${predicate}::${eventIdentity}`;
}

function factRows(
  facts: readonly BasicFactView[],
  fillRequired: boolean,
  audience: BasicFactsAudience,
  questionLedger: readonly BasicFactQuestionOutcomeInput[],
): BasicFactView[] {
  const rows = new Map<string, BasicFactView>();
  for (const fact of facts) {
    if (!fact?.predicate || fact.status === "lead") continue;
    const predicate = canonicalBasicFactPredicate(fact.predicate);
    const rowKey = factRowKey(fact, predicate);
    const existing = rows.get(rowKey);
    if (!existing) {
      rows.set(rowKey, { ...fact, predicate, sources: dedupeSources(fact.sources ?? []) });
      continue;
    }
    const sourceRows = dedupeSources([...(existing.sources ?? []), ...(fact.sources ?? [])]);
    // An already-merged row carries its values as an array; flatten it rather
    // than letting answerFor stringify it, or a three-way merge bakes ", "
    // joins into a single value no later pass can take apart.
    const mergeValues = (candidate: BasicFactView): string[] =>
      Array.isArray(candidate.value) ? candidate.value.map(displayValue).filter(Boolean) : [answerFor(candidate)];
    const values = [...new Map([...mergeValues(existing), ...mergeValues(fact)]
      .filter((value) => value && !/^(?:No verified answer|Not applicable|Sources disagree|A source was verified)/.test(value))
      .map((value) => [canonicalBasicFactComparisonValue(predicate, value), value])).values()];
    const repeatableFounderAsset = predicate === "official_token" && audience !== "project";
    // Two chain lists that OVERLAP answer "which networks" compatibly: one
    // source lists the flagship deployments, another the full footprint.
    // Overlap means corroboration; the richer list wins the display. Disjoint
    // lists remain a real conflict.
    const chainNames = (value: string) => new Set(
      (value.match(/[A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)?/g) ?? [])
        .map((name) => name.toLowerCase())
        .filter((name) => !/^\d|^incl/.test(name)),
    );
    const networkFootprint = predicate === "network" && values.length > 1
      ? values.find((value) => /\d+\s+chains/i.test(String(value)))
      : undefined;
    const networkOverlap = predicate === "network" && values.length > 1 && !networkFootprint
      ? values.every((value, index) => index === 0
        || [...chainNames(String(value))].some((name) => chainNames(String(values[0])).has(name)))
      : false;
    if (networkFootprint !== undefined) {
      // Individually verified single-chain answers enumerate deployments the
      // footprint already counts; the footprint is the most complete claim.
      values.length = 0;
      values.push(networkFootprint);
    } else if (networkOverlap) {
      const richest = [...values].sort((a, b) => chainNames(String(b)).size - chainNames(String(a)).size)[0];
      values.length = 0;
      values.push(richest);
    }
    const conflictingValues = SINGLE_VALUE_PREDICATES.has(predicate) && !repeatableFounderAsset && values.length > 1;
    const combinedStatus = existing.status === "conflicted" || fact.status === "conflicted" || conflictingValues
      ? "conflicted"
      : existing.status === "corroborated" || fact.status === "corroborated"
        ? "corroborated"
        : existing.status === "verified" || fact.status === "verified"
          ? "verified"
          : existing.status === "unresolved" || fact.status === "unresolved"
            ? "unresolved"
            : existing.status === "checked_empty" || fact.status === "checked_empty"
              ? "checked_empty"
              : "not_applicable";
    rows.set(rowKey, {
      ...existing,
      ...(fact.status === "conflicted" ? fact : {}),
      predicate,
      ...(values.length ? { value: values.length === 1 ? values[0] : values, normalizedValue: undefined, qualifier: undefined } : {}),
      status: combinedStatus,
      critical: existing.critical || fact.critical,
      sources: sourceRows,
    });
  }

  if (fillRequired) {
    for (const [predicate] of basicFactQuestionsFor(audience)) {
      if (![...rows.values()].some((fact) => fact.predicate === predicate)) {
        const ledgerEntry = questionLedger.find((entry) =>
          canonicalBasicFactPredicate(entry.predicate) === predicate);
        const completedEmpty = supportsExplicitEmptyBasicFact(predicate)
          && basicFactQuestionOutcome(ledgerEntry) === "checked_empty";
        rows.set(predicate, {
          predicate,
          status: completedEmpty ? "checked_empty" : "unresolved",
          ...(completedEmpty ? { value: explicitEmptyBasicFactAnswer(predicate) } : {}),
          critical: true,
          sources: [],
        });
      }
    }
  }

  const requiredOrder = new Map<string, number>(basicFactQuestionsFor(audience).map(([predicate], index) => [predicate, index]));
  return [...rows.values()].sort((left, right) => {
    const leftOrder = requiredOrder.get(left.predicate) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = requiredOrder.get(right.predicate) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || basicFactQuestionFor(left.predicate, audience).localeCompare(basicFactQuestionFor(right.predicate, audience));
  });
}

function leadRows(facts: readonly BasicFactView[], leads: readonly BasicFactLeadView[]): BasicFactLeadView[] {
  const rows: BasicFactLeadView[] = [
    ...facts.filter((fact) => fact.status === "lead").map((fact) => ({
      predicate: fact.predicate,
      value: fact.value ?? fact.normalizedValue,
      qualifier: fact.qualifier,
      candidateUrls: (fact.sources ?? []).flatMap((source) => safeHttpUrl(source.url) ? [source.url!] : []),
      provider: fact.sources?.[0]?.provider,
    })),
    ...leads,
  ];
  const seen = new Set<string>();
  return rows.filter((lead) => {
    if (!lead?.predicate) return false;
    const key = `${canonicalBasicFactPredicate(lead.predicate)}:${displayValue(lead.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function AnsweredFactCard({ fact, audience, prominent, extra }: {
  fact: BasicFactView; audience: BasicFactsAudience; prominent: boolean; extra?: React.ReactNode;
}) {
  const meta = STATUS_META[fact.status as "verified" | "corroborated"];
  // Contradicting sources are ordered first so the visible slice can never
  // hide a contradiction behind supporting links.
  const sources = dedupeSources(fact.sources ?? []).sort((a, b) =>
    Number(b.relation === "contradicts") - Number(a.relation === "contradicts"));
  const hard = hardVerificationLine(sources, fact.predicate);
  // When the shield line carries the provenance, the qualifier stops reading
  // as prose inside the answer (audit facts qualify their value with the
  // same sentence).
  const qualifierStripped = hard && fact.predicate === "audit" ? { ...fact, qualifier: undefined } : fact;
  const displayFact = dedupeCaptureValues(qualifierStripped);
  const statGrid = METRIC_GRID_PREDICATES.has(canonicalBasicFactPredicate(fact.predicate))
    ? parseFactMetrics(displayFact)
    : null;
  return (
    <li className={`panel-inset min-w-0 ${prominent ? "border-l-2 border-pass/40 px-3.5 py-3" : "px-3 py-2.5"}`}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          {statGrid ? (
            <FactStatGrid parsed={statGrid} />
          ) : (
            <ExpandableText
              text={answerFor(displayFact)}
              collapsedLength={prominent ? 190 : 150}
              className={`font-semibold leading-snug tracking-tight text-ink tabular-nums ${prominent ? "text-[16.5px]" : "text-[13.5px]"}`}
            />
          )}
          <p className="mt-1 text-[10px] uppercase tracking-[0.09em] text-ink-faint">
            {basicFactQuestionFor(fact.predicate, audience)}
          </p>
          {extra}
        </div>
        {fact.status === "corroborated" ? (
          <span className={`chip shrink-0 normal-case tracking-normal ${meta.className}`}>{meta.label}</span>
        ) : (
          <>
            <CheckCircle aria-hidden="true" size={14} weight="fill" className="mt-0.5 shrink-0 text-pass" />
            <span className="sr-only">Verified</span>
          </>
        )}
      </div>
      {hard && (
        <p className="mono mt-1.5 flex items-center gap-1.5 text-[10.5px] text-pass" title={hard.excerpt}>
          <ShieldCheck aria-hidden="true" size={12} weight="fill" className="shrink-0" />
          {hard.line}
        </p>
      )}
      <LegalEventMetadata fact={fact} audience={audience} />
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sources for ${basicFactQuestionFor(fact.predicate, audience)}`}>
          {sources.slice(0, prominent ? 4 : 2).map((source, sourceIndex) => {
            const url = safeHttpUrl(source.url)!;
            const contradicts = source.relation === "contradicts";
            return (
              <a
                key={`${url}:${sourceIndex}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.excerpt || sourceLabel(source, url)}
                className={`btn-chip min-h-8 max-w-full normal-case tracking-normal ${contradicts ? "tint-avoid" : "tint-signal"}`}
              >
                <ArrowSquareOut aria-hidden="true" size={12} weight="bold" className="shrink-0" />
                <span className="max-w-52 truncate">{contradicts ? "Contradicts: " : ""}{sourceLabel(source, url)}</span>
              </a>
            );
          })}
        </div>
      )}
    </li>
  );
}

export function BasicFactsPanel({
  id = "basic-facts",
  facts = [],
  leads = [],
  fillRequired = false,
  audience = "project",
  questionLedger = [],
  fundingRounds = [],
}: {
  id?: string;
  facts?: readonly BasicFactView[];
  leads?: readonly BasicFactLeadView[];
  fillRequired?: boolean;
  audience?: BasicFactsAudience;
  questionLedger?: readonly BasicFactQuestionOutcomeInput[];
  /** Disclosed rounds from the frozen funding snapshot, listed under the funding answer. */
  fundingRounds?: readonly FundingRoundView[];
}) {
  const rows = factRows(facts, fillRequired, audience, questionLedger);
  const discoveryLeads = leadRows(facts, leads);
  if (!rows.length && !discoveryLeads.length) return null;

  const identityReviewRows = rows.filter((fact) => fact.attributionScope === "identity_unresolved");
  const answered = rows.filter((fact) =>
    (fact.status === "verified" || fact.status === "corroborated")
    && fact.attributionScope !== "identity_unresolved").length;
  const checkedEmpty = rows.filter((fact) => fact.status === "checked_empty").length;
  const conflicted = rows.filter((fact) => fact.status === "conflicted").length;
  const unresolved = rows.filter((fact) => fact.status === "unresolved").length + identityReviewRows.length;
  const applicable = rows.filter((fact) => fact.status !== "not_applicable").length;
  const answeredRows = rows.filter((fact) =>
    (fact.status === "verified" || fact.status === "corroborated")
    && fact.attributionScope !== "identity_unresolved");
  const keyRows = answeredRows.filter((fact) => KEY_PREDICATES.has(fact.predicate));
  const supportingRows = answeredRows.filter((fact) => !KEY_PREDICATES.has(fact.predicate));
  const checkedEmptyRows = rows.filter((fact) => fact.status === "checked_empty");
  const conflictedRows = rows.filter((fact) => fact.status === "conflicted");
  const unresolvedRows = rows.filter((fact) => fact.status === "unresolved");

  return (
    <section id={id} className="panel scroll-mt-28 overflow-hidden" aria-labelledby={`${id}-title`}>
      <header className="border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-signal-lift">Key facts</p>
            <h2 id={`${id}-title`} className="mt-1 text-[19px] font-semibold tracking-tight text-ink">What you need to know</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
              Confirmed facts are shown first. Open a source to check any answer.
            </p>
          </div>
          <div className="panel-inset flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[11px]" aria-label="Basic facts found">
            <span className="inline-flex items-center gap-1.5 font-medium text-pass">
              <CheckCircle aria-hidden="true" size={14} weight="fill" />
              {answered} confirmed
            </span>
            {checkedEmpty > 0 && <span className="text-ink-dim">{checkedEmpty} with no result</span>}
            {conflicted > 0 && <span className="text-avoid">{conflicted} where sources disagree</span>}
            {unresolved > 0 && <span className="text-ink-faint">{unresolved} still to verify</span>}
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-line/70" aria-hidden="true">
          <div className="h-full rounded-full bg-pass transition-[width]" style={{ width: `${applicable ? ((answered + checkedEmpty) / applicable) * 100 : 0}%` }} />
        </div>
      </header>

      {answeredRows.length > 0 ? (
        <>
          {keyRows.length > 0 && (
            <ul className="grid gap-2 p-4 pb-0 sm:grid-cols-2 sm:p-5 sm:pb-0" aria-label="Key verified answers">
              {keyRows.map((fact, index) => (
                <AnsweredFactCard
                  key={fact.factId || `${fact.predicate}:${index}`}
                  fact={fact}
                  audience={audience}
                  prominent
                  extra={fact.predicate === "funding" && fundingRounds.length > 0
                    ? <FundingRoundsList rounds={fundingRounds} />
                    : undefined}
                />
              ))}
            </ul>
          )}
          {supportingRows.length > 0 && (
            <ul className="grid gap-1.5 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5 sm:pt-3" aria-label="Confirmed basic facts">
              {supportingRows.map((fact, index) => (
                <AnsweredFactCard key={fact.factId || `${fact.predicate}:${index}`} fact={fact} audience={audience} prominent={false} />
              ))}
            </ul>
          )}
        </>
      ) : checkedEmptyRows.length === 0 && identityReviewRows.length === 0 ? (
        <div className="px-4 py-5 sm:px-5">
          <div className="panel-inset flex items-start gap-3 px-3.5 py-3.5">
            <MagnifyingGlass aria-hidden="true" size={18} weight="bold" className="mt-0.5 shrink-0 text-caution" />
            <div>
              <p className="text-[13px] font-medium text-ink">Foundational answers are still being verified</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                ARGUS found {discoveryLeads.length} possible answer{discoveryLeads.length === 1 ? "" : "s"}, but none cleared source verification in this snapshot.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {checkedEmptyRows.length > 0 && (
        <div className="border-t border-line/60 bg-panel-2/30 px-4 py-4 sm:px-5" aria-label="Completed empty basic-fact searches">
          <div className="flex items-start gap-2.5">
            <CheckCircle aria-hidden="true" size={18} weight="fill" className="mt-0.5 shrink-0 text-ink-dim" />
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Checks with no result</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                We checked these questions but did not find a verified answer.
              </p>
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checkedEmptyRows.map((fact, index) => (
              <li key={fact.factId || `${fact.predicate}:${index}`} className="panel-inset min-w-0 px-3.5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10.5px] leading-relaxed text-ink-faint">{basicFactQuestionFor(fact.predicate, audience)}</p>
                    <p className="mt-1 text-[13px] font-medium leading-snug text-ink-dim">{answerFor(fact)}</p>
                  </div>
                  <span className={`chip shrink-0 normal-case tracking-normal ${STATUS_META.checked_empty.className}`}>
                    {STATUS_META.checked_empty.label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conflictedRows.length > 0 && (
        <div className="border-t border-avoid/30 bg-avoid/[0.035] px-4 py-4 sm:px-5" aria-label="Conflicted basic facts">
          <div className="flex items-start gap-2.5">
            <Warning aria-hidden="true" size={18} weight="fill" className="mt-0.5 shrink-0 text-avoid" />
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Sources disagree</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">ARGUS has not selected a clean answer for these points.</p>
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {conflictedRows.map((fact, index) => {
              const sources = dedupeSources(fact.sources ?? []);
              return (
                <li key={fact.factId || `${fact.predicate}:${index}`} className="panel-inset px-3 py-2.5">
                  <p className="text-[10.5px] text-ink-faint">{basicFactQuestionFor(fact.predicate, audience)}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-avoid">{answerFor(fact)}</p>
                  <LegalEventMetadata fact={fact} audience={audience} />
                  {sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sources for ${basicFactQuestionFor(fact.predicate, audience)}`}>
                      {sources.slice(0, 4).map((source, sourceIndex) => {
                        const url = safeHttpUrl(source.url)!;
                        const contradicts = source.relation === "contradicts";
                        return (
                          <a
                            key={`${url}:${sourceIndex}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={source.excerpt || sourceLabel(source, url)}
                            className={`btn-chip min-h-8 max-w-full normal-case tracking-normal ${contradicts ? "tint-avoid" : "tint-signal"}`}
                          >
                            <ArrowSquareOut aria-hidden="true" size={12} weight="bold" className="shrink-0" />
                            <span className="max-w-52 truncate">{contradicts ? "Contradicts: " : ""}{sourceLabel(source, url)}</span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {identityReviewRows.length > 0 && (
        <div className="border-t border-caution/30 bg-caution/[0.025] px-4 py-4 sm:px-5" aria-label="Identity review required">
          <div className="flex items-start gap-2.5">
            <Warning aria-hidden="true" size={18} weight="fill" className="mt-0.5 shrink-0 text-caution" />
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Same name, identity not confirmed</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">Kept for review and excluded from the verdict until the source ties the record to this exact person.</p>
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {identityReviewRows.map((fact, index) => {
              const sources = dedupeSources(fact.sources ?? []);
              return (
                <li key={fact.factId || `${fact.predicate}:${index}`} className="panel-inset min-w-0 px-3.5 py-3.5">
                  <p className="text-[10.5px] leading-relaxed text-ink-faint">{basicFactQuestionFor(fact.predicate, audience)}</p>
                  <p className="mt-1 text-[13px] font-medium leading-snug text-ink-dim">{answerFor(fact)}</p>
                  <LegalEventMetadata fact={fact} audience={audience} />
                  {sources[0] && (() => {
                    const url = safeHttpUrl(sources[0].url)!;
                    return (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-chip mt-2 min-h-8 max-w-full tint-caution normal-case tracking-normal">
                        <ArrowSquareOut aria-hidden="true" size={12} weight="bold" />
                        <span className="max-w-52 truncate">{sourceLabel(sources[0], url)}</span>
                      </a>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {unresolvedRows.length > 0 && (
        <details className="group border-t border-line/60 px-4 py-3.5 sm:px-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] font-medium text-ink marker:content-none">
            <span>Still to confirm</span>
            <span className="chip tint-caution normal-case tracking-normal">{unresolvedRows.length} questions</span>
          </summary>
          <ul className="mt-3 grid gap-x-6 gap-y-2 border-t border-line/50 pt-3 sm:grid-cols-2" aria-label="Unresolved basic facts">
            {unresolvedRows.map((fact, index) => (
              <li key={fact.factId || `${fact.predicate}:${index}`} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-dim">
                <MagnifyingGlass aria-hidden="true" size={13} weight="bold" className="mt-0.5 shrink-0 text-caution" />
                {basicFactQuestionFor(fact.predicate, audience)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {discoveryLeads.length > 0 && (
        <details className="group border-t border-caution/30 bg-caution/[0.025] px-4 py-3.5 sm:px-5" aria-label="Unverified basic fact leads">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:content-none">
            <span className="flex min-w-0 items-center gap-2.5">
              <MagnifyingGlass aria-hidden="true" size={16} weight="bold" className="shrink-0 text-caution" />
              <span>
                <span className="block text-[12.5px] font-medium text-ink">Possible leads</span>
                <span className="mt-0.5 block text-[10.5px] text-ink-faint">Not confirmed and not used in the score</span>
              </span>
            </span>
            <span className="chip tint-caution shrink-0 normal-case tracking-normal">{discoveryLeads.length} leads</span>
          </summary>
          <ul className="mt-3 grid gap-2 border-t border-caution/20 pt-3 sm:grid-cols-2">
            {discoveryLeads.map((lead, index) => {
              const urls = [...new Set([lead.sourceUrl, ...(lead.candidateUrls ?? [])].flatMap((url) => safeHttpUrl(url) ? [safeHttpUrl(url)!] : []))];
              const leadValue = displayValue(lead.value);
              const leadQualifier = canonicalBasicFactPredicate(lead.predicate) === "official_token"
                ? undefined
                : lead.qualifier?.trim();
              const leadAnswer = leadValue && leadQualifier && !leadValue.toLowerCase().includes(leadQualifier.toLowerCase())
                ? `${leadValue} · ${leadQualifier}`
                : leadValue;
              return (
                <li key={`${lead.predicate}:${displayValue(lead.value)}:${index}`} className="panel-inset px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.11em] text-ink-faint">{basicFactQuestionFor(lead.predicate, audience)}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{leadAnswer || "Candidate answer not recorded"}</p>
                    </div>
                    <span className="chip tint-caution shrink-0 normal-case tracking-normal">Possible lead</span>
                  </div>
                  {urls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {urls.slice(0, 3).map((url, urlIndex) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="btn-chip min-h-8 tint-caution normal-case tracking-normal">
                          {urlIndex === 0 && lead.sourceTitle?.trim() ? lead.sourceTitle.trim() : `Candidate source ${urlIndex + 1}`} <ArrowSquareOut aria-hidden="true" size={12} weight="bold" />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
