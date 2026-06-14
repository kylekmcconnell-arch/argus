import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { auditToken, type TokenDossier } from "../token/audit";
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

  useEffect(() => {
    let cancelled = false;
    setSteps([]);
    (async () => {
      try {
        const d = await auditToken(input, (s) => {
          if (!cancelled) setSteps((prev) => [...prev, s]);
        });
        if (cancelled) return;
        if (!d) onError();
        else setTimeout(() => onDone(d), 500);
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [input, onDone, onError]);

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
