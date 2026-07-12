import { useEffect, useRef, useState } from "react";
import { auditToken } from "../token/audit";
import { isRunnableTokenInput, resolveInput } from "../lib/resolveInput";
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
type TokRes = { label: string; address?: string; chain?: string; pairAddress?: string; verdict?: string; score?: number | null; liquidityUsd?: number; mcap?: number; dead: boolean; unresolved?: boolean };

async function tickerToContract(ticker: string): Promise<string | null> {
  const sym = ticker.replace(/^\$/, "").toUpperCase();
  if (!sym || sym.length < 2) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(sym)}`);
    const d = await r.json();
    const all: any[] = Array.isArray(d?.pairs) ? d.pairs : [];
    const mc = (p: any) => Number(p?.marketCap ?? p?.fdv ?? 0);
    const matches = all.filter((p: any) => p?.baseToken?.address && String(p?.baseToken?.symbol ?? "").toUpperCase() === sym);
    // Reject FAKE-SUPPLY tokens: no real token's cap exceeds ~$3.5T (BTC), so a
    // "$37 quadrillion" cap is a fabricated supply. Ranking by cap was letting one
    // of those hijack the match (this is what broke $send). Cap-rank the sane ones,
    // falling back to all matches (by liquidity) only if the filter empties.
    const sane = matches.filter((p: any) => mc(p) < 1e12);
    const pool = sane.length ? sane : matches;
    pool.sort((a: any, b: any) => (mc(b) - mc(a)) || (Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0)));
    return pool[0]?.baseToken?.address ?? null;
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

// Audit ONE promoted token. Returns null when it isn't a real promotion to grade
// (a blue-chip reference, or a mention that resolves to a major asset).
async function auditOnePromo(p: Promo): Promise<TokRes | null> {
  const tick = (p.ticker ?? "").replace(/^\$/, "").toUpperCase();
  // A blue-chip reference isn't a promotion — drop it before spending an audit.
  if (!p.contract_address && BLUECHIP.has(tick)) return null;
  let contract = p.contract_address || null;
  if (!contract && p.ticker) contract = await tickerToContract(p.ticker);
  const label = p.ticker ? (p.ticker.startsWith("$") ? p.ticker : "$" + p.ticker) : "token";
  if (!contract) return { label, dead: false, unresolved: true };
  const input = resolveInput(contract);
  const d = isRunnableTokenInput(input) ? await auditToken(input, undefined, { skipSim: true }).catch(() => null) : null;
  if (!d) return { label, dead: false, unresolved: true };
  if (BLUECHIP.has((d.symbol ?? "").toUpperCase())) return null; // resolved to a major asset
  const liq = d.liquidityUsd ?? 0;
  const mc = d.mcap ?? 0;
  // "rugged / dead" means the token is actually gone: essentially no MARKET CAP
  // AND no tradeable liquidity. Market cap — not DEX liquidity — is the life
  // signal: a real project ($RLB/Rollbit) can have thin DEX liquidity yet a large
  // cap because it trades on CEXes, and is NOT dead. This is distinct from the
  // ARGUS risk verdict (a token can be alive but still FAIL on risk).
  const dead = mc < 50_000 && liq < 5_000;
  const saneMcap = d.mcap != null && d.mcap < 1e12 ? d.mcap : undefined; // never show a fabricated-supply cap
  return { label: d.symbol ? `$${d.symbol}` : label, address: d.address, chain: d.chain, pairAddress: d.pairAddress, verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, mcap: saneMcap, dead };
}

// Run the promo audits with bounded concurrency (each is a dexscreener/rugcheck
// round-trip; 20 in series took ~15s). A pool of 4 keeps it fast without
// hammering the free APIs into rate limits; results stay in promo order.
async function auditPromotions(promos: Promo[]): Promise<TokRes[]> {
  const list = promos.slice(0, 20);
  const results: (TokRes | null)[] = new Array(list.length).fill(null);
  const POOL = 4;
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await auditOnePromo(list[i]).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, list.length) }, worker));
  return results.filter((r): r is TokRes => r != null);
}

export function KolReport({ handle, promotions, associates, panelCostToken, record = true, onAudit }: { handle: string; promotions: Promo[]; associates: Assoc[]; panelCostToken?: string; record?: boolean; onAudit?: (q: string) => void }) {
  const [tokens, setTokens] = useState<TokRes[] | null>(null);
  const [signals, setSignals] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const [sig, toks] = await Promise.all([
        fetch(
          `/api/kol-signals?handle=${encodeURIComponent(handle.replace(/^@/, ""))}`,
          panelCostToken ? { headers: { "x-argus-panel-token": panelCostToken } } : undefined,
        ).then((r) => r.json()).catch(() => null),
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
      if (record && ents.length) recordForensicEntities(handle, ents);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved = (tokens ?? []).filter((t) => !t.unresolved);
  const unresolved = (tokens ?? []).filter((t) => t.unresolved);
  const money = (n?: number) => (n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n));
  const assoc = associates.filter((a) => a.associate_key).slice(0, 12);

  return (
    <div className="panel p-4">
      {loading && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-ink-faint">grading promoted tokens + auditing reach…</span>
        </div>
      )}

      {/* promoted-token performance */}
      <div className="mt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px] font-medium text-ink">Tokens they promoted</span>
          {resolved.length + unresolved.length > 0 && (
            <span className="mono text-[11px] text-ink-faint">{resolved.length + unresolved.length} call{resolved.length + unresolved.length === 1 ? "" : "s"} priced</span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">Graded on how far each call ran <span className="text-ink-dim">after it was called</span> (the peak), not whether the token is alive now — most memecoins fade regardless of who called them.</p>
        {resolved.length > 0 ? (
          <div className="panel-inset mt-1.5 divide-y divide-line/60">
            {resolved.map((t, i) => {
              const m = t.verdict ? verdictMeta(t.verdict) : null;
              return (
                <div key={i} className="px-3 py-2 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => t.address && onAudit?.(t.address)} className="mono text-ink underline-offset-2 hover:text-signal-dim hover:underline">{t.label}</button>
                    {m && <span className={`verdict-pill ${t.verdict === "FAIL" ? "tint-fail" : "tint-var"}`} style={t.verdict === "FAIL" ? undefined : ({ "--tint": m.color } as React.CSSProperties)}>{t.verdict}{t.score != null ? ` ${t.score}` : ""}</span>}
                    <span className="text-[11px] text-ink-faint">{t.mcap ? `mcap ${money(t.mcap)}` : `liq ${money(t.liquidityUsd)}`}</span>
                    {t.dead && <span className="chip tint-caution">inactive now</span>}
                    {t.address && t.chain && <span className="ml-auto"><TokenSparkline address={t.address} chain={t.chain} pairAddress={t.pairAddress} compact hidePct /></span>}
                  </div>
                  {t.address && t.chain && <CallTimeline handle={handle} ticker={t.label} address={t.address} chain={t.chain} panelCostToken={panelCostToken} />}
                </div>
              );
            })}
          </div>
        ) : (
          !loading && resolved.length === 0 && unresolved.length === 0 && <p className="mt-1 text-[12.5px] text-ink-faint">No promoted tokens found.</p>
        )}
        {/* Promoted tickers we couldn't match to an on-chain contract — shown, not
            silently dropped, so a token they clearly promoted (e.g. $DUBBZ) doesn't
            just vanish from the list. Ticker-only, no DEX pair under that symbol. */}
        {!loading && unresolved.length > 0 && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">
            Also promoted, couldn't price on-chain (ticker-only — no DEX pair found under that symbol): {unresolved.map((t) => t.label).join(", ")}.
          </p>
        )}
      </div>

      {/* reach authenticity */}
      {signals && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[12.5px] font-medium text-ink">Reach authenticity</div>
          <div className={`mt-1 text-[12.5px] leading-relaxed ${signals.flags?.length ? "text-avoid" : "text-ink-dim"}`}>{signals.note}</div>
          <div className="mono mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
            {signals.totalFollowers != null && <span>{Number(signals.totalFollowers).toLocaleString()} followers</span>}
            {signals.botPct != null && <span className={signals.botPct >= 35 ? "text-avoid" : ""}>~{signals.botPct}% bot markers ({signals.followerSample} sampled)</span>}
            {signals.engagement && <span>~{signals.engagement.avgLikes} likes · {signals.engagement.avgReplies} replies/post</span>}
          </div>
        </div>
      )}

      {/* known associates */}
      {assoc.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-[12.5px] font-medium text-ink">Known associates</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {assoc.map((a, i) => {
              const h = a.associate_key.startsWith("@") ? a.associate_key : null;
              return h && onAudit ? (
                <button key={i} onClick={() => onAudit(h)} title={a.relation} className="btn-chip tint-signal normal-case">{a.associate_key}</button>
              ) : (
                <span key={i} title={a.relation} className="chip normal-case">{a.associate_key}</span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
