import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { auditToken, type TokenDossier } from "../token/audit";
import { beginScan, updateScan, endScan } from "../lib/activescans";
import type { ResolvedInput } from "../lib/resolveInput";
import type { TraceStep } from "../data/evidence";

// Runs the live token audit (DexScreener + GoPlus, client-side) and streams its
// trace into the shared console, then hands back the dossier.
export function TokenRun({
  input,
  onDone,
  onError,
}: {
  input: ResolvedInput;
  onDone: (d: TokenDossier) => void;
  onError: () => void;
}) {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const label = input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref;

  useEffect(() => {
    let cancelled = false;
    setSteps([]);
    const id = `tok:${input.ref}:${Date.now()}`;
    beginScan({ id, label, kind: "token", ref: input.ref, pct: 5 });
    let count = 0;
    (async () => {
      try {
        const d = await auditToken(input, (s) => {
          if (!cancelled) { count += 1; setSteps((prev) => [...prev, s]); updateScan(id, Math.min(92, count * 18)); }
        });
        if (cancelled) return;
        endScan(id);
        if (!d) onError();
        else setTimeout(() => onDone(d), 500);
      } catch {
        endScan(id);
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
      endScan(id);
    };
  }, [input, onDone, onError, label]);

  const pct = Math.min(92, steps.length * 18);
  return (
    <AuditConsole
      handle={input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref}
      subtitle="live token audit · DexScreener + GoPlus · no keys"
      steps={steps}
      pct={pct}
      working
      mode="live"
    />
  );
}
