// ARGUS pays for the leader-departure answer and used to record it against
// founder-company-relationships, a FOUNDER-gated row. On a PROJECT-only
// subject the role gate then published "not a founder" on the very run that
// answered the question. These tests pin the answer to its own PROJECT-scoped
// row, and pin the three outcomes apart: a dated departure, an all-still-listed
// roster, and a record that answered for nobody.
import { describe, expect, it } from "vitest";
import type { LeaderDepartureCheck } from "./adapters/peopledatalabs";
import { leadershipCurrencyObservation } from "./orchestrate";
import { PersonCheckTracker } from "./checks";

const departed = (name: string, ended?: string): LeaderDepartureCheck => ({
  name,
  role: "Co-Founder",
  linkedin: `linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
  state: "departed",
  summary: `${name} no longer lists Orbit as a current role: the record ends ${ended ?? "on an unstated date"}.`,
  ...(ended ? { ended } : {}),
});

const current = (name: string): LeaderDepartureCheck => ({
  name,
  role: "CTO",
  state: "current",
  summary: `${name} still lists CTO at Orbit as a current role.`,
});

const absent = (name: string): LeaderDepartureCheck => ({
  name,
  role: "CFO",
  state: "absent",
  summary: `${name} has no Orbit role on their employment record.`,
});

describe("leadership currency outcome", () => {
  it("records a dated departure on the PROJECT row, not the founder row", () => {
    const observation = leadershipCurrencyObservation([departed("Ada Okafor", "2024-03")], "Orbit");

    expect(observation).toMatchObject({
      id: "project-leadership-currency",
      status: "finding",
      provider: "peopledatalabs",
      sourceCount: 1,
    });
    expect(observation?.note).toContain("2024-03");
  });

  it("survives the role gate that used to deny the question on a project subject", () => {
    const tracker = new PersonCheckTracker();
    tracker.record(leadershipCurrencyObservation([departed("Ada Okafor", "2024-03")], "Orbit")!);

    const snapshot = tracker.snapshot(["PROJECT"], { resolvedRealName: false });
    expect(snapshot.find((check) => check.checkId === "project-leadership-currency")).toMatchObject({
      status: "finding",
    });
  });

  it("treats an all-still-listed roster as its own confirmed signal", () => {
    const observation = leadershipCurrencyObservation([current("Bram Vos"), current("Dana Ito")], "Orbit");

    expect(observation).toMatchObject({ status: "confirmed", sourceCount: 2 });
    expect(observation?.note).toContain("2 named leaders still list Orbit");
  });

  it("never counts an unanswered record as a leader who is still there", () => {
    const observation = leadershipCurrencyObservation(
      [current("Bram Vos"), absent("Cleo Nash"), absent("Eli Ward")],
      "Orbit",
    );

    expect(observation?.status).toBe("confirmed");
    expect(observation?.sourceCount).toBe(1);
    expect(observation?.note).toContain("1 named leader still lists Orbit");
    expect(observation?.note).toContain("no Orbit role for 2 other named leaders");
    expect(observation?.note).toContain("not evidence they were never involved");
  });

  it("records a record that answered for nobody as a completed lookup, not a clean roster", () => {
    const observation = leadershipCurrencyObservation([absent("Cleo Nash"), absent("Eli Ward")], "Orbit");

    expect(observation?.status).toBe("checked-empty");
    expect(observation?.note).toContain("neither a departure nor a confirmation");
    expect(observation?.sourceCount).toBeUndefined();
  });

  it("says the licensed record can lag the live profile on every outcome", () => {
    for (const rows of [[departed("Ada Okafor", "2024-03")], [current("Bram Vos")], [absent("Cleo Nash")]]) {
      expect(leadershipCurrencyObservation(rows, "Orbit")?.note).toContain("can lag the live profile");
    }
  });

  it("stays silent when no leader could be resolved at all", () => {
    expect(leadershipCurrencyObservation([], "Orbit")).toBeNull();
  });
});
