import { useEffect, useState } from "react";

type Alert = { id: string; severity: string; title: string; detail: string };
type ProviderLine = { id: string; provider: string; operation: string; calls: number; usd: number; status: string; detail?: string };
type CheckLine = { id: string; label: string; provider?: string; state: string; required: boolean; detail?: string };
type Scan = {
  id: string;
  label: string;
  kind: string;
  status: string;
  actor: string;
  creditsCharged: number;
  providerCostUsd: number | null;
  costBasis: string;
  startedAt: string;
  durationMs: number | null;
  failureDetail: string | null;
  providers: ProviderLine[];
  checks: CheckLine[];
  alerts: Alert[];
};
type Operations = {
  scans: Scan[];
  alerts: Array<Alert & { scanId: string; scanLabel: string }>;
  totals: { scans: number; running: number; degraded: number; failed: number; credits: number; providerCostUsd: number; unknownCostScans: number };
};

const money = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const elapsed = (ms: number | null) => ms == null ? "duration unavailable" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} sec`;
const time = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "time unavailable" : date.toLocaleString();
};
const tone = (status: string) => status === "complete" || status === "succeeded" ? "tint-pass" : status === "running" || status === "cached" ? "tint-signal" : "tint-unverifiable";

export function ScanOperationsPanel() {
  const [data, setData] = useState<Operations | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/scan-operations?limit=30", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Scan operations are unavailable.");
        return response.json() as Promise<Operations>;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Scan operations are unavailable.");
      });
    return () => controller.abort();
  }, []);

  if (error) return <div className="panel mt-5 p-4 text-[12.5px] text-ink-dim">{error}</div>;
  if (!data) return <div className="panel mt-5 p-4 text-[12.5px] text-ink-dim">Loading scan operations...</div>;

  return (
    <section className="panel mt-5 overflow-hidden" aria-labelledby="scan-operations-title">
      <div className="border-b border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="scan-operations-title" className="text-[16px] font-semibold text-ink">Scan operations</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">
              What finished, what failed, credits charged, and recorded provider cost for each investigation.
            </p>
          </div>
          <span className={`chip ${data.alerts.length ? "tint-unverifiable" : "tint-pass"}`}>
            {data.alerts.length ? `${data.alerts.length} need attention` : "No active alerts"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Scans" value={String(data.totals.scans)} />
          <Metric label="Failed or degraded" value={String(data.totals.failed + data.totals.degraded)} />
          <Metric label="Credits charged" value={data.totals.credits.toLocaleString()} />
          <Metric label="Recorded provider cost" value={money(data.totals.providerCostUsd)} note={data.totals.unknownCostScans ? `${data.totals.unknownCostScans} unknown` : "all recorded"} />
        </div>
      </div>

      {data.alerts.length > 0 && (
        <div className="border-b border-line p-4">
          <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Needs attention</div>
          <div className="mt-2 grid gap-2">
            {data.alerts.slice(0, 8).map((alert) => (
              <div key={`${alert.scanId}:${alert.id}`} className="finding tint-unverifiable p-3">
                <div className="text-[12.5px] font-medium text-ink">{alert.scanLabel}: {alert.title}</div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">{alert.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="divide-y divide-line">
        {data.scans.length === 0 && <p className="p-4 text-[12.5px] text-ink-dim">No scan receipts have been recorded yet.</p>}
        {data.scans.map((scan) => {
          const worked = scan.providers.filter((line) => line.status === "succeeded" || line.status === "cached");
          const failed = scan.providers.filter((line) => line.status === "failed" || line.status === "partial");
          const openChecks = scan.checks.filter((check) => !["complete", "not-applicable"].includes(check.state));
          return (
            <details key={scan.id} className="group p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{scan.label}</span>
                    <span className={`chip ${tone(scan.status)}`}>{scan.status}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-faint">{scan.actor} · {time(scan.startedAt)} · {elapsed(scan.durationMs)}</div>
                </div>
                <div className="text-right text-[11.5px] text-ink-dim">
                  <div>{scan.creditsCharged.toLocaleString()} credit{scan.creditsCharged === 1 ? "" : "s"}</div>
                  <div>{scan.providerCostUsd == null ? "provider cost unknown" : `${money(scan.providerCostUsd)} ${scan.costBasis}`}</div>
                </div>
              </summary>
              <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
                <OperationList title="What worked" empty="No provider outcomes were attached to this receipt." lines={worked.map((line) => ({ key: line.id, title: `${line.provider}: ${line.operation.replace(/[-_]+/g, " ")}`, detail: `${line.calls} call${line.calls === 1 ? "" : "s"} · ${money(line.usd)}` }))} />
                <OperationList title="What needs attention" empty="No provider failures or open checks." lines={[
                  ...failed.map((line) => ({ key: `provider:${line.id}`, title: `${line.provider}: ${line.operation.replace(/[-_]+/g, " ")}`, detail: line.detail || (line.status === "partial" ? "Provider returned only part of the requested result." : "Provider failed.") })),
                  ...openChecks.map((check) => ({ key: `check:${check.id}`, title: check.label, detail: check.detail || (check.required ? "Required check did not finish." : "Check did not finish.") })),
                ]} />
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat-tile"><div className="mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">{label}</div><div className="mt-1 text-[18px] font-semibold text-ink">{value}</div>{note && <div className="text-[10.5px] text-ink-faint">{note}</div>}</div>;
}

function OperationList({ title, empty, lines }: { title: string; empty: string; lines: Array<{ key: string; title: string; detail: string }> }) {
  return <div><h3 className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{title}</h3>{lines.length ? <div className="mt-2 space-y-2">{lines.map((line) => <div key={line.key}><div className="text-[12px] font-medium text-ink">{line.title}</div><div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{line.detail}</div></div>)}</div> : <p className="mt-2 text-[11.5px] text-ink-dim">{empty}</p>}</div>;
}
