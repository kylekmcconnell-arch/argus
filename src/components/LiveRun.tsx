import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { startPersonAudit, subscribeRuns, getRun } from "../lib/runner";
import type { Dossier } from "../data/dossier";

// Live run: a VIEW onto the background runner, not the owner of the stream. It
// starts (or re-attaches to) the run for this handle and renders its steps as
// they arrive. Navigating away unmounts this component but does NOT stop the
// audit — the runner keeps streaming and the result still lands in the library.
export function LiveRun({
  handle,
  onDone,
  onError,
}: {
  handle: string;
  onDone: (d: Dossier) => void;
  onError: () => void;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    startPersonAudit(handle); // idempotent: re-attaches if already running
    const unsub = subscribeRuns(() => setTick((t) => t + 1));
    return unsub; // detach the view only — the run keeps going in the background
  }, [handle]);

  const run = getRun(handle);

  // Owner-view transitions: only THIS view (mounted on the running handle) moves
  // to the report or the error page. Backgrounded runs finalize via the runner's
  // onComplete (logging), without pulling the user's view around.
  useEffect(() => {
    if (!run) return;
    if (run.status === "done" && run.dossier) onDone(run.dossier);
    else if (run.status === "error") onError();
  }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = run?.steps ?? [];
  const pct = run?.pct ?? 0;

  return (
    <AuditConsole
      handle={handle.startsWith("@") ? handle : "@" + handle.replace(/^@/, "")}
      subtitle="live collection across configured providers · runs in the background if you navigate away"
      steps={steps}
      pct={pct}
      working
      mode="live"
    />
  );
}
