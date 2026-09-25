import { useState } from "react";
interface Inventory {
  capturedAt: string;
  datasets: Array<{ table: string; scope: string; rows: number | null; dateColumn: string | null; firstAt: string | null; lastAt: string | null }>;
  dailySpend: { recordedUsd: number; events: number; zeroUsdEvents: number; thresholdExceeded: boolean; basis: string; from: string };
  limitations: string[];
}
/** Explicit owner action: avoids a full inventory query on every sources-page visit. */
export function DataInventory() {
  const [data, setData] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/data-inventory");
      const body = await response.json();
      if (!response.ok || !body.available) throw new Error(response.status === 403 ? "Only workspace owners can inspect this inventory." : body.message || "Inventory is unavailable.");
      setData(body);
    } catch (e) { setData(null); setError(e instanceof Error ? e.message : "Inventory is unavailable."); }
    finally { setBusy(false); }
  }
  return <section className="panel mt-5 p-4" aria-label="Stored data inventory">
    <h2 className="text-base font-medium">What we already have</h2>
    <p className="mt-1 text-sm text-ink-dim">Workspace record counts, history dates and today’s recorded spending. Owner access required.</p>
    <button className="mt-3 underline" disabled={busy} onClick={() => void inspect()}>{busy ? "Reading inventory…" : "Inspect stored data"}</button>
    {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
    {data && <>
      <p className="mt-3 text-sm" role={data.dailySpend.thresholdExceeded ? "alert" : undefined}>
        ${data.dailySpend.recordedUsd.toFixed(2)} recorded today · Europe/Lisbon · {data.dailySpend.events} events.
        {data.dailySpend.thresholdExceeded && " Recorded daily spending exceeds $100. Collection has no hard cap."}
      </p>
      <p className="mt-1 text-xs text-ink-dim">{data.dailySpend.basis}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr><th>Dataset</th><th>Workspace records</th><th>Date field</th><th>Earliest</th><th>Latest</th></tr></thead>
        <tbody>{data.datasets.map(d => <tr key={d.table}><td className="py-1">{d.table}</td><td>{d.rows ?? "Shared: schema only"}</td><td>{d.dateColumn ?? "Not recorded"}</td><td>{d.firstAt ?? "—"}</td><td>{d.lastAt ?? "—"}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-3 text-xs text-ink-dim">Read {data.capturedAt}. {data.limitations.join(" ")}</p>
    </>}
  </section>;
}
