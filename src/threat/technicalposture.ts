// Chart posture: a generic technical read for tokens that also trade on major
// venues, fetched from our keyed /api/technical-posture route. Coverage is
// majors-only by design - a fresh CA simply is not covered and the lane stays
// silent (null), which the report renders as an unchecked row, never a finding.
import { apiFetch } from "./net";
import type { TechnicalPosture } from "./types";

const STANCES = new Set(["bullish", "bearish", "mixed", "neutral"]);

export async function technicalPosture(symbol: string, mcap: number | null): Promise<TechnicalPosture | null> {
  if (!symbol || !/^[A-Za-z0-9]{1,15}$/.test(symbol)) return null;
  try {
    const q = `symbol=${encodeURIComponent(symbol)}${mcap && mcap > 0 ? `&mcap=${Math.round(mcap)}` : ""}`;
    const r = await apiFetch(`/api/technical-posture?${q}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      available?: unknown; covered?: unknown; stance?: unknown; readings?: unknown; note?: unknown;
    };
    if (d.available !== true || d.covered !== true) return null;
    const stance = STANCES.has(String(d.stance)) ? (String(d.stance) as TechnicalPosture["stance"]) : "neutral";
    const readings = (Array.isArray(d.readings) ? d.readings : [])
      .map((x) => {
        const row = x as { timeframe?: unknown; stance?: unknown; observations?: unknown };
        return {
          timeframe: String(row.timeframe ?? "?"),
          stance: STANCES.has(String(row.stance)) ? String(row.stance) : "neutral",
          observations: (Array.isArray(row.observations) ? row.observations : []).map(String).slice(0, 12),
        };
      })
      .filter((row) => row.observations.length > 0);
    if (readings.length === 0) return null;
    return { covered: true, stance, readings, note: d.note == null ? null : String(d.note) };
  } catch {
    return null;
  }
}
