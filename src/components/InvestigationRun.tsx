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
  expectedRunId,
}: {
  input: RunnableTokenInput;
  onDone: (inv: Investigation, priv: boolean, scanId: string) => void;
  onError: (message: string) => void;
  /** When set, ignore a stale done/error run left over from the previous scan of this address. */
  expectedRunId?: string;
}) {
  const [, setTick] = useState(0);
  const terminalNotificationRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = subscribeScanRuns(() => setTick((t) => t + 1));
    return unsub; // detach the view only — the run continues in the background
  }, [input]);

  const run = getScanRun("investigation", input.ref);
  const attached = expectedRunId ? (run?.id === expectedRunId ? run : undefined) : run;

  useEffect(() => {
    if (!attached) return;
    const notificationKey = `${attached.id}:${attached.status}`;
    if (attached.status === "running" || terminalNotificationRef.current === notificationKey) return;
    terminalNotificationRef.current = notificationKey;
    if (attached.status === "done" && attached.result) onDone(attached.result as Investigation, attached.priv, attached.id);
    else if (attached.status === "error") onError(attached.error ?? "The investigation did not finish.");
  }, [onDone, onError, attached, attached?.status]);

  const label = input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref;
  const working = !attached || attached.status === "running";
  return (
    <AuditConsole
      handle={label}
      subtitle="Live multi-surface evidence · observed sources appear as they respond · continues in background"
      steps={attached?.steps ?? []}
      working={working}
      mode="live"
      kind="investigation"
      hop={attached?.hop}
    />
  );
}
