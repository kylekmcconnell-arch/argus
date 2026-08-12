import { describe, expect, it } from "vitest";
import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import {
  recordOfficialXAccountStatusFinding,
  recordProtocolSecurityIncidentFindings,
} from "./orchestrate";

describe("material project incident findings", () => {
  it("promotes a frozen DeFiLlama hack row into direct-subject counter-evidence", () => {
    const evidence = emptyEvidence("@driftprotocol");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.protocolTvl = {
      slug: "drift",
      name: "Drift",
      symbol: "DRIFT",
      tvlUsd: 100_000_000,
      chains: ["Solana"],
      chainBreakdown: [{ chain: "Solana", tvlUsd: 100_000_000 }],
      geckoId: "drift-protocol",
      hacks: [{
        date: "2026-04-01",
        amountUsd: 295_000_000,
        returnedFunds: false,
        returnedAmountUsd: null,
        classification: "Infrastructure",
        technique: "Compromised Admin + Fake Token Price Manipulation",
      }],
      sourceUrl: "https://defillama.com/protocol/drift",
      capturedAt: "2026-07-24T12:00:00.000Z",
    };

    expect(recordProtocolSecurityIncidentFindings(evidence)).toBe(1);
    expect(recordProtocolSecurityIncidentFindings(evidence)).toBe(0);
    expect(evidence.findings).toContainEqual(expect.objectContaining({
      finding_type: "ProtocolSecurityIncident",
      verification_status: "Verified",
      polarity: -1,
      provider: "defillama",
      protocol_incident: {
        incident_date: "2026-04-01",
        observed_at: "2026-07-24T12:00:00.000Z",
        amount_usd: 295_000_000,
        reference_tvl_usd: 100_000_000,
        recovery_status: "no_recorded_full_return",
        returned_amount_usd: null,
      },
      finding_scope: expect.objectContaining({
        scope: "direct_subject",
        target_entity_key: "@driftprotocol",
        target_entity_type: "project",
      }),
    }));
    expect(evidence.findings[0].claim).toContain("$295M");
    expect(evidence.findings[0].claim).toContain("not by itself evidence of fraud");
  });

  it("records X suspension separately from project identity", () => {
    const evidence = emptyEvidence("@driftprotocol");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.x_account_status = "suspended";
    evidence.profile.x_account_status_source_url = "https://x.com/driftprotocol";
    evidence.profile.x_account_status_captured_at = "2026-07-24T12:00:00.000Z";

    expect(recordOfficialXAccountStatusFinding(evidence)).toBe(true);
    expect(recordOfficialXAccountStatusFinding(evidence)).toBe(false);
    expect(evidence.findings[0]).toEqual(expect.objectContaining({
      finding_type: "OfficialXAccountSuspended",
      verification_status: "Verified",
      polarity: -1,
    }));
    expect(evidence.profile.identity_confidence).toBe("Unverified");
  });

  it("does not treat a partial return as full recovery", () => {
    const evidence = emptyEvidence("@partialrecovery");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.protocolTvl = {
      slug: "partial-recovery",
      name: "Partial Recovery",
      symbol: "PART",
      tvlUsd: 100_000_000,
      chains: ["Ethereum"],
      chainBreakdown: [{ chain: "Ethereum", tvlUsd: 100_000_000 }],
      geckoId: "partial-recovery",
      hacks: [{
        date: "2026-04-01",
        amountUsd: 150_000_000,
        returnedFunds: true,
        returnedAmountUsd: 25_000_000,
        classification: "Infrastructure",
        technique: null,
      }],
      sourceUrl: "https://defillama.com/protocol/partial-recovery",
      capturedAt: "2026-07-24T12:00:00.000Z",
    };

    recordProtocolSecurityIncidentFindings(evidence);

    expect(evidence.findings[0].protocol_incident).toEqual(expect.objectContaining({
      recovery_status: "no_recorded_full_return",
      returned_amount_usd: 25_000_000,
    }));
  });
});
