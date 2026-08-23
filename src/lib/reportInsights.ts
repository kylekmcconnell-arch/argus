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

// Same pattern as src/threat/tokenomics.ts's NFT_POSITION check: a
// concentrated-liquidity AMM (Uniswap V3/V4, Raydium CLMM/CPMM, Meteora DLMM,
// Orca Whirlpool) holds liquidity as a position NFT, not an ERC20 LP token —
// duplicated here rather than imported so this presentation module stays
// independent of the standalone threat-scanner module's internals.
const CONCENTRATED_LIQUIDITY_DEX = /\bv3\b|\bv4\b|clmm|cpmm|dlmm|whirlpool|concentrated/i;
export function isConcentratedLiquidityPool(dexId?: string | null, dexLabels?: readonly string[] | null): boolean {
  return (dexLabels ?? []).some((label) => CONCENTRATED_LIQUIDITY_DEX.test(label))
    || CONCENTRATED_LIQUIDITY_DEX.test(dexId ?? "");
}

export type NoticedSeverity = "alert" | "watch" | "note";

export interface NoticedSignal {
  id: string;
  severity: NoticedSeverity;
  headline: string;
  detail: string;
  anchor?: string;
}

/**
 * Top-ten share summed from a token audit's own holder rows.
 *
 * Two things make this a floor rather than a total, and both suppress it:
 * a register the token lane already judged self-inconsistent (`holdersAssessed`
 * false, which is how it says its percentages summed past supply), and a row
 * list shorter than ten, which would publish four wallets' share as the top
 * ten's. It exists so a suppressed project-side concentration figure cannot be
 * quietly backfilled with an unreliable one.
 */
export function top10ShareFromRows(
  rows: readonly { percent?: number | null }[] | undefined,
  holdersAssessed: boolean | undefined,
): number | null {
  if (holdersAssessed === false || !rows || rows.length < 10) return null;
  const shares = rows.slice(0, 10).map((row) => row.percent);
  if (shares.some((share) => typeof share !== "number" || !Number.isFinite(share) || share < 0)) return null;
  const total = (shares as number[]).reduce((sum, share) => sum + share, 0);
  // A sum past supply is the same self-inconsistency, caught row-side.
  return total > 100 ? null : total;
}

export interface NoticedInputs {
  lpLockedPct?: number | null;
  /**
   * True when the pool is a concentrated-liquidity / position-NFT AMM
   * (Uniswap V3/V4, Raydium CLMM, Meteora DLMM, Orca Whirlpool). There is no
   * ERC20 LP token to lock or burn on these pools, so lpLockedPct reads as 0
   * by construction — that is not evidence the liquidity is removable, and
   * asserting "None of the trading liquidity is locked" from it is a false
   * positive (the same class of pool src/threat/tokenomics.ts already treats
   * as "nft-position" rather than "unlocked").
   */
  isConcentratedLiquidityPool?: boolean;
  largestHolderPct?: number | null;
  top10HolderPct?: number | null;
  /** Number of wallet rows included in top10HolderPct. */
  assessedWalletCount?: number | null;
  /** Whether top10HolderPct is a lower bound from fewer than ten rows. */
  top10HolderPctIsFloor?: boolean;
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
  /** First-party role attributions published by the project itself. */
  projectAttributedTeam?: Array<{ name: string; role?: string }>;
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
  const assessedWalletCount = Number.isInteger(input.assessedWalletCount)
    && (input.assessedWalletCount ?? 0) >= 1
    && (input.assessedWalletCount ?? 0) <= 10
    ? input.assessedWalletCount as number
    : null;
  const holderAggregate = isNum(input.top10HolderPct)
    && (
      (input.top10HolderPctIsFloor === true && assessedWalletCount !== null && assessedWalletCount < 10)
      || (input.top10HolderPctIsFloor === false && assessedWalletCount === 10)
    )
    ? {
        sharePct: input.top10HolderPct,
        assessedWalletCount: assessedWalletCount as number,
        isFloor: input.top10HolderPctIsFloor === true,
      }
    : null;
  const holderAggregateSentence = holderAggregate
    ? holderAggregate.isFloor
      ? ` At least ${pct(holderAggregate.sharePct)} of supply sits across ${holderAggregate.assessedWalletCount} assessed wallet${holderAggregate.assessedWalletCount === 1 ? "" : "s"}.`
      : ` The top 10 wallets hold ${pct(holderAggregate.sharePct)}.`
    : "";

  if (isNum(input.lpLockedPct) && input.lpLockedPct <= 5 && !input.isConcentratedLiquidityPool) {
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
    signals.push({
      id: "holder-concentration",
      severity: "alert",
      headline: `One wallet holds ${pct(input.largestHolderPct)} of the supply`,
      detail: `A single holder can move the price on its own.${holderAggregateSentence}`,
      anchor: anchors.market,
    });
  } else if (holderAggregate && holderAggregate.sharePct >= 60) {
    signals.push({
      id: "holder-concentration",
      severity: "watch",
      headline: holderAggregate.isFloor
        ? `At least ${pct(holderAggregate.sharePct)} sits across ${holderAggregate.assessedWalletCount} assessed wallet${holderAggregate.assessedWalletCount === 1 ? "" : "s"}`
        : `The top 10 wallets hold ${pct(holderAggregate.sharePct)} of the supply`,
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
    isNum(input.daysSinceLastPost)
    && (input.daysSinceLastPost >= 90
      || (input.daysSinceLastPost >= 30 && isNum(input.volume24hUsd) && input.volume24hUsd >= 100_000))
  ) {
    const days = Math.round(input.daysSinceLastPost);
    signals.push({
      id: "account-quiet",
      // Half a year of silence from the official voice is a leading red flag
      // on its own, token or not; shorter gaps stay a watch item.
      severity: days >= 180 ? "alert" : "watch",
      headline: `The official account has been silent for ${days} days`,
      detail: isNum(input.volume24hUsd) && input.volume24hUsd >= 100_000
        ? `No posts while the token still trades ${usdCompact(input.volume24hUsd)} a day.`
        : "A live project talks. Months of silence from the official account is a warning on its own.",
      anchor: anchors.account,
    });
  }

  if (
    isNum(input.verifiedTeamCount) && input.verifiedTeamCount === 0
    && isNum(input.marketCapUsd) && input.marketCapUsd >= 10_000_000
  ) {
    const attributed = (input.projectAttributedTeam ?? [])
      .filter((person) => person.name.trim())
      .slice(0, 4);
    const attributedLabel = attributed.map((person) =>
      `${person.name}${person.role ? ` as ${person.role}` : ""}`).join(", ");
    const named = attributed.length > 0
      ? `The project identifies ${attributedLabel}. That establishes its published role attribution, not independent proof of the person's identity, ownership, or control.`
      : isNum(input.namedTeamCount) && input.namedTeamCount > 0
        ? `${input.namedTeamCount} named ${input.namedTeamCount === 1 ? "person" : "people"}, none independently corroborated.`
        : "No team member has been independently corroborated.";
    signals.push({
      id: "team-unverified",
      severity: "alert",
      headline: attributed.length > 0
        ? `${attributed.length === 1 && /founder|creator/i.test(attributed[0]?.role ?? "") ? "Project-attributed founder" : "Project-attributed team"} behind a ${usdCompact(input.marketCapUsd)} token`
        : `No independently corroborated team behind a ${usdCompact(input.marketCapUsd)} token`,
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

const TICKER_STOPWORDS = new Set([
  "USD", "USDT", "USDC", "BTC", "ETH", "SOL", "BNB", "AI", "APY", "APR",
  "CEO", "CTO", "COO", "IPO", "LLC", "INC", "DAO", "NFT", "TVL", "FDV",
]);

/**
 * The first plausible self-claimed ticker in a profile bio ("Powered by
 * $ORBIT"). Used to direct the reader to the token scan when a scan could
 * not bind the claimed token; never used as evidence of anything.
 */
export function claimedTicker(bio: string | null | undefined): string | null {
  for (const match of (bio ?? "").matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)) {
    const ticker = match[1].toUpperCase();
    if (!TICKER_STOPWORDS.has(ticker)) return ticker;
  }
  return null;
}

export interface VerdictArgumentInputs {
  verdict?: string | null;
  supports?: readonly (string | null | undefined)[];
  concerns?: readonly (string | null | undefined)[];
  capReason?: string | null;
  nextChecks?: readonly (string | null | undefined)[];
  applicableChecks?: number;
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
      : input.applicableChecks === 0
        ? "No check results were saved with this report. Run a new scan before relying on it."
        : "No checks remain open. A new scan would show whether this result still holds.",
  };
}
