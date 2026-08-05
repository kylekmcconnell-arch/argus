import { useEffect, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { fetchPanelJson, panelRequestFailure, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

/**
 * WHO FUNDED THE FIRST BUYERS.
 *
 * The GMGN panel above this one carries a provider's opinion of the launch.
 * This one is ARGUS's own measurement: the wallets that took supply in the
 * token's first transactions, traced back to where each got its first SOL.
 * "17 of 36 early buyers share a funder" rendered here is derived from named
 * on-chain transactions and can be checked by anyone with an RPC node.
 *
 * It reports the shape and stops there. A shared funder, a same-block sweep
 * and an exited cluster are measurements; "this launch was bundled" is a
 * conclusion this panel never draws. A funder that is exchange custody is
 * named as such and never treated as a link between wallets, because
 * thousands of unrelated people withdraw from the same Binance hot wallet.
 */

interface ClusterMember {
  address: string;
  receivedUi: number;
  paidInFirstTx: boolean;
  remainingUi: number | null;
}

interface Cluster {
  funder: string;
  funderIsCreator: boolean;
  size: number;
  members: ClusterMember[];
  receivedTotalUi: number;
  remainingTotalUi: number | null;
  stillHeldPct: number | null;
}

interface EarlyBuyerPayload {
  mint: string;
  available: boolean;
  reachedLaunch?: boolean;
  windowTxCount?: number;
  buyersFound?: number;
  buyersCapped?: boolean;
  buyersTraced?: number;
  tracedIsPartial?: boolean;
  labelsAvailable?: boolean;
  creator?: { address: string; receivedUi: number | null } | null;
  sameBlock?: Array<{ slot: number; count: number }>;
  sameTx?: Array<{ signature: string; count: number }>;
  clusters?: Cluster[];
  cexFunded?: Array<{ address: string; exchange: string }>;
  unresolvedFunding?: number;
  note?: string | null;
}

const amount = (value: number): string =>
  value >= 1e9 ? `${(value / 1e9).toFixed(1)}B`
    : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M`
      : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K`
        : value.toFixed(value < 10 ? 2 : 0);

export function EarlyBuyerFunding({ chain, mint }: { chain?: string | null; mint?: string | null }) {
  const [data, setData] = useState<EarlyBuyerPayload | null>(null);
  const [failure, setFailure] = useState<PanelRequestFailure | null>(null);
  const [loading, setLoading] = useState(false);

  const solana = chain === "solana";
  useEffect(() => {
    if (!solana || !mint) return;
    let live = true;
    setLoading(true);
    fetchPanelJson<EarlyBuyerPayload>(`/api/early-buyers?mint=${encodeURIComponent(mint)}`)
      .then((payload) => { if (live) setData(payload); })
      .catch((error) => { if (live) setFailure(panelRequestFailure(error)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [solana, mint]);

  if (!solana || !mint) return null;
  if (failure) return <PanelRequestNotice failure={failure} label="Early-buyer funding trace" />;
  if (loading && !data) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">Who funded the first buyers</div>
        <div className="scan-bar" />
        <p className="mt-2 text-[12.5px] text-ink-faint">Walking the token's first transactions and tracing each early wallet's seed funding. This takes up to a minute.</p>
      </div>
    );
  }
  if (!data) return null;

  // A trace that did not run, or could not reach the launch, says so and
  // publishes nothing else. No shared funder found is a different sentence
  // than no trace taken, and the two must never look alike.
  if (!data.available || data.reachedLaunch === false) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">Who funded the first buyers</div>
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          {data.note ?? "The early-buyer funding trace was not taken for this token."}
        </p>
      </div>
    );
  }

  const clusters = data.clusters ?? [];
  const cexFunded = data.cexFunded ?? [];

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Who funded the first buyers</span>
        <span className="mono text-[11px] text-ink-faint">ARGUS on-chain trace</span>
      </div>

      {data.note && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{data.note}</p>
      )}

      {clusters.map((cluster) => (
        <div key={cluster.funder} className="mt-3 border-t border-line/60 pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[12px] text-ink">
              {cluster.size} wallets seeded by{" "}
              <span className="mono">{shortAddr(cluster.funder)}</span>
              {cluster.funderIsCreator && (
                <span className="ml-1.5 rounded border border-line px-1.5 py-0.5 text-[10.5px]" style={{ color: "var(--color-caution)" }}>
                  the token's creator
                </span>
              )}
            </span>
            <span className="mono text-[11.5px] tabular text-ink-dim">
              took {amount(cluster.receivedTotalUi)}
              {cluster.stillHeldPct !== null
                ? ` · still holds ${cluster.stillHeldPct.toFixed(0)}%`
                : " · current holdings unreadable"}
            </span>
          </div>
          <div className="mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
            {cluster.members.map((member) => (
              <span key={member.address} title={member.paidInFirstTx ? "Paid SOL in its first receiving transaction: a buy." : "Received without paying in the transaction: a transfer, not a buy."}>
                {shortAddr(member.address)}{member.paidInFirstTx ? "" : " (transferred)"}
              </span>
            ))}
          </div>
        </div>
      ))}

      {cexFunded.length > 0 && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
          Funded from exchange custody and therefore never clustered:{" "}
          {cexFunded.slice(0, 6).map((entry) => `${shortAddr(entry.address)} (${entry.exchange})`).join(", ")}
          {cexFunded.length > 6 ? ` and ${cexFunded.length - 6} more` : ""}.
        </p>
      )}

      {(data.tracedIsPartial || (data.unresolvedFunding ?? 0) > 0 || data.labelsAvailable === false) && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
          {data.tracedIsPartial && `Funding was traced for ${data.buyersTraced} of ${data.buyersFound} early wallets before the time budget ran out. `}
          {(data.unresolvedFunding ?? 0) > 0 && `${data.unresolvedFunding} wallet${(data.unresolvedFunding ?? 0) === 1 ? "'s" : "s'"} seed funding could not be resolved; unresolved is not independent. `}
          {data.labelsAvailable === false && "Market-infrastructure labels were unavailable for this run, so a pool or vault account may appear among the recipients."}
        </p>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
        Measured by ARGUS from the token's first transactions via Helius. These are shapes (shared funders, same-block buys, what a group has kept), not a verdict on intent.
      </p>
    </section>
  );
}
