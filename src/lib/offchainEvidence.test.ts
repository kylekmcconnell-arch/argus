import { describe, expect, it, vi } from "vitest";
import {
  collectLegalCases,
  collectNews,
  collectOfacName,
  legalCaptionHasFullName,
  parseOfacPersonNames,
} from "./offchainEvidence";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

const validOfacCache = (...leading: string[]) => [
  ...leading,
  ...Array.from({ length: 5_000 - leading.length }, (_, index) => `test person ${index}`),
].join("\n");

describe("shared off-chain provider clients", () => {
  it("keeps a valid empty news feed distinct from malformed 200 XML", async () => {
    const empty = await collectNews("Kyle McConnell", "KyleKMcConnell", vi.fn().mockImplementation(() => Promise.resolve(
      new Response("<rss><channel></channel></rss>", { status: 200 }),
    )));
    expect(empty.status).toBe("succeeded");
    expect(empty.value).toMatchObject({ available: true, query: "Kyle McConnell", articles: [] });

    const malformed = await collectNews("Kyle McConnell", "", vi.fn().mockResolvedValue(
      new Response("upstream challenge page", { status: 200 }),
    ));
    expect(malformed.status).toBe("failed");
    expect(malformed.attempts).toContainEqual(expect.objectContaining({ detail: "response_xml_error" }));
    // The public payload stays backward compatible; core callers use status.
    expect(malformed.value).toMatchObject({ available: true, articles: [] });
  });

  it("parses exact-phrase news results and preserves the existing article shape", async () => {
    const rss = `<rss><channel><item>
      <title>Kyle McConnell launches Argus - Example News</title>
      <source>Example News</source>
      <link>https://example.com/argus</link>
      <pubDate>Sat, 11 Jul 2026 12:00:00 GMT</pubDate>
      <description>Kyle McConnell launches a web3 diligence product.</description>
    </item></channel></rss>`;
    const result = await collectNews("Kyle McConnell", "", vi.fn().mockResolvedValue(new Response(rss, { status: 200 })));

    expect(result.status).toBe("succeeded");
    expect(result.value.articles).toEqual([{
      title: "Kyle McConnell launches Argus",
      source: "Example News",
      url: "https://example.com/argus",
      publishedAt: Date.parse("Sat, 11 Jul 2026 12:00:00 GMT"),
    }]);
    expect(result.matches).toEqual({ "https://example.com/argus": "exact_name" });
  });

  it("tracks exact-name and exact-handle provenance outside the API payload", async () => {
    const fetcher = vi.fn().mockImplementation((input: string | URL | Request) => {
      const decoded = decodeURIComponent(String(input));
      const byHandle = decoded.includes('"KyleKMcConnell"');
      const subject = byHandle ? "KyleKMcConnell" : "Kyle McConnell";
      const slug = byHandle ? "handle" : "name";
      return Promise.resolve(new Response(`<rss><channel><item>
        <title>${subject} launches Argus - Example</title>
        <source>Example</source>
        <link>https://example.com/${slug}</link>
        <description>${subject} launches Argus.</description>
      </item></channel></rss>`, { status: 200 }));
    });

    const result = await collectNews("Kyle McConnell", "KyleKMcConnell", fetcher);

    expect(result.value.articles).toHaveLength(2);
    expect(result.matches).toEqual({
      "https://example.com/name": "exact_name",
      "https://example.com/handle": "exact_handle",
    });
    expect(Object.keys(result.value)).toEqual(["available", "query", "articles"]);
  });

  it("always completes both name and handle paths and rejects longer substring collisions", async () => {
    let call = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      call += 1;
      const items = call === 1
        ? Array.from({ length: 6 }, (_, index) => `<item><title>Kyle McConnell item ${index}</title><source>Example</source><link>https://example.com/name-${index}</link><description>Kyle McConnell</description></item>`).join("")
        : `<item><title>KyleKMcConnellScam is unrelated</title><source>Example</source><link>https://example.com/collision</link><description>KyleKMcConnellScam</description></item>
           <item><title>KyleKMcConnell launches ARGUS</title><source>Example</source><link>https://example.com/handle</link><description>KyleKMcConnell</description></item>`;
      return Promise.resolve(new Response(`<rss><channel>${items}</channel></rss>`, { status: 200 }));
    });

    const result = await collectNews("Kyle McConnell", "KyleKMcConnell", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.value.articles.some((article) => article.url === "https://example.com/handle")).toBe(true);
    expect(result.value.articles.some((article) => article.url === "https://example.com/collision")).toBe(false);
  });

  it("marks malformed CourtListener results unavailable without changing its public payload shape", async () => {
    const result = await collectLegalCases("Kyle McConnell", vi.fn().mockResolvedValue(json({ count: 3 })));

    expect(result.status).toBe("failed");
    expect(result.attempts).toContainEqual(expect.objectContaining({ detail: "result_shape_error" }));
    expect(result.value).toEqual({
      available: true,
      name: "Kyle McConnell",
      total: 3,
      cases: [],
      asParty: 0,
    });
  });

  it("keeps a full-name case caption that appears after the first eight search hits", async () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      caseName: index === 10 ? "Kyle McConnell" : `Unrelated Matter ${index}`,
      docket_absolute_url: `/docket/${index}/`,
    }));
    const result = await collectLegalCases("Kyle McConnell", vi.fn().mockResolvedValue(json({ count: 12, results })));

    expect(result.status).toBe("succeeded");
    expect(result.value.available && result.value.cases).toHaveLength(12);
    expect(result.value.available && result.value.cases.some((item) => item.caseName === "Kyle McConnell")).toBe(true);
  });

  it("marks truncated and count-inconsistent CourtListener pages incomplete", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ caseName: `Matter ${index}`, docket_absolute_url: `/docket/${index}/` }));
    const truncated = await collectLegalCases("Kyle McConnell", vi.fn().mockResolvedValue(json({ count: 21, next: "https://next", results: rows })));
    const inconsistent = await collectLegalCases("Kyle McConnell", vi.fn().mockResolvedValue(json({ count: 3, results: [] })));

    expect(truncated.status).toBe("partial");
    expect(truncated.attempts[0]?.detail).toBe("20_of_21_results");
    expect(inconsistent.status).toBe("failed");
    expect(inconsistent.attempts[0]?.detail).toBe("result_count_mismatch");
  });

  it("drops malformed captions and never treats a surname-only caption as the subject", async () => {
    const result = await collectLegalCases("Kyle McConnell", vi.fn().mockResolvedValue(json({
      count: 2,
      results: [
        { caseName: 123, docket_absolute_url: "/docket/bad/" },
        { caseName: "McConnell v. Example", docket_absolute_url: "/docket/surname/" },
      ],
    })));

    expect(result.status).toBe("partial");
    expect(result.value.available && result.value.cases).toEqual([
      expect.objectContaining({ caseName: "McConnell v. Example", nameInCase: false }),
    ]);
  });

  it("requires the full normalized name for an immutable legal lead", () => {
    expect(legalCaptionHasFullName("McConnell v. Example Labs", "Kyle McConnell")).toBe(false);
    expect(legalCaptionHasFullName("Kyle McConnell v. Example Labs", "Kyle McConnell")).toBe(true);
    expect(legalCaptionHasFullName("McConnell, Kyle v. Example Labs", "Kyle McConnell")).toBe(true);
  });

  it("parses person names and exact aliases from the OFAC mirror", async () => {
    const csv = [
      "id,schema,name,aliases",
      '1,"Person","Example Person","Person Example;E Person"',
      '2,"Organization","Example Person",""',
    ].join("\n");
    expect([...parseOfacPersonNames(csv)]).toEqual(expect.arrayContaining(["example person", "person example", "e person"]));

    const cache = { read: vi.fn().mockResolvedValue(validOfacCache("example person", "person example")), write: vi.fn() };
    const fetcher = vi.fn();
    const result = await collectOfacName("Person Example", { fetcher, cache });

    expect(result.status).toBe("succeeded");
    expect(result.value).toMatchObject({
      available: true,
      name: "Person Example",
      listSize: 5_000,
      sanctioned: true,
      list: "US Treasury OFAC SDN",
    });
    expect(result.indexHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an undersized cached and downloaded OFAC index instead of false-clearing", async () => {
    const cache = { read: vi.fn().mockResolvedValue("example person\nperson example"), write: vi.fn() };
    const fetcher = vi.fn().mockResolvedValue(new Response('id,schema,name,aliases\n1,"Person","Other Person",""', { status: 200 }));

    const result = await collectOfacName("Example Person", { fetcher, cache });

    expect(result.status).toBe("partial");
    expect(result.value).toMatchObject({ available: false });
    expect(result.attempts[0]?.detail).toBe("undersized_index_1");
    expect(cache.write).not.toHaveBeenCalled();
  });
});
