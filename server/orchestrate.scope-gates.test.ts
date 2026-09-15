import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import type { ResearchCapability } from "../src/lib/researchDirector";
import { writeEntityFacts } from "./entityStore";
import {
  ADAPTERS_FOR_TEST,
  ADAPTER_DELEGATES,
  COLD_INTAKE_CAPABILITIES,
  coldIntakeAuthorized,
  writeVerifiedEntityFacts,
} from "./orchestrate";

vi.mock("./entityStore", () => ({ writeEntityFacts: vi.fn(async () => true) }));

afterEach(() => vi.clearAllMocks());

// 2026-09-14 deep-dive OR-9: an adapter absent from the delegate map can never
// run under a frozen gap-investigation scope. Arkham was absent, so every
// scoped follow-up recorded it as "outside the authorization".
describe("scoped follow-up adapter delegates", () => {
  it("maps every registered adapter to at least one research-plan delegate", () => {
    for (const adapter of ADAPTERS_FOR_TEST) {
      expect(ADAPTER_DELEGATES[adapter.id]?.length, `${adapter.id} has no delegate mapping`).toBeGreaterThan(0);
    }
  });

  it("lets a wallet-graph scope re-collect Arkham context", () => {
    expect(ADAPTER_DELEGATES.arkham).toContain("wallet-graph");
  });
});

// 2026-09-14 deep-dive OR-4: gap re-runs re-bought the entire unscoped cold
// intake before any authorized adapter, often exhausting the collection window.
describe("cold intake under an authorized scope", () => {
  const scope = (capabilities: ResearchCapability[]) => ({
    taskIds: ["task"],
    capabilities,
    delegates: ["basic-facts"],
  });

  it("always runs for an unscoped scan", () => {
    expect(coldIntakeAuthorized(undefined)).toBe(true);
  });

  it("is skipped for a follow-up that authorizes no discovery capability", () => {
    expect(coldIntakeAuthorized(scope(["official_facts"]))).toBe(false);
    expect(coldIntakeAuthorized(scope(["token_and_market", "fund_scale", "legal_and_adverse", "analyst_synthesis"]))).toBe(false);
  });

  it("still runs when any discovery capability is authorized", () => {
    for (const capability of COLD_INTAKE_CAPABILITIES) {
      expect(coldIntakeAuthorized(scope(["official_facts", capability])), capability).toBe(true);
    }
  });
});

// 2026-09-14 deep-dive OR-2: private scans wrote org-visible entity_facts
// (handle, display name, facts, audit_count, fresh updated_at).
describe("entity knowledge-base write-back", () => {
  function verifiedEvidence() {
    const evidence = emptyEvidence("@quietsubject");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = { verified: true, name: "Quiet", symbol: "QUIET", chain: "ethereum", address: "0x1" } as never;
    return evidence;
  }

  it("writes verified facts for an ordinary org-scoped run", () => {
    expect(writeVerifiedEntityFacts(verifiedEvidence(), { organizationId: "org-1" })).toBe(true);
    expect(writeEntityFacts).toHaveBeenCalledWith("org-1", expect.any(String), expect.objectContaining({ handle: "@quietsubject" }));
  });

  it("leaves no trace for a private run", () => {
    expect(writeVerifiedEntityFacts(verifiedEvidence(), { organizationId: "org-1", privateRun: true })).toBe(false);
    expect(writeEntityFacts).not.toHaveBeenCalled();
  });

  it("writes nothing without an organization", () => {
    expect(writeVerifiedEntityFacts(verifiedEvidence(), undefined)).toBe(false);
    expect(writeEntityFacts).not.toHaveBeenCalled();
  });
});
