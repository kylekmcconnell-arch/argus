import { describe, expect, it } from "vitest";
import type { DerivedIntelligenceSignal, IntelligenceMeasurement } from "../intelligence/types";
import {
  isPublicMeasurement,
  publicEvidenceLabel,
  publicMeasurementTitle,
  publicQuestionStateLabel,
  publicIntelligenceText,
  publicProviderExplanation,
  publicSignalCopy,
} from "./intelligencePresentation";

function measurement(id: string, label: string): IntelligenceMeasurement {
  return {
    id,
    label,
    domain: "supply",
    unit: "count",
    entityKey: "token:test",
    evidenceState: "reported_context",
    sourceRefs: ["source:test"],
    valueType: "number",
    value: 16,
  };
}

function signal(overrides: Partial<DerivedIntelligenceSignal> = {}): DerivedIntelligenceSignal {
  return {
    id: "signal:test",
    ruleId: "test-rule",
    ruleVersion: 1,
    kind: "observation",
    domain: "identity",
    severity: "medium",
    polarity: "unknown",
    headline: "A question remains open",
    finding: "The current report did not establish the answer.",
    whyItMatters: "The answer could change the decision.",
    changeCondition: "A direct source answers the question.",
    evidenceState: "bounded",
    measurementRefs: [],
    sourceRefs: [],
    lenses: ["investment"],
    ...overrides,
  };
}

describe("public Decision Intelligence presentation", () => {
  it("hides scorer-band and internal status measurements from the public evidence grid", () => {
    expect(isPublicMeasurement(measurement("project_strength_tier:p3-token-conduct", "P3_token_conduct deterministic scorer-packet evidence tier"))).toBe(false);
    expect(isPublicMeasurement(measurement("project_strength_max_score:p3-token-conduct", "P3_token_conduct deterministic evidence-band maximum"))).toBe(false);
    expect(isPublicMeasurement(measurement("evm_control_target_state", "Fixed-block canonical-address control-read state"))).toBe(false);
    expect(isPublicMeasurement(measurement("total_supply", "Reported total supply"))).toBe(true);
  });

  it("uses reader-facing metric and state labels", () => {
    expect(publicMeasurementTitle(measurement("goplus_fired_contract_flag_count", "GoPlus contract or deployer flags that fired"))).toBe("Contract or deployer warnings");
    expect(publicEvidenceLabel("reported_context")).toBe("Source reported");
    expect(publicEvidenceLabel("bounded")).toBe("Limited sample");
    expect(publicQuestionStateLabel("not_collected")).toBe("Not checked");
  });

  it("translates an integrity rule into a public report warning without exposing the rule id", () => {
    const copy = publicSignalCopy(signal({
      ruleId: "intelligence-integrity-gate",
      severity: "high",
      finding: "The final integrity gate recorded 3 fail-closed integrity events.",
    }));

    expect(copy.status).toBe("Report issue");
    expect(copy.headline).toContain("conclusions were withheld");
    expect(copy.finding).toContain("3 report items");
    expect(`${copy.headline} ${copy.finding}`).not.toContain("integrity-gate");
  });

  it("turns internal product and contract-warning headlines into reader language without vendor names", () => {
    const support = publicSignalCopy(signal({
      ruleId: "strict-product-description",
      polarity: "support",
      headline: "Product description has strict direct-subject sourcing",
    }));
    const concern = publicSignalCopy(signal({
      ruleId: "goplus-fired-contract-flag",
      polarity: "risk",
      headline: "GoPlus reports a fired contract or deployer flag",
    }));

    expect(support.headline).toBe("Direct sources describe what the product does");
    expect(concern.headline).toBe("A contract or deployer warning was recorded");
    expect(`${support.headline} ${concern.headline}`).not.toMatch(/strict direct-subject|fired .* flag|GoPlus/i);
  });

  it("rewrites integrity-gate dumps, SiteNotLive titles, ledger jargon, and raw floats", () => {
    const integrity = publicIntelligenceText(
      "The final integrity gate recorded 3 fail-closed integrity events. Counts include 2 duplicate source IDs, 1 duplicate measurement IDs, invalid lineage, rejected archetype evidence.",
    );
    const site = publicSignalCopy(signal({
      ruleId: "verified-direct-subject-adverse-finding",
      headline: "Verified adverse record: SiteNotLive",
      finding: "Frozen SiteNotLive finding: supergemma.ai is a coming-soon page.",
    }));
    const ledger = publicIntelligenceText(
      "The frozen scoring analyst recorded 2 unresolved questions. Strict direct-subject evidence answers part of this multi-facet question, but the frozen ledger does not record facet-level completeness. 1 direct-subject scorer-packet record is marked score-limiting.",
    );
    const drawdown = publicIntelligenceText("Price sits -39.7410894525038% below the reported high.");

    expect(integrity).toContain("3 report items failed the source-link check");
    expect(integrity).not.toMatch(/fail-closed|integrity gate|duplicate source IDs|invalid lineage|rejected archetype/i);
    expect(site.headline).toBe("The project website is not live yet");
    expect(site.finding).toContain("coming-soon");
    expect(`${site.headline} ${site.finding}`).not.toMatch(/SiteNotLive/i);
    expect(ledger).not.toMatch(/frozen scoring analyst|frozen ledger|strict direct-subject|scorer-packet/i);
    expect(ledger).toContain("saved review");
    expect(drawdown).toContain("-39.7%");
    expect(drawdown).not.toContain("39.7410894525038");
  });

  it("does not treat a provider name as the public explanation", () => {
    expect(publicProviderExplanation("GoPlus")).toBeUndefined();
    expect(publicProviderExplanation("twitterapi.io")).toBeUndefined();
    expect(publicIntelligenceText("GoPlus assigns 12% of supply to a labeled wallet.")).not.toMatch(/GoPlus/);
  });

  it("translates legacy scorer bands without changing their ranges or treating checked-empty evidence as negative", () => {
    const copy = publicSignalCopy(signal({
      id: "project_strength_band_summary",
      ruleId: "project-strength-band-summary",
      headline: "The scorer packet preserves axis-level evidence ranges",
      finding: "P1_team_and_identity: solid (12 to 13); P2_product_and_execution: emerging (10 to 16); P3_token_conduct: solid (14 to 16); P4_backers_and_partnerships: assessed_null (0 to 0). These are deterministic evidence-band constraints from the frozen scorer packet.",
      whyItMatters: "Assessed-null evidence limits confidence.",
    }));

    expect(copy.headline).toBe("How strong the evidence is in each area");
    expect(copy.finding).toContain("Team and leadership: strong evidence (12–13 points)");
    expect(copy.finding).toContain("Backers and partnerships: checked, but no reliable supporting evidence was confirmed (0 points)");
    expect(JSON.stringify(copy)).not.toMatch(/scorer|assessed_null|P\d_|deterministic|frozen/i);
  });

  it("turns legacy launch timestamps into a readable, neutral explanation", () => {
    const copy = publicSignalCopy(signal({
      id: "launch_boundary_gap",
      ruleId: "launch-boundary-gap",
      headline: "Observed account and domain launch boundaries are separated",
      finding: "The earliest saved launch boundary is 2024-08-31T14:43:47.000Z; the latest is 2026-03-03T16:49:55.000Z, a 18-month gap. These are observed account and domain boundaries, not a proved founding date, hidden relaunch, or deception finding.",
    }));

    expect(copy.headline).toBe("The project's online footprint appeared in two stages");
    expect(copy.finding).toContain("August 31, 2024");
    expect(copy.finding).toContain("March 3, 2026");
    expect(copy.finding).toContain("does not prove when the project began or indicate wrongdoing");
    expect(copy.finding).not.toMatch(/\d{4}-\d{2}-\d{2}T|boundar|hidden relaunch/i);
  });

  it("removes internal source-tracing vocabulary from generic saved findings", () => {
    const copy = publicIntelligenceText("Part of the derived intelligence failed its lineage contract after 3 fail-closed integrity events.");
    expect(copy).toContain("source-link check");
    expect(copy).not.toMatch(/lineage contract|fail-closed|integrity events/i);
  });
});
