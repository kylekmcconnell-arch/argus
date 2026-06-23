import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { streamInvestigation, type Investigation } from "../lib/investigation";
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

  useEffect(() => {
    setSteps([]);
    setSubtitle("starting the investigation…");
    const abort = streamInvestigation(input, {
      onStep: (s) => setSteps((prev) => [...prev, s]),
      onHop: (sub) => setSubtitle(sub),
      onDone,
      onError: () => onError(),
    });
    return abort;
  }, [input, onDone, onError]);

  const label = input.length > 20 ? input.slice(0, 8) + "…" + input.slice(-4) : input;
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
