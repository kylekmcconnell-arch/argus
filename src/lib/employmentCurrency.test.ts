import { describe, expect, it } from "vitest";
import { employmentCurrency } from "./employmentCurrency";

const record = (company: string, title: string, start: string, end?: string) => ({
  company, title, start, ...(end ? { end } : {}),
});

describe("employmentCurrency", () => {
  it("reports a still-current role with the date it started", () => {
    const result = employmentCurrency(
      [record("Orbit Group AI", "Chief Executive Officer", "2025-04")],
      "Orbit",
      "Niklas Homan",
    );
    expect(result.state).toBe("current");
    expect(result.summary).toBe(
      "Niklas Homan still lists Chief Executive Officer at Orbit Group AI as a current role, held since April 2025.",
    );
  });

  it("reports a departure and when the record ends", () => {
    const result = employmentCurrency(
      [record("Orbit Group AI", "Chief Executive Officer", "2025-04", "2026-02")],
      "Orbit",
      "Niklas Homan",
    );
    expect(result).toMatchObject({ state: "departed", end: "2026-02" });
    expect(result.summary).toBe(
      "Niklas Homan no longer lists Orbit Group AI as a current role: the record ends February 2026 (Chief Executive Officer).",
    );
  });

  it("prefers an open role over a closed one at the same company", () => {
    const result = employmentCurrency([
      record("Orbit", "Advisor", "2024-01", "2024-12"),
      record("Orbit", "Chief Executive Officer", "2025-04"),
    ], "Orbit");
    expect(result.state).toBe("current");
    expect(result.title).toBe("Chief Executive Officer");
  });

  it("does not treat a missing record as proof of no involvement", () => {
    const result = employmentCurrency([record("Someplace Else", "Engineer", "2020-01")], "Orbit");
    expect(result.state).toBe("absent");
    expect(result.summary).toContain("may simply be incomplete");
    expect(result.summary).toContain("not evidence they were never involved");
  });

  it("matches around company suffix noise without matching a different company", () => {
    expect(employmentCurrency([record("Orbit Group AI Inc", "CTO", "2025-01")], "Orbit Group").state).toBe("current");
    expect(employmentCurrency([record("Orbital Insight", "CTO", "2025-01")], "Orbit").state).toBe("absent");
    expect(employmentCurrency([record("Aave Labs", "Founder", "2017-01")], "Aave").state).toBe("current");
  });

  it("picks the most recent departure when several closed roles exist", () => {
    const result = employmentCurrency([
      record("Orbit", "Engineer", "2023-01", "2024-06"),
      record("Orbit", "Head of Product", "2024-07", "2025-11"),
    ], "Orbit");
    expect(result).toMatchObject({ state: "departed", end: "2025-11", title: "Head of Product" });
  });
});
