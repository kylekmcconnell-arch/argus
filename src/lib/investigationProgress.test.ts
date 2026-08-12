// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the checked-in recorded emit stream.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TraceStep } from "../data/evidence";
import { deriveInvestigationProgress, type InvestigationProgressKind } from "./investigationProgress";

const step = (partial: Partial<TraceStep> & Pick<TraceStep, "phase" | "label">): TraceStep => ({
  detail: `${partial.label} detail`,
  tone: "neutral",
  ...partial,
});

/** Distinct phases in order of first appearance in a recorded live stream. */
const recordedPhases = (recording: string): string[] => {
  const raw: string = readFileSync(new URL(`../../eval/recordings/${recording}/emits.jsonl`, import.meta.url), "utf8");
  const phases = raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => (JSON.parse(line) as TraceStep).phase);
  return [...new Set(phases)];
};

/** The stage a single step of this phase makes active, or null when the phase
 * matches nothing and the tracker would stall on it. */
const activeStageFor = (kind: InvestigationProgressKind, phase: string): string | null => {
  const summary = deriveInvestigationProgress({
    kind,
    working: true,
    steps: [step({ phase, label: `${phase} event` })],
  });
  return summary.stages.find((stage) => stage.state === "active")?.key ?? null;
};

/** src/token/audit.ts emit sites; no token-lane stream is recorded. */
const TOKEN_LANE_PHASES = ["P0 · Intake", "Market", "Contract", "Corroborate", "Screen", "Finalize"];

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

  it("advances a stage for every phase a recorded person audit emitted", () => {
    const phases = recordedPhases("orbitgroup_ai");

    expect(phases).toContain("Off-chain");
    expect(phases.filter((phase) => activeStageFor("person", phase) === null)).toEqual([]);
    expect(activeStageFor("person", "Off-chain")).toBe("evidence");
  });

  it("advances a stage for every phase the token lane emits", () => {
    expect(TOKEN_LANE_PHASES.filter((phase) => activeStageFor("token", phase) === null)).toEqual([]);
    expect(activeStageFor("token", "Screen")).toBe("screen");
  });

  it("keeps relayed off-chain and deployer screening steps on an investigation stage", () => {
    expect(activeStageFor("investigation", "Off-chain")).toBe("people");
    expect(activeStageFor("investigation", "Screen")).toBe("token");
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
