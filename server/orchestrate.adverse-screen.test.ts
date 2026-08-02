// The adverse / scam / rug sweep used to report only through
// checkTracker.provider, a map the coverage snapshot never reads. Skipping it
// therefore cost nothing, and a report with no sweep at all still published
// full clearance. These tests pin the sweep to a recorded checklist OUTCOME,
// and pin the distinction the product depends on: a search that ran and found
// nothing is an answer, not a clean record.
import { describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import type { CollectContext } from "./adapters/types";
import type { ChecklistObservation } from "./checks";

const harness = vi.hoisted(() => ({
  adverse: vi.fn(async () => ({ completed: true, signals: [] as unknown[] })),
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

function context() {
  const evidence = emptyEvidence("@subject");
  evidence.roles = [SubjectClass.KOL];
  const recorded: ChecklistObservation[] = [];
  const ctx: CollectContext = {
    handle: "@subject",
    evidence,
    emit: vi.fn(),
  };
  return { ctx, evidence, recorded, record: (o: ChecklistObservation) => recorded.push(o) };
}

const lead = (claim: string) => ({
  category: "rug",
  claim,
  source: "reports.example",
  source_url: "https://reports.example/thread",
  target_entity_key: "@subject",
  target_entity_type: "person",
  relationship_to_subject: "self",
  relationship_label: "audited subject",
});

describe("adverse sweep records a checklist outcome", () => {
  it("records a completed empty sweep as an answer, not a clean record", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, recorded, record } = context();

    await adverseSignalsAndTooling(ctx, record);

    const row = recorded.find((o) => o.id === "adverse-screen");
    expect(row).toBeDefined();
    expect(row?.status).toBe("checked-empty");
    expect(row?.provider).toBe("adverse-sweep");
    expect(row?.note).toContain("not proof");
  });

  it("records surfaced leads as a finding, named as unverified candidates", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [lead("Holders say liquidity was pulled overnight.")] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, recorded, record } = context();

    await adverseSignalsAndTooling(ctx, record);

    const row = recorded.find((o) => o.id === "adverse-screen");
    expect(row?.status).toBe("finding");
    expect(row?.sourceCount).toBe(1);
    expect(row?.note).toContain("unverified candidate source");
  });

  it("counts a manipulation-tooling lead as a surfaced concern", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [] });
    harness.tooling.mockResolvedValue({
      role_claim: "operator",
      tools: [{ name: "Bundler X", kind: "bundler", url: "https://bundler.example", evidence: "product page" }],
    });
    const { ctx, recorded, record } = context();

    await adverseSignalsAndTooling(ctx, record);

    const row = recorded.find((o) => o.id === "adverse-screen");
    expect(row?.status).toBe("finding");
    expect(row?.note).toContain("manipulation-tooling lead");
  });

  it("keeps the answer when the cross-project hop fails after the search returned", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [lead("Community accuses the team of an exit scam.")] });
    harness.tooling.mockResolvedValue(null);
    harness.team.mockResolvedValue([{ name: "Someone", handle: "@someone", role: "CTO" }]);
    const { ctx, evidence, recorded, record } = context();
    evidence.ventures = [
      { project_name: "One", role: "advisor", x_handle: "@one" },
      { project_name: "Two", role: "advisor", x_handle: "@two" },
    ] as typeof evidence.ventures;
    // Fail the second hop the moment it writes its result back, which is
    // strictly after the paid search resolved.
    Object.defineProperty(evidence, "ventureTeams", {
      configurable: true,
      get: () => undefined,
      set: () => { throw new Error("late hop failure"); },
    });

    await expect(adverseSignalsAndTooling(ctx, record)).rejects.toThrow("late hop failure");

    expect(recorded.find((o) => o.id === "adverse-screen")).toMatchObject({
      status: "finding",
      provider: "adverse-sweep",
    });
  });
});

// Live on @uniswap: the sweep announced it was screening $ARB. promotions holds
// every ticker the account has ever posted about, and Uniswap's first was an
// Arbitrum deployment, so a decision-critical screen ran on somebody else's
// token and never touched $UNI.
describe("the sweep screens the subject's own token", () => {
  it("prefers a verified project token over the first ticker the account mentioned", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, evidence, record } = context();
    evidence.promotions = [{ ticker: "ARB" }] as unknown as typeof evidence.promotions;
    evidence.projectToken = { verified: true, symbol: "UNI" } as unknown as typeof evidence.projectToken;

    await adverseSignalsAndTooling(ctx, record);

    const announced = (ctx.emit as unknown as { mock: { calls: [{ detail?: string }][] } }).mock.calls
      .map(([step]) => step.detail ?? "")
      .join(" ");
    expect(announced).toContain("$UNI");
    expect(announced).not.toContain("$ARB");
  });

  it("still falls back to a promoted ticker when the subject has no token of its own", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, evidence, record } = context();
    evidence.promotions = [{ ticker: "ARB" }] as unknown as typeof evidence.promotions;

    await adverseSignalsAndTooling(ctx, record);

    const announced = (ctx.emit as unknown as { mock: { calls: [{ detail?: string }][] } }).mock.calls
      .map(([step]) => step.detail ?? "")
      .join(" ");
    expect(announced).toContain("$ARB");
  });

  it("does not treat an unverified project token as the binding", async () => {
    harness.adverse.mockResolvedValue({ completed: true, signals: [] });
    harness.tooling.mockResolvedValue(null);
    const { ctx, evidence, record } = context();
    evidence.promotions = [{ ticker: "ARB" }] as unknown as typeof evidence.promotions;
    evidence.projectToken = { verified: false, symbol: "FAKE" } as unknown as typeof evidence.projectToken;

    await adverseSignalsAndTooling(ctx, record);

    const announced = (ctx.emit as unknown as { mock: { calls: [{ detail?: string }][] } }).mock.calls
      .map(([step]) => step.detail ?? "")
      .join(" ");
    expect(announced).not.toContain("$FAKE");
    expect(announced).toContain("$ARB");
  });
});
