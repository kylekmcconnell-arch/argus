// Persistent reports: push the full rendered audit up on completion, pull it back
// down when a recent audit is re-opened — so a click shows the real report even
// after a reload or from another analyst, instead of re-running. No-op when no
// backend is configured. Local session cache still handles the same-session case.
import { getAnalyst } from "./analyst";

export async function syncReport(
  kind: "person" | "token" | "investigation" | "site",
  ref: string,
  query: string,
  payload: unknown,
  verdict?: string,
  score?: number | null,
): Promise<void> {
  try {
    await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ref, query, contributor: getAnalyst(), payload, verdict, score }),
    });
  } catch {
    /* offline or no backend — the session cache still holds it */
  }
}

export interface StoredReport {
  kind: "person" | "token" | "investigation";
  query?: string;
  contributor?: string;
  payload: any;
  ts?: string;
}

// One row per persisted report (no payload — heavy; fetched per-ref on open).
export interface ReportListing {
  ref: string;
  kind: "person" | "token" | "investigation" | "site";
  query?: string;
  contributor?: string;
  verdict?: string | null;
  score?: number | null;
  ts?: string;
  // Provider spend of the audit run (person audits; token audits are keyless-free).
  cost?: {
    usd?: number;
    grokUsd?: number;
    claudeUsd?: number;
    sources?: number;
    // the full A-to-Z ledger: one line per provider+op, priciest first
    calls?: { provider: string; op: string; calls: number; usd: number; meta?: string }[];
  } | null;
}

// The identifier a report should be resolved by for entity unification. A token /
// investigation audit keys its cross-facet linkage on its $SYMBOL (carried in the
// query), so it groups by that; a person/site groups by its ref (handle / domain).
// Normalized to the bare form the alias resolver's canonical() expects.
export function entityKey(r: ReportListing): string {
  return ((r.kind === "token" || r.kind === "investigation" ? (r.query ?? r.ref) : r.ref) ?? "")
    .trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^[@$]/, "");
}

// Group report listings into entities: the $TOKEN audit, the @handle person audit
// and the site recon of ONE project collapse into a single group. `resolve` is the
// alias resolver (built from the graph contributions), which unions the facets from
// the audits' own edges — never name similarity. Insertion order is preserved, so
// a newest-first input stays newest-first. Falls back to the report's own key when
// nothing links it, so a lone audit is just a group of one.
export function groupReportsByEntity(reports: ReportListing[], resolve: (k: string) => string): ReportListing[][] {
  const byKey = new Map<string, ReportListing[]>();
  const order: string[] = [];
  for (const r of reports) {
    const id = entityKey(r);
    const key = resolve(id) || id || `${r.kind}:${r.ref}`;
    if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
    byKey.get(key)!.push(r);
  }
  return order.map((k) => byKey.get(k)!);
}

// The report library: every persisted report from every analyst, newest first.
export async function listReports(): Promise<ReportListing[]> {
  try {
    const r = await fetch("/api/report?list=1", { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d?.reports) ? d.reports : [];
  } catch {
    return [];
  }
}

// Retry once with real headroom: a cold serverless start (functions scale to zero
// after idle) can blow past a single short timeout, and a null here wrongly sends
// a click on a STORED audit into a fresh live re-run (or "No live dossier yet").
export async function fetchReport(ref: string): Promise<StoredReport | null> {
  const url = `/api/report?ref=${encodeURIComponent(ref.replace(/^[@$]/, ""))}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { if (attempt === 0) continue; return null; }
      const d = await r.json();
      return d?.report ?? null;
    } catch {
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}
