// Persistent reports: push the full rendered audit up on completion, pull it back
// down when a recent audit is re-opened — so a click shows the real report even
// after a reload or from another analyst, instead of re-running. No-op when no
// backend is configured. Local session cache still handles the same-session case.
import { getAnalyst } from "./analyst";

export async function syncReport(
  kind: "person" | "token" | "investigation",
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

export async function fetchReport(ref: string): Promise<StoredReport | null> {
  try {
    const r = await fetch(`/api/report?ref=${encodeURIComponent(ref.replace(/^[@$]/, ""))}`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.report ?? null;
  } catch {
    return null;
  }
}
