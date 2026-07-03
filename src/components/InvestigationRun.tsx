import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { startInvestigationScan, subscribeScanRuns, getScanRun } from "../lib/scanrunner";
import type { Investigation } from "../lib/investigation";

// A VIEW onto the background investigation — not the owner of the run. Navigating
// away no longer aborts the cascade: the runner keeps streaming and the finished
// investigation still lands in the library.
export function InvestigationRun({
  input,
  onDone,
  onError,
}: {
  input: string;
  onDone: (inv: Investigation) => void;
  onError: () => void;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    startInvestigationScan(input); // idempotent: re-attaches if already running
    const unsub = subscribeScanRuns(() => setTick((t) => t + 1));
    return unsub; // detach the view only — the run continues in the background
  }, [input]);

  const run = getScanRun("investigation", input);

  useEffect(() => {
    if (!run) return;
    if (run.status === "done" && run.result) onDone(run.result as Investigation);
    else if (run.status === "error") onError();
  }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = input.length > 20 ? input.slice(0, 8) + "…" + input.slice(-4) : input;
  return (
    <AuditConsole
      handle={label}
      subtitle={`investigation · ${run?.hop ?? "starting the investigation…"} · runs in the background if you navigate away`}
      steps={run?.steps ?? []}
      pct={run?.pct ?? 0}
      working
      mode="live"
    />
  );
}
