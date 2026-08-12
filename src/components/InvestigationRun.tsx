import { useEffect, useRef, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { subscribeScanRuns, getScanRun } from "../lib/scanrunner";
import type { Investigation } from "../lib/investigation";
import type { RunnableTokenInput } from "../lib/resolveInput";

// A VIEW onto the background investigation — not the owner of the run. Navigating
// away no longer aborts the cascade: the runner keeps streaming and the finished
// investigation still lands in the library.
export function InvestigationRun({
  input,
  onDone,
  onError,
}: {
  input: RunnableTokenInput;
  onDone: (inv: Investigation, priv: boolean, scanId: string) => void;
  onError: () => void;
}) {
  const [, setTick] = useState(0);
  const terminalNotificationRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = subscribeScanRuns(() => setTick((t) => t + 1));
    return unsub; // detach the view only — the run continues in the background
  }, [input]);

  const run = getScanRun("investigation", input.ref);

  useEffect(() => {
    if (!run) return;
    const notificationKey = `${run.id}:${run.status}`;
    if (run.status === "running" || terminalNotificationRef.current === notificationKey) return;
    terminalNotificationRef.current = notificationKey;
    if (run.status === "done" && run.result) onDone(run.result as Investigation, run.priv, run.id);
    else if (run.status === "error") onError();
  }, [onDone, onError, run, run?.status]);

  const label = input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref;
  const working = !run || run.status === "running";
  return (
    <AuditConsole
      handle={label}
      subtitle="Live multi-surface evidence · observed sources appear as they respond · continues in background"
      steps={run?.steps ?? []}
      working={working}
      mode="live"
      kind="investigation"
      hop={run?.hop}
    />
  );
}
