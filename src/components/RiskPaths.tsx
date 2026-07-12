import { useEffect, useRef, useState } from "react";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// Why a wallet is flagged: the seed→target trace behind its Arkham risk score.
// Each path names the hacker / mixer / sanctioned entity it's exposed to, the
// direction (received from vs sent to), how many hops away, and the USD that
// flowed. Self-hides when the wallet has no risk paths (i.e. it's clean).
type Path = { seed: string; seedName?: string; seedType?: string; category?: string; direction: string; score: number; usd: number; hops: number };

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const AVOID = new Set(["hacker", "sanctioned"]);

export function RiskPaths({ address, panelCostToken }: { address?: string | null; panelCostToken?: string }) {
  const requestKey = [address ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; paths: Path[]; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === requestKey || !address || !panelCostToken) return;
    ran.current = requestKey;
    let live = true;
    (async () => {
      try {
        const d = await fetchPanelJson<{ available?: boolean; paths?: Path[] }>(
          `/api/arkham-risk-paths?address=${encodeURIComponent(address)}`,
          { headers: requiredPanelHeaders(panelCostToken) },
        );
        if (live) setResult({ key: requestKey, paths: d?.available ? d.paths ?? [] : [] });
      } catch (error) {
        if (live) setResult({ key: requestKey, paths: [], failure: panelRequestFailure(error) });
      }
    })();
    return () => { live = false; };
  }, [address, panelCostToken, requestKey]);

  const current = result?.key === requestKey ? result : null;
  if (current?.failure) return <PanelRequestNotice failure={current.failure} label="Risk-path intelligence" />;
  const paths = current?.paths;
  if (!paths || paths.length === 0) return null;
  const worst = paths.some((p) => AVOID.has((p.category ?? "").toLowerCase()));
  const c = worst ? "var(--color-avoid)" : "var(--color-caution)";

  return (
    <div className="finding tint-var p-4" style={{ "--tint": c } as React.CSSProperties}>
      <div className="flex flex-wrap items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
        <span className="eyebrow">Risk paths</span>
        <span className="text-[11.5px] text-ink-dim">why the deployer is flagged · traced to the source (Arkham)</span>
      </div>
      <div className="mt-2.5 divide-y divide-line/60">
        {paths.map((p, i) => {
          const cat = (p.category ?? "").toLowerCase();
          const pc = AVOID.has(cat) ? "var(--color-avoid)" : "var(--color-caution)";
          const name = p.seedName || short(p.seed);
          const verb = p.direction === "backward" ? "sent funds to" : "received funds from";
          return (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-[11.5px]">
              <span className="text-ink-faint">{verb}</span>
              <span className="mono font-medium" style={{ color: pc }}>{name}</span>
              {p.category && <span className="chip tint-var shrink-0" style={{ "--tint": pc } as React.CSSProperties}>{p.category}</span>}
              <span className="text-ink-faint">·</span>
              <span className="mono text-ink-dim">{p.hops === 0 ? "direct" : `${p.hops} hop${p.hops === 1 ? "" : "s"}`}</span>
              <span className="mono ml-auto tabular text-ink">{usd(p.usd)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
