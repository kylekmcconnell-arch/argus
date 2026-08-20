import { describe, expect, it } from "vitest";
import type { DerivedIntelligenceSignal, IntelligenceSpineSnapshot } from "../intelligence/types";
import {
  evidencePostureForSignal,
  summarizeEvidencePosture,
} from "./evidenceReasoning";

function signal(): DerivedIntelligenceSignal {
  return {
    id: "signal:product",
    ruleId: "product",
    ruleVersion: 1,
    kind: "observation",
    domain: "product",
    severity: "medium",
    polarity: "support",
    headline: "Product is live",
    finding: "A product surface was observed.",
    whyItMatters: "Execution matters.",
    changeCondition: "The product becomes unavailable.",
    evidenceState: "verified",
    measurementRefs: [],
    sourceRefs: [],
    lenses: ["investment"],
  };
}

function snapshot(): IntelligenceSpineSnapshot {
  return {
    schemaVersion: 1,
    rulesetVersion: "argus-point-in-time-v1",
    mode: "point_in_time",
    scoringImpact: "none",
    subject: {
      key: "project:test",
      label: "Test",
      forms: [],
      archetypes: { state: "insufficient", primary: null, matches: [] },
    },
    captureWindow: { earliest: null, latest: null },
    sources: [],
    measurements: [],
    questions: [],
    coverage: [],
    signals: [],
    lenses: [],
  };
}

describe("evidence reasoning", () => {
  it("does not turn repeated first-party pages into independent corroboration", () => {
    const posture = summarizeEvidencePosture([
      {
        id: "team",
        provider: "official-site",
        sourceClass: "official_subject",
        evidenceState: "verified",
        sourceUrl: "https://example.com/team",
      },
      {
        id: "about",
        provider: "official-site",
        sourceClass: "official_subject",
        evidenceState: "verified",
        sourceUrl: "https://example.com/about",
      },
      {
        id: "docs",
        provider: "official-site",
        sourceClass: "official_subject",
        evidenceState: "verified",
        sourceUrl: "https://docs.example.com",
      },
    ], "verified");

    expect(posture).toMatchObject({
      kind: "first_party_only",
      independentOriginCount: 0,
      originCount: 1,
      firstPartyOnly: true,
      label: "First-party evidence only",
    });
  });

  it("keeps different independent publisher domains as separate origins", () => {
    const posture = summarizeEvidencePosture([
      {
        id: "publisher-a",
        provider: "public-web",
        sourceClass: "independent_publication",
        evidenceState: "verified",
        sourceUrl: "https://news.publisher-a.example/report",
        contentHashes: ["publisher-a-copy"],
      },
      {
        id: "publisher-b",
        provider: "public-web",
        sourceClass: "independent_publication",
        evidenceState: "verified",
        sourceUrl: "https://research.publisher-b.example/report",
        contentHashes: ["publisher-b-copy"],
      },
    ], "verified");

    expect(posture).toMatchObject({
      kind: "independently_corroborated",
      originCount: 2,
      independentOriginCount: 2,
    });
  });

  it("keeps unrelated tenants on a shared hosting suffix separate", () => {
    const posture = summarizeEvidencePosture([
      {
        id: "tenant-a",
        provider: "public-web",
        sourceClass: "independent_publication",
        evidenceState: "verified",
        sourceUrl: "https://project-a.github.io/report",
      },
      {
        id: "tenant-b",
        provider: "public-web",
        sourceClass: "independent_publication",
        evidenceState: "verified",
        sourceUrl: "https://project-b.github.io/report",
      },
    ], "verified");

    expect(posture.originCount).toBe(2);
    expect(posture.independentOriginCount).toBe(2);
  });

  it("collapses identical syndicated content before counting origins", () => {
    const posture = summarizeEvidencePosture([
      {
        id: "press-a",
        provider: "publication-a",
        sourceClass: "independent_publication",
        evidenceState: "verified",
        contentHashes: ["same-copy"],
      },
      {
        id: "press-b",
        provider: "publication-b",
        sourceClass: "independent_publication",
        evidenceState: "verified",
        contentHashes: ["same-copy"],
      },
    ], "verified");

    expect(posture.originCount).toBe(1);
    expect(posture.independentOriginCount).toBe(1);
    expect(posture.kind).toBe("externally_supported");
  });

  it("recognizes independent counterparty and registry corroboration", () => {
    const posture = summarizeEvidencePosture([
      {
        id: "official",
        provider: "official-site",
        sourceClass: "official_subject",
        evidenceState: "verified",
      },
      {
        id: "partner",
        provider: "partner-site",
        sourceClass: "official_counterparty",
        evidenceState: "verified",
      },
      {
        id: "registry",
        provider: "public-registry",
        sourceClass: "public_registry",
        evidenceState: "verified",
      },
    ], "verified");

    expect(posture).toMatchObject({
      kind: "independently_corroborated",
      independentOriginCount: 2,
      label: "2 independent origins",
    });
  });

  it("includes measurement lineage when evaluating a signal", () => {
    const value = snapshot();
    value.sources = [{
      id: "rpc",
      inputPath: "evmControl",
      provider: "direct-chain-rpc",
      title: "Fixed-block RPC read",
      sourceClass: "direct_chain_rpc",
      evidenceState: "measured",
    }];
    value.measurements = [{
      id: "measure:authority",
      domain: "control",
      label: "Authority threshold",
      unit: "count",
      entityKey: "token:test",
      valueType: "number",
      value: 1,
      evidenceState: "measured",
      sourceRefs: ["rpc"],
    }];
    const item = signal();
    item.measurementRefs = ["measure:authority"];
    item.evidenceState = "measured";

    expect(evidencePostureForSignal(value, item)).toMatchObject({
      kind: "direct_observation",
      label: "Directly observed",
      independentOriginCount: 1,
    });
  });
});
