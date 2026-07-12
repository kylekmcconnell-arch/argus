import { useEffect, useReducer } from "react";
import { getContributions, subscribeGraph } from "../graph/store";
import { subjectConnections, reconcileVerdict, type SubjectConnection, type Reconciliation } from "../graph/network";

// The graph's payoff, made automatic: when a report renders, check its subject
// against the ACCUMULATED community graph (every audit you and your co-analysts
// ever ran). A HARD infra tie (shared deployer / funder / bytecode / dev-email)
// to a failed subject OVERRIDES the headline — the contract-level verdict can't
// see that this is the same operation as a known rug. Weaker ties still warn.
const BAD = new Set(["FAIL", "AVOID"]);

function compute(handle: string): { conns: SubjectConnection[]; recon: Reconciliation | null } {
  const contribs = getContributions();
  const conns = subjectConnections(handle, contribs, 24).filter((c) => c.otherVerdict && BAD.has(c.otherVerdict));
  return { conns, recon: reconcileVerdict(handle, contribs) };
}

export interface RingAlertProps {
  handle: string;
  onAudit?: (q: string) => void;
  snapshotVersion?: number;
}

export function RingAlert({ handle, onAudit, snapshotVersion }: RingAlertProps) {
  const [, markGraphChanged] = useReducer((revision: number) => revision + 1, 0);
  // The community graph hydrates async on app load — recompute when it lands.
  useEffect(() => subscribeGraph(markGraphChanged), []);
  const { conns, recon } = compute(handle);

  if (!conns.length && !recon) return null;

  // Live reports can reconcile the headline. Immutable snapshots keep their
  // stored verdict and present the same graph evidence as a current overlay.
  const override = recon;
  const snapshotMode = snapshotVersion !== undefined;
  const snapshotSuggestion = override?.severity === "avoid" ? "AVOID" : "CAUTION";
  const cautionTone = snapshotMode ? snapshotSuggestion === "CAUTION" : override?.severity === "caution";
  const color = cautionTone ? "var(--color-caution)" : "var(--color-avoid)";

  return (
    <div className="finding tint-var mb-4 px-4 py-3" style={{ "--tint": color } as React.CSSProperties}>
      {snapshotMode ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">
              Current workspace network overlay
            </span>
            <span className="chip tint-var" style={{ "--tint": color } as React.CSSProperties}>
              suggests {snapshotSuggestion}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed">
            Current overlay suggests {snapshotSuggestion} while stored v{snapshotVersion} verdict remains unchanged.
          </p>
          {override?.riskEntities && override.riskEntities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {override.riskEntities.slice(0, 6).map((entity) => (
                <span key={entity.key} className="chip tint-var normal-case" style={{ "--tint": color } as React.CSSProperties}>{entity.label}</span>
              ))}
            </div>
          )}
        </div>
      ) : override ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="verdict-pill tint-var" style={{ "--tint": color } as React.CSSProperties}>REVISED: {override.severity === "caution" ? "CAUTION" : "AVOID"}</span>
            <span className="text-[11px] uppercase tracking-wider">network reconciliation overrides the contract score</span>
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed">{override.line}</p>
          {override.riskEntities && override.riskEntities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {override.riskEntities.slice(0, 6).map((e) => (
                <span key={e.key} className="chip tint-var normal-case" style={{ "--tint": color } as React.CSSProperties}>{e.label}</span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-avoid">
          <span className="text-[15px]">⚠</span>
          Connected to {conns.length === 1 ? "a flagged subject" : `${conns.length} flagged subjects`} in the shared graph
        </div>
      )}
      {conns.length > 0 && (
      <div className="mt-2 space-y-1.5">
        {conns.slice(0, 4).map((c) => (
          <div key={c.other} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-dim">
            {onAudit ? (
              <button onClick={() => onAudit(c.other)} className="mono font-medium text-avoid underline-offset-2 hover:underline">{c.other}</button>
            ) : (
              <span className="mono font-medium text-avoid">{c.other}</span>
            )}
            <span className={`verdict-pill ${c.otherVerdict === "FAIL" ? "tint-fail" : "tint-avoid"}`}>{c.otherVerdict}</span>
            {c.direct && <span className="text-[11px]">directly surfaced in this subject's audit</span>}
            {c.ties.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-[11px] text-ink-faint">
                via
                {c.ties.slice(0, 4).map((t) => (
                  <span key={t.key} className="chip normal-case" title={t.type}>{t.label}</span>
                ))}
                {c.ties.length > 4 && <span>+{c.ties.length - 4}</span>}
              </span>
            )}
          </div>
        ))}
        {conns.length > 4 && <div className="text-[11px] text-ink-faint">+{conns.length - 4} more — see the Trust graph.</div>}
      </div>
      )}
      <p className="mt-1.5 text-[12.5px] text-ink-faint">
        {snapshotMode
          ? `This overlay comes from the current shared graph and was not captured in snapshot v${snapshotVersion}. Review it as new intelligence; it does not revise the stored verdict.`
          : conns.length > 0
          ? "From the accumulated audit graph (yours + co-analysts'). A shared deployer, funder, or team member with a failed subject is a serial-operator signal no single audit can see."
          : "Arkham risk + counterparty data on this subject's own wallets. Exposure to a hacker, mixer, or sanctioned entity is a serial-operator / laundering signal the contract score can't see."}
      </p>
    </div>
  );
}
