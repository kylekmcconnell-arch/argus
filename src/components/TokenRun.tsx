import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { subscribeScanRuns, getScanRun } from "../lib/scanrunner";
import type { RunnableTokenInput } from "../lib/resolveInput";
import type { TokenDossier } from "../token/audit";

// A VIEW onto the background token scan — not the owner of the run. Navigating
// away unmounts this but does NOT stop the audit; the runner keeps going and the
// result still lands in the library.
export function TokenRun({
  input,
  onDone,
  onError,
}: {
  input: RunnableTokenInput;
  onDone: (d: TokenDossier, priv: boolean, scanId: string) => void;
  onError: () => void;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeScanRuns(() => setTick((t) => t + 1));
    return unsub; // detach the view only — the run continues in the background
  }, [input]);

  const run = getScanRun("token", input.ref);

  useEffect(() => {
    if (!run) return;
    if (run.status === "done" && run.result) onDone(run.result as TokenDossier, run.priv, run.id);
    else if (run.status === "error") onError();
  }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref;
  return (
    <AuditConsole
      handle={label}
      subtitle="live token audit · DexScreener + GoPlus · runs in the background if you navigate away"
      steps={run?.steps ?? []}
      pct={run?.pct ?? 0}
      working
      mode="live"
    />
  );
}
