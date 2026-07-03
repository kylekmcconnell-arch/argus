import { useEffect, useRef, useState } from "react";
import { auditToken } from "../token/audit";
import { resolveInput } from "../lib/resolveInput";
import { verdictMeta } from "../lib/verdict";
import { TokenSparkline } from "./TokenSparkline";
import { CallTimeline } from "./CallTimeline";
import { recordForensicEntities } from "../graph/store";

// Dedicated KOL (influencer) report. A KOL's threat model is different from a
// founder's: they pump-and-dump. So this grades the two things that matter —
// the PERFORMANCE of the tokens they shilled (did they promote rugs?), and the
// AUTHENTICITY of their reach (bot followers / bought engagement) — plus their
// known associates. Auto-runs on the report.
type Promo = { ticker?: string; contract_address?: string; chain?: string };
type Assoc = { associate_key: string; relation?: string };
type TokRes = { label: string; address?: string; chain?: string; pairAddress?: string; verdict?: string; score?: number | null; liquidityUsd?: number; dead: boolean; unresolved?: boolean };

async function tickerToContract(ticker: string): Promise<string | null> {
  const sym = ticker.replace(/^\$/, "").toUpperCase();
  if (!sym || sym.length < 2) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(sym)}`);
    const d = await r.json();
    const all: any[] = Array.isArray(d?.pairs) ? d.pairs : [];
    const pairs = all
      .filter((p: any) => p?.baseToken?.address && String(p?.baseToken?.symbol ?? "").toUpperCase() === sym)
      .sort((a: any, b: any) => (b?.chainId === "solana" ? 1 : 0) - (a?.chainId === "solana" ? 1 : 0) || Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
    return pairs[0]?.baseToken?.address ?? null;
  } catch {
    return null;
  }
}

// Major assets and stables a KOL might reference (ETH, SOL, BTC, USDC…). These
// are NOT shills — mentioning ETH is not promoting a memecoin — and running them
// through the memecoin rug audit produced absurd verdicts ("$ETH rugged / dead").
// Skip them entirely from the promoted-token grade.
const BLUECHIP = new Set([
  "ETH", "WETH", "BTC", "WBTC", "SOL", "WSOL", "BNB", "WBNB", "MATIC", "POL", "AVAX", "WAVAX",
  "ARB", "OP", "LINK", "UNI", "AAVE", "LDO", "MKR", "XRP", "ADA", "DOGE", "TRX", "DOT", "LTC",
  "BCH", "ATOM", "NEAR", "APT", "SUI", "TIA", "TON", "USDC", "USDT", "DAI", "BUSD", "USDE", "FDUSD",
]);

async function auditPromotions(promos: Promo[]): Promise<TokRes[]> {
  const out: TokRes[] = [];
  for (const p of promos.slice(0, 8)) {
    const tick = (p.ticker ?? "").replace(/^\$/, "").toUpperCase();
    // A blue-chip reference isn't a promotion — drop it before spending an audit.
    if (!p.contract_address && BLUECHIP.has(tick)) continue;
    let contract = p.contract_address || null;
    if (!contract && p.ticker) contract = await tickerToContract(p.ticker);
    const label = p.ticker ? (p.ticker.startsWith("$") ? p.ticker : "$" + p.ticker) : "token";
    if (!contract) { out.push({ label, dead: false, unresolved: true }); continue; }
    const input = resolveInput(contract);
    const d = input.kind === "token" ? await auditToken(input, undefined, { skipSim: true }).catch(() => null) : null;
    if (!d) { out.push({ label, dead: false, unresolved: true }); continue; }
    if (BLUECHIP.has((d.symbol ?? "").toUpperCase())) continue; // resolved to a major asset
    const liq = d.liquidityUsd ?? 0;
    // "rugged / dead" means the token is actually gone — thin/collapsed liquidity —
    // NOT merely a low ARGUS score. A token with real, deep liquidity is by
    // definition not dead, so a failed verdict only counts as dead when liquidity
    // is also thin (guards against tagging a $1B-liquidity asset "rugged").
    const dead = liq < 500 || ((d.verdict === "FAIL" || d.verdict === "AVOID") && liq < 250_000);
    out.push({ label: d.symbol ? `$${d.symbol}` : label, address: d.address, chain: d.chain, pairAddress: d.pairAddress, verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, dead });
  }
  return out;
}

export function KolReport({ handle, promotions, associates, onAudit }: { handle: string; promotions: Promo[]; associates: Assoc[]; onAudit?: (q: string) => void }) {
  const [tokens, setTokens] = useState<TokRes[] | null>(null);
  const [signals, setSignals] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const [sig, toks] = await Promise.all([
        fetch(`/api/kol-signals?handle=${encodeURIComponent(handle.replace(/^@/, ""))}`).then((r) => r.json()).catch(() => null),
        auditPromotions(promotions),
      ]);
      setSignals(sig && sig.available === false ? null : sig);
      setTokens(toks);
      setLoading(false);
      // Feed the shared graph: link this KOL to every token they promoted. The
      // token nodes are shared keys, so two KOLs who shilled the same token — or a
      // token/project audit of it — bridge through that node.
      const ents = toks
        .filter((t) => !t.unresolved)
        .map((t) => ({ key: t.label, type: "Token", subtype: "Promoted", edgeType: "PROMOTED", label: `${t.label}${t.verdict ? ` · ${t.verdict}` : ""}` }));
      if (ents.length) recordForensicEntities(handle, ents);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved = (tokens ?? []).filter((t) => !t.unresolved);
  const unresolved = (tokens ?? []).filter((t) => t.unresolved);
  const dead = resolved.filter((t) => t.dead);
  const money = (n?: number) => (n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n));
  const assoc = associates.filter((a) => a.associate_key).slice(0, 12);

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">KOL report</span>
        {loading && <span className="text-[11px] text-ink-faint">grading promoted tokens + auditing reach…</span>}
      </div>

      {/* promoted-token performance */}
      <div className="mt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium text-ink">Tokens they promoted</span>
          {resolved.length > 0 && (
            <span className={`mono text-[11px] ${dead.length ? "text-avoid" : "text-ink-faint"}`}>
              {dead.length}/{resolved.length} dead or failing
            </span>
          )}
        </div>
        {resolved.length > 0 ? (
          <div className="mt-1.5 divide-y divide-line/60 rounded-lg border border-line">
            {resolved.map((t, i) => {
              const m = t.verdict ? verdictMeta(t.verdict) : null;
              return (
                <div key={i} className="px-3 py-2 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => t.address && onAudit?.(t.address)} className="mono text-ink underline-offset-2 hover:text-signal-dim hover:underline">{t.label}</button>
                    {m && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${m.color}1a`, color: m.color }}>{t.verdict}{t.score != null ? ` ${t.score}` : ""}</span>}
                    <span className="text-[11px] text-ink-faint">liq {money(t.liquidityUsd)}</span>
                    {t.dead && <span className="mono rounded border border-avoid/40 px-1.5 py-0.5 text-[9.5px] text-avoid">rugged / dead</span>}
                    {t.address && t.chain && <span className="ml-auto"><TokenSparkline address={t.address} chain={t.chain} pairAddress={t.pairAddress} compact /></span>}
                  </div>
                  {t.address && t.chain && <CallTimeline handle={handle} ticker={t.label} address={t.address} chain={t.chain} />}
                </div>
              );
            })}
          </div>
        ) : (
          !loading && resolved.length === 0 && unresolved.length === 0 && <p className="mt-1 text-[12px] text-ink-faint">No promoted tokens found.</p>
        )}
        {dead.length > 0 && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-avoid">
            {dead.length} of the {resolved.length} tokens this account promoted are now dead or failing — a shill-and-dump pattern.
          </p>
        )}
        {/* Promoted tickers we couldn't match to an on-chain contract — shown, not
            silently dropped, so a token they clearly promoted (e.g. $DUBBZ) doesn't
            just vanish from the list. Ticker-only, no DEX pair under that symbol. */}
        {!loading && unresolved.length > 0 && (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
            Also promoted, couldn't price on-chain (ticker-only — no DEX pair found under that symbol): {unresolved.map((t) => t.label).join(", ")}.
          </p>
        )}
      </div>

      {/* reach authenticity */}
      {signals && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[12px] font-medium text-ink">Reach authenticity</div>
          <div className={`mt-1 text-[12px] leading-relaxed ${signals.flags?.length ? "text-avoid" : "text-ink-dim"}`}>{signals.note}</div>
          <div className="mono mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
            {signals.totalFollowers != null && <span>{Number(signals.totalFollowers).toLocaleString()} followers</span>}
            {signals.botPct != null && <span className={signals.botPct >= 35 ? "text-avoid" : ""}>~{signals.botPct}% bot markers ({signals.followerSample} sampled)</span>}
            {signals.engagement && <span>~{signals.engagement.avgLikes} likes · {signals.engagement.avgReplies} replies/post</span>}
          </div>
        </div>
      )}

      {/* known associates */}
      {assoc.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[12px] font-medium text-ink">Known associates</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {assoc.map((a, i) => {
              const h = a.associate_key.startsWith("@") ? a.associate_key : null;
              return h && onAudit ? (
                <button key={i} onClick={() => onAudit(h)} title={a.relation} className="mono rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink transition hover:border-signal hover:text-signal">{a.associate_key}</button>
              ) : (
                <span key={i} title={a.relation} className="mono rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-dim">{a.associate_key}</span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
