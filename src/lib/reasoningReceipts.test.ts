import { describe, expect, it } from "vitest";
import { buildGraphPathReceipt, buildPublicClaimConflictDiscovery, buildPublicControlPathDiscovery, buildTypedContradictionReceipts } from "./reasoningReceipts";

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
  it("surfaces an official claim that conflicts with an independent record for the same period", () => {
    const discovery = buildPublicClaimConflictDiscovery([{
      factId: "fact:launch-date",
      predicate: "launched",
      value: "The project launched in 2024.",
      status: "conflicted",
      attributionScope: "direct_subject",
      sources: [
        {
          url: "https://project.example/history",
          provider: "official-site",
          sourceClass: "official_subject",
          relation: "supports",
          excerpt: "We launched the project in March 2024.",
          contentHash: "official-hash",
          capturedAt: "2026-08-22T10:00:00Z",
          artifactVerified: true,
        },
        {
          url: "https://registry.example/filing",
          provider: "public-registry",
          sourceClass: "regulatory_or_onchain",
          relation: "contradicts",
          excerpt: "The registered launch occurred in September 2024.",
          contentHash: "registry-hash",
          capturedAt: "2026-08-22T10:01:00Z",
          artifactVerified: true,
        },
      ],
    }], "#basic-facts");

    expect(discovery).toMatchObject({
      id: "claim-conflict:fact:launch-date",
      headline: "The official launch date conflicts with a registry or on-chain record",
      evidenceHref: "#basic-facts",
      receipts: [
        { label: "Official claim", href: "https://project.example/history" },
        { href: "https://registry.example/filing" },
      ],
    });
    expect(discovery?.consequence).toContain("ARGUS leaves the conflict unresolved");
  });

  it("withholds claim conflicts that are dependent, unverified, out of period, or about a related entity", () => {
    const source = {
      url: "https://project.example/history",
      provider: "official-site",
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: "The project launched in 2024.",
      contentHash: "support-hash",
      capturedAt: "2026-08-22T10:00:00Z",
      artifactVerified: true,
    };
    const fact = {
      factId: "fact:launch-date",
      predicate: "launched",
      value: "The project launched in 2024.",
      status: "conflicted",
      attributionScope: "direct_subject",
      sources: [source, {
        ...source,
        relation: "contradicts",
        sourceClass: "independent_press",
        excerpt: "The project launched in 2024 on another date.",
        contentHash: "conflict-hash",
      }],
    };
    expect(buildPublicClaimConflictDiscovery([fact], "#basic-facts")).toBeNull();
    expect(buildPublicClaimConflictDiscovery([{
      ...fact,
      sources: [source, {
        ...fact.sources[1],
        url: "https://press.example/report",
        provider: "press",
        excerpt: "The project launched in 2023.",
      }],
    }], "#basic-facts")).toBeNull();
    expect(buildPublicClaimConflictDiscovery([{
      ...fact,
      attributionScope: "related_entity",
      sources: [source, {
        ...fact.sources[1],
        url: "https://press.example/report",
        provider: "press",
      }],
    }], "#basic-facts")).toBeNull();
    expect(buildPublicClaimConflictDiscovery([{
      ...fact,
      attributionScope: undefined,
      sources: [source, {
        ...fact.sources[1],
        url: "https://press.example/report",
        provider: "press",
      }],
    }], "#basic-facts")).toBeNull();
    expect(buildPublicClaimConflictDiscovery([{
      ...fact,
      sources: [source, {
        ...fact.sources[1],
        url: "https://press.example/report",
        provider: "press",
        artifactVerified: false,
      }],
    }], "#basic-facts")).toBeNull();
  });

  it("surfaces a two-hop public control path only when every edge has a source receipt", () => {
    const discovery = buildPublicControlPathDiscovery([
      {
        nodes: [
          { key: "token:base:0xargus", label: "$ARGUS", type: "Token", subject: true },
          { key: "@argus", label: "@argus", type: "Person" },
        ],
        edges: [{
          src: "token:base:0xargus",
          dst: "@argus",
          type: "TEAM",
          source_url: "https://x.com/argus",
          evidence_origin: "deterministic",
          artifact_verified: true,
        }],
      },
      {
        nodes: [
          { key: "@argus", label: "Argus", type: "Company", subject: true },
          { key: "@ada", label: "Ada Lovelace", type: "Person" },
        ],
        edges: [{
          src: "@argus",
          dst: "@ada",
          type: "TEAM",
          source_url: "https://argus.example/team",
          evidence_origin: "deterministic",
          artifact_verified: true,
        }],
      },
    ], "#investigation-relationships");

    expect(discovery).toMatchObject({
      evidenceHref: "#investigation-relationships",
      path: ["$ARGUS", "Argus", "Ada Lovelace"],
      receipts: [
        { href: "https://x.com/argus" },
        { href: "https://argus.example/team" },
      ],
    });
    expect(discovery?.headline).toContain("Ada Lovelace");
    expect(discovery?.consequence).toContain("accountability and track record");
  });

  it("withholds public control paths when one hop is source-less or candidate-only", () => {
    const base = {
      nodes: [
        { key: "subject", label: "Subject", type: "Company", subject: true },
        { key: "middle", label: "Middle", type: "Company" },
        { key: "target", label: "Target", type: "Person" },
      ],
      edges: [
        { src: "subject", dst: "middle", type: "AFFILIATED_WITH", source_url: "https://example.com/one" },
        { src: "middle", dst: "target", type: "TEAM" },
      ],
    };
    expect(buildPublicControlPathDiscovery([base], "#relationships")).toBeNull();
    expect(buildPublicControlPathDiscovery([{
      ...base,
      edges: [
        base.edges[0],
        { ...base.edges[1], source_url: "https://example.com/two", evidence_origin: "model_lead" },
      ],
    }], "#relationships")).toBeNull();
  });

  it("withholds generic link chains even when every link has a URL", () => {
    expect(buildPublicControlPathDiscovery([{
      nodes: [
        { key: "subject", label: "Subject", type: "Company", subject: true },
        { key: "site", label: "Official site", type: "Company" },
        { key: "docs", label: "Docs", type: "Company" },
      ],
      edges: [
        { src: "subject", dst: "site", type: "LINKS", source_url: "https://example.com" },
        { src: "site", dst: "docs", type: "LINKS", source_url: "https://docs.example.com" },
      ],
    }], "#relationships")).toBeNull();
  });

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
