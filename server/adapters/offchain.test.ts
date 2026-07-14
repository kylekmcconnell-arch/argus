import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import type { CheckObservation, CollectContext } from "./types";
import { offchainAdapter, refreshResolvedNameOffchain, resolvedOffchainName } from "./offchain";

const { collectProfilePhoto } = vi.hoisted(() => ({ collectProfilePhoto: vi.fn() }));
vi.mock("./profilePhoto", () => ({ collectProfilePhoto }));

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

const rss = `<rss><channel><item>
  <title>Kyle McConnell launches Argus - Example News</title>
  <source>Example News</source>
  <link>https://example.com/argus</link>
  <pubDate>Sat, 11 Jul 2026 12:00:00 GMT</pubDate>
  <description>Kyle McConnell launches a web3 diligence product.</description>
</item></channel></rss>`;

const validOfacCsv = () => [
  "id,schema,name,aliases",
  ...Array.from({ length: 5_000 }, (_, index) => `${index},"Person","Test Person ${index}",""`),
].join("\n");

function context(): { ctx: CollectContext; checks: CheckObservation[] } {
  const evidence = emptyEvidence("@KyleKMcConnell");
  evidence.profile.display_name = "Kyle McConnell";
  evidence.profile.identity_confidence = "Confirmed";
  evidence.roles = ["FOUNDER" as never];
  const checks: CheckObservation[] = [];
  return {
    checks,
    ctx: {
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: (observation) => checks.push(observation),
    },
  };
}

describe("frozen off-chain diligence adapter", () => {
  beforeEach(() => {
    collectProfilePhoto.mockReset().mockResolvedValue({ status: "succeeded", detail: "profile screen complete" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("freezes news, full-name legal, and no-match OFAC artifacts before scoring", async () => {
    const fetcher = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) return Promise.resolve(new Response(rss, { status: 200 }));
      if (url.startsWith("https://www.courtlistener.com/")) {
        return Promise.resolve(json({
          count: 2,
          results: [
            { caseName: "Kyle McConnell v. Example Labs", court: "D. Example", dateFiled: "2026-06-01", docketNumber: "1:26-cv-1", docket_absolute_url: "/docket/1/example/" },
            { caseName: "McConnell v. Unrelated", court: "D. Other", docket_absolute_url: "/docket/2/unrelated/" },
          ],
        }));
      }
      if (url.startsWith("https://data.opensanctions.org/")) {
        return Promise.resolve(new Response(validOfacCsv(), { status: 200 }));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const { ctx, checks } = context();

    const result = await offchainAdapter.run(ctx);

    expect(result).toMatchObject({ state: "executed" });
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "news-press", status: "confirmed", sourceCount: 1 }),
      expect.objectContaining({ id: "us-legal-history", status: "finding", sourceCount: 1 }),
      expect.objectContaining({ id: "ofac-sanctions-name", status: "checked-empty" }),
    ]));
    expect(ctx.evidence.sourceArtifacts).toHaveLength(3);
    expect(ctx.evidence.sourceArtifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.contentHash))).toBe(true);
    expect(ctx.evidence.sourceArtifacts.filter((artifact) => artifact.kind === "legal_case")).toHaveLength(1);
    expect(ctx.evidence.sourceArtifacts.find((artifact) => artifact.kind === "sanctions_screen")?.sourceContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ctx.evidence.findings).toContainEqual(expect.objectContaining({
      finding_type: "LegalCaseNameLead",
      claim: expect.stringContaining("verify that the named party"),
      source_url: "https://www.courtlistener.com/docket/1/example/",
    }));
  });

  it("never turns malformed 200 responses into clean outcomes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) return Promise.resolve(new Response("challenge", { status: 200 }));
      if (url.startsWith("https://www.courtlistener.com/")) return Promise.resolve(json({ count: 2 }));
      if (url.startsWith("https://data.opensanctions.org/")) return Promise.resolve(new Response("unavailable", { status: 503 }));
      throw new Error(`unexpected URL ${url}`);
    }));
    const { ctx, checks } = context();

    const result = await offchainAdapter.run(ctx);

    expect(result).toMatchObject({ state: "partial" });
    expect(checks.filter((check) => check.status === "unavailable").map((check) => check.id).sort()).toEqual([
      "news-press",
      "ofac-sanctions-name",
      "us-legal-history",
    ]);
    expect(ctx.evidence.sourceArtifacts).toEqual([]);
    expect(ctx.evidence.findings).toEqual([]);
  });

  it("keeps artifacts but does not complete news coverage when one exact path fails", async () => {
    let newsCalls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) {
        newsCalls += 1;
        return Promise.resolve(newsCalls === 1
          ? new Response(rss, { status: 200 })
          : new Response("unavailable", { status: 503 }));
      }
      if (url.startsWith("https://www.courtlistener.com/")) return Promise.resolve(json({ count: 0, results: [] }));
      if (url.startsWith("https://data.opensanctions.org/")) {
        return Promise.resolve(new Response(validOfacCsv(), { status: 200 }));
      }
      throw new Error(`unexpected URL ${url}`);
    }));
    const { ctx, checks } = context();

    const result = await offchainAdapter.run(ctx);

    expect(result).toMatchObject({ state: "partial" });
    expect(checks).toContainEqual(expect.objectContaining({ id: "news-press", status: "unavailable" }));
    expect(ctx.evidence.sourceArtifacts).toContainEqual(expect.objectContaining({ kind: "press", sourceUrl: "https://example.com/argus" }));
  });

  it("prefers a PDL-resolved name while preserving the public display name", async () => {
    const { ctx, checks } = context();
    ctx.evidence.profile.display_name = "Anon Builder";
    ctx.evidence.profile.resolved_name = "Kyle McConnell";
    ctx.evidence.profile.identity_confidence = "Probable";
    const fetcher = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) return Promise.resolve(new Response("<rss><channel></channel></rss>", { status: 200 }));
      if (url.startsWith("https://www.courtlistener.com/")) return Promise.resolve(json({ count: 0, results: [] }));
      if (url.startsWith("https://data.opensanctions.org/")) {
        return Promise.resolve(new Response(validOfacCsv(), { status: 200 }));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);

    await offchainAdapter.run(ctx);

    expect(ctx.evidence.profile.display_name).toBe("Anon Builder");
    expect(checks.map((check) => check.id)).toEqual(expect.arrayContaining(["us-legal-history", "ofac-sanctions-name"]));
    expect(fetcher.mock.calls.some(([input]) => decodeURIComponent(String(input)).includes('"Kyle McConnell" (crypto'))).toBe(true);
    expect(fetcher.mock.calls.some(([input]) => decodeURIComponent(String(input)).includes('"Kyle McConnell"'))).toBe(true);
  });

  it("keeps legal and OFAC out of scope when no real person is resolved", async () => {
    const { ctx, checks } = context();
    ctx.evidence.profile.display_name = "anon";
    ctx.evidence.profile.identity_confidence = "Unverified";
    const fetcher = vi.fn().mockResolvedValue(new Response("<rss><channel></channel></rss>", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const result = await offchainAdapter.run(ctx);

    expect(result).toMatchObject({ state: "executed" });
    expect(checks.map((check) => check.id)).toEqual(["news-press"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps a Stani-only news miss provisional until the full handle-shaped identity is resolved", async () => {
    const { ctx, checks } = context();
    ctx.handle = "@StaniKulechov";
    ctx.evidence.profile.handle = "@StaniKulechov";
    ctx.evidence.profile.display_name = "Stani";
    ctx.evidence.profile.resolved_name = "Stani";
    ctx.evidence.profile.identity_confidence = "Confirmed";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<rss><channel></channel></rss>", { status: 200 }),
    ));

    await offchainAdapter.run(ctx);

    expect(resolvedOffchainName(ctx)).toBeNull();
    expect(checks).toEqual([
      expect.objectContaining({
        id: "news-press",
        status: "unavailable",
        note: expect.stringContaining("verified full-name search is still required"),
      }),
    ]);
  });

  it("refreshes news, legal, and OFAC after Basic Facts resolves a full name without rerunning the photo screen", async () => {
    const staniRss = `<rss><channel><item>
      <title>Stani Kulechov founded Aave - Example News</title>
      <source>Example News</source>
      <link>https://example.com/stani-aave</link>
      <pubDate>Mon, 13 Jul 2026 12:00:00 GMT</pubDate>
      <description>Stani Kulechov is the founder of the Aave Protocol.</description>
    </item></channel></rss>`;
    const fetcher = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) return Promise.resolve(new Response(staniRss, { status: 200 }));
      if (url.startsWith("https://www.courtlistener.com/")) return Promise.resolve(json({ count: 0, results: [] }));
      if (url.startsWith("https://data.opensanctions.org/")) {
        return Promise.resolve(new Response(validOfacCsv(), { status: 200 }));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const { ctx, checks } = context();
    ctx.handle = "@StaniKulechov";
    ctx.evidence.profile.handle = "@StaniKulechov";
    ctx.evidence.profile.display_name = "Stani";
    ctx.evidence.profile.resolved_name = "Stani Kulechov";
    ctx.evidence.profile.identity_confidence = "Probable";
    collectProfilePhoto.mockClear();

    const result = await refreshResolvedNameOffchain(ctx);

    expect(result).toMatchObject({ state: "executed", detail: expect.stringContaining("Stani Kulechov") });
    expect(collectProfilePhoto).not.toHaveBeenCalled();
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "news-press", status: "confirmed", sourceCount: 1 }),
      expect.objectContaining({ id: "us-legal-history", status: "checked-empty" }),
      expect.objectContaining({ id: "ofac-sanctions-name", status: "checked-empty" }),
    ]));
    expect(fetcher.mock.calls.some(([input]) => decodeURIComponent(String(input)).includes('"Stani Kulechov"'))).toBe(true);
    expect(ctx.evidence.sourceArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "press", sourceUrl: "https://example.com/stani-aave" }),
      expect.objectContaining({ kind: "sanctions_screen" }),
    ]));
  });

  it("does not treat a two-word pseudonym as a resolved legal identity", async () => {
    const { ctx, checks } = context();
    ctx.evidence.profile.display_name = "Anon Builder";
    ctx.evidence.profile.identity_confidence = "Probable";
    const fetcher = vi.fn().mockResolvedValue(new Response("<rss><channel></channel></rss>", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await offchainAdapter.run(ctx);

    expect(checks.map((check) => check.id)).toEqual(["news-press"]);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("courtlistener"))).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("opensanctions"))).toBe(false);
  });

  it("freezes inspectable legal leads but keeps coverage incomplete for a partial page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) return Promise.resolve(new Response("<rss><channel></channel></rss>", { status: 200 }));
      if (url.startsWith("https://www.courtlistener.com/")) return Promise.resolve(json({
        count: 2,
        next: "https://next",
        results: [{ caseName: "Kyle McConnell v. Example", docket_absolute_url: "/docket/1/" }],
      }));
      if (url.startsWith("https://data.opensanctions.org/")) return Promise.resolve(new Response(validOfacCsv(), { status: 200 }));
      throw new Error(`unexpected URL ${url}`);
    }));
    const { ctx, checks } = context();

    const result = await offchainAdapter.run(ctx);

    expect(result).toMatchObject({ state: "partial" });
    expect(checks).toContainEqual(expect.objectContaining({ id: "us-legal-history", status: "unavailable", sourceCount: 1 }));
    expect(ctx.evidence.sourceArtifacts).toContainEqual(expect.objectContaining({ kind: "legal_case" }));
  });

  it("does not complete a legal finding that has no inspectable docket URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/")) return Promise.resolve(new Response("<rss><channel></channel></rss>", { status: 200 }));
      if (url.startsWith("https://www.courtlistener.com/")) return Promise.resolve(json({ count: 1, results: [{ caseName: "Kyle McConnell" }] }));
      if (url.startsWith("https://data.opensanctions.org/")) return Promise.resolve(new Response(validOfacCsv(), { status: 200 }));
      throw new Error(`unexpected URL ${url}`);
    }));
    const { ctx, checks } = context();

    await offchainAdapter.run(ctx);

    expect(checks).toContainEqual(expect.objectContaining({ id: "us-legal-history", status: "unavailable", sourceCount: 0 }));
    expect(ctx.evidence.sourceArtifacts.some((artifact) => artifact.kind === "legal_case")).toBe(false);
    expect(ctx.evidence.findings.some((finding) => finding.finding_type === "LegalCaseNameLead")).toBe(false);
  });
});
