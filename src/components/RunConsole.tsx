import { useEffect, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import type { SubjectFixture } from "../data/subjects";

// Simulated run: advances through a fixture's curated trace on a timer. Used
// when the collector backend is not running.
export function RunConsole({ fixture, onDone }: { fixture: SubjectFixture; onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const steps = fixture.trace;

  useEffect(() => {
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = () => {
      i += 1;
      setShown(i);
      if (i < steps.length) timers.push(setTimeout(tick, 620 + Math.random() * 420));
      else timers.push(setTimeout(onDone, 900));
    };
    timers.push(setTimeout(tick, 450));
    return () => timers.forEach(clearTimeout);
  }, [steps.length, onDone]);

  return (
    <AuditConsole
      handle={fixture.handle}
      subtitle={`${fixture.display_name} · ${fixture.followers} followers · joined ${fixture.joined}`}
      steps={steps.slice(0, shown)}
      working={shown < steps.length}
      mode="curated"
      kind="person"
    />
  );
}
