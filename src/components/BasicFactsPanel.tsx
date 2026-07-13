import {
  ArrowSquareOut,
  CheckCircle,
  MagnifyingGlass,
  Warning,
} from "@phosphor-icons/react";

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
      .map((value) => [value.toLowerCase(), value])).values()];
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
          <div className="grid shrink-0 grid-cols-3 gap-1.5 text-center" aria-label="Basic facts coverage">
            <div className="panel-inset min-w-16 px-2.5 py-2">
              <div className="mono text-[14px] font-semibold text-pass">{answered}/{applicable}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-ink-faint">answered</div>
            </div>
            <div className="panel-inset min-w-16 px-2.5 py-2">
              <div className={`mono text-[14px] font-semibold ${conflicted ? "text-avoid" : "text-ink-dim"}`}>{conflicted}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-ink-faint">conflicts</div>
            </div>
            <div className="panel-inset min-w-16 px-2.5 py-2">
              <div className={`mono text-[14px] font-semibold ${unresolved ? "text-caution" : "text-ink-dim"}`}>{unresolved}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-ink-faint">open</div>
            </div>
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-line/70" aria-hidden="true">
          <div className="h-full rounded-full bg-pass transition-[width]" style={{ width: `${applicable ? (answered / applicable) * 100 : 0}%` }} />
        </div>
      </header>

      {rows.length > 0 && (
        <ol className="divide-y divide-line/60" aria-label="Required diligence questions">
          {rows.map((fact, index) => {
            const meta = STATUS_META[fact.status as Exclude<BasicFactStatus, "lead">] ?? STATUS_META.unresolved;
            const sources = dedupeSources(fact.sources ?? []);
            return (
              <li key={fact.factId || `${fact.predicate}:${index}`} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] sm:px-5">
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    {fact.status === "verified" || fact.status === "corroborated" ? (
                      <CheckCircle aria-hidden="true" size={17} weight="fill" className="mt-0.5 shrink-0 text-pass" />
                    ) : fact.status === "conflicted" ? (
                      <Warning aria-hidden="true" size={17} weight="fill" className="mt-0.5 shrink-0 text-avoid" />
                    ) : (
                      <MagnifyingGlass aria-hidden="true" size={17} weight="bold" className="mt-0.5 shrink-0 text-caution" />
                    )}
                    <p className="text-[12.5px] font-medium leading-relaxed text-ink">{questionFor(fact.predicate)}</p>
                  </div>
                  {fact.critical && <span className="mono ml-6 mt-1 block text-[9px] uppercase tracking-[0.12em] text-ink-faint">decision critical</span>}
                </div>
                <div className="min-w-0 sm:border-l sm:border-line/60 sm:pl-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <p className={`min-w-0 flex-1 text-[12.5px] leading-relaxed ${fact.status === "unresolved" || fact.status === "not_applicable" ? "text-ink-faint" : "text-ink"}`}>
                      {answerFor(fact)}
                    </p>
                    <span className={`chip shrink-0 normal-case tracking-normal ${meta.className}`}>{meta.label}</span>
                  </div>
                  {fact.status === "conflicted" && (
                    <p className="mt-1 text-[11px] leading-relaxed text-avoid">The sources disagree. ARGUS has not selected a clean answer.</p>
                  )}
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
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {discoveryLeads.length > 0 && (
        <div className="border-t border-caution/30 bg-caution/[0.035] px-4 py-4 sm:px-5" aria-label="Unverified basic fact leads">
          <div className="flex items-start gap-2.5">
            <MagnifyingGlass aria-hidden="true" size={18} weight="bold" className="mt-0.5 shrink-0 text-caution" />
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-ink">Unverified discovery leads</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                AI-suggested answers stay out of the facts above until ARGUS fetches and verifies the underlying source. They do not affect the verdict.
              </p>
            </div>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
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
        </div>
      )}
    </section>
  );
}
