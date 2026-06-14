import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { streamAudit } from "../lib/live";
import type { TraceStep } from "../data/evidence";
import type { Dossier } from "../data/dossier";

// Live run: streams the real collector over SSE, rendering steps as they arrive.
export function LiveRun({
  handle,
  onDone,
  onError,
}: {
  handle: string;
  onDone: (d: Dossier) => void;
  onError: () => void;
}) {
  const [steps, setSteps] = useState<TraceStep[]>([]);

  useEffect(() => {
    setSteps([]);
    const abort = streamAudit(handle, {
      onStep: (s) => setSteps((prev) => [...prev, s]),
      onDone: (d) => onDone(d),
      onError: () => onError(),
    });
    return abort;
  }, [handle, onDone, onError]);

  // progress is open-ended for live; ramp asymptotically toward 90% by step count
  const pct = Math.min(92, steps.length * 11);

  return (
    <AuditConsole
      handle={handle.startsWith("@") ? handle : "@" + handle.replace(/^@/, "")}
      subtitle="live collection across configured providers"
      steps={steps}
      pct={pct}
      working
      mode="live"
    />
  );
}
