import { afterEach, describe, expect, it, vi } from "vitest";
import { persistProvenance } from "./_provenance";

describe("frozen source artifact provenance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
});
