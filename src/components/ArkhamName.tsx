import { explorerAddr } from "../lib/addressLabels";
import { arkhamOf, type ArkhamLabel } from "../lib/useArkhamLabels";

// Renders a wallet as its Arkham entity when known ("Binance", "Wintermute",
// "Vitalik Buterin" + a type chip + their Twitter), falling back to whatever the
// caller already showed (a curated label or the short address). Drop-in across the
// forensic surfaces so a named wallet reads the same everywhere.
const typeColor = (ak: ArkhamLabel) => (ak.isCex ? "var(--color-pass)" : "var(--color-signal)");

// Risk level → color. LOW = caution; MEDIUM/HIGH/SEVERE (and any flagged seed) = avoid.
const HIGH = new Set(["MEDIUM", "HIGH", "SEVERE", "CRITICAL"]);
const riskColor = (r: { level: string; isSeed: boolean }) => (r.isSeed || HIGH.has(r.level.toUpperCase()) ? "var(--color-avoid)" : "var(--color-caution)");
const usd = (n?: number) => (n == null ? "" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);

export function ArkhamName({ address, chain, labels, fallback, className }: {
  address?: string | null;
  chain: string;
  labels: Record<string, ArkhamLabel>;
  fallback: string;
  className?: string;
}) {
  const ak = arkhamOf(labels, address ?? undefined);
  const href = address ? explorerAddr(address, chain) : undefined;
  const color = ak?.name ? (ak.isCex ? "var(--color-pass)" : "var(--color-ink)") : undefined;
  const text = ak?.name || fallback;
  const rc = ak?.risk ? riskColor(ak.risk) : undefined;
  const riskLabel = ak?.risk ? (ak.risk.isSeed ? `${ak.risk.category ?? "flagged"} source` : `${ak.risk.level.toLowerCase()} risk${ak.risk.category ? ` · ${ak.risk.category}` : ""}`) : "";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={`mono truncate hover:underline ${className ?? ""}`} style={color ? { color } : undefined} title={ak?.name ? `Arkham: ${ak.name}${ak.sublabel ? ` · ${ak.sublabel}` : ""}` : address ?? undefined}>{text}</a>
      ) : (
        <span className={`mono truncate ${className ?? ""}`} style={color ? { color } : undefined}>{text}</span>
      )}
      {ak?.type && <span className="chip tint-var shrink-0" style={{ "--tint": typeColor(ak) } as React.CSSProperties}><span>{ak.type}{ak.sublabel ? ` · ${ak.sublabel}` : ""}</span></span>}
      {ak?.risk && rc && (
        <span className="chip tint-var shrink-0" style={{ "--tint": rc } as React.CSSProperties} title={ak.risk.incomingUsd ? `${usd(ak.risk.incomingUsd)} risk-weighted inflow (Arkham)` : "Arkham risk score"}>
          <span>⚠ {riskLabel}{ak.risk.incomingUsd && ak.risk.incomingUsd >= 1e5 ? ` · ${usd(ak.risk.incomingUsd)}` : ""}</span>
        </span>
      )}
      {ak?.twitter && <a href={ak.twitter} target="_blank" rel="noreferrer" className="link-ext mono shrink-0 text-[11px]" title="Arkham-linked X account">𝕏</a>}
    </span>
  );
}
