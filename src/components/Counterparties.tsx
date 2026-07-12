import { useEffect, useRef, useState } from "react";
import { recordForensicEntities } from "../graph/store";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// Who the deployer actually transacts with, on-chain, named by Arkham — the real
// relationships behind an operator. Named non-exchange counterparties are wired
// into the trust graph as verified TRANSACTS_WITH edges (ground truth, not
// inference), so two tokens whose operators both move money through the same fund
// or mixer connect. Exchanges are shown but not bridged (everyone cashes out
// somewhere). Self-hides when there's nothing named to show.
type CP = { name: string; type?: string; address: string; twitter?: string; usd: number; txCount: number; flow: "in" | "out" | "both"; isCex: boolean; isContract: boolean };

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const RISKY = new Set(["privacy", "hacker", "sanctioned", "mixer"]);
const FLOW: Record<string, { g: string; t: string }> = { in: { g: "M13 5H3m0 0 4-4M3 5l4 4", t: "received from" }, out: { g: "M3 5h10m0 0-4-4m4 4-4 4", t: "sent to" }, both: { g: "M4 8h9m-9 0 3-3m-3 3 3 3M13 3h-9m9 0-3-3m3 3-3 3", t: "two-way" } };

export function Counterparties({ address, subject, panelCostToken, record = true }: { address?: string | null; subject?: string | null; chain?: string; panelCostToken?: string; record?: boolean }) {
  const requestKey = [address ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; rows: CP[]; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === requestKey || !address || !panelCostToken) return;
    ran.current = requestKey;
    let live = true;
    (async () => {
      try {
        const d = await fetchPanelJson<{ available?: boolean; counterparties?: CP[] }>(
          `/api/arkham-counterparties?address=${encodeURIComponent(address)}`,
          { headers: requiredPanelHeaders(panelCostToken) },
        );
        const cps: CP[] = d?.available ? d.counterparties ?? [] : [];
        if (!live) return;
        setResult({ key: requestKey, rows: cps });
        // Feed the meaningful ones into the graph (named, non-exchange, real volume).
        if (record && subject) {
          const seen = new Set<string>();
          const ents = cps
            .filter((c) => !c.isCex && (RISKY.has((c.type ?? "").toLowerCase()) || c.usd >= 10000))
            .map((c) => {
              const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
              const t = (c.type ?? "").toLowerCase();
              const risky = RISKY.has(t);
              // Transacting with a hacker / mixer / sanctioned entity keys on `risk:`
              // so it overrides the verdict; a normal named counterparty just bridges.
              return risky
                ? { key: `risk:${slug}`, type: "Identity", subtype: ["hacker", "sanctioned"].includes(t) ? "risk-avoid" : "risk-caution", edgeType: "TRANSACTS_WITH", label: `${c.name} · ${c.type}` }
                : { key: `arkham:${slug}`, type: "Identity", edgeType: "TRANSACTS_WITH", label: c.name };
            })
            .filter((e) => e.key !== "arkham:" && e.key !== "risk:" && !seen.has(e.key) && seen.add(e.key));
          if (ents.length) recordForensicEntities(subject, ents);
        }
      } catch (error) {
        if (live) setResult({ key: requestKey, rows: [], failure: panelRequestFailure(error) });
      }
    })();
    return () => { live = false; };
  }, [address, panelCostToken, record, requestKey, subject]);

  const current = result?.key === requestKey ? result : null;
  if (current?.failure) return <PanelRequestNotice failure={current.failure} label="Counterparty intelligence" />;
  const rows = current?.rows;
  if (!rows || rows.length === 0) return null;
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" /><path d="M8.4 6H16M6 8.4V16M8 16l8-8" /></svg>
        <span className="eyebrow">Counterparties</span>
        <span className="text-[11.5px] text-ink-dim">who the deployer moves money with, on-chain (Arkham)</span>
      </div>
      <div className="mt-2.5 divide-y divide-line/60">
        {rows.map((c, i) => {
          const risky = RISKY.has((c.type ?? "").toLowerCase());
          const nc = risky ? "var(--color-avoid)" : c.isCex ? "var(--color-pass)" : "var(--color-ink)";
          const f = FLOW[c.flow];
          return (
            <div key={i} className="flex items-center gap-2 py-1.5 text-[11.5px]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><title>{f.t}</title><path d={f.g} /></svg>
              <span className="mono truncate" style={{ color: nc }}>{c.name}</span>
              {c.type && <span className="chip tint-var shrink-0" style={{ "--tint": risky ? "var(--color-avoid)" : c.isCex ? "var(--color-pass)" : "var(--color-signal)" } as React.CSSProperties}>{c.type}</span>}
              {c.twitter && <a href={c.twitter} target="_blank" rel="noreferrer" className="link-ext mono shrink-0 text-[11px]">𝕏</a>}
              <span className="mono ml-auto shrink-0 tabular text-ink-dim">{usd(c.usd)}</span>
              <span className="mono shrink-0 text-[11px] text-ink-faint">{c.txCount.toLocaleString()} tx</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">Named non-exchange counterparties are wired into the trust graph as verified relationship edges — a shared fund or mixer bridges two operators automatically.</p>
    </div>
  );
}
