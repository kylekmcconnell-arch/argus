/**
 * Deterministic investigator-brief derivations, computed at render time from
 * the frozen payload. Two products:
 *
 *  - deriveNoticedSignals: the "ARGUS noticed" rail. Rules over stats the
 *    report already holds, ranked so the three most decision-relevant
 *    anomalies stop hiding inside stat grids.
 *  - deriveVerdictArgument: the hero argues its result in three lines:
 *    strongest evidence for it, sharpest concern against it, and what would
 *    change it.
 *
 * Everything here is presentation-side selection and phrasing. No scoring
 * input, no floors, no caps: the verdict machinery upstream stays untouched.
 */
import { usdCompact } from "./format";

export type NoticedSeverity = "alert" | "watch" | "note";

export interface NoticedSignal {
  id: string;
  severity: NoticedSeverity;
  headline: string;
  detail: string;
  anchor?: string;
}

export interface NoticedInputs {
  lpLockedPct?: number | null;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  holderCount?: number | null;
  circulatingPct?: number | null;
  fdvUsd?: number | null;
  marketCapUsd?: number | null;
  volume24hUsd?: number | null;
  nextUnlock?: {
    date?: string | null;
    amountUsd?: number | null;
    pctSupply?: number | null;
  } | null;
  tvlChange30dPct?: number | null;
  feesChange30dPct?: number | null;
  athDrawdownPct?: number | null;
  accountSuspended?: boolean;
  daysSinceLastPost?: number | null;
  verifiedTeamCount?: number | null;
  namedTeamCount?: number | null;
  anchors?: {
    market?: string;
    team?: string;
    account?: string;
  };
}

const SEVERITY_RANK: Record<NoticedSeverity, number> = { alert: 0, watch: 1, note: 2 };

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const pct = (value: number): string => `${Math.round(value)}%`;

/** Rules over already-collected stats; returns every firing signal ranked by severity. */
export function deriveNoticedSignals(input: NoticedInputs): NoticedSignal[] {
  const signals: NoticedSignal[] = [];
  const anchors = input.anchors ?? {};

  if (isNum(input.lpLockedPct) && input.lpLockedPct <= 5) {
    signals.push({
      id: "lp-unlocked",
      severity: "alert",
      headline: input.lpLockedPct === 0
        ? "None of the trading liquidity is locked"
        : "Almost none of the trading liquidity is locked",
      detail: `${pct(input.lpLockedPct)} of DEX liquidity is locked or burned, so the trading pool can be removed at any time.`,
      anchor: anchors.market,
    });
  }

  if (isNum(input.largestHolderPct) && input.largestHolderPct >= 20) {
    const top10 = isNum(input.top10HolderPct) ? ` The top 10 wallets hold ${pct(input.top10HolderPct)}.` : "";
    signals.push({
      id: "holder-concentration",
      severity: "alert",
      headline: `One wallet holds ${pct(input.largestHolderPct)} of the supply`,
      detail: `A single holder can move the price on its own.${top10}`,
      anchor: anchors.market,
    });
  } else if (isNum(input.top10HolderPct) && input.top10HolderPct >= 60) {
    signals.push({
      id: "holder-concentration",
      severity: "watch",
      headline: `The top 10 wallets hold ${pct(input.top10HolderPct)} of the supply`,
      detail: "Ownership is concentrated enough for a small group to move the market.",
      anchor: anchors.market,
    });
  }

  const unlockUsd = input.nextUnlock?.amountUsd;
  if (isNum(unlockUsd) && unlockUsd > 0 && isNum(input.volume24hUsd) && input.volume24hUsd > 0) {
    const daysOfVolume = unlockUsd / input.volume24hUsd;
    if (daysOfVolume >= 3) {
      const when = input.nextUnlock?.date ? ` on ${input.nextUnlock.date}` : "";
      const share = isNum(input.nextUnlock?.pctSupply) ? ` (${pct(input.nextUnlock.pctSupply)} of supply)` : "";
      signals.push({
        id: "unlock-pressure",
        severity: daysOfVolume >= 10 ? "alert" : "watch",
        headline: `The next unlock equals ${Math.round(daysOfVolume)} days of trading`,
        detail: `${usdCompact(unlockUsd)}${share} unlocks${when}, against ${usdCompact(input.volume24hUsd)} of typical daily volume.`,
        anchor: anchors.market,
      });
    }
  }

  if (
    isNum(input.tvlChange30dPct) && isNum(input.feesChange30dPct)
    && Math.abs(input.tvlChange30dPct) >= 10 && Math.abs(input.feesChange30dPct) >= 10
    && Math.sign(input.tvlChange30dPct) !== Math.sign(input.feesChange30dPct)
  ) {
    const fees = input.feesChange30dPct > 0 ? `rose ${pct(input.feesChange30dPct)}` : `fell ${pct(Math.abs(input.feesChange30dPct))}`;
    const tvl = input.tvlChange30dPct > 0 ? `rose ${pct(input.tvlChange30dPct)}` : `fell ${pct(Math.abs(input.tvlChange30dPct))}`;
    signals.push({
      id: "usage-capital-divergence",
      severity: "watch",
      headline: "Usage and locked capital are moving in opposite directions",
      detail: `Fees ${fees} while locked value ${tvl} over 30 days.`,
      anchor: anchors.market,
    });
  }

  if (
    isNum(input.circulatingPct) && input.circulatingPct <= 50
    && isNum(input.fdvUsd) && isNum(input.marketCapUsd) && input.marketCapUsd > 0
  ) {
    const ratio = input.fdvUsd / input.marketCapUsd;
    if (ratio >= 1.5) {
      signals.push({
        id: "supply-overhang",
        severity: "watch",
        headline: `Only ${pct(input.circulatingPct)} of the supply is circulating`,
        detail: `The all-token value is ${ratio.toFixed(1)}x the market cap; most of the supply has not been released yet.`,
        anchor: anchors.market,
      });
    }
  }

  if (input.accountSuspended) {
    signals.push({
      id: "account-suspended",
      severity: "alert",
      headline: "The official X account is suspended",
      detail: "Suspension alone is not proof of wrongdoing, but the project currently has no live official voice.",
      anchor: anchors.account,
    });
  } else if (
    isNum(input.daysSinceLastPost) && input.daysSinceLastPost >= 30
    && isNum(input.volume24hUsd) && input.volume24hUsd >= 100_000
  ) {
    signals.push({
      id: "account-quiet",
      severity: "watch",
      headline: `The official account has been silent for ${Math.round(input.daysSinceLastPost)} days`,
      detail: `No posts while the token still trades ${usdCompact(input.volume24hUsd)} a day.`,
      anchor: anchors.account,
    });
  }

  if (
    isNum(input.verifiedTeamCount) && input.verifiedTeamCount === 0
    && isNum(input.marketCapUsd) && input.marketCapUsd >= 10_000_000
  ) {
    const named = isNum(input.namedTeamCount) && input.namedTeamCount > 0
      ? `${input.namedTeamCount} named ${input.namedTeamCount === 1 ? "person" : "people"}, none independently verified.`
      : "No team member has been independently verified.";
    signals.push({
      id: "team-unverified",
      severity: "alert",
      headline: `No verified team behind a ${usdCompact(input.marketCapUsd)} token`,
      detail: named,
      anchor: anchors.team,
    });
  }

  if (isNum(input.athDrawdownPct) && input.athDrawdownPct <= -90) {
    signals.push({
      id: "deep-drawdown",
      severity: "note",
      headline: `Trading ${pct(Math.abs(input.athDrawdownPct))} below its lifetime high`,
      detail: "Deep drawdowns are common in this market, but recovery to prior highs is rare.",
      anchor: anchors.market,
    });
  }

  return signals.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export interface VerdictArgumentInputs {
  verdict?: string | null;
  supports?: readonly (string | null | undefined)[];
  concerns?: readonly (string | null | undefined)[];
  capReason?: string | null;
  nextChecks?: readonly (string | null | undefined)[];
}

export interface VerdictArgument {
  forLine: string | null;
  againstLine: string | null;
  moveLine: string;
}

const firstMeaningful = (values?: readonly (string | null | undefined)[]): string | null => {
  for (const value of values ?? []) {
    const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const sentence = (value: string): string => /[.!?]$/.test(value) ? value : `${value}.`;

/**
 * Select the three lines the hero argues with. A cap always wins the concern
 * slot; an adverse verdict with no recorded concern states that honestly
 * instead of inventing one.
 */
export function deriveVerdictArgument(input: VerdictArgumentInputs): VerdictArgument {
  const support = firstMeaningful(input.supports);
  const cap = (input.capReason ?? "").trim();
  const concern = cap || firstMeaningful(input.concerns);
  const next = (input.nextChecks ?? [])
    .map((value) => (value ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2);

  const adverse = /^(?:caution|fail|avoid|unverifiable)/i.test((input.verdict ?? "").trim());

  return {
    forLine: support ? sentence(support) : null,
    againstLine: concern
      ? sentence(concern)
      : adverse
        ? "The concern here is coverage: too little verified evidence, not adverse findings."
        : null,
    moveLine: next.length
      ? `${next.join("; ")}.`
      : "No checks remain open; a rescan would test whether this result still holds.",
  };
}
