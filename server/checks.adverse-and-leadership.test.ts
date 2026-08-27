// Two rows the checklist contract was missing, and the two lies that followed.
//
// 1. There was no adverse / scam-sweep row at all. The sweep reported only
//    through checkTracker.provider, a map snapshot() and completeness() never
//    read, so skipping the sweep cost ZERO coverage and the report published
//    full clearance while the rug screen never ran.
// 2. The leader-departure answer was recorded against founder-company-
//    relationships, whose FOUNDER role gate then published "not a founder" on a
//    PROJECT-only subject: ARGUS paid for the answer and denied the question.
import { describe, expect, it } from "vitest";
import { deriveDecisionReadiness } from "../src/lib/decisionReadiness";
import {
  FUND_SCALE_ERA_PERSON_CHECK_IDS,
  PRE_ORGANIZATION_SAFETY_PERSON_CHECK_IDS,
  PERSON_CHECK_IDS,
  PersonCheckTracker,
  type PersonCheckScope,
} from "./checks";

const byId = (tracker: PersonCheckTracker, roles: string[], id: string, scope?: PersonCheckScope) =>
  tracker.snapshot(roles, scope).find((check) => check.checkId === id);

/** Every decision gate a resolved-name KOL has, except the adverse sweep. */
const KOL_GATES_EXCEPT_ADVERSE = [
  "identity-resolution",
  "affiliations-associates",
  "promoted-token-performance",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
] as const;

describe("adverse-screen check row", () => {
  it("leaves an unrun sweep as an open decision gate for a person role", () => {
    const tracker = new PersonCheckTracker();
    // The old shape of the bug: the pass reported itself and nothing else.
    tracker.provider("adverse-sweep", "Adverse-signal sweep", "unavailable", "collection time budget reached before this pass");

    const row = byId(tracker, ["KOL"], "adverse-screen", { resolvedRealName: true });
    expect(row).toMatchObject({ status: "unknown", decisionCritical: true });
  });

  it("stops a KOL reaching full coverage with no adverse sweep at all", () => {
    const tracker = new PersonCheckTracker();
    for (const id of KOL_GATES_EXCEPT_ADVERSE) {
      tracker.record({ id, status: "confirmed", note: `${id} verified`, provider: "test-provider", sourceCount: 1 });
    }
    const scope = { resolvedRealName: true };

    const readiness = deriveDecisionReadiness(tracker.snapshot(["KOL"], scope));
    expect(readiness.applicable).toBe(7);
    expect(readiness.successful).toBe(6);
    expect(readiness.coveragePercent).toBeLessThan(100);
    expect(readiness.unknown).toBe(1);
  });

  it("counts the sweep for a pseudonymous subject, whose name screens cannot apply", () => {
    const tracker = new PersonCheckTracker();
    const scope = { resolvedRealName: false };

    // With no resolved real name both name screens go not-applicable, so the
    // sweep is the only place anyone asks whether this subject is accused of
    // taking people's money.
    expect(byId(tracker, ["KOL"], "us-legal-history", scope)?.status).toBe("not-applicable");
    expect(byId(tracker, ["KOL"], "ofac-sanctions-name", scope)?.status).toBe("not-applicable");
    expect(byId(tracker, ["KOL"], "adverse-screen", scope)).toMatchObject({
      status: "unknown",
      decisionCritical: true,
    });
  });

  it("treats a completed empty sweep as an answer and an unprovisioned one as a gap", () => {
    const ran = new PersonCheckTracker();
    ran.record({
      id: "adverse-screen",
      status: "checked-empty",
      note: "the search returned no candidate source. An empty search is not proof that no adverse record exists.",
      provider: "adverse-sweep",
    });
    const never = new PersonCheckTracker();
    never.record({
      id: "adverse-screen",
      status: "unavailable",
      note: "no model search provider is configured, so no adverse, scam, or rug search was attempted",
      provider: "adverse-sweep",
    });

    expect(byId(ran, ["FOUNDER"], "adverse-screen")?.status).toBe("checked-empty");
    expect(byId(never, ["FOUNDER"], "adverse-screen")?.status).toBe("unavailable");
    // Only the second is an open gate.
    expect(deriveDecisionReadiness(ran.snapshot(["FOUNDER"])).successful).toBe(1);
    expect(deriveDecisionReadiness(never.snapshot(["FOUNDER"])).successful).toBe(0);
  });

  it("keeps a completed sweep outcome even when a later error reports the pass unavailable", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "adverse-screen",
      status: "finding",
      note: "2 adverse leads surfaced. Each is an unverified candidate source for follow-up, not a verified finding.",
      provider: "adverse-sweep",
      sourceCount: 2,
    });
    tracker.record({
      id: "adverse-screen",
      status: "unavailable",
      note: "the adverse, scam, and rug sweep failed before it completed: Error: venn hop blew up",
      provider: "adverse-sweep",
    });

    expect(byId(tracker, ["FOUNDER"], "adverse-screen")).toMatchObject({
      status: "finding",
      sourceCount: 2,
    });
  });
});

describe("project-leadership-currency check row", () => {
  it("no longer denies the question on the PROJECT-only subject that answered it", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "project-leadership-currency",
      status: "finding",
      note: "Ada Okafor no longer lists Orbit as a current role: the record ends March 2024.",
      provider: "peopledatalabs",
      sourceCount: 1,
    });

    const scope = { resolvedRealName: false };
    expect(byId(tracker, ["PROJECT"], "project-leadership-currency", scope)).toMatchObject({
      status: "finding",
      note: expect.stringContaining("March 2024"),
      provider: "peopledatalabs",
    });
    // The FOUNDER-gated row that used to swallow it still reads not-applicable,
    // and now that is the truth: nothing was recorded there.
    expect(byId(tracker, ["PROJECT"], "founder-company-relationships", scope)).toMatchObject({
      status: "not-applicable",
      note: "not a founder",
    });
  });

  it("stays out of scope for a subject that is not a project account", () => {
    const tracker = new PersonCheckTracker();

    expect(byId(tracker, ["FOUNDER"], "project-leadership-currency")).toMatchObject({
      status: "not-applicable",
      note: "not a project account",
    });
  });

  it("never withholds project clearance for a lookup that could not be made", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "identity-resolution",
      "affiliations-associates",
      "project-token-identity",
      "entity-continuity",
      "project-product-substance",
      "project-team-identity",
      "project-backing-partners",
      "project-traction-liveness",
      "project-transparency",
      "trust-graph-connections",
    ] as const) {
      tracker.record({ id, status: "confirmed", note: `${id} verified`, provider: "test-provider", sourceCount: 1 });
    }
    const scope = { resolvedRealName: false };

    expect(byId(tracker, ["PROJECT"], "project-leadership-currency", scope)?.decisionCritical).toBe(false);
    expect(tracker.completeness(["PROJECT"], scope)).toBe("complete");
  });
});

describe("frozen checklist contracts", () => {
  it("keeps the pre-change contract available so already persisted reports still qualify", () => {
    const current = new Set<string>(PERSON_CHECK_IDS);
    const fundScaleEra = new Set<string>(FUND_SCALE_ERA_PERSON_CHECK_IDS);
    const preOrganizationSafety = new Set<string>(PRE_ORGANIZATION_SAFETY_PERSON_CHECK_IDS);

    expect(preOrganizationSafety.size).toBe(fundScaleEra.size + 2);
    expect(current.size).toBe(preOrganizationSafety.size + 3);
    for (const id of fundScaleEra) expect(preOrganizationSafety.has(id)).toBe(true);
    for (const id of preOrganizationSafety) expect(current.has(id)).toBe(true);
    expect(fundScaleEra.has("adverse-screen")).toBe(false);
    expect(fundScaleEra.has("project-leadership-currency")).toBe(false);
    expect(current.has("adverse-screen")).toBe(true);
    expect(current.has("project-leadership-currency")).toBe(true);
    expect(preOrganizationSafety.has("organization-registration")).toBe(false);
    expect(preOrganizationSafety.has("organization-sanctions")).toBe(false);
    expect(current.has("organization-registration")).toBe(true);
    expect(current.has("organization-sanctions")).toBe(true);
  });
});
