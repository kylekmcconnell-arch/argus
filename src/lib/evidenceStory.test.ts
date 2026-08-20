import { describe, expect, it } from "vitest";
import type { AxisEvidenceRecord } from "../data/evidence";
import type { DecisionBasisRow } from "./decisionBasis";
import { summarizeEvidencePosture } from "./evidenceReasoning";
import { deriveAxisEvidenceLimits } from "./evidenceStory";

function artifact(
  hex: string,
  provider: string,
  sourceUrl: string,
  verification: AxisEvidenceRecord["verification"] = "verified",
  title = "Saved evidence",
): AxisEvidenceRecord {
  const contentHash = hex.repeat(64).slice(0, 64);
  return {
    artifactId: `art_v1_${contentHash}`,
    kind: "axis_evidence",
    provider,
    operation: "project-diligence",
    section: "governing-axis",
    title,
    sourceUrl,
    contentHash,
    eligibleAxes: [
      "P2_product_substance",
      "P3_token_conduct",
      "P4_backing_and_partners",
      "P6_transparency_integrity",
    ],
    verification,
    scope: "direct_subject",
  };
}

function row(
  axis: string,
  overrides: Partial<DecisionBasisRow> = {},
): DecisionBasisRow {
  return {
    axis,
    score: 20,
    weight: 20,
    rationale: "Performance rationale belongs to the score, not evidence confidence.",
    support: [],
    counter: [],
    gapArtifacts: [],
    gaps: [],
    status: "grounded",
    ...overrides,
  };
}

describe("axis evidence story", () => {
  it("does not call a strongly evidenced adverse performance result an evidence gap", () => {
    const strongLowScore = row("P2_product_substance", {
      score: 0,
      support: [
        artifact("a", "independent-publication", "https://research.example/product"),
        artifact("b", "public-registry", "https://registry.example/operator"),
      ],
    });

    expect(deriveAxisEvidenceLimits([strongLowScore])).toEqual([]);
    expect(deriveAxisEvidenceLimits([{ ...strongLowScore, score: 20 }])).toEqual([]);
  });

  it("shows weak or unknown evidence even when the numeric score is neutral or high", () => {
    const limits = deriveAxisEvidenceLimits([
      row("P2_product_substance", { score: 20, support: [], status: "gap" }),
    ]);

    expect(limits).toHaveLength(1);
    expect(limits[0]).toMatchObject({
      axis: "P2_product_substance",
      reason: "origin_shortfall",
      title: "Still needed: independent proof of a live product and recent delivery activity.",
    });
    expect(limits[0]?.detail).toContain("No eligible supporting artifact");
    expect(limits[0]?.detail).not.toContain("Performance rationale");
  });

  it("keeps completed no-token and no-backer assessments neutral", () => {
    const rows = [
      row("P3_token_conduct", {
        score: 0,
        weight: 20,
        status: "gap",
        gaps: [
          "No token could be tied to the project's official identity; the completed identity check returned null and the project states it has no token.",
        ],
      }),
      row("P4_backing_and_partners", {
        score: 0,
        weight: 14,
        status: "gap",
        gaps: ["No named backer, investor, funding round, or project partner was found or announced."],
      }),
    ];

    expect(deriveAxisEvidenceLimits(rows, {
      P3_token_conduct: { tier: "assessed_null" },
      P4_backing_and_partners: { tier: "assessed_null" },
    })).toEqual([]);
  });

  it("preserves real outages and identity conflicts on assessed-null axes", () => {
    const limits = deriveAxisEvidenceLimits([
      row("P3_token_conduct", {
        status: "partial",
        gaps: ["Token records conflict across two exact-contract providers."],
      }),
      row("P4_backing_and_partners", {
        status: "partial",
        gapArtifacts: [
          artifact(
            "9",
            "counterparty-registry",
            "https://partners.example/project",
            "unavailable",
            "Partner registry lookup",
          ),
        ],
      }),
    ], {
      P3_token_conduct: { tier: "assessed_null" },
      P4_backing_and_partners: { tier: "assessed_null" },
    });

    expect(limits).toEqual([
      expect.objectContaining({ axis: "P3_token_conduct", reason: "open_question" }),
      expect.objectContaining({ axis: "P4_backing_and_partners", reason: "source_unavailable" }),
    ]);
  });

  it("counts repeated citations from one publisher as one origin", () => {
    const citations = [
      artifact("c", "official-site", "https://project.example/about"),
      artifact("d", "official-site", "https://project.example/docs"),
    ];
    const posture = summarizeEvidencePosture(citations, "verified");
    const [limit] = deriveAxisEvidenceLimits([
      row("P6_transparency_integrity", { support: citations }),
    ]);

    expect(posture).toMatchObject({
      sourceRefCount: 2,
      originCount: 1,
      independentOriginCount: 0,
      firstPartyOnly: true,
    });
    expect(limit?.posture.originCount).toBe(1);
    expect(limit?.detail).toContain("only from the subject's own channels");
  });

  it("replaces generic P2 and P6 thinness with the concrete proof still needed", () => {
    const firstParty = artifact("e", "official-site", "https://project.example");
    const limits = deriveAxisEvidenceLimits([
      row("P2_product_substance", {
        support: [firstParty],
        gaps: ["Verified evidence on product and execution is thin."],
        status: "partial",
      }),
      row("P6_transparency_integrity", {
        support: [firstParty],
        gaps: ["Verified evidence on transparency and integrity remains limited."],
        status: "partial",
      }),
    ]);

    expect(limits.map((limit) => limit.title)).toEqual([
      "Still needed: independent proof of a live product and recent delivery activity.",
      "Still needed: a legal-operator record plus independent governance, security-review, or public-code proof.",
    ]);
    expect(limits.map((limit) => limit.title).join(" ")).not.toMatch(/thin|limited/i);
  });

  it("keeps an unavailable canonical source check visible even when other evidence is strong", () => {
    const limit = deriveAxisEvidenceLimits([
      row("P6_transparency_integrity", {
        support: [
          artifact("f", "independent-publication", "https://research.example/disclosures"),
          artifact("1", "public-registry", "https://registry.example/legal-entity"),
        ],
        gapArtifacts: [
          artifact(
            "2",
            "security-audit-registry",
            "https://audits.example/project",
            "unavailable",
            "Independent security review lookup",
          ),
        ],
        status: "partial",
      }),
    ])[0];

    expect(limit).toMatchObject({
      reason: "source_unavailable",
      title: "Still needed: a legal-operator record plus independent governance, security-review, or public-code proof.",
    });
    expect(limit?.detail).toContain("Independent security review lookup");
  });
});
