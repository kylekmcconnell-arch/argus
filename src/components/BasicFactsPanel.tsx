import {
  ArrowSquareOut,
  CheckCircle,
  MagnifyingGlass,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { plainLanguageSummary } from "../lib/plainLanguage";
import { canonicalBasicFactComparisonValue } from "../data/evidence";
import {
  basicFactQuestionOutcome,
  basicFactQuestionFor,
  canonicalBasicFactPredicate,
  explicitEmptyBasicFactAnswer,
  reportBasicFactQuestionsFor,
  supportsExplicitEmptyBasicFact,
  type BasicFactQuestionOutcomeInput,
  type BasicFactsAudience,
} from "../lib/basicFactQuestions";
import { ExpandableText } from "./ExpandableText";
import { EvidenceTip } from "./EvidenceTip";
import { ProvenanceTag } from "./ProvenanceTag";
import { provenanceForBasicFactStatus } from "../lib/provenance";

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
  capturedAt?: string;
  artifactVerified?: boolean;
  contentHash?: string;
}

export interface BasicFactView {
  factId?: string;
  predicate: string;
  /** Frozen research question used for this report, when available. */
  question?: string;
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
  evidence_origin?: string;
  artifact_verified?: boolean;
  provider?: string;
  discoveryProvider?: string;
}

export interface BasicFactLeadView {
  predicate: string;
  value?: unknown;
  qualifier?: string;
  eventStatus?: string;
  attributedEntity?: string;
  attributionScope?: "direct_subject" | "related_entity" | "identity_unresolved";
  excerpt?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  candidateUrls?: string[];
  provider?: string;
  sourceClass?: string;
  relation?: "supports" | "contradicts";
  capturedAt?: string;
  artifactVerified?: boolean;
  evidence_origin?: string;
  artifact_verified?: boolean;
  sources?: BasicFactSourceView[];
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

// Labels only: provenance colour now comes from ProvenanceTag / provenanceForBasicFactStatus
// (DESIGN.md 2.1), never from the verdict palette. Where a fact came from is not whether
// it's good news.
const STATUS_META: Record<Exclude<BasicFactStatus, "lead">, { label: string }> = {
  verified: { label: "Verified" },
  corroborated: { label: "Confirmed twice" },
  conflicted: { label: "Conflicted" },
  unresolved: { label: "Unresolved" },
  checked_empty: { label: "Checked, none found" },
  not_applicable: { label: "Not applicable" },
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
  if (source.title?.trim()) return plainLanguageSummary(source.title);
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return source.provider || "Source";
  }
}

function cleanSourceTitle(value?: string): string {
  return plainLanguageSummary((value ?? "")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim());
}

function leadSourceLabel(lead: BasicFactLeadView, url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
      if (/^\/company\//i.test(parsed.pathname)) return "LinkedIn company page";
      if (/^\/in\//i.test(parsed.pathname)) return "LinkedIn profile";
      return "LinkedIn";
    }
  } catch {
    // safeHttpUrl already guards rendered links; retain the generic label.
  }
  const title = index === 0 ? cleanSourceTitle(lead.sourceTitle) : "";
  return title || `Candidate source ${index + 1}`;
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
  if (fact.status === "unresolved") return "No verified answer was found when this report was saved.";
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
  return plainLanguageSummary(answer);
}

// The answers an investor scans first. Identity includes who founded the
// project and who runs it now, not just its name and token.
const KEY_PREDICATES = new Set([
  "official_identity",
  "founder",
  "executive",
  "official_token",
  "traction",
  "funding",
]);

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
    if (onchain) return { line: "Confirmed through the official account, not just the name", excerpt: onchain.excerpt };
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

function artifactVerificationLabel(value?: boolean): string {
  if (value === true) return "Verified artifact";
  if (value === false) return "Not artifact verified";
  return "Not recorded";
}

function recordedStatusLabel(status: BasicFactStatus): string {
  if (status === "checked_empty") return "Checked empty";
  if (status === "not_applicable") return "Not applicable";
  return compactMetadataValue(status);
}

function evidenceTreatmentLabel({
  status,
  providerProjection,
  floorEligible,
  attributionScope,
}: {
  status: BasicFactStatus;
  providerProjection?: boolean;
  floorEligible?: boolean;
  attributionScope?: BasicFactView["attributionScope"];
}): string {
  if (status === "lead") return "Candidate only. This item is not confirmed and is not used in the score.";
  if (status === "conflicted") return "Conflicted evidence. ARGUS has not selected a clean governing answer.";
  if (attributionScope === "identity_unresolved") return "Identity unresolved. The record is excluded from the verdict until the source binds it to the exact subject.";
  if (providerProjection === true) return "Reported by a source. ARGUS saved this as context but did not independently confirm it, so it did not affect the score.";
  if (floorEligible === false) return "Additional context. This item did not affect the score.";
  return "Saved fact. Open the sources below to see what supports this answer.";
}

function dedupeSources(sources: readonly BasicFactSourceView[]): BasicFactSourceView[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify([
      source.url?.trim() ?? "",
      source.title?.trim() ?? "",
      source.sourceClass ?? "",
      source.relation ?? "",
      source.excerpt ?? "",
      source.provider ?? "",
      source.capturedAt ?? "",
      source.artifactVerified,
      source.contentHash ?? "",
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function linkableSources(sources: readonly BasicFactSourceView[]): BasicFactSourceView[] {
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

function EvidenceAuditDisclosure({
  label,
  status,
  sources,
  provider,
  discoveryProvider,
  evidenceOrigin,
  artifactVerified,
  providerProjection,
  floorEligible,
  attributedEntity,
  attributionScope,
}: {
  label: string;
  status: BasicFactStatus;
  sources: readonly BasicFactSourceView[];
  provider?: string;
  discoveryProvider?: string;
  evidenceOrigin?: string;
  artifactVerified?: boolean;
  providerProjection?: boolean;
  floorEligible?: boolean;
  attributedEntity?: string;
  attributionScope?: BasicFactView["attributionScope"];
}) {
  const receipts = dedupeSources(sources);
  const statusLabel = recordedStatusLabel(status);
  const treatment = evidenceTreatmentLabel({ status, providerProjection, floorEligible, attributionScope });
  const compactTreatment = status === "lead"
    ? "Lead"
    : providerProjection === true
      ? `Reported by a source, saved as ${statusLabel}`
      : floorEligible === false
        ? `Additional context, saved as ${statusLabel}`
        : attributionScope === "identity_unresolved"
          ? `Identity unresolved, recorded ${statusLabel}`
          : statusLabel;

  return (
    <details className="group mt-2 border-t border-line/50 pt-2" aria-label={`Sources and technical details for ${label}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[10.5px] text-ink-faint marker:content-none">
        <span className="font-medium text-ink-dim">Sources and technical details</span>
        <span className="text-right">
          {compactTreatment} · {receipts.length} {receipts.length === 1 ? "source" : "sources"}
        </span>
      </summary>
      <div className="mt-2 rounded-lg border border-line/60 bg-panel-2/35 p-2.5">
        <dl className="grid gap-x-4 gap-y-1.5 text-[10.5px] sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-ink-faint">Recorded status</dt>
            <dd className="font-medium text-ink-dim">{statusLabel}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-faint">Fact artifact verification</dt>
            <dd className="font-medium text-ink-dim">{artifactVerificationLabel(artifactVerified)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-faint">Fact provider</dt>
            <dd className="break-words font-medium text-ink-dim">{provider?.trim() || "Not recorded"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-faint">Evidence origin</dt>
            <dd className="break-words font-medium text-ink-dim">{evidenceOrigin?.trim() || "Not recorded"}</dd>
          </div>
          {discoveryProvider?.trim() && (
            <div className="min-w-0">
              <dt className="text-ink-faint">Discovery provider</dt>
              <dd className="break-words font-medium text-ink-dim">{discoveryProvider.trim()}</dd>
            </div>
          )}
          {attributedEntity?.trim() && (
            <div className="min-w-0">
              <dt className="text-ink-faint">Attributed entity</dt>
              <dd className="break-words font-medium text-ink-dim">{attributedEntity.trim()}</dd>
            </div>
          )}
          {attributionScope && (
            <div className="min-w-0">
              <dt className="text-ink-faint">Attribution scope</dt>
              <dd className="break-words font-medium text-ink-dim">{attributionScope}</dd>
            </div>
          )}
        </dl>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">{treatment}</p>

        {receipts.length > 0 ? (
          <div className="mt-2 space-y-2" role="list" aria-label={`Saved sources for ${label}`}>
            {receipts.map((source, index) => {
              const safeUrl = safeHttpUrl(source.url);
              const rawUrl = source.url?.trim();
              const relation = source.relation ? compactMetadataValue(source.relation) : "Not recorded";
              const contradicts = source.relation === "contradicts";
              return (
                <article key={`${rawUrl ?? "source"}:${source.relation ?? "none"}:${index}`} className="rounded-md border border-line/50 bg-panel/45 p-2" role="listitem">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-[11px] font-medium text-ink">
                      Source {index + 1}{source.title?.trim() ? `: ${source.title.trim()}` : ""}
                    </p>
                    <span className={`chip shrink-0 normal-case tracking-normal ${contradicts ? "tint-avoid text-avoid" : "tint-neutral text-ink-dim"}`}>
                      Relation: {relation}
                    </span>
                  </div>
                  <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-[10px] sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-ink-faint">Provider</dt>
                      <dd className="break-words text-ink-dim">{source.provider?.trim() || "Not recorded"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-ink-faint">Source class</dt>
                      <dd className="break-words text-ink-dim">{source.sourceClass?.trim() || "Not recorded"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-ink-faint">Captured at</dt>
                      <dd className="break-words text-ink-dim">{source.capturedAt?.trim() || "Not recorded"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-ink-faint">Artifact verification</dt>
                      <dd className="text-ink-dim">{artifactVerificationLabel(source.artifactVerified)}</dd>
                    </div>
                    {source.contentHash?.trim() && (
                      <div className="min-w-0 sm:col-span-2">
                        <dt className="text-ink-faint">Content hash</dt>
                        <dd className="break-all font-mono text-ink-dim">{source.contentHash.trim()}</dd>
                      </div>
                    )}
                  </dl>
                  {source.excerpt?.trim() ? (
                    <blockquote className="mt-1.5 border-l-2 border-line pl-2 text-[10.5px] leading-relaxed text-ink-dim">
                      {source.excerpt.trim()}
                    </blockquote>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-ink-faint">No excerpt recorded.</p>
                  )}
                  {safeUrl && rawUrl ? (
                    <p className="mt-1.5 text-[10px] text-signal-lift">
                      <span className="text-ink-faint">URL: </span>
                      <span className="break-all">{rawUrl}</span>
                    </p>
                  ) : rawUrl ? (
                    <p className="mt-1.5 text-[10px] text-caution">Source URL withheld by link safety rules.</p>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-ink-faint">No source URL recorded.</p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 rounded-md border border-caution/30 bg-caution/[0.04] p-2 text-[10.5px] leading-relaxed text-caution">
            No saved source was included with this item.
          </p>
        )}
      </div>
    </details>
  );
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
  const requiredQuestions = reportBasicFactQuestionsFor(audience, questionLedger);
  const questionByPredicate = new Map(requiredQuestions);
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
      // A merged answer is only as strong as its weakest included value. If
      // any contributor is a provider projection or ceiling-only context, the
      // whole rendered answer stays outside the green confirmed treatment.
      providerProjection: existing.providerProjection === true || fact.providerProjection === true,
      floorEligible: existing.floorEligible === false || fact.floorEligible === false
        ? false
        : existing.floorEligible ?? fact.floorEligible,
      sources: sourceRows,
    });
  }

  if (fillRequired) {
    for (const [predicate, question] of requiredQuestions) {
      if (![...rows.values()].some((fact) => fact.predicate === predicate)) {
        const ledgerEntry = questionLedger.find((entry) =>
          canonicalBasicFactPredicate(entry.predicate) === predicate);
        if (basicFactQuestionOutcome(ledgerEntry) === "answered") continue;
        const completedEmpty = supportsExplicitEmptyBasicFact(predicate)
          && basicFactQuestionOutcome(ledgerEntry) === "checked_empty";
        rows.set(predicate, {
          predicate,
          question,
          status: completedEmpty ? "checked_empty" : "unresolved",
          ...(completedEmpty ? { value: explicitEmptyBasicFactAnswer(predicate) } : {}),
          critical: true,
          sources: [],
        });
      }
    }
  }

  const requiredOrder = new Map<string, number>(requiredQuestions.map(([predicate], index) => [predicate, index]));
  return [...rows.values()].map((fact) => ({
    ...fact,
    question: fact.question
      ?? questionByPredicate.get(canonicalBasicFactPredicate(fact.predicate))
      ?? basicFactQuestionFor(fact.predicate, audience),
  })).sort((left, right) => {
    const leftOrder = requiredOrder.get(left.predicate) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = requiredOrder.get(right.predicate) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.question!.localeCompare(right.question!);
  });
}

function isStrictlyVerifiedFact(fact: BasicFactView): boolean {
  return (fact.status === "verified" || fact.status === "corroborated")
    && fact.providerProjection !== true
    && fact.floorEligible !== false
    && fact.attributionScope !== "identity_unresolved";
}

function isSourceReportedFact(fact: BasicFactView): boolean {
  return (fact.status === "verified" || fact.status === "corroborated")
    && fact.providerProjection === true
    && fact.attributionScope !== "identity_unresolved";
}

function isSupportingContextFact(fact: BasicFactView): boolean {
  return (fact.status === "verified" || fact.status === "corroborated")
    && fact.providerProjection !== true
    && fact.floorEligible === false
    && fact.attributionScope !== "identity_unresolved";
}

function leadRows(facts: readonly BasicFactView[], leads: readonly BasicFactLeadView[]): BasicFactLeadView[] {
  const confirmedSingletonPredicates = new Set<string>();
  const presentedValues = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (
      (fact.status !== "verified" && fact.status !== "corroborated")
      || fact.attributionScope === "identity_unresolved"
    ) continue;
    const predicate = canonicalBasicFactPredicate(fact.predicate);
    if (isStrictlyVerifiedFact(fact)) confirmedSingletonPredicates.add(predicate);
    const values = Array.isArray(fact.value)
      ? fact.value
      : [fact.value ?? fact.normalizedValue];
    const normalized = presentedValues.get(predicate) ?? new Set<string>();
    for (const value of values) {
      const comparable = canonicalBasicFactComparisonValue(predicate, displayValue(value));
      if (comparable) normalized.add(comparable);
    }
    presentedValues.set(predicate, normalized);
  }
  const rows: BasicFactLeadView[] = [
    ...facts.filter((fact) => fact.status === "lead").map((fact) => ({
      predicate: fact.predicate,
      value: fact.value ?? fact.normalizedValue,
      qualifier: fact.qualifier,
      eventStatus: fact.eventStatus,
      attributedEntity: fact.attributedEntity,
      attributionScope: fact.attributionScope,
      excerpt: fact.sources?.[0]?.excerpt,
      sourceUrl: fact.sources?.[0]?.url,
      sourceTitle: fact.sources?.[0]?.title,
      candidateUrls: (fact.sources ?? []).flatMap((source) => safeHttpUrl(source.url) ? [source.url!] : []),
      provider: fact.sources?.[0]?.provider ?? fact.provider,
      sourceClass: fact.sources?.[0]?.sourceClass,
      relation: fact.sources?.[0]?.relation,
      capturedAt: fact.sources?.[0]?.capturedAt,
      artifactVerified: fact.sources?.[0]?.artifactVerified,
      evidence_origin: fact.evidence_origin,
      artifact_verified: fact.artifact_verified ?? false,
      sources: fact.sources,
    })),
    ...leads,
  ];
  const seen = new Set<string>();
  return rows.filter((lead) => {
    if (!lead?.predicate) return false;
    const predicate = canonicalBasicFactPredicate(lead.predicate);
    const comparable = canonicalBasicFactComparisonValue(predicate, displayValue(lead.value));
    // A confirmed singleton answer makes alternate discovery copies noise.
    // Repeatable people stay visible until that exact person is confirmed.
    if (SINGLE_VALUE_PREDICATES.has(predicate) && confirmedSingletonPredicates.has(predicate)) return false;
    // A source-reported answer can remove an exact duplicate card without
    // suppressing an alternate candidate. That keeps provider context from
    // silently becoming the governing singleton identity.
    if (comparable && presentedValues.get(predicate)?.has(comparable)) return false;
    const key = `${predicate}:${comparable || displayValue(lead.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function leadEvidenceSources(lead: BasicFactLeadView): BasicFactSourceView[] {
  const explicit = dedupeSources(lead.sources ?? []);
  const explicitUrls = new Set(explicit.flatMap((source) => source.url?.trim() ? [source.url.trim()] : []));
  const legacy = [lead.sourceUrl, ...(lead.candidateUrls ?? [])]
    .flatMap((url, index): BasicFactSourceView[] => {
      const normalized = url?.trim();
      if (!normalized || explicitUrls.has(normalized)) return [];
      return [{
        url: normalized,
        title: index === 0 ? lead.sourceTitle : undefined,
        sourceClass: index === 0 ? lead.sourceClass : undefined,
        relation: index === 0 ? lead.relation : undefined,
        excerpt: index === 0 ? lead.excerpt : undefined,
        provider: index === 0 ? lead.provider : undefined,
        capturedAt: index === 0 ? lead.capturedAt : undefined,
        artifactVerified: index === 0 ? lead.artifactVerified : undefined,
      }];
    });
  return dedupeSources([...explicit, ...legacy]);
}

function AnsweredFactCard({ fact, audience, prominent, extra }: {
  fact: BasicFactView; audience: BasicFactsAudience; prominent: boolean; extra?: React.ReactNode;
}) {
  const strictlyVerified = isStrictlyVerifiedFact(fact);
  const sourceReported = isSourceReportedFact(fact);
  const meta = STATUS_META[fact.status as "verified" | "corroborated"];
  // Contradicting sources are ordered first so the visible slice can never
  // hide a contradiction behind supporting links.
  const sources = dedupeSources(fact.sources ?? []).sort((a, b) =>
    Number(b.relation === "contradicts") - Number(a.relation === "contradicts"));
  const sourceLinks = linkableSources(sources);
  const hard = strictlyVerified ? hardVerificationLine(sources, fact.predicate) : null;
  // When the shield line carries the provenance, the qualifier stops reading
  // as prose inside the answer (audit facts qualify their value with the
  // same sentence).
  const qualifierStripped = hard && fact.predicate === "audit" ? { ...fact, qualifier: undefined } : fact;
  const displayFact = dedupeCaptureValues(qualifierStripped);
  const statGrid = METRIC_GRID_PREDICATES.has(canonicalBasicFactPredicate(fact.predicate))
    ? parseFactMetrics(displayFact)
    : null;
  return (
    <li className={`panel-inset min-w-0 ${prominent ? `border-l-2 ${strictlyVerified ? "border-sourced/40" : "border-signal/35"} px-3.5 py-3` : "px-3 py-2.5"}`}>
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
            {fact.question ?? basicFactQuestionFor(fact.predicate, audience)}
          </p>
          {extra}
        </div>
        {!strictlyVerified ? (
          <ProvenanceTag
            state={sourceReported ? { tier: "derived" } : { tier: "sourced" }}
            label={sourceReported ? "Reported by a source" : "Additional context"}
            className="shrink-0"
          />
        ) : fact.status === "corroborated" ? (
          <ProvenanceTag state={provenanceForBasicFactStatus(fact.status)!} label={meta.label} className="shrink-0" />
        ) : (
          <ProvenanceTag
            state={provenanceForBasicFactStatus(fact.status)!}
            label={meta.label}
            icon={<CheckCircle aria-hidden="true" size={12} weight="fill" />}
            className="shrink-0"
          />
        )}
      </div>
      {!strictlyVerified && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
          {sourceReported
            ? "The source made this claim. ARGUS did not independently confirm it, and it did not affect the score."
            : "Another source supported this context, but it did not affect the score."}
        </p>
      )}
      {hard && (
        <p className="mono mt-1.5 flex items-center gap-1.5 text-[10.5px] text-sourced" title={hard.excerpt}>
          <ShieldCheck aria-hidden="true" size={12} weight="fill" className="shrink-0" />
          {hard.line}
        </p>
      )}
      <LegalEventMetadata fact={fact} audience={audience} />
      {sourceLinks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sources for ${fact.question ?? basicFactQuestionFor(fact.predicate, audience)}`}>
          {sourceLinks.slice(0, prominent ? 4 : 2).map((source, sourceIndex) => {
            const url = safeHttpUrl(source.url)!;
            const contradicts = source.relation === "contradicts";
            return (
              <EvidenceTip
                key={`${url}:${sourceIndex}`}
                excerpt={source.excerpt}
                sourceName={sourceLabel(source, url)}
                provider={source.provider}
                capturedAt={source.capturedAt}
                contradicts={contradicts}
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn-chip min-h-8 max-w-full normal-case tracking-normal ${contradicts ? "tint-avoid" : "tint-signal"}`}
                >
                  <ArrowSquareOut aria-hidden="true" size={12} weight="bold" className="shrink-0" />
                  <span className="max-w-52 truncate">{contradicts ? "Contradicts: " : ""}{sourceLabel(source, url)}</span>
                </a>
              </EvidenceTip>
            );
          })}
        </div>
      )}
      <EvidenceAuditDisclosure
        label={fact.question ?? basicFactQuestionFor(fact.predicate, audience)}
        status={fact.status}
        sources={sources}
        provider={fact.provider}
        discoveryProvider={fact.discoveryProvider}
        evidenceOrigin={fact.evidence_origin}
        artifactVerified={fact.artifact_verified}
        providerProjection={fact.providerProjection}
        floorEligible={fact.floorEligible}
        attributedEntity={fact.attributedEntity}
        attributionScope={fact.attributionScope}
      />
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
  supportingAffiliationCount = 0,
}: {
  id?: string;
  facts?: readonly BasicFactView[];
  leads?: readonly BasicFactLeadView[];
  fillRequired?: boolean;
  audience?: BasicFactsAudience;
  questionLedger?: readonly BasicFactQuestionOutcomeInput[];
  /** Disclosed rounds from the frozen funding snapshot, listed under the funding answer. */
  fundingRounds?: readonly FundingRoundView[];
  /** Source-backed career rows saved elsewhere in the same frozen report. */
  supportingAffiliationCount?: number;
}) {
  const rows = factRows(facts, fillRequired, audience, questionLedger);
  const questionByPredicate = new Map(reportBasicFactQuestionsFor(audience, questionLedger));
  const questionFor = (predicate: string) => questionByPredicate.get(canonicalBasicFactPredicate(predicate))
    ?? basicFactQuestionFor(predicate, audience);
  const discoveryLeads = leadRows(facts, leads);
  if (!rows.length && !discoveryLeads.length) return null;

  const identityReviewRows = rows.filter((fact) => fact.attributionScope === "identity_unresolved");
  const answered = rows.filter(isStrictlyVerifiedFact).length;
  const reported = rows.filter(isSourceReportedFact).length;
  const supporting = rows.filter(isSupportingContextFact).length;
  const checkedEmpty = rows.filter((fact) => fact.status === "checked_empty").length;
  const conflicted = rows.filter((fact) => fact.status === "conflicted").length;
  const unresolved = rows.filter((fact) => fact.status === "unresolved").length + identityReviewRows.length;
  const applicable = rows.filter((fact) => fact.status !== "not_applicable").length;
  const answeredRows = rows.filter(isStrictlyVerifiedFact);
  const contextRows = rows.filter((fact) => isSourceReportedFact(fact) || isSupportingContextFact(fact));
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
              Confirmed facts are shown first, followed by additional context that did not affect the score. Open a source to check any answer.
            </p>
          </div>
          <div className="panel-inset flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[11px]" aria-label="Basic facts found">
            <span className="inline-flex items-center gap-1.5 font-medium text-pass">
              <CheckCircle aria-hidden="true" size={14} weight="fill" />
              {answered} confirmed key-fact {answered === 1 ? "answer" : "answers"}
            </span>
            {supportingAffiliationCount > 0 && (
              <span className="text-signal-lift">
                {supportingAffiliationCount} source-backed {supportingAffiliationCount === 1 ? "affiliation" : "affiliations"} elsewhere
              </span>
            )}
            {reported > 0 && <span className="text-signal-lift">{reported} reported by a source</span>}
            {supporting > 0 && <span className="text-signal-lift">{supporting} supporting context</span>}
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
      ) : contextRows.length === 0 && checkedEmptyRows.length === 0 && identityReviewRows.length === 0 ? (
        <div className="px-4 py-5 sm:px-5">
          <div className="panel-inset flex items-start gap-3 px-3.5 py-3.5">
            <MagnifyingGlass aria-hidden="true" size={18} weight="bold" className="mt-0.5 shrink-0 text-caution" />
            <div>
              <p className="text-[13px] font-medium text-ink">Foundational answers are still being verified</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                ARGUS found {discoveryLeads.length} possible answer{discoveryLeads.length === 1 ? "" : "s"}, but the available sources did not confirm any of them.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {contextRows.length > 0 && (
        <div className="border-t border-signal/20 bg-signal/[0.025] px-4 py-4 sm:px-5" aria-label="Context-only basic facts">
          <div>
            <h3 className="text-[13px] font-semibold text-ink">Additional context</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
              Useful information from a provider or another source. It did not affect the score.
            </p>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {contextRows.map((fact, index) => (
              <AnsweredFactCard
                key={fact.factId || `${fact.predicate}:${index}`}
                fact={fact}
                audience={audience}
                prominent={KEY_PREDICATES.has(fact.predicate)}
                extra={fact.predicate === "funding" && fundingRounds.length > 0
                  ? <FundingRoundsList rounds={fundingRounds} />
                  : undefined}
              />
            ))}
          </ul>
        </div>
      )}

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
                    <p className="text-[10.5px] leading-relaxed text-ink-faint">{fact.question ?? basicFactQuestionFor(fact.predicate, audience)}</p>
                    <p className="mt-1 text-[13px] font-medium leading-snug text-ink-dim">{answerFor(fact)}</p>
                  </div>
                  <ProvenanceTag state={provenanceForBasicFactStatus("checked_empty")!} label={STATUS_META.checked_empty.label} className="shrink-0" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conflictedRows.length > 0 && (
        <div className="border-t border-sourced/30 bg-sourced/[0.035] px-4 py-4 sm:px-5" aria-label="Conflicted basic facts">
          <div className="flex items-start gap-2.5">
            <Warning aria-hidden="true" size={18} weight="fill" className="mt-0.5 shrink-0 text-sourced" />
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Sources disagree</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">ARGUS has not selected a clean answer for these points.</p>
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {conflictedRows.map((fact, index) => {
              const sources = dedupeSources(fact.sources ?? []);
              const sourceLinks = linkableSources(sources);
              return (
                <li key={fact.factId || `${fact.predicate}:${index}`} className="panel-inset px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10.5px] text-ink-faint">{fact.question ?? basicFactQuestionFor(fact.predicate, audience)}</p>
                    <ProvenanceTag state={provenanceForBasicFactStatus(fact.status)!} label={STATUS_META.conflicted.label} className="shrink-0" />
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{answerFor(fact)}</p>
                  <LegalEventMetadata fact={fact} audience={audience} />
                  {sourceLinks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sources for ${fact.question ?? basicFactQuestionFor(fact.predicate, audience)}`}>
                      {sourceLinks.slice(0, 4).map((source, sourceIndex) => {
                        const url = safeHttpUrl(source.url)!;
                        const contradicts = source.relation === "contradicts";
                        return (
                          <EvidenceTip
                            key={`${url}:${sourceIndex}`}
                            excerpt={source.excerpt}
                            sourceName={sourceLabel(source, url)}
                            provider={source.provider}
                            capturedAt={source.capturedAt}
                            contradicts={contradicts}
                          >
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`btn-chip min-h-8 max-w-full normal-case tracking-normal ${contradicts ? "tint-avoid" : "tint-signal"}`}
                            >
                              <ArrowSquareOut aria-hidden="true" size={12} weight="bold" className="shrink-0" />
                              <span className="max-w-52 truncate">{contradicts ? "Contradicts: " : ""}{sourceLabel(source, url)}</span>
                            </a>
                          </EvidenceTip>
                        );
                      })}
                    </div>
                  )}
                  <EvidenceAuditDisclosure
                    label={fact.question ?? basicFactQuestionFor(fact.predicate, audience)}
                    status={fact.status}
                    sources={sources}
                    provider={fact.provider}
                    discoveryProvider={fact.discoveryProvider}
                    evidenceOrigin={fact.evidence_origin}
                    artifactVerified={fact.artifact_verified}
                    providerProjection={fact.providerProjection}
                    floorEligible={fact.floorEligible}
                    attributedEntity={fact.attributedEntity}
                    attributionScope={fact.attributionScope}
                  />
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
              const sourceLinks = linkableSources(sources);
              return (
                <li key={fact.factId || `${fact.predicate}:${index}`} className="panel-inset min-w-0 px-3.5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10.5px] leading-relaxed text-ink-faint">{fact.question ?? basicFactQuestionFor(fact.predicate, audience)}</p>
                    <span className="chip tint-caution shrink-0 normal-case tracking-normal text-caution">
                      Recorded {recordedStatusLabel(fact.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] font-medium leading-snug text-ink-dim">{answerFor(fact)}</p>
                  <LegalEventMetadata fact={fact} audience={audience} />
                  {sourceLinks[0] && (() => {
                    const url = safeHttpUrl(sourceLinks[0].url)!;
                    return (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-chip mt-2 min-h-8 max-w-full tint-caution normal-case tracking-normal">
                        <ArrowSquareOut aria-hidden="true" size={12} weight="bold" />
                        <span className="max-w-52 truncate">{sourceLabel(sourceLinks[0], url)}</span>
                      </a>
                    );
                  })()}
                  <EvidenceAuditDisclosure
                    label={fact.question ?? basicFactQuestionFor(fact.predicate, audience)}
                    status={fact.status}
                    sources={sources}
                    provider={fact.provider}
                    discoveryProvider={fact.discoveryProvider}
                    evidenceOrigin={fact.evidence_origin}
                    artifactVerified={fact.artifact_verified}
                    providerProjection={fact.providerProjection}
                    floorEligible={fact.floorEligible}
                    attributedEntity={fact.attributedEntity}
                    attributionScope={fact.attributionScope}
                  />
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
                {fact.question ?? basicFactQuestionFor(fact.predicate, audience)}
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
            <span className="chip tint-caution shrink-0 normal-case tracking-normal">
              {discoveryLeads.length} {discoveryLeads.length === 1 ? "lead" : "leads"}
            </span>
          </summary>
          <ul className="mt-3 grid gap-2 border-t border-caution/20 pt-3 sm:grid-cols-2">
            {discoveryLeads.map((lead, index) => {
              const urls = [...new Set([lead.sourceUrl, ...(lead.candidateUrls ?? [])].flatMap((url) => safeHttpUrl(url) ? [safeHttpUrl(url)!] : []))];
              const evidenceSources = leadEvidenceSources(lead);
              const leadValue = displayValue(lead.value);
              const leadQualifier = canonicalBasicFactPredicate(lead.predicate) === "official_token"
                ? undefined
                : lead.qualifier?.trim();
              const leadAnswer = leadValue && leadQualifier && !leadValue.toLowerCase().includes(leadQualifier.toLowerCase())
                ? `${leadValue} · ${leadQualifier}`
                : leadValue;
              return (
                <li key={`${lead.predicate}:${displayValue(lead.value)}:${index}`} className="panel-inset min-w-0 overflow-hidden px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-[0.11em] text-ink-faint">{questionFor(lead.predicate)}</p>
                      <p className="mt-1 break-words text-[12.5px] leading-relaxed text-ink-dim">{leadAnswer || "Candidate answer not recorded"}</p>
                    </div>
                    <ProvenanceTag state={provenanceForBasicFactStatus("lead")!} label="Possible lead" className="shrink-0" />
                  </div>
                  {urls.length > 0 && (
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                      {urls.slice(0, 3).map((url, urlIndex) => {
                        const label = leadSourceLabel(lead, url, urlIndex);
                        return (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={cleanSourceTitle(lead.sourceTitle) || label}
                          className="btn-chip min-h-8 min-w-0 max-w-full overflow-hidden tint-caution normal-case tracking-normal"
                        >
                          <span className="truncate">{label}</span>
                          <ArrowSquareOut aria-hidden="true" size={12} weight="bold" className="shrink-0" />
                        </a>
                        );
                      })}
                    </div>
                  )}
                  <EvidenceAuditDisclosure
                    label={questionFor(lead.predicate)}
                    status="lead"
                    sources={evidenceSources}
                    provider={lead.provider}
                    evidenceOrigin={lead.evidence_origin}
                    artifactVerified={lead.artifact_verified ?? false}
                    attributedEntity={lead.attributedEntity}
                    attributionScope={lead.attributionScope}
                  />
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
