import { useEffect, useState } from "react";
import { getContributions, subscribeGraph } from "../graph/store";
import { subjectConnections, type SubjectConnection } from "../graph/network";

// The graph's payoff, made automatic: when a report renders, check its subject
// against the ACCUMULATED community graph (every audit you and your co-analysts
// ever ran) and raise a loud alert if it connects to flagged subjects — a shared
// deployer wallet, a shared team member, a shared funder. This is intelligence
// no single audit contains; it only exists because prior audits compounded.
const BAD = new Set(["FAIL", "AVOID"]);

function badConnections(handle: string): SubjectConnection[] {
  return subjectConnections(handle, getContributions(), 24).filter(
    (c) => c.otherVerdict && BAD.has(c.otherVerdict),
  );
}

export function RingAlert({ handle, onAudit }: { handle: string; onAudit?: (q: string) => void }) {
  const [conns, setConns] = useState<SubjectConnection[]>(() => badConnections(handle));
  // The community graph hydrates async on app load — recompute when it lands.
  useEffect(() => {
    setConns(badConnections(handle));
    return subscribeGraph(() => setConns(badConnections(handle)));
  }, [handle]);

  if (!conns.length) return null;

  return (
    <div className="mb-4 rounded-xl border px-4 py-3" style={{ borderColor: "var(--color-avoid)", background: "rgba(220,38,38,0.08)" }}>
      <div className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: "var(--color-avoid)" }}>
        <span className="text-[15px]">⚠</span>
        Connected to {conns.length === 1 ? "a flagged subject" : `${conns.length} flagged subjects`} in the shared graph
      </div>
      <div className="mt-2 space-y-1.5">
        {conns.slice(0, 4).map((c) => (
          <div key={c.other} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-dim">
            {onAudit ? (
              <button onClick={() => onAudit(c.other)} className="mono font-medium underline-offset-2 hover:underline" style={{ color: "var(--color-avoid)" }}>{c.other}</button>
            ) : (
              <span className="mono font-medium" style={{ color: "var(--color-avoid)" }}>{c.other}</span>
            )}
            <span className="mono rounded px-1 py-0.5 text-[9.5px]" style={{ background: "rgba(220,38,38,.14)", color: "var(--color-avoid)" }}>{c.otherVerdict}</span>
            {c.direct && <span className="text-[11px]">directly surfaced in this subject's audit</span>}
            {c.ties.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-[11px] text-ink-faint">
                via
                {c.ties.slice(0, 4).map((t) => (
                  <span key={t.key} className="mono rounded border border-line bg-panel px-1 py-0.5 text-[10px] text-ink-dim" title={t.type}>{t.label}</span>
                ))}
                {c.ties.length > 4 && <span>+{c.ties.length - 4}</span>}
              </span>
            )}
          </div>
        ))}
        {conns.length > 4 && <div className="text-[11px] text-ink-faint">+{conns.length - 4} more — see the Trust graph.</div>}
      </div>
      <p className="mt-1.5 text-[11.5px] text-ink-faint">
        From the accumulated audit graph (yours + co-analysts'). A shared deployer, funder, or team member with a
        failed subject is a serial-operator signal no single audit can see.
      </p>
    </div>
  );
}
