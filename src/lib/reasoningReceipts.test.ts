import { describe, expect, it } from "vitest";
import { buildGraphPathReceipt, buildTypedContradictionReceipts } from "./reasoningReceipts";

function graphPacket() {
  return {
    projectAttributions: [{
      project: "Argus",
      name: "@ada",
      role: "Founder",
      sourceUrl: "https://argus.example/team",
    }],
    investigationReasoning: {
      projectEvidence: { facts: [] },
      connections: {
        tokenGraph: { nodes: [], edges: [] },
        projectGraph: {
          nodes: [
            { key: "project:argus", label: "Argus", subject: true },
            { key: "x:ada", label: "@ada" },
            { key: "wallet:0xverified", label: "0xverified" },
            { key: "wallet:0xcandidate", label: "0xcandidate" },
          ],
          edges: [
            {
              from: "x:ada",
              to: "wallet:0xverified",
              relationship: "CONTROLS_WALLET",
              sourceUrl: "https://chain.example/attestation",
              provider: "direct-chain-rpc",
              sourceClass: "direct_chain_rpc",
              evidenceState: "verified",
              eligibility: "verified",
              inputPath: "investigationReasoning.connections.projectGraph.edges.0",
            },
            {
              from: "project:argus",
              to: "wallet:0xcandidate",
              relationship: "NAMESAKE_WALLET",
              sourceUrl: "https://search.example/result",
              evidenceState: "reported_context",
              eligibility: "candidate model_lead",
              inputPath: "investigationReasoning.connections.projectGraph.edges.1",
            },
          ],
        },
      },
    },
  };
}

function conflictPacket(overrides: Record<string, unknown> = {}) {
  return {
    investigationReasoning: {
      projectEvidence: {
        facts: [{
          factId: "fact:launch-date",
          predicate: "launch_date",
          value: "The project launched in 2024.",
          status: "conflicted",
          attributionScope: "direct_subject",
          sources: [
            {
              url: "https://project.example/history",
              provider: "official-site",
              sourceClass: "official_subject",
              relation: "supports",
              excerpt: "The project launched in 2024.",
              contentHash: "support-hash",
              capturedAt: "2026-08-22T10:00:00Z",
              artifactVerified: true,
            },
            {
              url: "https://registry.example/filing",
              provider: "public-registry",
              sourceClass: "public_registry",
              relation: "contradicts",
              excerpt: "The first registered launch occurred in 2024 under a different date.",
              contentHash: "conflict-hash",
              capturedAt: "2026-08-22T10:01:00Z",
              artifactVerified: true,
              ...overrides,
            },
          ],
        }],
      },
      connections: {},
    },
  };
}

describe("reasoning receipts", () => {
  it("returns the shortest source-receipted path and preserves bounded attribution", () => {
    const receipt = buildGraphPathReceipt("Trace Argus to wallet:0xverified", "trace_connection", graphPacket());

    expect(receipt).toMatchObject({
      state: "complete",
      targetKeys: ["wallet:0xverified"],
      paths: [{
        nodeKeys: ["project:argus", "x:ada", "wallet:0xverified"],
        pathLength: 2,
        evidenceState: "bounded",
        edges: [
          expect.objectContaining({ relationship: "Founder", evidenceState: "bounded" }),
          expect.objectContaining({ relationship: "CONTROLS_WALLET", evidenceState: "verified" }),
        ],
      }],
    });
  });

  it("rejects candidate graph topology instead of promoting it into a path", () => {
    const receipt = buildGraphPathReceipt("Trace Argus to 0xcandidate", "trace_connection", graphPacket());

    expect(receipt.state).toBe("withheld");
    expect(receipt.paths).toEqual([]);
    expect(receipt.rejectedAlternatives).toContainEqual(expect.objectContaining({
      to: "wallet:0xcandidate",
      reason: "candidate_edge",
    }));
  });

  it("does not choose an unnamed trace target", () => {
    expect(buildGraphPathReceipt("Trace the connection", "trace_connection", graphPacket())).toMatchObject({
      state: "target_unresolved",
      targetKeys: [],
    });
  });

  it("types aligned independent artifacts as an unresolved proposition conflict", () => {
    expect(buildTypedContradictionReceipts(conflictPacket())).toEqual([
      expect.objectContaining({
        factId: "fact:launch-date",
        scopeAlignment: "aligned",
        timeAlignment: "aligned",
        sourceIndependence: "independent",
        status: "unresolved",
      }),
    ]);
  });

  it("withholds dependent sources even when the text and period align", () => {
    const receipt = buildTypedContradictionReceipts(conflictPacket({
      url: "https://project.example/correction",
      provider: "official-site",
    }));

    expect(receipt[0]).toMatchObject({ sourceIndependence: "dependent", status: "withheld" });
  });

  it("classifies different stated periods as different context, not contradiction", () => {
    const receipt = buildTypedContradictionReceipts(conflictPacket({
      excerpt: "The first registered launch occurred in 2025.",
    }));

    expect(receipt[0]).toMatchObject({ timeAlignment: "misaligned", status: "different_context" });
  });

  it("recognizes an explicit later correction as superseding the earlier proposition", () => {
    const receipt = buildTypedContradictionReceipts(conflictPacket({
      excerpt: "Correction: the earlier 2024 launch date is no longer accurate.",
      capturedAt: "2026-08-23T10:01:00Z",
    }));

    expect(receipt[0]).toMatchObject({ status: "superseded" });
  });

  it("requires exact verified artifacts on both sides", () => {
    expect(buildTypedContradictionReceipts(conflictPacket({ artifactVerified: false }))).toEqual([]);
  });
});
