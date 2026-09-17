import { useId } from "react";
import type { Dossier } from "../data/dossier";
import { usdCompact } from "../lib/format";
import {
  BACKER_TYPE_LABEL,
  classifyBacker,
  fundraisingTrajectory,
  mergeFundraisingRounds,
  type FundraisingRound,
} from "../lib/fundraising";

// Fundraising & backers: every identity-bound funding record frozen with this
// report, as one chronological story - when each round happened, how much was
// raised, at what valuation, what was sold (token terms when the index states
// them), and who backed it, with each backer classified by name and the venue
// registry. Aggregator indexes are discovery records, never a cap table.

const stated = (value: number | null | undefined, format: (n: number) => string): string =>
  value && value > 0 ? format(value) : "not stated by the index";

function RoundRow({ round }: { round: FundraisingRound }) {
  const backers = [
    ...round.leadInvestors.map((name) => ({ name, lead: true })),
    ...round.otherInvestors.map((name) => ({ name, lead: false })),
  ];
  return (
    <div className="border-b border-line/60 px-4 py-3 last:border-b-0 sm:px-5" data-testid="fundraising-round">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="mono text-[12px] text-ink-dim">{round.date ?? "undated"}</span>
        <span className="text-[13.5px] font-medium text-ink">{round.label}</span>
        <span className="mono text-[13px] text-ink">{stated(round.amountUsd, usdCompact)}</span>
        <span className="text-[12px] text-ink-dim">valuation {stated(round.valuationUsd, usdCompact)}</span>
        <span className={`chip ${round.instrument === "token_sale" ? "tint-signal" : "tint-neutral"}`}>
          {round.instrument === "token_sale" ? "Token sale" : "Instrument not stated"}
        </span>
      </div>
      {round.instrument === "token_sale" && (
        <p className="mt-1 text-[12px] text-ink-dim">
          Token terms: price {stated(round.tokenPriceUsd, (n) => `$${n}`)}
          {round.tokensForSale ? ` · ${round.tokensForSale.toLocaleString()} tokens offered` : ""}
          {round.allocationOfSupplyPct ? ` · ${round.allocationOfSupplyPct}% of supply` : ""}
        </p>
      )}
      {backers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {backers.map((backer) => (
            <span key={backer.name} className={`chip ${backer.lead ? "tint-pass" : ""}`} title={backer.lead ? "Named lead in this round" : "Named participant"}>
              {backer.name} · {BACKER_TYPE_LABEL[classifyBacker(backer.name)]}{backer.lead ? " · lead" : ""}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-ink-faint">
        {round.sources.map((source, index) => (
          <span key={source.url}>
            {index > 0 ? " · " : ""}
            <a href={source.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{source.title}</a>
          </span>
        ))}
        {round.announcementUrl && (
          <>
            {" · "}
            <a href={round.announcementUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">announcement</a>
          </>
        )}
      </p>
    </div>
  );
}

export function FundraisingPanel({
  dossier,
  id = "fundraising",
}: {
  dossier: Pick<Dossier, "protocolFunding" | "cryptoRankFunding" | "companyEnrichment" | "website" | "stockHealth">;
  id?: string;
}) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `${generatedId}-title`;
  const rounds = mergeFundraisingRounds(dossier);
  if (!rounds.length) return null;
  const trajectory = fundraisingTrajectory(rounds);
  const directionCopy = trajectory.valuationDirection === "rising"
    ? "valuations rose across the rounds that state one"
    : trajectory.valuationDirection === "falling"
      ? "valuations fell across the rounds that state one"
      : trajectory.valuationDirection === "mixed"
        ? "valuations moved in both directions across rounds"
        : "too few rounds state a valuation to read a direction";

  return (
    <section id={id} className="report-section mt-6 scroll-mt-28" aria-labelledby={titleId} data-testid="fundraising">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Fundraising &amp; backers</p>
          <h2 id={titleId} className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
            Who funded it, when, and on what terms
          </h2>
          <p className="story-chapter-description mt-2 max-w-3xl leading-relaxed text-ink-dim">
            Every identity-bound funding record saved with this report, in order. Indexed rounds are a floor, not a cap
            table; a field an index does not state is unknown here, not zero. Backer types are read from the backer&apos;s
            name and ARGUS&apos;s launch-venue registry: a classification aid, not a verified fact about that entity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <span className="chip tint-neutral">{trajectory.roundCount} round{trajectory.roundCount === 1 ? "" : "s"} indexed</span>
          {trajectory.totalDisclosedUsd > 0 && <span className="chip tint-pass">{usdCompact(trajectory.totalDisclosedUsd)} disclosed</span>}
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        {rounds.map((round, index) => <RoundRow key={`${round.date}:${round.label}:${index}`} round={round} />)}
        <div className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-dim sm:px-5">
          {trajectory.firstDate && trajectory.lastDate && trajectory.firstDate !== trajectory.lastDate
            ? `Raising spanned ${trajectory.firstDate} to ${trajectory.lastDate}; `
            : ""}
          {directionCopy}.
          {dossier.stockHealth
            ? " This subject also has a verified public listing: listed-company fundraising additionally includes share issuances, which live in the SEC filings record, not in these token-market indexes."
            : ""}
        </div>
      </div>
    </section>
  );
}
