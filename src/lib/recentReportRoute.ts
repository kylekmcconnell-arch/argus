import type { ReportKind } from "./reports";

const REPORT_KINDS = new Set<ReportKind>(["person", "token", "investigation", "site"]);

export function recentReportHref(ref: string, kind?: ReportKind): string {
  const params = new URLSearchParams({ s: ref });
  if (kind) params.set("kind", kind);
  return `?${params.toString()}`;
}

export function recentReportKind(value: string | null): ReportKind | undefined {
  return value && REPORT_KINDS.has(value as ReportKind) ? value as ReportKind : undefined;
}
