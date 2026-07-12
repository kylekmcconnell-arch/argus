import { describe, expect, it } from "vitest";
import type { TraceStep } from "../data/evidence";
import { deriveInvestigationProgress } from "./investigationProgress";

const step = (partial: Partial<TraceStep> & Pick<TraceStep, "phase" | "label">): TraceStep => ({
  detail: `${partial.label} detail`,
  tone: "neutral",
  ...partial,
});

describe("deriveInvestigationProgress", () => {
  it("counts only observed events, source tags, and attention tones", () => {
    const summary = deriveInvestigationProgress({
      kind: "person",
      working: true,
      steps: [
        step({ phase: "P0 · Intake", label: "Resolve profile", source: "twitterapi.io", tone: "good" }),
        step({ phase: "Adverse", label: "Adverse sweep", source: " Grok ", tone: "warn" }),
        step({ phase: "Network", label: "Trust graph", source: "TWITTERAPI.IO", tone: "bad" }),
      ],
    });

    expect(summary.eventCount).toBe(3);
    expect(summary.observedSources).toEqual(["twitterapi.io", "Grok"]);
    expect(summary.attentionCount).toBe(2);
    expect(summary.latestEvent?.label).toBe("Trust graph");
    expect(summary.stages).toEqual([
      { key: "subject", label: "Subject identity", state: "observed" },
      { key: "evidence", label: "Evidence collection", state: "observed" },
      { key: "network", label: "Connection screening", state: "active" },
      { key: "analysis", label: "Decision analysis", state: "waiting" },
      { key: "finalize", label: "Report finalization", state: "waiting" },
    ]);
  });

  it("uses an actual investigation hop as the active stage without marking it complete", () => {
    const summary = deriveInvestigationProgress({
      kind: "investigation",
      working: true,
      hop: "reading the project site for the team",
      steps: [
        step({ phase: "P0 · Intake", label: "Resolve token" }),
        step({ phase: "Market", label: "$ARG" }),
        step({ phase: "Investigation", label: "Token audited" }),
      ],
    });

    expect(summary.stages.find((stage) => stage.key === "token")?.state).toBe("observed");
    expect(summary.stages.find((stage) => stage.key === "site")?.state).toBe("active");
    expect(summary.stages.find((stage) => stage.key === "people")?.state).toBe("waiting");
  });

  it("shows an honest resolving state before any event arrives", () => {
    const summary = deriveInvestigationProgress({
      kind: "resolution",
      working: true,
      steps: [],
    });

    expect(summary.currentLabel).toBe("Resolving the exact subject");
    expect(summary.eventCount).toBe(0);
    expect(summary.observedSources).toEqual([]);
    expect(summary.stages).toEqual([
      { key: "resolve", label: "Resolve exact subject", state: "active" },
    ]);
  });

  it("does not leave an active stage after a run stops", () => {
    const summary = deriveInvestigationProgress({
      kind: "token",
      working: false,
      steps: [step({ phase: "Finalize", label: "Verdict" })],
    });

    expect(summary.stages.find((stage) => stage.key === "finalize")?.state).toBe("observed");
    expect(summary.stages.some((stage) => stage.state === "active")).toBe(false);
  });
});
