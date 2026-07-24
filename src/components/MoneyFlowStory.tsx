import { useEffect, useId, useRef, useState } from "react";
import { arkhamOf, useArkhamLabels } from "../lib/useArkhamLabels";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

type MoneyFlowEvent = {
  id: string;
  at: string;
  direction: "in" | "out";
  usd: number;
  token: string;
  chain: string;
  counterparty: string;
  counterpartyType?: string;
  counterpartyTags: string[];
  isExchange: boolean;
  transactionHash?: string;
};

type MoneyFlowData = {
  available: boolean;
  activeSince?: string;
  lifetimeInflowUsd: number;
  lifetimeOutflowUsd: number;
  lifetimeNetUsd: number;
  last30dInflowUsd: number;
  last30dOutflowUsd: number;
  events: MoneyFlowEvent[];
};

const usd = (value: number): string => (
  value >= 1e9 ? `$${(value / 1e9).toFixed(2)}B`
    : value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M`
      : value >= 1e3 ? `$${(value / 1e3).toFixed(1)}K`
        : `$${Math.round(value)}`
);

const day = (value: string): string => new Date(value).toLocaleDateString(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const tagClass = (label: string): string => (
  /hack|scam|sanction|mixer|ponzi|ransom|dark web|phish|exploit/i.test(label)
    ? "tint-avoid normal-case tracking-normal"
    : /whale|fomo|high risk/i.test(label)
      ? "tint-caution normal-case tracking-normal"
      : "normal-case tracking-normal"
);

function flowSummary(data: MoneyFlowData): string {
  const received = usd(data.lifetimeInflowUsd);
  const sent = usd(data.lifetimeOutflowUsd);
  if (data.lifetimeInflowUsd <= 0 && data.lifetimeOutflowUsd <= 0) {
    return "Arkham did not return enough priced history to calculate lifetime money flow.";
  }
  const net = data.lifetimeNetUsd;
  const netSentence = Math.abs(net) < Math.max(data.lifetimeInflowUsd, data.lifetimeOutflowUsd) * 0.01
    ? "Money in and money out are roughly balanced."
    : net > 0
      ? `${usd(net)} more came in than went out.`
      : `${usd(Math.abs(net))} more went out than came in.`;
  return `Across Arkham's recorded history, this wallet received ${received} and sent ${sent}. ${netSentence}`;
}

export function MoneyFlowStory({ address, chain, panelCostToken }: {
  address?: string | null;
  chain: string;
  panelCostToken?: string;
}) {
  const titleId = useId();
  const requestKey = [address ?? "", chain, panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; data: MoneyFlowData | null; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");
  const { labels, state: labelState } = useArkhamLabels([address], panelCostToken);
  const identity = arkhamOf(labels, address);

  useEffect(() => {
    if (ran.current === requestKey || !address || !panelCostToken) return;
    ran.current = requestKey;
    let live = true;
    const query = new URLSearchParams({ address, chain });
    fetchPanelJson<MoneyFlowData>(
      `/api/arkham-money-flow?${query.toString()}`,
      { headers: requiredPanelHeaders(panelCostToken) },
    )
      .then((data) => {
        if (live) {
          setResult(data.available
            ? { key: requestKey, data }
            : { key: requestKey, data: null, failure: "unavailable" });
        }
      })
      .catch((error: unknown) => {
        if (live) setResult({ key: requestKey, data: null, failure: panelRequestFailure(error) });
      });
    return () => { live = false; };
  }, [address, chain, panelCostToken, requestKey]);

  const current = result?.key === requestKey ? result : null;
  if (current?.failure) return <PanelRequestNotice failure={current.failure} label="Money-flow history" />;
  const data = current?.data;
  if (!data?.available || (data.lifetimeInflowUsd <= 0 && data.lifetimeOutflowUsd <= 0 && data.events.length === 0)) return null;

  const exchangeEvent = data.events.find((event) => event.direction === "out" && event.isExchange);
  const identityTags = identity?.tags?.slice(0, 4) ?? [];
  const footprint = identity?.entityWalletCount
    ? `Arkham links this entity to ${identity.entityWalletCount.toLocaleString()} wallet${identity.entityWalletCount === 1 ? "" : "s"}${identity.entityChainCount ? ` across ${identity.entityChainCount} chain${identity.entityChainCount === 1 ? "" : "s"}` : ""}.`
    : "";

  return (
    <section className="panel p-4" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span id={titleId} className="eyebrow">The wallet's money story</span>
        <span className="text-[11.5px] text-ink-dim">where the deployer's money came from and went (Arkham)</span>
      </div>

      {(labelState === "rescan_required" || labelState === "unavailable") && (
        <PanelRequestNotice failure={labelState} label="Wallet identity labels" className="mt-2" />
      )}

      {(identity?.name || identityTags.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {identity?.name && <span className="text-ink">Arkham identifies it as <strong>{identity.name}</strong>.</span>}
          {identityTags.map((tag) => <span key={tag.id} className={`chip ${tagClass(tag.label)}`}>{tag.label}</span>)}
          {footprint && <span className="text-ink-faint">{footprint}</span>}
        </div>
      )}

      <p className="mt-2 text-[13px] leading-relaxed text-ink">{flowSummary(data)}</p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="stat-tile">
          <div className="stat-label">recorded money in</div>
          <div className="stat-value mt-0.5 font-semibold tabular">{usd(data.lifetimeInflowUsd)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">recorded money out</div>
          <div className="stat-value mt-0.5 font-semibold tabular">{usd(data.lifetimeOutflowUsd)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">last 30 days in</div>
          <div className="stat-value mt-0.5 font-semibold tabular">{usd(data.last30dInflowUsd)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">last 30 days out</div>
          <div className="stat-value mt-0.5 font-semibold tabular">{usd(data.last30dOutflowUsd)}</div>
        </div>
      </div>

      {exchangeEvent && (
        <div className="finding tint-caution mt-3 px-3 py-2 text-[12px] leading-relaxed">
          A recent large transfer sent {usd(exchangeEvent.usd)} of {exchangeEvent.token} to {exchangeEvent.counterparty} on {day(exchangeEvent.at)}.
          A transfer to an exchange can be a sale or a custody move. ARGUS treats it as a signal, not proof of selling.
        </div>
      )}

      {data.events.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow">Recent large transfers</div>
          <div className="mt-1 divide-y divide-line/60">
            {data.events.slice(0, 8).map((event) => (
              <div key={event.id} className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 py-1.5 text-[11.5px] sm:grid-cols-[88px_minmax(0,1fr)_auto]">
                <time dateTime={event.at} className="mono text-ink-faint">{day(event.at)}</time>
                <span className="min-w-0 truncate text-ink-dim">
                  {event.direction === "out" ? "Sent to " : "Received from "}
                  <strong className="text-ink">{event.counterparty}</strong>
                  {event.isExchange ? " (exchange)" : ""}
                  {event.counterpartyTags[0] ? ` · ${event.counterpartyTags[0]}` : ""}
                </span>
                <span className="mono col-start-2 tabular text-ink sm:col-start-auto">{usd(event.usd)} {event.token}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.activeSince && (
        <p className="mt-2 text-[11px] text-ink-faint">Priced wallet history begins {day(data.activeSince)}.</p>
      )}
    </section>
  );
}
