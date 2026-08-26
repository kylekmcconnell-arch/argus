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
