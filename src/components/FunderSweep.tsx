import { useState } from "react";
import { shortAddr } from "../lib/wallets";

// Serial-operator sweep for a Solana wallet (/api/funder): the wallet's OWN
// launches (a single wallet that serial-mints is a rug farm) plus the forward
// sweep of every fresh deployer it seeded. Expensive (~up to 50s), so it runs
// on click, not automatically. Every discovered token is one click from a full
// audit via onAudit.
export function FunderSweep({ wallet, onAudit }: { wallet: string; onAudit?: (q: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (loading || data) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/funder?wallet=${encodeURIComponent(wallet)}`);
      const d = await r.json();
      setData(d?.available === false ? { note: d.note ?? "Sweep unavailable (Helius not configured)." } : d);
    } catch {
      setData({ note: "Sweep failed." });
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <button onClick={run} disabled={loading} className="mono mt-1.5 rounded-md border border-line px-2 py-0.5 text-[10.5px] text-ink-dim transition hover:text-ink disabled:opacity-50">
        {loading ? "sweeping launches… (up to 50s)" : "serial-launch sweep →"}
      </button>
    );
  }

  const own: { mint: string; name?: string }[] = data.ownTokens ?? [];
  const seeded: { wallet: string; tokensCreated: number; sampleTokens: { mint: string; name?: string }[] }[] = data.seededDeployers ?? [];
  const serial = (data.ownLaunches ?? 0) > 1 || seeded.length > 0;

  return (
    <div className="mt-2 border-t border-line pt-2 text-[11.5px] text-ink-dim">
      {data.note && <div className={`leading-relaxed ${serial ? "text-avoid" : ""}`}>{data.note}</div>}

      {(data.ownLaunches ?? 0) > 0 && (
        <div className="mt-1.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Launched by this wallet ({data.ownLaunches})</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {own.map((t) => (
              <button key={t.mint} onClick={() => onAudit?.(t.mint)} title={t.mint} className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink transition hover:border-signal hover:text-signal">
                {t.name || shortAddr(t.mint)}
              </button>
            ))}
          </div>
        </div>
      )}

      {seeded.length > 0 && (
        <div className="mt-2">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Other deployers it seeded ({data.seededCount})</div>
          <div className="mt-1 space-y-1">
            {seeded.map((s) => (
              <div key={s.wallet} className="flex flex-wrap items-center gap-1.5">
                <a href={`https://solscan.io/account/${s.wallet}`} target="_blank" rel="noreferrer" className="mono text-[11px] text-signal hover:underline">{shortAddr(s.wallet)}</a>
                <span className="text-[10.5px] text-ink-faint">{s.tokensCreated} token{s.tokensCreated === 1 ? "" : "s"}:</span>
                {(s.sampleTokens ?? []).slice(0, 4).map((t) => (
                  <button key={t.mint} onClick={() => onAudit?.(t.mint)} title={t.mint} className="mono rounded border border-line px-1 py-0.5 text-[9.5px] text-ink transition hover:border-signal hover:text-signal">
                    {t.name || shortAddr(t.mint)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
