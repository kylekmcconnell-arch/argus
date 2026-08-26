export type ReportStyle = 1 | 2;

/** Style 2 is the canonical reading view. Style 1 remains an explicit opt-in. */
export function reportStyleFromSearch(search: string): ReportStyle {
  return new URLSearchParams(search).get("reportStyle") === "1" ? 1 : 2;
}

export function searchForReportStyle(search: string, style: ReportStyle): string {
  const params = new URLSearchParams(search);
  if (style === 1) params.set("reportStyle", "1");
  else params.delete("reportStyle");
  const value = params.toString();
  return value ? `?${value}` : "";
}
