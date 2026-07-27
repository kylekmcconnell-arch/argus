import { describe, expect, it, vi } from "vitest";
import { checkLeaderDepartures } from "./peopledatalabs";

const person = (experience: Array<{ company: string; title: string; start: string; end?: string }>) => ({
  fullName: "Niklas Homan",
  jobTitle: "CEO",
  jobCompany: "Orbit",
  experience,
  linkedin: "linkedin.com/in/niklas-homan",
  emails: [],
});

describe("checkLeaderDepartures", () => {
  it("reports a departure with its date, for a leader who left", async () => {
    const enrich = vi.fn(async () => person([
      { company: "Orbit Group AI", title: "Chief Executive Officer", start: "2025-04", end: "2026-02" },
    ]) as never);

    const out = await checkLeaderDepartures(
      [{ name: "Niklas Homan", role: "Founder & Chief Executive Officer", linkedin: "linkedin.com/in/niklas-homan" }],
      "Orbit",
      enrich,
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ state: "departed", ended: "2026-02", linkedin: "linkedin.com/in/niklas-homan" });
    expect(out[0].summary).toContain("no longer lists");
    // The LinkedIn profile travels with it so a human can confirm the licensed
    // record against the live page.
    expect(enrich).toHaveBeenCalledWith(expect.objectContaining({ company: "Orbit", name: "Niklas Homan" }));
  });

  it("only spends on founders and C-level, and never more than three", async () => {
    const enrich = vi.fn(async () => person([{ company: "Orbit", title: "CEO", start: "2025-01" }]) as never);
    const roster = [
      { name: "Aa Aaa", role: "Founder" },
      { name: "Bb Bbb", role: "Chief Technology Officer" },
      { name: "Cc Ccc", role: "President" },
      { name: "Dd Ddd", role: "Chief Marketing Officer" },
      { name: "Ee Eee", role: "Partner Relations Director" },
      { name: "Ff Fff", role: "Engineer" },
      { name: "Gg Ggg", role: "Community Manager" },
    ];

    const out = await checkLeaderDepartures(roster, "Orbit", enrich);
    expect(enrich).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(3);
    expect(out.every((row) => row.state === "current")).toBe(true);
  });

  it("spends nothing without a company, a leader, or a full name", async () => {
    const enrich = vi.fn(async () => person([]) as never);
    expect(await checkLeaderDepartures([{ name: "Aa Aaa", role: "Founder" }], "", enrich)).toEqual([]);
    expect(await checkLeaderDepartures([{ name: "Aa Aaa", role: "Engineer" }], "Orbit", enrich)).toEqual([]);
    // A single-token name cannot be matched safely, so it is never bought.
    expect(await checkLeaderDepartures([{ name: "Niklas", role: "Founder" }], "Orbit", enrich)).toEqual([]);
    expect(enrich).not.toHaveBeenCalled();
  });

  it("skips a leader the provider cannot resolve rather than guessing", async () => {
    const enrich = vi.fn(async () => null);
    const out = await checkLeaderDepartures([{ name: "Aa Aaa", role: "Founder" }], "Orbit", enrich as never);
    expect(out).toEqual([]);
  });
});
