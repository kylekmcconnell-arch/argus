import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { recordForensicEntities } from "../graph/store";

// Serial-operator sweep for a Solana wallet (/api/funder): the wallet's OWN
// launches (a single wallet that serial-mints is a rug farm) plus the forward
// sweep of every fresh deployer it seeded. Expensive (~up to 45s), so it runs on
// click with a live scanning state. Every discovered token is one click from a
// full audit via onAudit.
const STAGES = [
  "Pulling this wallet's mint history…",
  "Tracing every wallet it funded…",
  "Checking which recipients minted tokens…",
  "Assembling the launch network…",
  "Almost there…",
];

function RadarIcon({ live }: { live?: boolean }) {
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/40" />}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-4.6-7.9" />
        <path d="M12 12l5.5-3.2" />
        <circle cx="12" cy="12" r="1.4" fill="var(--color-signal)" stroke="none" />
      </svg>
    </span>
  );
}

export function FunderSweep({ wallet, onAudit }: { wallet: string; onAudit?: (q: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const run = async () => {
    if (loading || data) return;
    setLoading(true);
    setStage(0);
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 6000);
    try {
      const r = await fetch(`/api/funder?wallet=${encodeURIComponent(wallet)}`);
      const d = await r.json();
      setData(d?.available === false ? { note: d.note ?? "Sweep unavailable (Helius not configured)." } : d);
      // Record this wallet's launches + the deployers it seeded, so a shared
      // funder/deployer bridges launches across audits (serial-operator web).
      const ownT: { mint: string; name?: string }[] = d?.ownTokens ?? [];
      const seededD: { wallet: string; tokensCreated: number }[] = d?.seededDeployers ?? [];
      const ents = [
        ...ownT.map((t) => ({ key: `token:${t.mint}`, type: "Token", edgeType: "LAUNCHED", label: t.name || t.mint })),
        ...seededD.map((s) => ({ key: `wallet:${s.wallet}`, type: "Identity", subtype: "Wallet", edgeType: "SEEDED", label: s.wallet })),
      ];
      if (ents.length) recordForensicEntities(`wallet:${wallet}`, ents);
    } catch {
      setData({ note: "Sweep failed." });
    } finally {
      if (timer.current) clearInterval(timer.current);
      setLoading(false);
    }
  };

  // ── loading state ──
  if (loading) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-signal/35 bg-signal/[0.06] p-4">
        <div className="flex items-center gap-2.5">
          <RadarIcon live />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-signal-lift">{STAGES[stage]}</div>
            <div className="mono mt-0.5 text-[11px] text-ink-faint">serial-launch sweep · reading the chain · up to ~45s</div>
          </div>
        </div>
        <div className="scan-bar mt-2.5" />
      </div>
    );
  }

  // ── CTA (not run yet) ──
  if (!data) {
    return (
      <button
        onClick={run}
        className="group mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-signal/40 bg-signal/[0.08] px-3.5 py-2.5 text-left transition hover:border-signal hover:bg-signal/[0.14]"
      >
        <span className="flex items-center gap-2.5">
          <RadarIcon />
          <span>
            <span className="block text-[13px] font-semibold text-signal-lift">Serial-launch sweep</span>
            <span className="block text-[11px] text-ink-dim">what else has this wallet launched, and who else did it fund?</span>
          </span>
        </span>
        <span className="mono shrink-0 rounded-md border border-signal/50 px-2 py-1 text-[11px] text-signal-lift transition group-hover:bg-signal group-hover:text-white">run →</span>
      </button>
    );
  }

  // ── results ──
  const own: { mint: string; name?: string }[] = data.ownTokens ?? [];
  const seeded: { wallet: string; tokensCreated: number; sampleTokens: { mint: string; name?: string }[] }[] = data.seededDeployers ?? [];
  const serial = (data.ownLaunches ?? 0) > 1 || seeded.length > 0;

  return (
    <div className="mt-2 border-t border-line pt-2 text-[11.5px] text-ink-dim">
      {data.note && <div className={`leading-relaxed ${serial ? "text-avoid" : ""}`}>{data.note}</div>}

      {(data.ownLaunches ?? 0) > 0 && (
        <div className="mt-1.5">
          <div className="eyebrow">Launched by this wallet ({data.ownLaunches})</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {own.map((t) => (
              <button key={t.mint} onClick={() => onAudit?.(t.mint)} title={t.mint} className="btn-chip">
                {t.name || shortAddr(t.mint)}
              </button>
            ))}
          </div>
        </div>
      )}

      {seeded.length > 0 && (
        <div className="mt-2">
          <div className="eyebrow">Other deployers it seeded ({data.seededCount})</div>
          <div className="mt-1 space-y-1">
            {seeded.map((s) => (
              <div key={s.wallet} className="flex flex-wrap items-center gap-1.5">
                <a href={`https://solscan.io/account/${s.wallet}`} target="_blank" rel="noreferrer" className="link-ext mono text-[11px]">{shortAddr(s.wallet)}</a>
                <span className="text-[11px] text-ink-faint">{s.tokensCreated} token{s.tokensCreated === 1 ? "" : "s"}:</span>
                {(s.sampleTokens ?? []).slice(0, 4).map((t) => (
                  <button key={t.mint} onClick={() => onAudit?.(t.mint)} title={t.mint} className="btn-chip">
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
