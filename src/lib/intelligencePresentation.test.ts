import { describe, expect, it } from "vitest";
import type { DerivedIntelligenceSignal, IntelligenceMeasurement } from "../intelligence/types";
import {
  isPublicMeasurement,
  publicEvidenceLabel,
  publicMeasurementTitle,
  publicQuestionStateLabel,
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
});
