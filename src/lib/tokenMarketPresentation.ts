import type { TokenDossier } from "../token/audit";
/** A value without a collection receipt is unknown, including legacy fallbacks. */
export function tokenMarketPresentation(d: TokenDossier) {
  const measured = (key: keyof NonNullable<TokenDossier["marketEvidence"]>) =>
    d.marketEvidence?.[key] === true && typeof d[key] === "number" && Number.isFinite(d[key]) ? d[key]! : null;
  return { marketCap: measured("mcap"), fullyDilutedValuation: measured("fdv"), liquidityUsd: measured("liquidityUsd"), volume24h: measured("vol24"), ageDays: measured("ageDays") };
}

