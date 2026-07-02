import { useEffect, useRef, useState } from "react";
import { auditToken } from "../token/audit";
import { resolveInput } from "../lib/resolveInput";
import { verdictMeta } from "../lib/verdict";
import { TokenSparkline } from "./TokenSparkline";
import { recordForensicEntities } from "../graph/store";

// VC / investor track record: their portfolio (via /api/vc-portfolio) with each
// token investment priced on-chain, so "prolific fund" becomes "of N token bets,
// M are dead." A fund is only as good as how its bets ended. Auto-runs when the
// subject is an INVESTOR.
type Investment = { project: string; ticker: string | null; contract: string | null; chain: string | null; x_handle: string | null; stage: string | null; year: string | null; outcome: string | null };
type Scored = Investment & { address?: string; chainResolved?: string; verdict?: string; score?: number | null; liquidityUsd?: number; dead?: boolean; resolved?: boolean };

async function tickerToContract(ticker: string): Promise<string | null> {
  const sym = ticker.replace(/^\$/, "").toUpperCase();
  if (!sym || sym.length < 2) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(sym)}`);
    const d = await r.json();
    const all: any[] = Array.isArray(d?.pairs) ? d.pairs : [];
    const pairs = all
      .filter((p: any) => p?.baseToken?.address && String(p?.baseToken?.symbol ?? "").toUpperCase() === sym)
      .sort((a: any, b: any) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
    return pairs[0]?.baseToken?.address ?? null;
  } catch {
    return null;
  }
}

async function auditInvestment(inv: Investment): Promise<Scored> {
  let contract = inv.contract;
  if (!contract && inv.ticker) contract = await tickerToContract(inv.ticker);
  if (!contract) return { ...inv, resolved: false };
  const input = resolveInput(contract);
  const d = input.kind === "token" ? await auditToken(input, undefined, { skipSim: true }).catch(() => null) : null;
  if (!d) return { ...inv, resolved: false };
  const dead = d.verdict === "FAIL" || d.verdict === "AVOID" || (d.liquidityUsd ?? 0) < 500;
  return { ...inv, address: d.address, chainResolved: d.chain, verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, dead, resolved: true };
}

export function VcReport({ handle, name, onAudit }: { handle: string; name: string; onAudit?: (q: string) => void }) {
  const [rows, setRows] = useState<Scored[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const r = await fetch(`/api/vc-portfolio?handle=${encodeURIComponent(handle.replace(/^@/, ""))}&name=${encodeURIComponent(name)}`);
        const d = await r.json();
        const inv: Investment[] = d?.investments ?? [];
        if (!inv.length) { setState("none"); return; }
        // Price the token investments (cap to bound), keep the rest as-is.
        const withToken = inv.filter((i) => i.contract || i.ticker).slice(0, 12);
        const rest = inv.filter((i) => !(i.contract || i.ticker));
        const scored = await Promise.all(withToken.map(auditInvestment));
        setRows([...scored, ...rest.map((i) => ({ ...i, resolved: false }))]);
        setState("ok");
        // Feed the shared graph: link this fund to each portfolio project/token.
        // Shared project handles + tickers bridge the fund to the founders who
        // built those projects and to any KOL who promoted the same token.
        const ents = inv
          .map((i) => {
            const key = i.x_handle || i.ticker;
            if (!key) return null;
            return { key, type: i.x_handle ? "Company" : "Token", subtype: "Portfolio", edgeType: "INVESTED_IN", label: i.project + (i.stage ? ` · ${i.stage}` : "") };
          })
          .filter(Boolean) as { key: string; type: string; subtype: string; edgeType: string; label: string }[];
        if (ents.length) recordForensicEntities(handle, ents);
      } catch {
        setState("none");
      }
    })();
  }, [handle, name]);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-faint">assembling the portfolio + pricing each bet…</div>;
  if (state === "none" || !rows) return <div className="rounded-xl border border-line bg-panel p-4 text-[12px] text-ink-dim">No verifiable portfolio found for this investor.</div>;

  const priced = rows.filter((r) => r.resolved && r.verdict);
  const dead = priced.filter((r) => r.dead);
  const money = (n?: number) => (n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n));

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">{rows.length} portfolio {rows.length === 1 ? "investment" : "investments"}</span>
        {priced.length > 0 && (
          <span className={`mono text-[11px] ${dead.length ? "text-avoid" : "text-ink-faint"}`}>{dead.length}/{priced.length} token bets dead or failing</span>
        )}
      </div>

      <div className="mt-2 divide-y divide-line/60 rounded-lg border border-line">
        {rows.map((r, i) => {
          const m = r.verdict ? verdictMeta(r.verdict) : null;
          const openTarget = r.address || r.x_handle;
          return (
            <div key={i} className="px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                {openTarget && onAudit ? (
                  <button onClick={() => onAudit(openTarget!)} className="font-medium text-ink underline-offset-2 hover:text-signal-dim hover:underline">{r.project}</button>
                ) : (
                  <span className="font-medium text-ink">{r.project}</span>
                )}
                {r.ticker && <span className="mono text-[10.5px] text-ink-faint">{r.ticker}</span>}
                {(r.stage || r.year) && <span className="text-[10.5px] text-ink-faint">{[r.stage, r.year].filter(Boolean).join(" · ")}</span>}
                {m && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${m.color}1a`, color: m.color }}>{r.verdict}{r.score != null ? ` ${r.score}` : ""}</span>}
                {r.resolved && <span className="text-[10.5px] text-ink-faint">liq {money(r.liquidityUsd)}</span>}
                {r.dead && <span className="mono rounded border border-avoid/40 px-1.5 py-0.5 text-[9.5px] text-avoid">dead</span>}
                {r.address && r.chainResolved && <span className="ml-auto"><TokenSparkline address={r.address} chain={r.chainResolved} compact /></span>}
              </div>
              {r.outcome && !r.resolved && <div className="mt-0.5 text-[10.5px] text-ink-faint">{r.outcome}</div>}
            </div>
          );
        })}
      </div>
      {dead.length > 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-avoid">
          {dead.length} of {priced.length} priceable token bets are now dead or failing — weigh the fund's judgement accordingly.
        </p>
      )}
    </div>
  );
}
