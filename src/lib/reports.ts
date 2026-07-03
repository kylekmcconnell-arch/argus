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
