import { explorerAddr } from "../lib/addressLabels";
import { arkhamOf, type ArkhamLabel } from "../lib/useArkhamLabels";

// Renders a wallet as its Arkham entity when known ("Binance", "Wintermute",
// "Vitalik Buterin" + a type chip + their Twitter), falling back to whatever the
// caller already showed (a curated label or the short address). Drop-in across the
// forensic surfaces so a named wallet reads the same everywhere.
const typeColor = (ak: ArkhamLabel) => (ak.isCex ? "var(--color-pass)" : ak.type === "individual" ? "var(--color-signal)" : "var(--color-signal)");

export function ArkhamName({ address, chain, labels, fallback, className }: {
  address?: string | null;
  chain: string;
  labels: Record<string, ArkhamLabel>;
  fallback: string;
  className?: string;
}) {
  const ak = arkhamOf(labels, address ?? undefined);
  const href = address ? explorerAddr(address, chain) : undefined;
  const color = ak ? (ak.isCex ? "var(--color-pass)" : "var(--color-ink)") : undefined;
  const text = ak?.name ?? fallback;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={`mono truncate hover:underline ${className ?? ""}`} style={color ? { color } : undefined} title={ak ? `Arkham: ${ak.name}${ak.sublabel ? ` · ${ak.sublabel}` : ""}` : address ?? undefined}>{text}</a>
      ) : (
        <span className={`mono truncate ${className ?? ""}`} style={color ? { color } : undefined}>{text}</span>
      )}
      {ak?.type && <span className="mono shrink-0 rounded px-1 py-0.5 text-[9px]" style={{ background: typeColor(ak) + "1a", color: typeColor(ak) }}>{ak.type}{ak.sublabel ? ` · ${ak.sublabel}` : ""}</span>}
      {ak?.twitter && <a href={ak.twitter} target="_blank" rel="noreferrer" className="mono shrink-0 text-[9.5px] text-signal-dim hover:underline" title="Arkham-linked X account">𝕏↗</a>}
    </span>
  );
}
