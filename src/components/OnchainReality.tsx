import { useEffect, useRef, useState } from "react";
import { auditToken } from "../token/audit";
import { resolveInput } from "../lib/resolveInput";
import { shortAddr } from "../lib/wallets";
import { verdictMeta } from "../lib/verdict";
import { FunderSweep } from "./FunderSweep";

// Auto on-chain cascade for a handle audit: take the token the account promotes
// (or a wallet it disclosed), resolve it, get its deployer, and pull the money
// trail + serial-launch history — the on-chain unmask that the social side can't
// do. Runs automatically on report load; the heavy funder sweep stays on-click.
type Promo = { ticker?: string; contract_address?: string; chain?: string };
type Wal = { address: string; chain: string };

// Resolve a promoted ticker to a contract by EXACT symbol match — a fuzzy search
// picks unrelated tokens (or ones whose address merely contains the letters), so
// we only accept baseToken.symbol === ticker, prefer Solana, then top liquidity.
async function tickerToContract(ticker: string): Promise<string | null> {
  const sym = ticker.replace(/^\$/, "").toUpperCase();
  if (!sym) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(sym)}`);
    const d = await r.json();
    const pairs: any[] = (Array.isArray(d?.pairs) ? d.pairs : [])
      .filter((p) => p?.baseToken?.address && String(p?.baseToken?.symbol ?? "").toUpperCase() === sym)
      .sort((a, b) => (b?.chainId === "solana" ? 1 : 0) - (a?.chainId === "solana" ? 1 : 0) || Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
    return pairs[0]?.baseToken?.address ?? null;
  } catch {
    return null;
  }
}

export function OnchainReality({ promotions, wallets, onAudit }: { promotions: Promo[]; wallets: Wal[]; onAudit?: (q: string) => void }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [tok, setTok] = useState<any | null>(null);
  const [trail, setTrail] = useState<any | null>(null);
  const [subject, setSubject] = useState<{ label: string; deployer?: string } | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      let contract: string | null = promotions.find((p) => p.contract_address)?.contract_address ?? null;
      let tickerLabel = "";
      if (!contract) {
        const tk = promotions.find((p) => p.ticker)?.ticker;
        if (tk) { tickerLabel = tk.startsWith("$") ? tk : "$" + tk; contract = await tickerToContract(tk); }
      }
      const solWallet = wallets.find((w) => w.chain === "solana")?.address;
      if (!contract && !solWallet) { setState("done"); return; }
      setState("loading");
      if (contract) {
        const input = resolveInput(contract);
        const d = input.kind === "token" ? await auditToken(input, undefined, { skipSim: true }).catch(() => null) : null;
        setTok(d);
        const dep = d?.deployer ?? null;
        setSubject({ label: d?.symbol ? `$${d.symbol}` : tickerLabel || "promoted token", deployer: dep ?? undefined });
        if (dep && d?.chain === "solana") {
          try {
            const r = await fetch(`/api/deployer?wallet=${encodeURIComponent(dep)}`);
            const t = await r.json();
            setTrail(t?.available === false ? null : t);
          } catch { /* trail optional */ }
        }
      } else if (solWallet) {
        setSubject({ label: "disclosed wallet", deployer: solWallet });
      }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "idle" || (state === "done" && !subject)) return null;

  const m = tok ? verdictMeta(tok.verdict) : null;
  const sweepWallet = subject?.deployer;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">On-chain reality check</span>
        {state === "loading" && <span className="text-[11px] text-ink-faint">tracing the promoted token on-chain…</span>}
      </div>

      {tok && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
          <button onClick={() => onAudit?.(tok.address)} className="mono text-ink underline-offset-2 hover:text-signal-dim hover:underline">{subject?.label}</button>
          {m && <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${m.color}1a`, color: m.color }}>{tok.verdict}{tok.score != null ? ` ${tok.score}` : ""}</span>}
          {typeof tok.liquidityUsd === "number" && <span className="text-[11px] text-ink-faint">liquidity ${Math.round(tok.liquidityUsd).toLocaleString()}</span>}
          <span className="text-[10.5px] text-ink-faint">· the token this account promotes</span>
        </div>
      )}

      {subject?.deployer && (
        <div className="mt-2 text-[12px] text-ink-dim">
          Deployer <span className="mono text-ink">{shortAddr(subject.deployer)}</span>
          {trail?.walletAgeDays != null && <> · wallet {trail.walletAgeDays}d old</>}
          {trail?.tokensCreated != null && (
            <> · <span className={trail.serialDeployer ? "font-medium text-avoid" : ""}>{trail.tokensCreated} token{trail.tokensCreated === 1 ? "" : "s"} minted{trail.serialDeployer ? " · serial deployer" : ""}</span></>
          )}
          {trail?.note && <div className="mt-1 leading-snug text-ink-faint">{trail.note}</div>}
        </div>
      )}

      {sweepWallet && <FunderSweep wallet={sweepWallet} onAudit={onAudit} />}

      {state === "done" && !tok && !subject?.deployer && (
        <div className="mt-1.5 text-[12px] text-ink-faint">The promoted token could not be resolved on-chain (thin, unlisted, or non-Solana).</div>
      )}
    </div>
  );
}
