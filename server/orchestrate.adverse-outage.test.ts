// The adverse sweep now completes a coverage row, which makes the distinction
// between "the search ran and found nothing" and "the search never answered"
// load-bearing in a way it was not when the sweep only wrote a provider run.
//
// searchAdverseSignals returns an empty list for four different reasons: the
// provider returned nothing at all, the answer carried no JSON, the JSON did
// not parse, and a completed search with no leads. Only the last one is an
// answer. If the first three record checked-empty, a total model-search outage
// RAISES this report's coverage and publishes "adverse sweep: nothing found",
// which is the exact assertion the product rule forbids.
import { describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import type { CollectContext } from "./adapters/types";
import type { ChecklistObservation } from "./checks";

const harness = vi.hoisted(() => ({
  adverse: vi.fn(),
  tooling: vi.fn(async () => null as unknown),
  team: vi.fn(async () => [] as unknown[]),
}));

vi.mock("./adapters/x", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adapters/x")>()),
  searchAdverseSignals: harness.adverse,
  detectManipulationTooling: harness.tooling,
  findTeam: harness.team,
}));

const { adverseSignalsAndTooling } = await import("./orchestrate");

function context(handles: string[] = []) {
  const evidence = emptyEvidence("@subject");
  evidence.roles = [SubjectClass.KOL];
  evidence.ventures = handles.map((handle) => ({
    project_name: handle.replace(/^@/, ""),
    role: "advisor",
    x_handle: handle,
  })) as typeof evidence.ventures;
  const recorded: ChecklistObservation[] = [];
  const ctx: CollectContext = { handle: "@subject", evidence, emit: vi.fn() };
  return { ctx, recorded, record: (o: ChecklistObservation) => recorded.push(o) };
}

const row = (recorded: ChecklistObservation[]) => recorded.find((o) => o.id === "adverse-screen");

describe("an adverse sweep that never answered is not an empty sweep", () => {
  it("records unavailable when the search provider answered nothing", async () => {
    harness.adverse.mockResolvedValue({ completed: false, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, recorded, record } = context();

    await adverseSignalsAndTooling(ctx, record);

    expect(row(recorded)?.status).toBe("unavailable");
    expect(row(recorded)?.note).not.toContain("returned no candidate source");
  });

  it("still records a completed empty search as an answer", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, recorded, record } = context();

    await adverseSignalsAndTooling(ctx, record);

    expect(row(recorded)?.status).toBe("checked-empty");
    expect(row(recorded)?.note).toContain("not proof");
  });

  it("names the targets the sweep never reached when only some searches answered", async () => {
    // The subject answered; both venture searches did not.
    harness.adverse.mockImplementation(async (handle: string) =>
      handle.replace(/^@/, "").toLowerCase() === "subject"
        ? { completed: true, signals: [] }
        : { completed: false, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, recorded, record } = context(["@one", "@two"]);

    await adverseSignalsAndTooling(ctx, record);

    expect(row(recorded)?.status).toBe("checked-empty");
    // The empty answer must not be allowed to cover the targets nobody screened.
    expect(row(recorded)?.note).toContain("2 of the 3");
  });

  it("keeps a surfaced lead a finding even when other searches failed", async () => {
    harness.adverse.mockImplementation(async (handle: string) =>
      handle.replace(/^@/, "").toLowerCase() === "subject"
        ? {
            completed: true,
            signals: [{
              category: "rug",
              claim: "Holders say liquidity was pulled.",
              source: "reports.example",
              source_url: "https://reports.example/thread",
              target_entity_key: "@subject",
              target_entity_type: "person",
              relationship_to_subject: "self",
              relationship_label: "audited subject",
            }],
          }
        : { completed: false, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, recorded, record } = context(["@one"]);

    await adverseSignalsAndTooling(ctx, record);

    expect(row(recorded)?.status).toBe("finding");
  });
});
