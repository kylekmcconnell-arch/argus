// Concentrated-liquidity (V3-style) position custody, traced live. On these
// pools the liquidity is a position NFT, not an LP token, so the standard
// lock/burn percentages read 0 by construction and say nothing about whether
// the pool can be pulled. This panel calls api/nftlock, which follows each of
// the largest Mint events to the position's CURRENT owner and classifies it:
// burned, a plain wallet (removable at will), or a holder contract read for a
// callable exit path. Live supplemental data: it does not change the saved
// score or the frozen report.
import { useEffect, useRef, useState } from "react";

interface NftPosition {
  tokenId: number;
  owner: string | null;
  ownerKind: "burned" | "eoa" | "contract" | "closed";
  ownerName: string | null;
  amount: string;
  locked: boolean | null;
  reason: string;
}
interface NftLockReport {
  available: boolean;
  manager: string | null;
  positions: NftPosition[];
  dominant: NftPosition | null;
  note: string;
}

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function positionTone(p: NftPosition): { color: string; label: string } {
  if (p.ownerKind === "closed") return { color: "var(--color-ink-faint)", label: "closed" };
  if (p.ownerKind === "burned") return { color: "var(--color-pass)", label: "burned" };
  if (p.locked === true) return { color: "var(--color-pass)", label: "locked" };
  if (p.locked === false) return { color: "var(--color-avoid)", label: "removable" };
  return { color: "var(--color-caution)", label: "unconfirmed" };
}

export function LpCustody({ chain, pairAddress }: { chain: string; pairAddress: string }) {
  const [state, setState] = useState<"loading" | "done" | "unsupported">("loading");
  const [report, setReport] = useState<NftLockReport | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/nftlock?address=${encodeURIComponent(pairAddress)}&chain=${encodeURIComponent(chain)}`,
          { signal: AbortSignal.timeout(26000) },
        );
        if (!res.ok) { setState("unsupported"); return; }
        const d = (await res.json()) as NftLockReport;
        if (!d.available || !d.positions?.length) { setState("unsupported"); return; }
        setReport(d);
        setState("done");
      } catch {
        setState("unsupported");
      }
    })();
  }, [chain, pairAddress]);

  if (state === "unsupported") return null;

  return (
    <section className="panel p-4" aria-label="Liquidity position custody">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">Who can pull the liquidity</h3>
        <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">traced on-chain · live</span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
        This pool holds its liquidity as position NFTs, not a lockable LP token, so lock percentages do not apply here.
        Each large position below was followed to its current owner and checked for a way to withdraw.
      </p>
      {state === "loading" && (
        <p className="mt-3 animate-pulse text-[12px] text-ink-faint">Tracing the largest positions to their current owners…</p>
      )}
      {state === "done" && report && (
        <>
          <div className="mt-3 divide-y divide-line/60">
            {report.positions.map((p) => {
              const tone = positionTone(p);
              return (
                <div key={p.tokenId} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="mono text-[11px] text-ink-faint">
                      #{p.tokenId}{p.ownerName ? ` · ${p.ownerName}` : p.owner ? ` · ${shortAddr(p.owner)}` : ""}
                    </span>
                    <span className="mono ml-auto rounded border border-current px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider" style={{ color: tone.color }}>
                      {tone.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-dim">{p.reason}</p>
                </div>
              );
            })}
          </div>
          <p className="mono mt-2 border-t border-line/70 pt-2 text-[10.5px] text-ink-faint">{report.note}</p>
        </>
      )}
    </section>
  );
}
