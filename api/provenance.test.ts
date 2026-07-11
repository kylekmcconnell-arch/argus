import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { persistProvenance } from "./_provenance";

describe("frozen source artifact provenance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists strict catalog evidence and checks before ordered axis links", async () => {
    const supportId = `art_v1_${"a".repeat(64)}`;
    const counterId = `art_v1_${"b".repeat(64)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [
          {
            artifactId: supportId,
            contentHash: "a".repeat(64),
            kind: "axis_evidence",
            provider: "github",
            operation: "account-resolution",
            section: "identity",
            title: "GitHub account links to the audited X handle",
            excerpt: "twitter_username matched the audited handle",
            sourceUrl: "https://github.com/alice",
            capturedAt: "2026-07-11T07:00:00-05:00",
            eligibleAxes: ["F1_identity_verifiability"],
            verification: "verified",
            scope: "direct_subject",
          },
          {
            artifactId: counterId,
            contentHash: "b".repeat(64),
            kind: "axis_evidence",
            provider: "google-news",
            operation: "exact-name-search",
            section: "reputation",
            title: "One adverse exact-name result",
            eligibleAxes: ["F1_identity_verifiability"],
            verification: "reported",
            scope: "direct_subject",
          },
        ],
        report: {
          composite_verdict: "PASS",
          governing_score: 81,
          role_reports: [{
            role: "FOUNDER",
            axes: {
              F1_identity_verifiability: {
                score: 9,
                evidenceRefs: [supportId],
                counterEvidenceRefs: [counterId],
                gaps: ["No government registry artifact was collected."],
              },
            },
          }],
        },
      },
      [{
        checkId: "identity-resolution",
        label: "Identity resolution",
        status: "confirmed",
        provider: "github",
        sourceCount: 1,
      }],
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/evidence_items?");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/check_runs?");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/report_axis_evidence?");

    const evidenceRows = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(evidenceRows).toHaveLength(2);
    expect(evidenceRows[0]).toMatchObject({
      evidence_key: supportId,
      provider: "github",
      source_type: "identity",
      content_hash: "a".repeat(64),
      captured_at: "2026-07-11T12:00:00.000Z",
      metadata: {
        strictLineage: true,
        axisCitationVersion: 1,
        operation: "account-resolution",
        eligibleAxes: ["F1_identity_verifiability"],
        verification: "verified",
        scope: "direct_subject",
        catalogArtifact: {
          artifactId: supportId,
          kind: "axis_evidence",
          provider: "github",
          operation: "account-resolution",
          section: "identity",
          title: "GitHub account links to the audited X handle",
          excerpt: "twitter_username matched the audited handle",
          sourceUrl: "https://github.com/alice",
          capturedAt: "2026-07-11T12:00:00.000Z",
          contentHash: "a".repeat(64),
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        },
      },
    });

    const axisRows = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    expect(axisRows).toEqual([
      expect.objectContaining({
        role: "FOUNDER",
        axis_id: "F1_identity_verifiability",
        artifact_id: supportId,
        relation: "support",
        ordinal: 0,
      }),
      expect.objectContaining({
        role: "FOUNDER",
        axis_id: "F1_identity_verifiability",
        artifact_id: counterId,
        relation: "counter",
        ordinal: 0,
      }),
    ]);
  });

  it("persists a strict INCOMPLETE catalog with zero scored axes and no link write", async () => {
    const artifactId = `art_v1_${"d".repeat(64)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId,
          contentHash: "d".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "account-resolution",
          section: "identity",
          title: "A frozen collector artifact remains available for review",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "observed",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", score_total: null, axes: {} }],
        },
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/evidence_items?");
    const rows = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(rows).toEqual([expect.objectContaining({ evidence_key: artifactId })]);
  });

  it("treats an undefined lineage version as legacy payload shape", async () => {
    const contentHash = "e".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: undefined,
        sourceArtifacts: [{
          kind: "profile",
          provider: "github",
          title: "Legacy profile artifact",
          contentHash,
        }],
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/evidence_items?");
  });

  it.each([
    {
      label: "unsupported lineage version",
      payload: { axisCitationVersion: 2 },
    },
    {
      label: "malformed artifact id",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: "not-an-artifact",
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: { role_reports: [] },
      },
    },
    {
      label: "reference outside the catalog",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          role_reports: [{
            role: "FOUNDER",
            axes: {
              F1_identity_verifiability: {
                score: 8,
                evidenceRefs: [`art_v1_${"c".repeat(64)}`],
                counterEvidenceRefs: [],
                gaps: [],
              },
            },
          }],
        },
      },
    },
    {
      label: "zero axes for a scored verdict",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "PASS",
          governing_score: 88,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "an incomplete verdict with a non-null governing score",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: 1,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a catalog artifact without the required kind",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a source URL containing userinfo",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          sourceUrl: "https://user:secret@example.com/evidence",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a source URL containing a sensitive query parameter",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          sourceUrl: "https://example.com/evidence?api_key=secret",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
    {
      label: "a non-canonical source URL that would otherwise leak raw metadata",
      payload: {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          sourceUrl: "https://example.com/evidence#raw-fragment",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "verified",
          scope: "direct_subject",
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
    },
  ])("rejects $label before making any persistence request", async ({ payload }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      payload,
      [],
    )).rejects.toThrow("invalid axis evidence lineage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "an AWS signed credential", extra: { sourceUrl: "https://example.com/evidence?X-Amz-Signature=secret" } },
    { label: "an encoded AWS credential key", extra: { sourceUrl: "https://example.com/evidence?%58%2DAmz%2DCredential=secret" } },
    { label: "a Google signed credential", extra: { sourceUrl: "https://example.com/evidence?X-Goog-Credential=secret" } },
    { label: "an out-of-range URL port", extra: { sourceUrl: "https://example.com:65536/evidence" } },
    { label: "an unknown catalog property", extra: { rawProviderResponse: "must-not-persist" } },
  ])("rejects $label before persistence", async ({ extra }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        axisCitationVersion: 1,
        axisEvidenceCatalog: [{
          artifactId: `art_v1_${"a".repeat(64)}`,
          contentHash: "a".repeat(64),
          kind: "axis_evidence",
          provider: "github",
          operation: "lookup",
          section: "identity",
          title: "Result",
          eligibleAxes: ["F1_identity_verifiability"],
          verification: "observed",
          scope: "direct_subject",
          ...extra,
        }],
        report: {
          composite_verdict: "INCOMPLETE",
          governing_score: null,
          role_reports: [{ role: "FOUNDER", axes: {} }],
        },
      },
      [],
    )).rejects.toThrow("invalid axis evidence lineage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "checked_empty"])(
    "rejects %s support without an explicit gap before persistence",
    async (verification) => {
      const artifactId = `art_v1_${"a".repeat(64)}`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(persistProvenance(
        { url: "https://database.example", key: "sb_secret_test" },
        {
          organizationId: "00000000-0000-4000-8000-000000000011",
          reportVersionId: "00000000-0000-4000-8000-000000000022",
          attestationState: "server_collected",
        },
        {
          axisCitationVersion: 1,
          axisEvidenceCatalog: [{
            artifactId,
            contentHash: "a".repeat(64),
            kind: "axis_evidence",
            provider: "github",
            operation: "lookup",
            section: "identity",
            title: "Coverage absence",
            eligibleAxes: ["F1_identity_verifiability"],
            verification,
            scope: "direct_subject",
          }],
          report: {
            composite_verdict: "PASS",
            governing_score: 80,
            role_reports: [{
              role: "FOUNDER",
              axes: {
                F1_identity_verifiability: {
                  score: 8,
                  evidenceRefs: [artifactId],
                  counterEvidenceRefs: [],
                  gaps: [],
                },
              },
            }],
          },
        },
        [],
      )).rejects.toThrow("absence evidence without a gap");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["unavailable", "checked_empty"])(
    "rejects %s as counter-evidence before persistence",
    async (verification) => {
      const supportId = `art_v1_${"a".repeat(64)}`;
      const counterId = `art_v1_${"b".repeat(64)}`;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(persistProvenance(
        { url: "https://database.example", key: "sb_secret_test" },
        {
          organizationId: "00000000-0000-4000-8000-000000000011",
          reportVersionId: "00000000-0000-4000-8000-000000000022",
          attestationState: "server_collected",
        },
        {
          axisCitationVersion: 1,
          axisEvidenceCatalog: [
            {
              artifactId: supportId,
              contentHash: "a".repeat(64),
              kind: "axis_evidence",
              provider: "github",
              operation: "lookup",
              section: "identity",
              title: "Verified support",
              eligibleAxes: ["F1_identity_verifiability"],
              verification: "verified",
              scope: "direct_subject",
            },
            {
              artifactId: counterId,
              contentHash: "b".repeat(64),
              kind: "axis_evidence",
              provider: "github",
              operation: "lookup",
              section: "identity",
              title: "Coverage absence",
              eligibleAxes: ["F1_identity_verifiability"],
              verification,
              scope: "direct_subject",
            },
          ],
          report: {
            composite_verdict: "PASS",
            governing_score: 80,
            role_reports: [{
              role: "FOUNDER",
              axes: {
                F1_identity_verifiability: {
                  score: 8,
                  evidenceRefs: [supportId],
                  counterEvidenceRefs: [counterId],
                  gaps: ["The coverage absence is disclosed."],
                },
              },
            }],
          },
        },
        [],
      )).rejects.toThrow("absence evidence as counter-evidence");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("preserves artifact hashes, source kind, capture metadata, and match semantics", async () => {
    const contentHash = "a".repeat(64);
    const sourceContentHash = "b".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        sourceArtifacts: [{
          kind: "sanctions_screen",
          provider: "opensanctions",
          title: "OFAC exact-name screen",
          sourceUrl: "https://data.example/latest.csv",
          capturedAt: "2026-07-11T12:00:00.000Z",
          publishedAt: "2026-07-10T12:00:00.000Z",
          match: "no_match",
          excerpt: "No exact match.",
          contentHash,
          sourceContentHash,
        }],
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toContain("evidence_items");
    const rows = JSON.parse(String((request[1] as RequestInit).body)) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      evidence_key: contentHash,
      source_type: "sanctions_screen",
      content_hash: contentHash,
      metadata: {
        capturedAt: "2026-07-11T12:00:00.000Z",
        publishedAt: "2026-07-10T12:00:00.000Z",
        match: "no_match",
        sourceContentHash,
      },
    });
  });

  it("persists a deterministic hash-only artifact without inventing a public URL", async () => {
    const contentHash = "c".repeat(64);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistProvenance(
      { url: "https://database.example", key: "sb_secret_test" },
      {
        organizationId: "00000000-0000-4000-8000-000000000011",
        reportVersionId: "00000000-0000-4000-8000-000000000022",
        attestationState: "server_collected",
      },
      {
        sourceArtifacts: [{
          kind: "trust_graph",
          provider: "argus-graph",
          title: "Organization trust-graph reconciliation",
          capturedAt: "2026-07-11T12:00:00.000Z",
          match: "risk_signal",
          excerpt: "Exact report-version graph tie.",
          contentHash,
          sourceContentHash: contentHash,
        }],
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    const rows = JSON.parse(String((request[1] as RequestInit).body)) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      evidence_key: contentHash,
      provider: "argus-graph",
      source_type: "trust_graph",
      source_url: null,
      content_hash: contentHash,
      metadata: {
        hashOnly: true,
        match: "risk_signal",
        sourceContentHash: contentHash,
      },
    });
  });
});

describe("axis evidence migration contract (static SQL assertions only)", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260711212542_axis_evidence_lineage.sql", import.meta.url),
    "utf8",
  );

  it("declares tenant-safe lineage tables, RLS, and immutable certification", () => {
    expect(sql).toContain("create table public.report_axis_evidence");
    expect(sql).toContain("create table public.report_lineage_certifications");
    expect(sql).toContain("foreign key (organization_id, report_version_id, artifact_id)");
    expect(sql).toContain("alter table public.report_axis_evidence enable row level security");
    expect(sql).toContain("alter table public.report_lineage_certifications enable row level security");
    expect(sql).toContain("prevent_certified_lineage_mutation");
    expect(sql).toContain("to service_role");
  });

  it("gates strict publication and inserts the graph before base activation", () => {
    expect(sql).toContain("axisCitationVersion");
    expect(sql).toContain("report_lineage_certifications");
    expect(sql).toContain("reports_enforce_axis_evidence_lineage");
    const graphUpsert = sql.indexOf("insert into public.graph_contributions");
    const baseActivation = sql.lastIndexOf("perform public.activate_report_version");
    expect(graphUpsert).toBeGreaterThan(-1);
    expect(baseActivation).toBeGreaterThan(graphUpsert);
  });

  it("certifies honest incomplete reports and hardens retry and catalog semantics", () => {
    expect(sql).toContain("v_is_incomplete");
    expect(sql).toContain("{report,composite_verdict}' = 'INCOMPLETE'");
    expect(sql).toContain("{report,governing_score}') = 'null'");
    expect(sql).toContain("v_version.score is null");
    expect(sql).toContain("new.score is null");
    expect(sql).toContain("scored_axis_count = 0 and link_count = 0");
    expect(sql).toContain("incomplete strict report must not contain scored axes");
    expect(sql).toContain("coalesce(artifact.item ->> 'kind', '') <> 'axis_evidence'");
    expect(sql).toContain("!~ '^https?://(\\[[0-9a-f:.]+\\]|[a-z0-9]");
    expect(sql).toContain("artifact.item ->> 'sourceUrl' ~* '^https?://[^/?#]*@'");
    expect(sql).toContain("pg_catalog.regexp_split_to_table");
    expect(sql).toContain("access[_-]?token|api[_-]?key|key|token|signature|sig|auth");
    expect(sql).toContain("x[-_]?(amz|goog)");
    expect(sql).toContain("v_port_text::integer > 65535");
    expect(sql).toContain("non-canonical or invalid sourceUrl port");
    expect(sql).toContain("if tg_op = 'INSERT' then");
    expect(sql).toContain("evidence.evidence_key = pg_catalog.to_jsonb(new) ->> 'evidence_key'");
    expect(sql).toContain("link.ordinal = (pg_catalog.to_jsonb(new) ->> 'ordinal')::integer");
    expect(sql).toContain("pg_catalog.string_agg(catalog_artifact::text");
    expect(sql).toContain("verification' in ('unavailable', 'checked_empty')");
    expect(sql).toContain("absence evidence cannot be used as counter-evidence");
  });

  it("hashes and freezes the complete certified decision", () => {
    expect(sql).toContain("pg_catalog.to_jsonb(v_version)::text");
    expect(sql).toContain("--active-projection--");
    expect(sql).toContain("'payload', new.payload");
    expect(sql).toContain("'verdict', new.verdict");
    expect(sql).toContain("'score', new.score");
    expect(sql).toContain("prevent_certified_report_version_mutation");
    expect(sql).toContain("certified report version decision payload is immutable");
    expect(sql).toContain("prevent_certified_report_projection_mutation");
    expect(sql).toContain("certified active report projection is immutable");
  });

  it("allows only full-row idempotent retries and canonical artifacts", () => {
    expect(sql).toContain("pg_catalog.to_jsonb(evidence) - 'id' - 'captured_at'");
    expect(sql).toContain("pg_catalog.to_jsonb(link) - 'created_at'");
    expect(sql).toContain("certified lineage retry payload does not match the existing row");
    expect(sql).toContain("'catalogArtifact', normalized.catalog_artifact");
    expect(sql).toContain("evidence.excerpt is not distinct from artifact.item ->> 'excerpt'");
    expect(sql).toContain("evidence.source_url is not distinct from artifact.item ->> 'sourceUrl'");
    expect(sql).toContain("axis evidence catalog contains an invalid capturedAt timestamp");
  });

  it("binds and freezes the exact authoritative graph even through base activation", () => {
    expect(sql).toContain("prevent_certified_graph_mutation");
    expect(sql).toContain("argus.activating_graph_report_version");
    expect(sql).toContain("graph.nodes = v_version.payload #> '{graph,nodes}'");
    expect(sql).toContain("graph.edges = v_version.payload #> '{graph,edges}'");
    expect(sql).toContain("graph.contributor_user_id is not distinct from v_version.created_by");
    expect(sql).toContain("complete strict person report requires its exact authoritative graph");
  });

  it("builds the tenant-qualified evidence key inside a bounded Supabase-compatible transaction", () => {
    const schemaTransaction = sql.indexOf("\nbegin;\n\nset local");
    const boundedIndex = sql.indexOf("create unique index if not exists evidence_items_org_report_key_uidx");
    const attachConstraint = sql.indexOf("unique using index evidence_items_org_report_key_uidx");
    expect(sql).toContain("and not index_state.indisvalid");
    expect(sql).toContain("execute 'drop index public.evidence_items_org_report_key_uidx'");
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '120s'");
    expect(sql).not.toContain("create unique index concurrently");
    expect(schemaTransaction).toBeGreaterThan(-1);
    expect(boundedIndex).toBeGreaterThan(schemaTransaction);
    expect(attachConstraint).toBeGreaterThan(boundedIndex);
  });

  it("marks and independently guards the certified archive lifecycle", () => {
    expect(sql).toContain("manage_case_lifecycle_without_lineage_marker");
    expect(sql).toContain("argus.lifecycle_action");
    expect(sql).toContain("argus.lifecycle_subjects");
    expect(sql).toContain("membership.role = 'owner'");
    expect(sql).toContain("case_row.status = 'archived'");
    expect(sql).toContain("version_row.payload = old.payload");
  });
});
