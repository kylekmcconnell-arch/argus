import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { streamInvestigation, type Investigation } from "../lib/investigation";
import { beginScan, updateScan, endScan } from "../lib/activescans";
import type { TraceStep } from "../data/evidence";

// Drives the autonomous investigation cascade and streams every hop's steps into
// the one shared console, with a subtitle that tracks the current hop.
export function InvestigationRun({
  input,
  onDone,
  onError,
}: {
  input: string;
  onDone: (inv: Investigation) => void;
  onError: () => void;
}) {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [subtitle, setSubtitle] = useState("starting the investigation…");

  const label = input.length > 20 ? input.slice(0, 8) + "…" + input.slice(-4) : input;

  useEffect(() => {
    setSteps([]);
    setSubtitle("starting the investigation…");
    // Register in the sidebar's "scanning…" list so the run is visible everywhere
    // until it completes (not just on this console).
    const id = `inv:${input}:${Date.now()}`;
    beginScan({ id, label, kind: "investigation", ref: input, pct: 5 });
    let count = 0;
    const abort = streamInvestigation(input, {
      onStep: (s) => { count += 1; setSteps((prev) => [...prev, s]); updateScan(id, Math.min(94, count * 7)); },
      onHop: (sub) => setSubtitle(sub),
      onDone: (inv) => { endScan(id); onDone(inv); },
      onError: () => { endScan(id); onError(); },
    });
    return () => { endScan(id); abort(); };
  }, [input, onDone, onError, label]);

  const pct = Math.min(94, steps.length * 7);

  return (
    <AuditConsole
      handle={label}
      subtitle={`investigation · ${subtitle}`}
      steps={steps}
      pct={pct}
      working
      mode="live"
    />
  );
}
