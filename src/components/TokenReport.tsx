import { ArgusMark } from "./ArgusMark";
import { verdictMeta } from "../lib/verdict";
import type { TokenDossier } from "../token/audit";

function money(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function Ring({ score, verdict, size = 96 }: { score: number | null; verdict: string; size?: number }) {
  const m = verdictMeta(verdict);
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={m.color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 0.8s ease-out" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[24px] font-semibold leading-none tabular" style={{ color: m.color }}>{score ?? "—"}</span>
        <span className="mono text-[9px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}

function Bar({ a, color }: { a: TokenDossier["axes"][number]; color: string }) {
  const ratio = a.weight ? a.score / a.weight : 0;
  const weak = ratio < 0.45;
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-ink-dim">{a.label}</span>
        <span className="mono shrink-0 text-[11px] tabular text-ink-faint">{a.score}<span className="text-ink-faint/60">/{a.weight}</span></span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ background: weak ? "var(--color-caution)" : color, width: `${ratio * 100}%`, transition: "width 0.7s ease-out" }} />
      </div>
      {a.rationale && <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">{a.rationale}</p>}
    </div>
  );
}

function Check({ label, ok, value, na }: { label: string; ok: boolean; value?: string; na?: boolean }) {
  const color = na ? "var(--color-ink-faint)" : ok ? "var(--color-pass)" : "var(--color-avoid)";
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-[12.5px] text-ink-dim">{label}</span>
      <span className="mono flex items-center gap-1.5 text-[11.5px]" style={{ color }}>
        {value ?? (na ? "unchecked" : ok ? "ok" : "risk")}
        <span>{na ? "•" : ok ? "✓" : "✗"}</span>
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-2 text-[12.5px] font-medium text-ink">{title}</div>
      {children}
    </div>
  );
}

export function TokenReport({ dossier: d, onReset }: { dossier: TokenDossier; onReset: () => void }) {
  const m = verdictMeta(d.verdict);
  const s = d.safety;
  const gp = d.goplusChecked;

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-72" />

      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Audits
          </button>
          <span className="mono text-[11px] text-ink-faint">/ token</span>
          <span className="mono rounded border px-1.5 py-0.5 text-[10px] tracking-wider" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>● LIVE</span>
          <div className="ml-auto">
            <button onClick={onReset} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink">New audit</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5">
        {/* token identity */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {d.imageUrl ? (
            <img src={d.imageUrl} alt="" className="h-14 w-14 rounded-2xl border border-line-2 object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line-2 bg-panel text-xl text-signal">${d.symbol.slice(0, 3)}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-semibold tracking-tight text-ink">{d.name}</h1>
              <span className="mono text-[13px] text-ink-faint">${d.symbol}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
              <span className="rounded border border-line px-1.5 py-0.5 text-ink-dim capitalize">{d.chain}</span>
              <span>{d.dexId}</span>
              <span className="mono">{d.address.slice(0, 6)}…{d.address.slice(-4)}</span>
              {d.socials.map((x) => (
                <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="text-signal-dim hover:text-signal">{x.label}</a>
              ))}
            </div>
          </div>
          <div className="flex gap-5 text-right">
            <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">mcap</div><div className="mono text-[14px] text-ink">{money(d.mcap)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">liquidity</div><div className="mono text-[14px] text-ink">{money(d.liquidityUsd)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-ink-faint">24h vol</div><div className="mono text-[14px] text-ink">{money(d.vol24)}</div></div>
          </div>
        </div>

        {/* verdict hero */}
        <div className="relative mt-6 overflow-hidden rounded-2xl border bg-panel p-6 soft-shadow" style={{ borderColor: `${m.color}55` }}>
          <div className="absolute right-0 top-0 h-full w-1/2" style={{ background: `radial-gradient(400px 200px at 100% 0%, ${m.glow}, transparent 70%)` }} />
          <div className="relative flex flex-wrap items-center gap-6">
            <Ring score={d.score} verdict={d.verdict} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-ink-faint">Token verdict</div>
              <div className="text-[34px] font-bold leading-none tracking-tight" style={{ color: m.color }}>{m.label}</div>
              <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">{d.headline}</p>
              {d.capApplied && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12px]" style={{ borderColor: "var(--color-avoid)", color: "var(--color-avoid)" }}>
                  <span>▲</span> Hard cap · {d.capApplied.replace(/_/g, " ")}
                </div>
              )}
            </div>
          </div>
        </div>

        {!gp && (
          <div className="mt-3 rounded-xl border border-line bg-panel/40 px-4 py-3 text-[12.5px] text-ink-dim">
            Contract-internal safety (honeypot, mint authority, ownership, tax) could not be verified keyless on <span className="capitalize">{d.chain}</span>. Those axes are scored conservatively. Add a Helius/Bitquery key to verify on-chain.
          </div>
        )}

        {/* axes */}
        <section className="mt-5">
          <div className="mb-2.5 text-[13px] font-semibold tracking-tight text-ink">Forensic breakdown</div>
          <div className="rounded-xl border border-line bg-white px-4 py-1 divide-y divide-line/60">
            {d.axes.map((a) => <Bar key={a.key} a={a} color={m.color} />)}
            <div className="flex items-center justify-between py-2.5 text-[11.5px] text-ink-faint">
              <span>weighted total</span>
              <span className="mono">= {d.score}{d.capApplied ? " (capped)" : ""}</span>
            </div>
          </div>
        </section>

        {/* panels */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card title="Contract safety">
            <div className="divide-y divide-line/60">
              <Check label="Not a honeypot" ok={!s.honeypot} na={!gp} />
              <Check label="Supply not mintable" ok={!s.mintable} na={!gp} />
              <Check label="Ownership renounced" ok={!!s.ownerRenounced} na={!gp} />
              <Check label="No take-back ownership" ok={!s.takeBack} na={!gp} />
              <Check label="No hidden owner" ok={!s.hiddenOwner} na={!gp} />
              <Check label="Transfers not pausable" ok={!s.pausable} na={!gp} />
              <Check label="Source verified" ok={!!s.openSource} na={!gp} />
              <Check label="Taxes" ok={Number(s.buyTax) + Number(s.sellTax) < 10} value={gp ? `${Number(s.buyTax).toFixed(0)}/${Number(s.sellTax).toFixed(0)}%` : undefined} na={!gp} />
            </div>
          </Card>

          <Card title="Liquidity & holders">
            <div className="divide-y divide-line/60">
              <Check label="Liquidity locked / burned" ok={!!s.lpLocked} na={!gp} />
              <Check label="Liquidity depth" ok={(d.liquidityUsd ?? 0) >= 50000} value={money(d.liquidityUsd)} />
              <Check label="Holders" ok={Number(s.holderCount) >= 500} value={gp ? Number(s.holderCount).toLocaleString() : undefined} na={!gp} />
              <Check label="Top holder concentration" ok={s.topHolderPct == null || Number(s.topHolderPct) <= 25} value={s.topHolderPct != null ? `${Number(s.topHolderPct).toFixed(0)}%` : undefined} na={s.topHolderPct == null} />
              <Check label="Pair age" ok={(d.ageDays ?? 0) >= 30} value={d.ageDays != null ? (d.ageDays < 1 ? "<1d" : Math.round(d.ageDays) + "d") : undefined} />
            </div>
          </Card>
        </div>

        {/* findings */}
        {d.findings.length > 0 && (
          <section className="mt-5">
            <div className="mb-2.5 text-[13px] font-semibold tracking-tight text-ink">Signals</div>
            <div className="space-y-2">
              {d.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-white p-3.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.tone === "good" ? "var(--color-pass)" : f.tone === "warn" ? "var(--color-caution)" : "var(--color-avoid)" }} />
                  <p className="flex-1 text-[13px] leading-snug text-ink">{f.claim}</p>
                  <span className="mono text-[10.5px] text-ink-faint">{f.source}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 rounded-xl border border-line bg-panel/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-dim"><ArgusMark size={16} /> How this verdict was reached</div>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            Scored live from DexScreener (market, liquidity, trading) and GoPlus (contract safety, holders), with no keys.
            Disqualifying findings, a honeypot, mintable supply, or reclaimable ownership, act as hard caps that override the
            weighted total. A clean market never papers over an unsafe contract. Real-time, reproducible.
          </p>
        </div>
      </div>
    </div>
  );
}
