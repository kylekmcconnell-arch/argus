import { useEffect, useState } from "react";

// Loud banner when a paid provider is failing (credits out, key dead). Without
// this, a dead provider degrades reports SILENTLY — team searches return
// nothing and the audit just looks thin. One health probe per session (plus a
// 5-minute refresh), shared across every report via a module-level cache.
type Svc = { id: string; label: string; ok: boolean; detail?: string; action?: string };

let cache: { at: number; services: Svc[] } | null = null;
let inflight: Promise<Svc[]> | null = null;
const TTL = 5 * 60_000;

async function getHealth(): Promise<Svc[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.services;
  if (inflight) return inflight;
  inflight = fetch("/api/health", { signal: AbortSignal.timeout(20000) })
    .then((r) => (r.ok ? r.json() : { services: [] }))
    .then((d) => {
      const services: Svc[] = Array.isArray(d?.services) ? d.services : [];
      cache = { at: Date.now(), services };
      return services;
    })
    .catch(() => cache?.services ?? [])
    .finally(() => { inflight = null; });
  return inflight;
}

export function ServiceAlert() {
  const [down, setDown] = useState<Svc[]>([]);
  useEffect(() => {
    let alive = true;
    void getHealth().then((services) => { if (alive) setDown(services.filter((s) => !s.ok)); });
    return () => { alive = false; };
  }, []);

  if (!down.length) return null;

  return (
    <div className="mb-4 rounded-xl border px-4 py-3" style={{ borderColor: "var(--color-avoid)", background: "rgba(220,38,38,0.08)" }}>
      <div className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: "var(--color-avoid)" }}>
        <span className="text-[15px]">⚠</span>
        {down.length === 1 ? `${down[0].label} is failing — this report is running degraded` : `${down.length} providers are failing — this report is running degraded`}
      </div>
      <div className="mt-1.5 space-y-1">
        {down.map((s) => (
          <div key={s.id} className="text-[12.5px] leading-relaxed text-ink-dim">
            <span className="font-medium text-ink">{s.label}</span>
            {s.action && <span style={{ color: "var(--color-avoid)" }}> · {s.action}</span>}
            {s.detail && <span className="mono block text-[11px] text-ink-faint">{s.detail}</span>}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-ink-faint">
        Deep digs (team search, portfolios, namesake, identity) depend on these — rescan after topping up.
      </p>
    </div>
  );
}
