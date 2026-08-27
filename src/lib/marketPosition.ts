/**
 * A transparent fallback for assets no global directory ranks. This is a
 * valuation interval, not a fabricated ordinal and not an ARGUS safety grade.
 */
export function marketSizeBand(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 100_000) return "Under $100K";
  if (value < 1_000_000) return "$100K–$1M";
  if (value < 10_000_000) return "$1M–$10M";
  if (value < 100_000_000) return "$10M–$100M";
  if (value < 1_000_000_000) return "$100M–$1B";
  return "$1B+";
}

export interface MarketCapPosition {
  label: string;
  /** Short reader-facing basis for the approximation. */
  detail: string;
}

/**
 * Broad market-cap position bands benchmarked against the active CoinGecko
 * market universe on 2026-08-26. The deliberately wide buckets avoid turning
 * a saved DEX valuation into a false exact rank while still giving the reader
 * a useful sense of relative scale.
 */
export function marketCapPosition(value?: number | null): MarketCapPosition | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const topPct = value >= 10_000_000_000 ? 0.1
    : value >= 1_000_000_000 ? 0.5
      : value >= 100_000_000 ? 2
        : value >= 40_000_000 ? 4
          : value >= 15_000_000 ? 7
            : value >= 3_000_000 ? 13
              : value >= 1_000_000 ? 20
                : value >= 400_000 ? 25
                  : value >= 100_000 ? 40
                    : null;
  return topPct === null
    ? { label: "Lower half", detail: "Approximate market-cap position" }
    : { label: `Top ~${topPct}%`, detail: "Approximate market-cap position" };
}
