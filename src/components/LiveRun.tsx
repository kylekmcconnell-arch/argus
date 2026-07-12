import { useEffect, useRef, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import { subscribeRuns, getRun } from "../lib/runner";
import type { Dossier } from "../data/dossier";

// Live run: a VIEW onto the background runner, not the owner of the stream. It
// re-attaches to the run for this handle and renders its steps as
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
  const terminalNotificationRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = subscribeRuns(() => setTick((t) => t + 1));
    return unsub; // detach the view only — the run keeps going in the background
  }, [handle]);

  const run = getRun(handle);

  // Owner-view transitions: only THIS view (mounted on the running handle) moves
  // to the report or the error page. Backgrounded runs finalize via the runner's
  // onComplete (logging), without pulling the user's view around.
  useEffect(() => {
    if (!run) return;
    const notificationKey = `${run.key}:${run.startedAt}:${run.status}`;
    if (run.status === "running" || terminalNotificationRef.current === notificationKey) return;
    terminalNotificationRef.current = notificationKey;
    if (run.status === "done" && run.dossier) onDone(run.dossier);
    else if (run.status === "error") onError();
  }, [onDone, onError, run, run?.status]);

  const steps = run?.steps ?? [];
  const working = !run || run.status === "running";

  return (
    <AuditConsole
      handle={handle.startsWith("@") ? handle : "@" + handle.replace(/^@/, "")}
      subtitle="Live evidence acquisition · observed sources appear as they respond · continues in background"
      steps={steps}
      working={working}
      mode="live"
      kind="person"
    />
  );
}
