import { describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { mergeManagementIntoWebTeam } from "./orchestrate";

const enrichment = (management: Array<{ name: string; title: string; priorCompanies: string[]; linkedin: string | null; startYear: string | null }>) => ({
  name: "Uniswap Labs",
  uuid: "monid-uuid",
  identityMatch: "official_domain" as const,
  requestedDomain: "uniswap.org",
  matchedDomain: "uniswap.org",
  matchMethod: "exact_host" as const,
  management,
  sourceUrl: "https://uniswap.org",
  capturedAt: "2026-07-23T00:00:00.000Z",
});

describe("mergeManagementIntoWebTeam", () => {
  it("adds missing leadership profiles as verified roster members", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.companyEnrichment = enrichment([
      { name: "Mary-Catherine Lader", title: "COO", priorCompanies: ["BlackRock"], linkedin: "linkedin.com/in/mclader", startYear: "2021" },
    ]);
    const emit = vi.fn();
    mergeManagementIntoWebTeam(evidence, emit);

    const member = (evidence.webTeam ?? []).find((entry) => entry.name === "Mary-Catherine Lader");
    expect(member).toMatchObject({
      role: "COO",
      linkedin: "linkedin.com/in/mclader",
      artifact_verified: true,
      evidence_origin: "deterministic",
      provider: "monid",
      sourceUrl: "https://uniswap.org",
      identity_link_evidence_origin: "deterministic",
    });
    expect(member?.evidence).toContain("BlackRock");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ source: "monid", tone: "good" }));
  });

  it("corroborates an existing unverified member instead of duplicating them", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.webTeam = [{
      name: "Hayden Adams",
      role: "team",
      source: "web/LinkedIn search",
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
      identity_link_evidence_origin: "model_lead",
      projects_evidence_origin: "model_lead",
    }];
    evidence.companyEnrichment = enrichment([
      { name: "hayden adams", title: "CEO", priorCompanies: [], linkedin: "linkedin.com/in/haydenadams", startYear: "2018" },
    ]);
    mergeManagementIntoWebTeam(evidence, vi.fn());

    expect(evidence.webTeam).toHaveLength(1);
    expect(evidence.webTeam[0]).toMatchObject({
      name: "Hayden Adams",
      role: "CEO",
      linkedin: "linkedin.com/in/haydenadams",
      artifact_verified: true,
      provider: "monid",
      identity_link_evidence_origin: "deterministic",
    });
  });

  it("does nothing without a management record", () => {
    const evidence = emptyEvidence("@uniswap");
    const emit = vi.fn();
    mergeManagementIntoWebTeam(evidence, emit);
    expect(evidence.webTeam ?? []).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects leadership from a name-only company match", () => {
    const evidence = emptyEvidence("@askvenice");
    evidence.companyEnrichment = {
      ...enrichment([
        { name: "Nik Rae Falco", title: "Founder and Owner", priorCompanies: [], linkedin: null, startYear: null },
      ]),
      identityMatch: "name_only",
      sourceUrl: "https://venicetrim.com",
    };
    const emit = vi.fn();
    mergeManagementIntoWebTeam(evidence, emit);

    expect(evidence.webTeam ?? []).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      label: "Leadership match rejected",
      source: "monid",
      tone: "warn",
    }));
  });

  it("rejects a forged official-domain flag when the selected company website differs", () => {
    const evidence = emptyEvidence("@driftprotocol");
    evidence.profile.website = "https://drift.trade";
    evidence.companyEnrichment = {
      ...enrichment([
        { name: "Marc Washington", title: "Founder", priorCompanies: [], linkedin: null, startYear: null },
      ]),
      requestedDomain: "drift.trade",
      matchedDomain: "drifthair.com",
      sourceUrl: "https://drifthair.com",
    };
    const emit = vi.fn();

    mergeManagementIntoWebTeam(evidence, emit);

    expect(evidence.webTeam ?? []).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      label: "Leadership match rejected",
      source: "monid",
      tone: "warn",
    }));
  });
});
