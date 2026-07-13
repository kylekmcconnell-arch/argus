import {
  ArrowSquareOut,
  CheckCircle,
  MagnifyingGlass,
  Warning,
} from "@phosphor-icons/react";
import { canonicalBasicFactComparisonValue } from "../data/evidence";

export type BasicFactStatus =
  | "verified"
  | "corroborated"
  | "conflicted"
  | "lead"
  | "unresolved"
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
  status: BasicFactStatus;
  critical?: boolean;
  sources?: BasicFactSourceView[];
}

export interface BasicFactLeadView {
  predicate: string;
  value?: unknown;
  qualifier?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  candidateUrls?: string[];
  provider?: string;
}

const REQUIRED_QUESTIONS = [
  ["official_identity", "What is the project's official identity?"],
  ["product", "What does the project actually do?"],
  ["founder", "Who founded it?"],
  ["executive", "Who operates it today?"],
  ["founded", "When was it founded?"],
  ["launched", "When did the product launch?"],
  ["official_token", "Does it have an official token?"],
  ["network", "Which networks does it run on?"],
  ["legal_entity", "Which legal entity is responsible?"],
  ["funding", "How much funding has it raised?"],
  ["investor", "Who funded it?"],
  ["governance", "Who controls governance and the treasury?"],
  ["audit", "Has the code been independently audited?"],
  ["repository", "Where is the source code maintained?"],
  ["traction", "Is there evidence of real usage?"],
] as const;

const QUESTION_BY_PREDICATE = new Map<string, string>(REQUIRED_QUESTIONS);

const PREDICATE_ALIASES: Record<string, string> = {
  identity: "official_identity",
  founders: "founder",
  cofounders: "founder",
  co_founders: "founder",
  team: "executive",
  leadership: "executive",
  core_team: "executive",
  token: "official_token",
  tokeneconomics: "official_token",
  tokenomics: "official_token",
  launch_date: "launched",
  launch: "launched",
  founding_date: "founded",
  incorporation: "legal_entity",
  company: "legal_entity",
  investors: "investor",
  fundraising: "funding",
  security_audits: "audit",
  audits: "audit",
  github: "repository",
  repositories: "repository",
  usage: "traction",
  adoption: "traction",
};

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
  corroborated: { label: "Corroborated", className: "tint-pass text-pass" },
  conflicted: { label: "Conflicted", className: "tint-avoid text-avoid" },
  unresolved: { label: "Unresolved", className: "tint-caution text-caution" },
  not_applicable: { label: "Not applicable", className: "tint-neutral text-ink-faint" },
};

function canonicalPredicate(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return PREDICATE_ALIASES[normalized] ?? normalized;
}

function humanize(value: string): string {
  const canonical = canonicalPredicate(value);
  return canonical.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function questionFor(predicate: string): string {
  const canonical = canonicalPredicate(predicate);
  return QUESTION_BY_PREDICATE.get(canonical) ?? humanize(canonical);
}

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

function answerFor(fact: BasicFactView): string {
  if (fact.status === "not_applicable") return "Not applicable to this subject.";
  if (fact.status === "unresolved") return "No verified answer was found in this snapshot.";
  const value = displayValue(fact.value) || displayValue(fact.normalizedValue);
  const qualifier = fact.qualifier?.trim();
  const answer = value && qualifier && !value.toLowerCase().includes(qualifier.toLowerCase())
    ? `${value} · ${qualifier}`
    : value;
  if (!answer) return fact.status === "conflicted"
    ? "Sources disagree and no governing answer was selected."
    : "A source was verified, but the answer could not be summarized.";
  return answer;
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

function factRows(facts: readonly BasicFactView[], fillRequired: boolean): BasicFactView[] {
  const rows = new Map<string, BasicFactView>();
  for (const fact of facts) {
    if (!fact?.predicate || fact.status === "lead") continue;
    const predicate = canonicalPredicate(fact.predicate);
    const existing = rows.get(predicate);
    if (!existing) {
      rows.set(predicate, { ...fact, predicate, sources: dedupeSources(fact.sources ?? []) });
      continue;
    }
    const sourceRows = dedupeSources([...(existing.sources ?? []), ...(fact.sources ?? [])]);
    const values = [...new Map([
      answerFor(existing),
      answerFor(fact),
    ].filter((value) => value && !/^(?:No verified answer|Not applicable|Sources disagree|A source was verified)/.test(value))
      .map((value) => [canonicalBasicFactComparisonValue(predicate, value), value])).values()];
    const conflictingValues = SINGLE_VALUE_PREDICATES.has(predicate) && values.length > 1;
    const combinedStatus = existing.status === "conflicted" || fact.status === "conflicted" || conflictingValues
      ? "conflicted"
      : existing.status === "corroborated" || fact.status === "corroborated"
        ? "corroborated"
        : existing.status === "verified" || fact.status === "verified"
          ? "verified"
          : existing.status === "unresolved" || fact.status === "unresolved"
            ? "unresolved"
            : "not_applicable";
    rows.set(predicate, {
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
    for (const [predicate] of REQUIRED_QUESTIONS) {
      if (!rows.has(predicate)) {
        rows.set(predicate, { predicate, status: "unresolved", critical: true, sources: [] });
      }
    }
  }

  const requiredOrder = new Map<string, number>(REQUIRED_QUESTIONS.map(([predicate], index) => [predicate, index]));
  return [...rows.values()].sort((left, right) => {
    const leftOrder = requiredOrder.get(left.predicate) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = requiredOrder.get(right.predicate) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || questionFor(left.predicate).localeCompare(questionFor(right.predicate));
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
    const key = `${canonicalPredicate(lead.predicate)}:${displayValue(lead.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function BasicFactsPanel({
  id = "basic-facts",
  facts = [],
  leads = [],
  fillRequired = false,
}: {
  id?: string;
  facts?: readonly BasicFactView[];
  leads?: readonly BasicFactLeadView[];
  fillRequired?: boolean;
}) {
  const rows = factRows(facts, fillRequired);
  const discoveryLeads = leadRows(facts, leads);
  if (!rows.length && !discoveryLeads.length) return null;

  const answered = rows.filter((fact) => fact.status === "verified" || fact.status === "corroborated").length;
  const conflicted = rows.filter((fact) => fact.status === "conflicted").length;
  const unresolved = rows.filter((fact) => fact.status === "unresolved").length;
  const applicable = rows.filter((fact) => fact.status !== "not_applicable").length;
  const answeredRows = rows.filter((fact) => fact.status === "verified" || fact.status === "corroborated");
  const conflictedRows = rows.filter((fact) => fact.status === "conflicted");
  const unresolvedRows = rows.filter((fact) => fact.status === "unresolved");

  return (
    <section id={id} className="panel scroll-mt-28 overflow-hidden" aria-labelledby={`${id}-title`}>
      <header className="border-b border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-signal-lift">Core diligence</p>
            <h2 id={`${id}-title`} className="mt-1 text-[19px] font-semibold tracking-tight text-ink">Basic facts</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
              The basic questions an investor should never have to research twice. Answers count only when a fetched source supports them.
            </p>
          </div>
          <div className="panel-inset flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[11px]" aria-label="Basic facts coverage">
            <span className="inline-flex items-center gap-1.5 font-medium text-pass">
              <CheckCircle aria-hidden="true" size={14} weight="fill" />
              {answered} confirmed
            </span>
            {conflicted > 0 && <span className="text-avoid">{conflicted} conflicted</span>}
            {unresolved > 0 && <span className="text-ink-faint">{unresolved} still to verify</span>}
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-line/70" aria-hidden="true">
          <div className="h-full rounded-full bg-pass transition-[width]" style={{ width: `${applicable ? (answered / applicable) * 100 : 0}%` }} />
        </div>
      </header>

      {answeredRows.length > 0 ? (
        <ul className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5" aria-label="Confirmed basic facts">
          {answeredRows.map((fact, index) => {
            const meta = STATUS_META[fact.status as "verified" | "corroborated"];
            const sources = dedupeSources(fact.sources ?? []);
            return (
              <li key={fact.factId || `${fact.predicate}:${index}`} className="panel-inset min-w-0 px-3.5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10.5px] leading-relaxed text-ink-faint">{questionFor(fact.predicate)}</p>
                    <p className="mt-1 text-[15px] font-medium leading-snug text-ink">{answerFor(fact)}</p>
                  </div>
                  <span className={`chip shrink-0 normal-case tracking-normal ${meta.className}`}>
                    <CheckCircle aria-hidden="true" size={12} weight="fill" />
                    {meta.label}
                  </span>
                </div>
                  {sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sources for ${questionFor(fact.predicate)}`}>
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
      ) : (
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
                  <p className="text-[10.5px] text-ink-faint">{questionFor(fact.predicate)}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-avoid">{answerFor(fact)}</p>
                  {sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Sources for ${questionFor(fact.predicate)}`}>
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
                {questionFor(fact.predicate)}
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
                <span className="block text-[12.5px] font-medium text-ink">Research leads awaiting verification</span>
                <span className="mt-0.5 block text-[10.5px] text-ink-faint">Visible for transparency, excluded from the verdict</span>
              </span>
            </span>
            <span className="chip tint-caution shrink-0 normal-case tracking-normal">{discoveryLeads.length} leads</span>
          </summary>
          <ul className="mt-3 grid gap-2 border-t border-caution/20 pt-3 sm:grid-cols-2">
            {discoveryLeads.map((lead, index) => {
              const urls = [...new Set([lead.sourceUrl, ...(lead.candidateUrls ?? [])].flatMap((url) => safeHttpUrl(url) ? [safeHttpUrl(url)!] : []))];
              const leadValue = displayValue(lead.value);
              const leadQualifier = lead.qualifier?.trim();
              const leadAnswer = leadValue && leadQualifier && !leadValue.toLowerCase().includes(leadQualifier.toLowerCase())
                ? `${leadValue} · ${leadQualifier}`
                : leadValue;
              return (
                <li key={`${lead.predicate}:${displayValue(lead.value)}:${index}`} className="panel-inset px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.11em] text-ink-faint">{questionFor(lead.predicate)}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{leadAnswer || "Candidate answer not recorded"}</p>
                    </div>
                    <span className="chip tint-caution shrink-0 normal-case tracking-normal">{lead.provider || "AI"} lead</span>
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
