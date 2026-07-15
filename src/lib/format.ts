/**
 * One USD style on the report canvas: $1.23B, $14.3B, $142B, $49.0M.
 * Three significant digits with fixed decimals per magnitude so stat columns
 * align. Other surfaces keep their local formatters for now.
 */
export function usdCompact(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  const unit = abs >= 1e12 ? [1e12, "T"] as const
    : abs >= 1e9 ? [1e9, "B"] as const
      : abs >= 1e6 ? [1e6, "M"] as const
        : abs >= 1e3 ? [1e3, "K"] as const
          : null;
  if (!unit) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const scaled = value / unit[0];
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `$${scaled.toFixed(digits)}${unit[1]}`;
}
