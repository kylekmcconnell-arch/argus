import type { TokenDossier } from "../token/audit";

/** Larger than any plausible crypto circulating cap or FDV (BTC is far below this). */
export const MAX_PLAUSIBLE_USD = 20_000_000_000_000;

export function finitePlausibleUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_USD;
}

/** A value without a collection receipt is unknown, including legacy fallbacks. */
export function tokenMarketPresentation(d: TokenDossier) {
  const measured = (key: keyof NonNullable<TokenDossier["marketEvidence"]>) => {
    const value = d.marketEvidence?.[key] === true && typeof d[key] === "number" && Number.isFinite(d[key]) ? d[key]! : null;
    if (value == null) return null;
    if ((key === "mcap" || key === "fdv") && !finitePlausibleUsd(value)) return null;
    return value;
  };
  return { marketCap: measured("mcap"), fullyDilutedValuation: measured("fdv"), liquidityUsd: measured("liquidityUsd"), volume24h: measured("vol24"), ageDays: measured("ageDays") };
}

