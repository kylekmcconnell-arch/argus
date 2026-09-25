import { describe, expect, it, vi } from "vitest";
import { employerWebsite, verifyTeamCompanyCandidates } from "./teamCompanyBinding";
import { sameTeamIdentity } from "../src/lib/teamCompanyBinding";
import type { PublicTextResult } from "./publicWeb";
const page = (url: string, text: string): PublicTextResult => ({ status: "ok", url, host: new URL(url).hostname, text, contentType: "text/html", contentHash: "sha256:test", capturedAt: "2026-09-24T00:00:00Z" });
const employer = "https://www.linkedin.com/company/hades/";
const member = { name: "Example Operator", role: "engineer", linkedin: "https://linkedin.com/in/example", sourceUrl: employer, companyHint: { companyUrl: employer, website: "https://hadesprivacy.example", activityMatches: true } };
describe("independently retrieved company binding", () => {
  it("rejects three Hades Mining candidates even when the model reports a matching privacy domain", async () => {
    const read = vi.fn(async (url: string) => page(url, "Hades Mining. Website https://www.hades.com Industry Mining. Example Operator engineer. Laser drilling for critical minerals."));
    const result = await verifyTeamCompanyCandidates([member, member, member], "https://hadesprivacy.example", "hadesprivacy", { read, maxPages: 8 });
    expect(result.accepted).toEqual([]);
    expect(result.checks.every(c => c.state === "rejected" && c.employerDomain === "hades.com")).toBe(true);
    expect(result.checks[0].sources[0].contentHash).toBe("sha256:test");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not count a blocked employer page as a match or negative finding", async () => {
    const result = await verifyTeamCompanyCandidates([member], "https://hadesprivacy.example", "hadesprivacy", { read: async () => ({ status: "failed", reason: "http_403" }), maxPages: 8 });
    expect(result.accepted).toEqual([]);
    expect(result.checks[0]).toMatchObject({ state: "unresolved", sources: [] });
  });
  it("compares business descriptions even when Website matches", async () => {
    const result = await verifyTeamCompanyCandidates([member], "https://hadesprivacy.example", "hadesprivacy", { read: async url => page(url, url === employer ? "Website https://hadesprivacy.example Mining laser drilling minerals Example Operator engineer" : "Privacy protocol for confidential blockchain transactions"), maxPages: 8 });
    expect(result.checks[0]).toMatchObject({ state: "rejected", activity: "conflicting" });
  });
  it("accepts a company-bound employment claim without upgrading it to verified identity", async () => {
    const result = await verifyTeamCompanyCandidates([member], "https://hadesprivacy.example", "hadesprivacy", { read: async url => page(url, "Website https://hadesprivacy.example Privacy protocol for blockchain transactions. Example Operator engineer"), maxPages: 8 });
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).not.toHaveProperty("artifact_verified");
    expect(result.checks[0].state).toBe("matched_company");
  });
  it("keeps an official-site pseudonym but strips a separately guessed LinkedIn", async () => {
    const result = await verifyTeamCompanyCandidates([{ name: "shlok", role: "builder", sourceUrl: "https://hadesprivacy.example/team", linkedin: "linkedin.com/in/guess" }], "https://hadesprivacy.example", "hadesprivacy", { read: async url => page(url, "Built by shlok, our founder."), maxPages: 8 });
    expect(result.accepted[0]).toMatchObject({ name: "shlok", linkedin: undefined });
  });
  it("enforces a shared page budget and keeps missing employer fields unresolved", async () => {
    const read = vi.fn(async url => page(url, "This page merely mentions hadesprivacy.example."));
    const result = await verifyTeamCompanyCandidates([member, { ...member, companyHint: { companyUrl: "https://linkedin.com/company/another" } }], "https://hadesprivacy.example", "hadesprivacy", { read, maxPages: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.checks.every(c => c.state === "unresolved")).toBe(true);
    expect(employerWebsite("A review of https://hadesprivacy.example")).toBeNull();
  });
  it("never merges namesakes or contradictory handles", () => {
    expect(sameTeamIdentity({ name: "Sam" }, { name: "Sam", handle: "sam" })).toBe(false);
    expect(sameTeamIdentity({ name: "Sam", handle: "one", linkedin: "linkedin.com/in/sam" }, { name: "Sam", handle: "two", linkedin: "linkedin.com/in/sam" })).toBe(false);
    expect(sameTeamIdentity({ name: "Sam", linkedin: "https://www.linkedin.com/in/sam/" }, { name: "S", linkedin: "linkedin.com/in/sam" })).toBe(true);
  });
});
