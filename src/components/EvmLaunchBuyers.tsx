import { useEffect, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { fetchPanelJson, panelRequestFailure, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

interface Payload {
  available: boolean;
  note?: string;
  sourceUrl?: string;
  decimals?: number | null;
  creationBlock?: number;
  pool?: string;
  launcher?: string | null;
  creator?: string | null;
  buyers?: Array<{
    address: string;
    firstBlock: number;
    boughtRaw: string;
    remainingRaw: string | null;
    transactionOrigin: string | null;
    contractWallet: boolean | null;
  }>;
  buyersCapped?: boolean;
  sameBlock?: Array<{ block: number; count: number }>;
  sharedOrigins?: Array<{ address: string; count: number }>;
  boughtRaw?: string;
  remainingRaw?: string | null;
  totalSupplyRaw?: string;
}

const SUPPORTED = new Set(["robinhood"]);

function ratio(numerator: string | null | undefined, denominator: string | null | undefined): number | null {
  if (!numerator || !denominator) return null;
  try {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    return d > 0n ? Number((n * 1_000_000n) / d) / 10_000 : null;
  } catch { return null; }
}

function amount(raw: string | null | undefined, decimals = 18): string {
  if (raw === null || raw === undefined) return "unreadable";
  try {
    const value = BigInt(raw);
    const scale = 10n ** BigInt(Math.max(0, Math.min(decimals, 30)));
    const whole = Number(value / scale);
    if (whole >= 1e9) return `${(whole / 1e9).toFixed(2)}B`;
    if (whole >= 1e6) return `${(whole / 1e6).toFixed(2)}M`;
    if (whole >= 1e3) return `${(whole / 1e3).toFixed(1)}K`;
    return whole.toLocaleString("en-US");
  } catch { return "unreadable"; }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/50 py-1.5 last:border-0">
      <span className="text-[12px] text-ink-dim">{label}</span>
      <span className="mono text-right text-[12px] tabular text-ink">{value}</span>
    </div>
  );
}

export function EvmLaunchBuyers({ chain, address }: { chain?: string | null; address?: string | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const [failure, setFailure] = useState<PanelRequestFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const supported = !!chain && SUPPORTED.has(chain.toLowerCase());

  useEffect(() => {
    if (!supported || !chain || !address) return;
    let live = true;
    setLoading(true);
    // Clear the previous failure before the retry. Without this a transient
    // error kept the failure notice pinned over fresh data for the rest of
    // the mount, because nothing ever reset it.
    setFailure(null);
    fetchPanelJson<Payload>(`/api/evm-launch-buyers?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`)
      .then((payload) => { if (live) setData(payload); })
      .catch((error) => { if (live) setFailure(panelRequestFailure(error)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [supported, chain, address]);

  if (!supported || !address) return null;
  if (failure) return <PanelRequestNotice failure={failure} label="Launch-buyer trace" />;
  if (loading && !data) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">Launch buyer concentration</div>
        <div className="scan-bar" />
        <p className="mt-2 text-[12px] text-ink-faint">Reconstructing the first pool recipients and their live balances from Robinhood Chain.</p>
      </div>
    );
  }
  if (!data) return null;
  if (!data.available) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">Launch buyer concentration</div>
        <p className="text-[12.5px] leading-relaxed text-ink-dim">{data.note ?? "The launch-buyer trace was not collected."}</p>
      </div>
    );
  }

  const buyers = data.buyers ?? [];
  const boughtPct = ratio(data.boughtRaw, data.totalSupplyRaw);
  const heldPctSupply = ratio(data.remainingRaw, data.totalSupplyRaw);
  const retainedPct = ratio(data.remainingRaw, data.boughtRaw);
  const netReductionRaw = data.remainingRaw && data.boughtRaw
    ? (() => { try { return (BigInt(data.boughtRaw) - BigInt(data.remainingRaw) > 0n ? BigInt(data.boughtRaw) - BigInt(data.remainingRaw) : 0n).toString(); } catch { return null; } })()
    : null;
  const creator = data.creator?.toLowerCase() ?? null;
  const creatorConnected = creator
    ? buyers.some((buyer) => buyer.address.toLowerCase() === creator || buyer.transactionOrigin?.toLowerCase() === creator)
    : null;
  const bursts = (data.sameBlock ?? []).slice(0, 4);
  const origins = (data.sharedOrigins ?? []).slice(0, 4);
  const pct = (value: number | null): string => value === null ? "unreadable" : `${value.toFixed(value >= 10 ? 1 : 2)}%`;

  return (
    <section className="panel overflow-hidden p-4" style={{ borderColor: "color-mix(in srgb, var(--color-caution) 42%, var(--color-line))" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow" style={{ color: "var(--color-caution)" }}>Launch buyer concentration</span>
        <span className="mono text-[11px] text-ink-faint">ARGUS · Blockscout + chain RPC</span>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
        This reconstructs the wallets that first received tokens from the launch pool. It measures concentration and timing; it does not infer common ownership from timing alone.
      </p>

      <div className="mt-3 rounded-lg border border-line/70 bg-surface/40 px-3 py-1">
        <Row label="First pool recipients" value={`${buyers.length}${data.buyersCapped ? "+" : ""} wallets`} />
        <Row label="They bought" value={`${amount(data.boughtRaw, data.decimals ?? 18)} · ${pct(boughtPct)} of supply`} />
        <Row label="They still hold" value={`${amount(data.remainingRaw, data.decimals ?? 18)} · ${pct(heldPctSupply)} of supply`} />
        <Row label="Net below their early take" value={`${amount(netReductionRaw, data.decimals ?? 18)} · ${retainedPct === null ? "retention unreadable" : `${Math.max(0, 100 - retainedPct).toFixed(1)}% net reduction`}`} />
        <Row label="Creator in first-buyer path" value={creatorConnected === null ? "creator unreadable" : creatorConnected ? "observed" : "not observed"} />
        {/* Math.min() over an empty list is Infinity, which would render
            "block Infinity". The server currently never returns an available
            reading with zero buyers, but the display must not depend on it. */}
        {buyers.length > 0 && (
          <Row label="First cluster buy" value={`block ${Math.min(...buyers.map((buyer) => buyer.firstBlock))}`} />
        )}
      </div>

      {bursts.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Same-block bursts</div>
          <p className="mono mt-1 text-[11.5px] leading-relaxed text-ink-dim">
            {bursts.map((burst) => `${burst.count} buyers in block ${burst.block}`).join(" · ")}
          </p>
        </div>
      )}

      {origins.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Common transaction submitters</div>
          <p className="mono mt-1 text-[11.5px] leading-relaxed text-ink-dim">
            {origins.map((origin) => `${shortAddr(origin.address)} submitted ${origin.count} buyers' first transactions`).join(" · ")}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            A common submitter can be an account-abstraction bundler or relayer serving unrelated users. It is evidence of a shared transaction path, not proof of a shared funder or owner.
          </p>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        {data.note}
        {data.sourceUrl && <> <a className="link-ext" href={data.sourceUrl} target="_blank" rel="noreferrer">Open the transfer ledger ↗</a></>}
      </p>
    </section>
  );
}
