import type { TokenDossier } from "../token/audit";
import { finiteUsd } from "../token/marketIntegrity";

/** A value without a collection receipt is unknown, including legacy fallbacks. */
export function tokenMarketPresentation(d: TokenDossier) {
  const measured = (key: keyof NonNullable<TokenDossier["marketEvidence"]>) =>
    d.marketEvidence?.[key] === true && typeof d[key] === "number" && Number.isFinite(d[key]) ? d[key]! : null;
  const measuredUsd = (key: "mcap" | "fdv" | "liquidityUsd" | "vol24") => {
    const value = measured(key);
    return finiteUsd(value, true) ? value : null;
  };
  return { marketCap: measuredUsd("mcap"), fullyDilutedValuation: measuredUsd("fdv"), liquidityUsd: measuredUsd("liquidityUsd"), volume24h: measuredUsd("vol24"), ageDays: measured("ageDays") };
}

