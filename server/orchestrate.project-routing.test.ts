import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { emptyEvidence } from "../src/data/evidence";
import { axisCatalog, providerBackedRoles } from "./orchestrate";

function resolvedProjectProfile(bio: string, website: string | null | undefined = "https://world.xyz/") {
  const evidence = emptyEvidence("@world_xyz");
  evidence.profile.bio = bio;
  evidence.profile.website = website ?? undefined;
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = "2026-07-12T14:00:00.000Z";
  return evidence;
}

describe("provider-backed project routing", () => {
  it("routes @world_xyz to the PROJECT methodology and requests every PROJECT axis", () => {
    const evidence = resolvedProjectProfile("the solana prediction market");
    const roles = providerBackedRoles(evidence);

    expect(roles).toEqual([SubjectClass.PROJECT]);
    expect(axisCatalog(roles)).toEqual([
      { axis: "P1_team_and_identity", weight: 16, role: SubjectClass.PROJECT },
      { axis: "P2_product_substance", weight: 24, role: SubjectClass.PROJECT },
      { axis: "P3_token_conduct", weight: 20, role: SubjectClass.PROJECT },
      { axis: "P4_backing_and_partners", weight: 14, role: SubjectClass.PROJECT },
      { axis: "P5_traction_and_liveness", weight: 14, role: SubjectClass.PROJECT },
      { axis: "P6_transparency_integrity", weight: 12, role: SubjectClass.PROJECT },
    ]);
  });

  it.each([
    "the onchain prediction market",
    "a decentralized exchange",
    "the NFT marketplace",
    "a crypto product",
    "the liquidity protocol",
  ])("recognizes a provider-resolved project profile: %s", (bio) => {
    expect(providerBackedRoles(resolvedProjectProfile(bio))).toContain(SubjectClass.PROJECT);
  });

  it("does not let a model-only PROJECT candidate select a methodology", () => {
    const evidence = emptyEvidence("@model_project");
    evidence.findings.push({
      finding_type: "RoleCandidate",
      claim: "Model-extracted self-claim suggests PROJECT.",
      source_url: "",
      source_date: "",
      source_author: "claude-intake",
      verification_status: "Rumor",
      independent_source_count: 0,
      polarity: 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });

    const roles = providerBackedRoles(evidence);
    expect(roles).toEqual([]);
    expect(axisCatalog(roles)).toEqual([]);
  });

  it.each([
    ["no official site", null, "twitterapi", "2026-07-12T14:00:00.000Z"],
    ["untrusted profile provider", "https://world.xyz/", "model", "2026-07-12T14:00:00.000Z"],
    ["unfrozen provider profile", "https://world.xyz/", "twitterapi", undefined],
    ["shared-host profile URL", "https://medium.com/world", "twitterapi", "2026-07-12T14:00:00.000Z"],
  ])("rejects PROJECT routing with %s", (_label, website, provider, capturedAt) => {
    const evidence = resolvedProjectProfile("the solana prediction market", website);
    evidence.profile.profile_provider = provider;
    evidence.profile.profile_captured_at = capturedAt;

    expect(providerBackedRoles(evidence)).not.toContain(SubjectClass.PROJECT);
  });
});
