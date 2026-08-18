import type { CSSProperties, ReactNode } from "react";
import type { ProvenanceTier } from "../lib/provenance";

/* A figure whose underline says where it came from (DESIGN.md 2.1), with the
   receipt one hover or focus away: the exact passage, the source, and the
   chain of custody with times. The dotted underline is the reading contract —
   green means an outside artifact says so, slate means ARGUS computed it,
   violet means nobody has evidenced it yet. */

const TIER_TINT: Record<ProvenanceTier, string> = {
  sourced: "var(--color-sourced)",
  derived: "var(--color-derived)",
  unestablished: "var(--color-unverifiable)",
};

const TIER_LABEL: Record<ProvenanceTier, string> = {
  sourced: "Sourced",
  derived: "Derived by ARGUS",
  unestablished: "Not yet evidenced",
};

export interface ProvenanceReceipt {
  /** The exact passage or observation the value rests on. */
  passage?: string;
  /** Where it came from, in words ("Vesting contracts · onchain trace"). */
  sourceLabel?: string;
  /** Stable URL of the artifact, when one exists. */
  url?: string;
  /** Chain of custody: [what happened, when] in order. */
  chain?: [string, string][];
}

export function ProvenancedValue({ tier, receipt, children }: {
  tier: ProvenanceTier;
  receipt?: ProvenanceReceipt | null;
  children: ReactNode;
}) {
  const tint = TIER_TINT[tier];
  const hasReceipt = Boolean(
    receipt && (receipt.passage || receipt.sourceLabel || receipt.url || receipt.chain?.length),
  );
  if (!hasReceipt) {
    return (
      <span
        className="prov-value"
        style={{ "--tint": tint } as CSSProperties}
        title={TIER_LABEL[tier]}
      >
        {children}
      </span>
    );
  }
  return (
    <span className="prov-value prov-value-rich" style={{ "--tint": tint } as CSSProperties} tabIndex={0}>
      {children}
      <span className="prov-pop" role="tooltip">
        <span className="mono block text-[10px] font-medium uppercase tracking-wider" style={{ color: tint }}>
          {TIER_LABEL[tier]}
        </span>
        {receipt?.passage && (
          <span className="mt-1.5 block text-[12.5px] leading-relaxed text-ink">
            {"“"}{receipt.passage}{"”"}
          </span>
        )}
        {(receipt?.sourceLabel || receipt?.url) && (
          <span className="mt-1.5 block">
            {receipt.url ? (
              <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="mono link-ext text-[11px]">
                {receipt.sourceLabel || receipt.url}
              </a>
            ) : (
              <span className="mono text-[11px] text-ink-dim">{receipt.sourceLabel}</span>
            )}
          </span>
        )}
        {receipt?.chain && receipt.chain.length > 0 && (
          <span className="mt-2 block border-t border-line/60 pt-1.5">
            {receipt.chain.map(([what, when]) => (
              <span key={`${what}·${when}`} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className="text-[11.5px] text-ink-dim">{what}</span>
                <span className="mono shrink-0 text-[10px] text-ink-faint">{when}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}
