import { useEffect, useId, useRef, useState } from "react";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

type HolderEntity = {
  id: string;
  name: string;
  type?: string;
  percent: number;
  usd: number;
  balance: number;
  observedWallets: number;
  knownWallets?: number;
  isService: boolean;
  tags: string[];
};

type HolderGroups = {
  available: boolean;
  entities: HolderEntity[];
  knownEntityPercent: number;
  groupedEntityCount: number;
  largestNonService?: HolderEntity;
};

const toneFor = (percent: number): string => (
  percent >= 40 ? "var(--color-avoid)"
    : percent >= 20 ? "var(--color-caution)"
      : "var(--color-signal)"
);
const tagClass = (label: string): string => (
  /hack|scam|sanction|mixer|ponzi|ransom|dark web|phish|exploit/i.test(label)
    ? "tint-avoid normal-case tracking-normal"
    : /whale|fomo|high risk/i.test(label)
      ? "tint-caution normal-case tracking-normal"
      : "normal-case tracking-normal"
);

export function EntityConcentration({ address, chain, symbol, panelCostToken }: {
  address: string;
  chain: string;
  symbol: string;
  panelCostToken?: string;
}) {
  const titleId = useId();
  const requestKey = [address, chain, panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; data: HolderGroups | null; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === requestKey || !address || !chain || !panelCostToken) return;
    ran.current = requestKey;
    let live = true;
    const query = new URLSearchParams({ address, chain });
    fetchPanelJson<HolderGroups>(
      `/api/arkham-token-holders?${query.toString()}`,
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
  if (current?.failure) return <PanelRequestNotice failure={current.failure} label="Connected-holder check" />;
  const data = current?.data;
  if (!data?.available || data.entities.length === 0) return null;

  const groupedNonService = data.entities.find((entity) => entity.observedWallets > 1 && !entity.isService);
  const groupedService = data.entities.find((entity) => entity.observedWallets > 1);
  const lead = groupedNonService ?? data.largestNonService ?? groupedService ?? data.entities[0];
  const tone = lead.isService ? "var(--color-signal)" : toneFor(lead.percent);
  const visibleWallets = lead.observedWallets;
  const groupedSentence = visibleWallets > 1
    ? `Arkham links at least ${visibleWallets} visible holder wallets to ${lead.name}. Together, the entity holds ${lead.percent.toFixed(1)}% of $${symbol}.`
    : `${lead.name} is the largest identified holder at ${lead.percent.toFixed(1)}% of $${symbol}.`;
  const custodySentence = lead.isService
    ? " It is marked as a service or custody entity, so this does not mean one person owns all of those tokens."
    : "";

  return (
    <section className="panel tint-var p-4" style={{ "--tint": tone } as React.CSSProperties} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-2">
        <span id={titleId} className="eyebrow">Who holds the visible supply</span>
        <span className="text-[11.5px] text-ink-dim">Arkham groups wallets attributed to the same entity</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink">
        {groupedSentence}{custodySentence}
      </p>

      <div className="mt-3 divide-y divide-line/60">
        {data.entities.slice(0, 6).map((entity) => (
          <div key={entity.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-[11.5px]">
            <span className="font-medium text-ink">{entity.name}</span>
            {entity.type && <span className={`chip ${entity.isService ? "tint-pass" : "tint-signal"}`}>{entity.type}</span>}
            {entity.observedWallets > 1 && (
              <span className="text-ink-faint">at least {entity.observedWallets} visible wallets</span>
            )}
            {entity.tags[0] && <span className={`chip ${tagClass(entity.tags[0])}`}>{entity.tags[0]}</span>}
            <span className="mono ml-auto tabular text-ink">{entity.percent.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-ink-faint">
        Arkham identified entities covering at least {data.knownEntityPercent.toFixed(1)}% of the token supply.
        Unidentified wallets remain separate. Entity attribution is useful evidence, not proof of beneficial ownership.
      </p>
    </section>
  );
}
