import type { ReactNode } from "react";

/* The receipt, one hover or focus away (design-and-ui): wraps a source chip
   or link and shows the exact excerpt, the provider, and when it was
   captured — the compact sibling of EvidenceAuditDisclosure's full ledger.
   With nothing to show it renders the child untouched. */

export function EvidenceTip({ excerpt, sourceName, provider, capturedAt, contradicts, children }: {
  excerpt?: string;
  sourceName?: string;
  provider?: string;
  capturedAt?: string;
  contradicts?: boolean;
  children: ReactNode;
}) {
  const captured = capturedAt ? capturedAt.slice(0, 10) : undefined;
  if (!excerpt && !provider && !captured) return <>{children}</>;
  return (
    <span className="evidence-tip">
      {children}
      <span className="prov-pop" role="tooltip">
        <span
          className="mono block text-[10px] font-medium uppercase tracking-wider"
          style={{ color: contradicts ? "var(--color-avoid)" : "var(--color-sourced)" }}
        >
          {contradicts ? "Contradicting source" : "The receipt"}
        </span>
        {excerpt && (
          <span className="mt-1.5 block text-[12.5px] leading-relaxed text-ink">
            {"“"}{excerpt}{"”"}
          </span>
        )}
        {sourceName && <span className="mono mt-1.5 block text-[11px] text-ink-dim">{sourceName}</span>}
        {(provider || captured) && (
          <span className="mono mt-1 block text-[10px] text-ink-faint">
            {[provider, captured ? `captured ${captured}` : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </span>
  );
}
