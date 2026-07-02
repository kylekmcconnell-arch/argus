import { useEffect, useState } from "react";

// Peace-of-mind view for Kyle + Enigma: which API keys are plugged in, what each
// powers, where to top up, and live usage where the provider exposes it.
type Provider = { label: string; powers: string; source: string; tier: string; configured: boolean; usage?: string };

const TIER_LABEL: Record<string, string> = { paid: "key", optional: "optional", infra: "infra" };

export function ProvidersPage() {
  const [data, setData] = useState<{ providers: Provider[]; keyless: string[]; note?: string } | null>(null);
  useEffect(() => {
    fetch("/api/keys-status").then((r) => r.json()).then(setData).catch(() => setData({ providers: [], keyless: [] }));
  }, []);

  const providers = data?.providers ?? [];
  const missing = providers.filter((p) => !p.configured && p.tier !== "optional");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Providers &amp; keys</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
        What ARGUS is plugged into. Shows configured or not (never a secret), what each key powers, where to top up,
        and live usage where the provider exposes it.
      </p>
      {missing.length > 0 && (
        <div className="mt-4 rounded-lg border border-caution/40 bg-caution/5 px-3 py-2 text-[12.5px] text-caution">
          {missing.length} required provider{missing.length === 1 ? "" : "s"} not configured: {missing.map((m) => m.label).join(", ")}.
        </div>
      )}

      <div className="mt-5 divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-panel">
        {providers.map((p) => (
          <div key={p.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.configured ? "var(--color-pass)" : p.tier === "optional" ? "var(--color-ink-faint)" : "var(--color-avoid)" }} />
              <span className="text-[13.5px] font-medium text-ink">{p.label}</span>
              <span className="mono rounded border border-line px-1 py-0.5 text-[9px] uppercase tracking-wide text-ink-faint">{TIER_LABEL[p.tier] ?? p.tier}</span>
            </span>
            <span className="min-w-0 flex-1 text-[12px] text-ink-dim">{p.powers}</span>
            <span className="flex items-center gap-2">
              {p.usage && <span className="mono text-[10.5px] text-signal-dim">{p.usage}</span>}
              <span className="mono text-[11px]" style={{ color: p.configured ? "var(--color-pass)" : p.tier === "optional" ? "var(--color-ink-faint)" : "var(--color-avoid)" }}>
                {p.configured ? "configured" : p.tier === "optional" ? "unset" : "MISSING"}
              </span>
              <a href={`https://${p.source.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="mono text-[10.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline">{p.source} ↗</a>
            </span>
          </div>
        ))}
        {!data && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">loading provider status…</div>}
      </div>

      {(data?.keyless?.length ?? 0) > 0 && (
        <>
          <div className="mt-6 text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">Keyless — always on, no key</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data!.keyless.map((k) => (
              <span key={k} className="mono rounded-md border border-line bg-panel/60 px-2 py-1 text-[11px] text-ink-dim">{k}</span>
            ))}
          </div>
        </>
      )}
      {data?.note && <p className="mt-5 text-[11.5px] leading-relaxed text-ink-faint">{data.note}</p>}
    </div>
  );
}
