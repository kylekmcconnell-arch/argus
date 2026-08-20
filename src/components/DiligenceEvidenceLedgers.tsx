import { Bank, Buildings, ShieldWarning } from "@phosphor-icons/react";
import { useId } from "react";
import type {
  CompanyEnrichmentSnapshot,
  ProjectTokenSnapshot,
  ProtocolFundingSnapshot,
  ProtocolTvlSnapshot,
} from "../data/evidence";
import {
  isExactDomainBoundCompanyEnrichment,
  protocolBindingMethodLabel,
  validateProtocolEvidenceBinding,
  type ProtocolBindingContext,
  type ValidatedProtocolBindingReceipt,
} from "../lib/diligenceEvidenceBinding";

const COMPANY_PROVIDER = "Akta via Monid";
const INCIDENT_PROVIDER = "DeFiLlama";

function hostOf(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim().toLowerCase();
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`)
      .hostname
      .replace(/^www\./, "") || null;
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/, 1)[0]
      || null;
  }
}

function safeHref(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function dateLabel(value?: string | null): string {
  if (!value) return "Not recorded";
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function usdLabel(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Not recorded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function listedNames(values: string[]): string {
  const names = values.map((value) => value.trim()).filter(Boolean);
  return names.length > 0 ? names.join(", ") : "None recorded";
}

function FactCell({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-line/60 bg-panel/45 px-3 py-2.5">
      <dt className="mono text-[9.5px] uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className="mt-1 break-words text-[12.5px] font-medium text-ink">{value?.trim() || "Not recorded"}</dd>
    </div>
  );
}

function ProtocolBindingReceiptFields({
  binding,
}: {
  binding: ValidatedProtocolBindingReceipt;
}) {
  const canonical = binding.method === "matched_chain_contract"
    ? binding.canonicalChain + ":" + binding.canonicalAddress
    : binding.method === "matched_official_x_and_domain"
      ? "@" + binding.canonicalHandle
      : binding.canonicalGeckoId;
  const provider = binding.method === "matched_chain_contract"
    ? binding.providerChain + ":" + binding.providerAddress
    : binding.method === "matched_official_x_and_domain"
      ? "@" + binding.providerHandle + " · " + binding.providerDomain
      : binding.providerGeckoId ?? binding.canonicalGeckoId;
  return (
    <>
      <dl className="mt-2 grid gap-2 sm:grid-cols-3">
        <FactCell label={binding.method === "matched_official_x_and_domain" ? "Canonical project identity" : "Canonical token identity"} value={canonical} />
        <FactCell label="Provider identity" value={provider} />
        <FactCell label="Join method" value={protocolBindingMethodLabel(binding)} />
      </dl>
      {binding.scope === "project" && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
          This receipt binds the protocol record to the project only. It does not establish or create token linkage.
        </p>
      )}
    </>
  );
}

function EvidenceSource({
  provider,
  sourceUrl,
  capturedAt,
  linkLabel = "Open provider source",
}: {
  provider: string;
  sourceUrl?: string | null;
  capturedAt?: string | null;
  linkLabel?: string;
}) {
  const href = safeHref(sourceUrl);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line/60 pt-3 text-[11px] text-ink-faint">
      <span>Provider record: {provider}</span>
      <span aria-hidden="true">·</span>
      <span>Captured {dateLabel(capturedAt)}</span>
      {href && (
        <>
          <span aria-hidden="true">·</span>
          <a href={href} target="_blank" rel="noreferrer" className="text-signal-lift underline-offset-2 hover:underline">
            {linkLabel}
          </a>
        </>
      )}
    </div>
  );
}

function CompanyEvidenceLedger({ company }: { company: CompanyEnrichmentSnapshot }) {
  const sectionId = useId();
  const firmographic = company.firmographic;
  const funding = company.funding;
  const management = company.management;

  return (
    <article className="panel overflow-hidden" aria-labelledby={`${sectionId}-title`}>
      <div className="border-b border-line/70 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-signal-lift/25 bg-signal-lift/[0.06] text-signal-lift">
              <Buildings aria-hidden="true" size={18} weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="eyebrow text-signal-lift">Provider-attributed company record</p>
              <h3 id={`${sectionId}-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
                {company.name}
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                Licensed company data bound to the project through its official domain.
              </p>
            </div>
          </div>
          <span className="chip tint-signal">{COMPANY_PROVIDER}</span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <section aria-label="Company identity binding receipt">
          <p className="eyebrow">Binding receipt</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FactCell label="Requested domain" value={hostOf(company.requestedDomain)} />
            <FactCell label="Matched domain" value={hostOf(company.matchedDomain)} />
            <FactCell label="Match method" value={company.matchMethod?.replaceAll("_", " ")} />
            <FactCell label="Provider company ID" value={company.uuid} />
          </dl>
        </section>

        <section aria-label="Company legal and firmographic fields">
          <p className="eyebrow">Company fields</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FactCell label="Legal name" value={firmographic?.legalName} />
            <FactCell label="Founded" value={firmographic?.foundedYear} />
            <FactCell label="Headcount range" value={firmographic?.headcountRange} />
            <FactCell label="Ownership field" value={firmographic?.ownership} />
          </dl>
        </section>

        <section aria-label="Provider-recorded company funding">
          <div className="rounded-lg border border-caution/25 bg-caution/[0.035] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
            These are provider-recorded company financing fields. They are not token treasury, token value, token ownership, or any person's capital.
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="eyebrow">Provider total raised field</p>
              <p className="mono mt-1 text-[20px] font-semibold tabular-nums text-ink">
                {funding ? usdLabel(funding.totalRaisedUsd) : "Section not collected"}
              </p>
            </div>
            <span className="chip">{funding ? `${funding.rounds.length} funding rounds recorded` : "Funding section not collected"}</span>
          </div>

          {funding ? <details className="mt-3 border-t border-line/60 pt-3" open>
            <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink">
              Complete funding-round ledger
            </summary>
            {funding.rounds.length ? (
              <ol className="mt-2 divide-y divide-line/60" aria-label="All provider-recorded company funding rounds">
                {funding.rounds.map((round, index) => (
                  <li key={`${round.date ?? "undated"}:${round.round}:${index}`} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium text-ink">{round.round || "Round type not recorded"}</span>
                      <span className="mono text-[10.5px] text-ink-faint">{dateLabel(round.date)}</span>
                      <span className="mono ml-auto text-[12px] font-semibold tabular-nums text-ink">{usdLabel(round.amountUsd)}</span>
                    </div>
                    <dl className="mt-2 grid gap-1.5 text-[11.5px] leading-relaxed sm:grid-cols-2">
                      <div>
                        <dt className="inline font-medium text-ink-dim">Lead investors: </dt>
                        <dd className="inline text-ink-faint">{listedNames(round.leadInvestors)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-ink-dim">Other investors: </dt>
                        <dd className="inline text-ink-faint">{listedNames(round.otherInvestors)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[11.5px] text-ink-faint">The collected provider funding section returned zero round rows.</p>
            )}
          </details> : (
            <p className="mt-3 border-t border-line/60 pt-3 text-[11.5px] leading-relaxed text-ink-faint">
              Funding enrichment was not collected in this provider request. This is not a zero-round result.
            </p>
          )}
        </section>

        {management ? <details className="border-t border-line/60 pt-3" open>
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink">
            Management records ({management.length})
          </summary>
          {management.length > 0 ? (
            <ol className="mt-2 grid gap-2 md:grid-cols-2" aria-label="All provider-recorded management records">
              {management.map((person, index) => {
                const linkedin = safeHref(person.linkedin);
                return (
                  <li key={`${person.name}:${person.title}:${index}`} className="rounded-lg border border-line/60 bg-panel/45 p-3">
                    <p className="text-[13px] font-semibold text-ink">{person.name || "Name not recorded"}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-dim">{person.title || "Title not recorded"}</p>
                    <dl className="mt-2 space-y-1 text-[11px] leading-relaxed text-ink-faint">
                      <div>
                        <dt className="inline font-medium text-ink-dim">Start year: </dt>
                        <dd className="inline">{person.startYear || "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-ink-dim">Prior companies: </dt>
                        <dd className="inline">{listedNames(person.priorCompanies)}</dd>
                      </div>
                    </dl>
                    {linkedin && (
                      <a href={linkedin} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[11px] text-signal-lift underline-offset-2 hover:underline">
                        Open provider-listed LinkedIn profile
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-2 text-[11.5px] text-ink-faint">The collected provider management section returned zero rows.</p>
          )}
        </details> : (
          <section className="border-t border-line/60 pt-3" aria-label="Management enrichment coverage">
            <p className="text-[12px] font-semibold text-ink">Management records</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
              Management enrichment was not collected in this provider request. This is not evidence that no management records exist.
            </p>
          </section>
        )}

        <EvidenceSource
          provider={COMPANY_PROVIDER}
          sourceUrl={company.sourceUrl}
          capturedAt={company.capturedAt}
          linkLabel="Open matched company website"
        />
      </div>
    </article>
  );
}

function ProtocolFundingLedger({
  funding,
  binding,
}: {
  funding: ProtocolFundingSnapshot;
  binding: ValidatedProtocolBindingReceipt;
}) {
  const sectionId = useId();
  const rounds = [...funding.rounds].sort((left, right) =>
    String(right.date ?? "").localeCompare(String(left.date ?? "")));
  const pricedRounds = rounds.filter((round) =>
    typeof round.amountUsd === "number" && Number.isFinite(round.amountUsd) && round.amountUsd > 0);
  const explicitAmountSum = pricedRounds.reduce((sum, round) => sum + (round.amountUsd ?? 0), 0);

  return (
    <article className="panel overflow-hidden" aria-labelledby={`${sectionId}-title`}>
      <div className="border-b border-line/70 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-signal-lift/25 bg-signal-lift/[0.06] text-signal-lift">
              <Bank aria-hidden="true" size={18} weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="eyebrow text-signal-lift">Provider-recorded protocol financing</p>
              <h3 id={`${sectionId}-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
                Complete public funding ledger
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                Every financing row saved in the exact identity-bound protocol record.
              </p>
            </div>
          </div>
          <span className="chip tint-signal">{INCIDENT_PROVIDER}</span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <section aria-label="Protocol funding identity binding receipt">
          <p className="eyebrow">Binding receipt</p>
          <ProtocolBindingReceiptFields binding={binding} />
        </section>

        <section aria-label="Bounded protocol funding aggregates">
          <dl className="grid gap-2 sm:grid-cols-3">
            <FactCell label="Funding rows" value={String(rounds.length)} />
            <FactCell label="Rows with explicit amount" value={String(pricedRounds.length)} />
            <FactCell label="Sum of explicit amounts" value={pricedRounds.length > 0 ? usdLabel(explicitAmountSum) : "Not recorded"} />
          </dl>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
            The amount is a bounded sum of {pricedRounds.length} of {rounds.length} saved rows, not a claim about current treasury cash or all capital ever raised.
          </p>
        </section>

        <div className="rounded-lg border border-caution/25 bg-caution/[0.035] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
          Investor names and valuations are provider-recorded context. They do not establish current ownership, token rights, endorsement, lockups, or capital still held by the project.
        </div>

        <details className="border-t border-line/60 pt-3" open>
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink">
            Complete funding-round ledger ({rounds.length})
          </summary>
          {rounds.length > 0 ? (
            <ol className="mt-2 divide-y divide-line/60" aria-label="All provider-recorded protocol funding rounds">
              {rounds.map((round, index) => (
                <li key={`${round.date ?? "undated"}:${round.round}:${index}`} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">{round.round || "Round type not recorded"}</span>
                    <span className="mono text-[10.5px] text-ink-faint">{dateLabel(round.date)}</span>
                    <span className="mono ml-auto text-[12px] font-semibold tabular-nums text-ink">{usdLabel(round.amountUsd)}</span>
                  </div>
                  <dl className="mt-2 grid gap-1.5 text-[11.5px] leading-relaxed sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium text-ink-dim">Lead investors: </dt>
                      <dd className="inline text-ink-faint">{listedNames(round.leadInvestors)}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-ink-dim">Other investors: </dt>
                      <dd className="inline text-ink-faint">{listedNames(round.otherInvestors)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-medium text-ink-dim">Provider valuation field: </dt>
                      <dd className="inline text-ink-faint">{usdLabel(round.valuationUsd)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[11.5px] text-ink-faint">No funding-round rows were present in this provider record.</p>
          )}
        </details>

        <EvidenceSource provider={INCIDENT_PROVIDER} sourceUrl={funding.sourceUrl} capturedAt={funding.capturedAt} />
      </div>
    </article>
  );
}

function ProtocolIncidentLedger({
  protocolTvl,
  binding,
}: {
  protocolTvl: ProtocolTvlSnapshot;
  binding: ValidatedProtocolBindingReceipt;
}) {
  const sectionId = useId();
  const incidents = [...(protocolTvl.hacks ?? [])]
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
  const quantified = incidents.filter((incident) =>
    typeof incident.amountUsd === "number" && Number.isFinite(incident.amountUsd) && incident.amountUsd >= 0);
  const returnedAmounts = incidents.filter((incident) =>
    typeof incident.returnedAmountUsd === "number"
    && Number.isFinite(incident.returnedAmountUsd)
    && incident.returnedAmountUsd >= 0);
  const grossAmount = quantified.reduce((sum, incident) => sum + (incident.amountUsd ?? 0), 0);
  const returnedAmount = returnedAmounts.reduce((sum, incident) => sum + (incident.returnedAmountUsd ?? 0), 0);
  const markedReturned = incidents.filter((incident) => incident.returnedFunds === true).length;
  const explicitReturnStates = incidents.filter((incident) => incident.returnedFunds !== null).length;

  return (
    <article className="panel overflow-hidden" aria-labelledby={`${sectionId}-title`}>
      <div className="border-b border-line/70 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-caution/30 bg-caution/[0.06] text-caution">
              <ShieldWarning aria-hidden="true" size={18} weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="eyebrow text-caution">Provider-recorded event history</p>
              <h3 id={`${sectionId}-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
                Protocol incident ledger
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                Complete incident rows in the saved protocol record, attributed to the provider.
              </p>
            </div>
          </div>
          <span className="chip tint-caution">{INCIDENT_PROVIDER}</span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <section aria-label="Protocol identity binding receipt">
          <p className="eyebrow">Binding receipt</p>
          <ProtocolBindingReceiptFields binding={binding} />
        </section>

        <section aria-label="Bounded incident aggregates">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <FactCell label="Incident rows" value={String(incidents.length)} />
            <FactCell label="Gross recorded amounts" value={quantified.length > 0 ? usdLabel(grossAmount) : "Not recorded"} />
            <FactCell label="Explicit returned amounts" value={returnedAmounts.length > 0 ? usdLabel(returnedAmount) : "Not recorded"} />
            <FactCell label="Provider marked returned" value={`${markedReturned} of ${explicitReturnStates} explicit return-state rows`} />
          </dl>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
            Gross total uses {quantified.length} of {incidents.length} rows with an explicit amount. Returned total uses {returnedAmounts.length} {returnedAmounts.length === 1 ? "row" : "rows"} with an explicit returned amount.
          </p>
        </section>

        <div className="rounded-lg border border-caution/25 bg-caution/[0.035] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
          Amounts are gross event amounts in the provider record. They are not labeled as losses here. A missing returned amount is not treated as unrecovered capital. These rows do not establish cause or current protocol security.
        </div>

        <details className="border-t border-line/60 pt-3" open>
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink">
            Complete incident ledger ({incidents.length})
          </summary>
          <ol className="mt-2 divide-y divide-line/60" aria-label="All provider-recorded protocol incidents">
            {incidents.map((incident, index) => (
              <li key={`${incident.date ?? "undated"}:${incident.amountUsd ?? "unquantified"}:${index}`} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-ink">{dateLabel(incident.date)}</span>
                  <span className="mono ml-auto text-[12px] font-semibold tabular-nums text-ink">{usdLabel(incident.amountUsd)}</span>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-[11.5px] leading-relaxed sm:grid-cols-2">
                  <div>
                    <dt className="inline font-medium text-ink-dim">Provider classification: </dt>
                    <dd className="inline text-ink-faint">{incident.classification || "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-dim">Provider technique: </dt>
                    <dd className="inline text-ink-faint">{incident.technique || "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-dim">Returned-funds field: </dt>
                    <dd className="inline text-ink-faint">{incident.returnedFunds === true ? "Yes" : incident.returnedFunds === false ? "No" : "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-dim">Returned amount field: </dt>
                    <dd className="inline text-ink-faint">{usdLabel(incident.returnedAmountUsd)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="inline font-medium text-ink-dim">Source attribution: </dt>
                    <dd className="inline text-ink-faint">{INCIDENT_PROVIDER} protocol record</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        </details>

        <EvidenceSource provider={INCIDENT_PROVIDER} sourceUrl={protocolTvl.sourceUrl} capturedAt={protocolTvl.capturedAt} />
      </div>
    </article>
  );
}

export function DiligenceEvidenceLedgers({
  company,
  protocolFunding,
  protocolTvl,
  projectToken,
  officialHandle,
  officialWebsite,
  officialWebsites,
  canonicalGeckoId,
  className = "",
}: {
  company?: CompanyEnrichmentSnapshot | null;
  protocolFunding?: ProtocolFundingSnapshot | null;
  protocolTvl?: ProtocolTvlSnapshot | null;
  projectToken?: ProjectTokenSnapshot | null;
  officialHandle?: string | null;
  officialWebsite?: string | null;
  officialWebsites?: readonly string[] | null;
  canonicalGeckoId?: string | null;
  className?: string;
}) {
  const boundCompany = isExactDomainBoundCompanyEnrichment(company, officialWebsite) ? company : null;
  const bindingContext: ProtocolBindingContext = {
    projectToken,
    canonicalGeckoId,
    officialHandle,
    officialWebsites: [officialWebsite, ...(officialWebsites ?? [])],
  };
  const fundingValidation = validateProtocolEvidenceBinding(bindingContext, protocolFunding);
  const tvlValidation = validateProtocolEvidenceBinding(bindingContext, protocolTvl);
  const boundFunding = fundingValidation.state === "matched" ? protocolFunding : null;
  const boundProtocol = tvlValidation.state === "matched" ? protocolTvl : null;
  const hasIncidents = Boolean(boundProtocol?.hacks?.length);
  if (!boundCompany && !boundFunding && !hasIncidents) return null;

  return (
    <section className={`space-y-3 ${className}`} aria-label="Provider evidence ledgers">
      {boundCompany && <CompanyEvidenceLedger company={boundCompany} />}
      {boundFunding && fundingValidation.state === "matched" && (
        <ProtocolFundingLedger funding={boundFunding} binding={fundingValidation.binding} />
      )}
      {boundProtocol && hasIncidents && tvlValidation.state === "matched" && (
        <ProtocolIncidentLedger protocolTvl={boundProtocol} binding={tvlValidation.binding} />
      )}
    </section>
  );
}
