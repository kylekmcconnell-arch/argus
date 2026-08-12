import { useEffect, useState } from "react";
import { usdCompact } from "../lib/format";
import { shortAddr } from "../lib/wallets";
import { fetchPanelJson, panelRequestFailure, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";
import type { LiveForensicStatusHandler } from "../lib/liveForensics";

/**
 * WHAT THE TOP HOLDERS PAID.
 *
 * Every other holder panel in this report answers "how much do they hold". That
 * does not say whether they are about to sell. A wallet sitting on a 40x gain
 * and a wallet underwater on the same position behave nothing alike, and GMGN
 * is the only source here that reports the entry cost that tells them apart.
 *
 * Everything on this card is GMGN's account of the chain, and the card says so
 * once, plainly, rather than repeating a hedge on every row. Their per-wallet
 * risk tags are their classification and are labelled as such: ARGUS did not
 * verify that a wallet is a sniper, GMGN asserted it.
 *
 * The row type is restated here rather than imported from server/adapters/gmgn
 * for the same reason OperatorTrackRecord restates its own: pulling a server
 * adapter into the app tsconfig drags node globals in behind it.
 */

export interface GmgnHolderRow {
  address: string;
  percent: number | null;
  usdValue: number | null;
  costUsd: number | null;
  profitUsd: number | null;
  riskTags: string[];
  suspicious: boolean;
  xHandle: string | null;
  exchange: string | null;
}

interface GmgnHolderPayload {
  available: boolean;
  note: string | null;
  capped: boolean;
  claims: string[];
  holders: GmgnHolderRow[];
}

/** A signed percentage return, only where both sides were actually reported. */
function returnPct(row: GmgnHolderRow): number | null {
  if (row.costUsd === null || row.profitUsd === null || row.costUsd <= 0) return null;
  return (row.profitUsd / row.costUsd) * 100;
}

function toneFor(pct: number | null): string {
  if (pct === null) return "var(--color-ink-faint)";
  if (pct > 0) return "var(--color-pass)";
  if (pct < 0) return "var(--color-caution)";
  return "var(--color-ink-dim)";
}

// The chains GMGN actually serves (server/adapters/gmgn.ts). A chain outside
// this set is NOT an outage: querying it returns a truthful "not covered",
// which the live-forensics rail would then report as a failed check and paint
// a red coverage warning over an otherwise complete scan. Not covered is a
// silent absence, so the panel does not run at all.
const SUPPORTED_CHAINS = new Set(["solana", "ethereum", "base", "bsc"]);

export function GmgnHolderCosts({ chain, address, onStatusChange }: { chain?: string | null; address?: string | null; onStatusChange?: LiveForensicStatusHandler }) {
  const [data, setData] = useState<GmgnHolderPayload | null>(null);
  const [failure, setFailure] = useState<PanelRequestFailure | null>(null);
  const [loading, setLoading] = useState(false);

  const supported = !!chain && SUPPORTED_CHAINS.has(chain.toLowerCase());
  useEffect(() => {
    if (!supported || !chain || !address) return;
    let live = true;
    setLoading(true);
    onStatusChange?.({ id: "gmgn-holder-costs", label: "GMGN holder cost basis", state: "running" });
    fetchPanelJson<GmgnHolderPayload>(`/api/gmgn-holders?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`)
      .then((payload) => {
        if (!live) return;
        setData(payload);
        onStatusChange?.({ id: "gmgn-holder-costs", label: "GMGN holder cost basis", state: payload.available ? "complete" : "unavailable" });
      })
      .catch((error) => {
        if (!live) return;
        setFailure(panelRequestFailure(error));
        onStatusChange?.({ id: "gmgn-holder-costs", label: "GMGN holder cost basis", state: "unavailable" });
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [supported, chain, address, onStatusChange]);

  if (!supported || !chain || !address) return null;
  if (failure) return <PanelRequestNotice failure={failure} label="Holder cost basis (GMGN)" />;
  if (loading && !data) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">What the top holders paid</div>
        <div className="scan-bar" />
      </div>
    );
  }
  if (!data) return null;

  // A reading that did not happen says why, and publishes nothing else. An
  // absent provider is not a token with no concentrated holders.
  if (!data.available) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">What the top holders paid</div>
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          {data.note ?? "GMGN's holder reading was not collected for this token."}
        </p>
      </div>
    );
  }

  const priced = data.holders.filter((row) => returnPct(row) !== null);
  const rows = data.holders.slice(0, 10);

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">What the top holders paid</span>
        <span className="mono text-[11px] text-ink-faint">
          GMGN{data.capped ? " · capped list, a floor" : ""}
        </span>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
        Entry cost and profit are GMGN's accounting of these wallets, not ARGUS's own reconstruction of the chain.
        A holder deep in profit has more reason to sell than one at break-even, which is what this shows and all it shows.
      </p>

      {rows.length > 0 && (
        <ol className="mt-3 divide-y divide-line/60 border-t border-line/60">
          {rows.map((row) => {
            const pct = returnPct(row);
            return (
              <li key={row.address} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="mono flex min-w-0 items-center gap-2 text-[11.5px] text-ink">
                  {shortAddr(row.address)}
                  {row.exchange && <span className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-faint">{row.exchange}</span>}
                  {row.xHandle && (
                    <a
                      href={`https://x.com/${encodeURIComponent(row.xHandle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-ext text-[10.5px] text-ink-faint"
                      title="X handle GMGN associates with this wallet. An attribution, not proof."
                    >
                      @{row.xHandle}
                    </a>
                  )}
                  {row.riskTags.map((tag) => (
                    <span key={tag} className="rounded border border-line px-1.5 py-0.5 text-[10.5px]" style={{ color: "var(--color-caution)" }}>
                      {tag} (GMGN)
                    </span>
                  ))}
                </span>
                <span className="mono shrink-0 text-[11.5px] tabular text-ink-dim">
                  {row.percent !== null ? `${row.percent.toFixed(2)}%` : "share not reported"}
                  {row.costUsd !== null && <span className="text-ink-faint"> · paid {usdCompact(row.costUsd)}</span>}
                  {pct !== null && (
                    <span style={{ color: toneFor(pct) }}> · {pct > 0 ? "+" : ""}{pct.toFixed(0)}%</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {priced.length === 0 && (
        <p className="mt-3 text-[12.5px] text-ink-faint">
          GMGN reported no entry cost for these wallets, so whether they are in profit is not measured here.
        </p>
      )}

      {data.claims.map((claim) => (
        <p key={claim} className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{claim}</p>
      ))}
    </section>
  );
}
