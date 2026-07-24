import { describe, expect, it } from "vitest";
import { getProfile, SubjectClass } from "../src/engine";
import {
  buildScoringEvidencePacket,
  deriveProjectStrengthBands,
  type AnalystAxis,
} from "./agent";

const projectAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
  .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));

const packet = (hacks: Array<Record<string, unknown>>) => buildScoringEvidencePacket({
  profile: {
    handle: "@driftprotocol",
    display_name: "Drift Protocol",
    website: "https://www.drift.trade",
    profile_collection_state: "resolved",
    profile_provider: "twitterapi",
    profile_captured_at: "2026-07-24T12:00:00.000Z",
  },
  basicFacts: [
    {
      predicate: "repository",
      value: "github.com/drift-labs/protocol-v2",
      status: "verified",
      artifact_verified: true,
    },
    {
      predicate: "product",
      value: "Live decentralized perpetual futures protocol",
      status: "verified",
      artifact_verified: true,
    },
  ],
  projectToken: {
    verified: true,
    verification: "official_domain",
    coingeckoId: "drift-protocol",
    rank: 300,
    marketCapUsd: 75_000_000,
    volume24hUsd: 3_000_000,
    liquidityUsd: 2_000_000,
    providers: ["coingecko", "dexscreener"],
    capturedAt: "2026-07-24T12:00:00.000Z",
  },
  findings: hacks.map((incident) => ({
    finding_type: "ProtocolSecurityIncident",
    claim: incident.returnedFunds === true
      ? "DeFiLlama records $14.5M protocol security incident on 2022-05-11. DeFiLlama records $14.5M returned."
      : "DeFiLlama records $295M infrastructure security incident on 2026-04-01. DeFiLlama does not record returned funds for this incident.",
    source_url: "https://defillama.com/protocol/drift",
    source_date: String(incident.date ?? ""),
    source_author: "defillama",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "defillama",
    finding_scope: {
      scope: "direct_subject",
      target_entity_key: "@driftprotocol",
      target_entity_type: "project",
      relationship_to_subject: "self",
    },
  })),
}, projectAxes);

describe("project security incident strength caps", () => {
  it("caps product and token/control axes at emerging for a material incident without recorded recovery", () => {
    const clean = deriveProjectStrengthBands(packet([]), projectAxes);
    const exploited = deriveProjectStrengthBands(packet([{
      date: "2026-04-01",
      amountUsd: 295_000_000,
      returnedFunds: false,
      classification: "Infrastructure",
    }]), projectAxes);

    expect(clean.P2_product_substance.tier).toBe("solid");
    expect(clean.P3_token_conduct.tier).toBe("solid");
    expect(exploited.P2_product_substance.tier).toBe("emerging");
    expect(exploited.P3_token_conduct.tier).toBe("emerging");
    expect(exploited.P2_product_substance.reasons.join(" ")).toContain("security incident");
    expect(exploited.P3_token_conduct.reasons.join(" ")).toContain("security incident");
  });

  it("does not cap a historical incident whose funds are recorded returned", () => {
    const recovered = deriveProjectStrengthBands(packet([{
      date: "2022-05-11",
      amountUsd: 14_500_000,
      returnedFunds: true,
      returnedAmountUsd: 14_500_000,
      classification: "Protocol Logic",
    }]), projectAxes);

    expect(recovered.P2_product_substance.tier).toBe("solid");
    expect(recovered.P3_token_conduct.tier).toBe("solid");
  });
});
