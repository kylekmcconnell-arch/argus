import { describe, it, expect } from "vitest";
import {
  buildScoringEvidencePacket,
  extractScoringEvidenceCatalog,
  inspectAnalystScoringPreflight,
  type AnalystAxis,
} from "./agent";
import { PersonCheckTracker } from "./checks";
import { SubjectClass, getProfile } from "../src/engine";

// The empirically confirmed @a16zcrypto case: once routing correctly selected
// INVESTOR, the fund still abstained INCOMPLETE because no source-backed AUM or
// fund-close amount verified, leaving I3_fund_scale_tier with no substantive
// artifact. A completed fund-scale assessment is itself I3 evidence.
const investorAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.INVESTOR).axes)
  .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.INVESTOR }));

function fundSections(): Record<string, unknown> {
  return {
    profile: {
      handle: "@a16zcrypto",
      display_name: "a16z crypto",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      bio: "We back bold entrepreneurs building the next internet.",
      website: "https://a16zcrypto.com/",
      profile_captured_at: "2026-07-19T15:00:00.000Z",
    },
    checkOutcomes: [
      { checkId: "identity-resolution", status: "confirmed", note: "resolved", provider: "twitterapi" },
      { checkId: "vc-portfolio-track-record", status: "confirmed", note: "portfolio verified", provider: "portfolio-web" },
    ],
  };
}

function preflightWith(sections: Record<string, unknown>) {
  const packet = buildScoringEvidencePacket(sections, investorAxes);
  return {
    pf: inspectAnalystScoringPreflight(investorAxes, packet),
    catalog: extractScoringEvidenceCatalog(packet, investorAxes),
  };
}

describe("investor abstention fix: assessed-null fund scale", () => {
  it("REGRESSION: a fund with no verified scale abstains on I3", () => {
    const { pf } = preflightWith(fundSections());
    expect(pf.missingSubstantiveAxes).toContain("I3_fund_scale_tier");
  });

  it("FIX: a completed fund-scale assessment clears I3 with a substantive artifact", () => {
    const sections = fundSections();
    (sections.checkOutcomes as unknown[]).push({
      checkId: "investor-fund-scale",
      status: "finding",
      note: "assessed fund scale: a completed source-backed search verified no fund AUM or close amount for this fund. A null result on this axis, not adverse evidence.",
      provider: "fund-scale-web",
    });
    const { pf, catalog } = preflightWith(sections);
    expect(pf.missingSubstantiveAxes).not.toContain("I3_fund_scale_tier");
    const artifact = catalog.find((row) => row.operation === "checkOutcomes:investor-fund-scale");
    expect(artifact).toBeDefined();
    expect(artifact?.verification).toBe("verified");
    // The assessment is scoped to fund scale only; it must never become
    // evidence for portfolio quality or any other investor axis.
    expect(artifact?.eligibleAxes).toEqual(["I3_fund_scale_tier"]);
  });

  // The frozen checklist is longer than the packet's checkOutcomes budget, so a
  // positional cut would drop whichever substantive assessment happens to sit
  // late in the list behind a block of not-applicable rows.
  it("keeps a substantive assessment that sits past the packet cap, dropping not-applicable rows first", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "investor-fund-scale",
      status: "finding",
      note: "assessed fund scale: a completed source-backed search verified no fund AUM or close amount for this fund. A null result on this axis, not adverse evidence.",
      provider: "fund-scale-web",
    });
    tracker.record({
      id: "vc-portfolio-track-record",
      status: "confirmed",
      note: "portfolio verified",
      provider: "portfolio-web",
    });
    const snapshot = tracker.snapshot([SubjectClass.INVESTOR, SubjectClass.AGENCY], {});
    // The real checklist exceeds the packet budget and puts fund scale late.
    expect(snapshot.length).toBeGreaterThan(20);
    const fundScaleIndex = snapshot.findIndex((row) => row.checkId === "investor-fund-scale");
    expect(fundScaleIndex).toBeGreaterThanOrEqual(20);

    const packet = buildScoringEvidencePacket({
      profile: { handle: "@a16zcrypto", display_name: "a16z crypto", profile_collection_state: "resolved", bio: "We back founders." },
      checkOutcomes: snapshot,
    }, investorAxes);
    const retained = (JSON.parse(packet).checkOutcomes ?? []) as { checkId: string; status: string }[];
    const retainedIds = retained.map((row) => row.checkId);

    expect(retainedIds).toContain("investor-fund-scale");
    expect(retainedIds).toContain("vc-portfolio-track-record");
    expect(retained.some((row) => row.status === "not-applicable")).toBe(false);
    expect(inspectAnalystScoringPreflight(investorAxes, packet).missingSubstantiveAxes)
      .not.toContain("I3_fund_scale_tier");
  });
});
