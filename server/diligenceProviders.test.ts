import { expect, it, vi } from "vitest";
import { collectDiligenceProviders, parseDiligenceCandidates } from "./diligenceProviders";
const subject = { name: "Ada Example", company: "Example Labs", role: "CTO", publicNameEstablished: true };
const now = () => "2026-09-25T10:00:00Z";
it("does not issue requests without credentials", async () => {
  const fetcher = vi.fn(); const result = await collectDiligenceProviders(subject, { fetch: fetcher, keys: {}, now });
  expect(fetcher).not.toHaveBeenCalled(); expect(result.every(r => r.status === "not_configured" && r.calls === 0)).toBe(true);
});
it("does not search a pseudonym as a legal identity or spend on irrelevant academic research", async () => {
  const fetcher = vi.fn();
  const result = await collectDiligenceProviders({ ...subject, publicNameEstablished: false }, { fetch: fetcher, keys: { openalex: "secret", courtlistener: "token" }, now });
  expect(fetcher).not.toHaveBeenCalled(); expect(result.every(r => r.status === "not_applicable")).toBe(true);
});
it("uses fixed hosts, read-only endpoints, header credentials and no redirects or pagination", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ results: [] })));
  const result = await collectDiligenceProviders(subject, { fetch: fetcher, keys: { openalex: "secret", courtlistener: "token" }, now });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toContain("https://api.openalex.org/authors?");
  expect(fetcher.mock.calls[1][0]).toContain("https://www.courtlistener.com/api/rest/v4/search/?");
  for (const [url, init] of fetcher.mock.calls) { expect(url).not.toMatch(/secret|token/); expect(init.redirect).toBe("error"); expect(init.method ?? "GET").toBe("GET"); }
  expect(result.every(r => r.status === "empty" && r.contentHash?.length === 64)).toBe(true);
  expect(result[1].estimatedUsd).toBeNull();
  expect(result[1].note).toContain("not a clean-record");
});
it.each([401,403,429,500])("retains unavailable status on HTTP %s and never retries", async code => {
  const fetcher = vi.fn().mockResolvedValue(new Response("provider error", { status: code }));
  const result = await collectDiligenceProviders(subject, { fetch: fetcher, keys: { courtlistener: "secret" }, now });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(result[1].status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("secret");
});
it("does not accept malicious source URLs, non-JSON or malformed successes as measured empty", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ caseName: "Ada", absolute_url: "https://evil.test/opinion/123/x/" }] })));
  const result = await collectDiligenceProviders(subject, { fetch: fetcher, keys: { courtlistener: "secret" }, now });
  expect(result[1].status).toBe("unavailable"); expect(result[1].candidates).toEqual([]);
});
it("bounds response size and discards the error body", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("secret", { headers: { "content-length": "600000" } }));
  const result = await collectDiligenceProviders(subject, { fetch: fetcher, keys: { openalex: "secret" }, now });
  expect(result[0].status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("secret");
});
it("keeps useful author and case results explicitly unattributed", () => {
  expect(parseDiligenceCandidates("openalex", { results: [{ id: "https://openalex.org/A123", display_name: "Ada Example", last_known_institutions: [{ display_name: "Example University" }] }] })[0]).toMatchObject({ attribution: "unresolved", url: "https://openalex.org/authors/A123" });
  expect(parseDiligenceCandidates("courtlistener", { results: [{ absolute_url: "/docket/123/example/", caseName: "Example dispute", snippet: "<b>Potential</b> namesake" }] })[0]).toMatchObject({ attribution: "unresolved", title: "Example dispute" });
});
it("does not begin specialist calls after the collection deadline", async () => {
  const fetcher = vi.fn();
  const receipts = await collectDiligenceProviders({ ...subject, deadlineAt: 1 }, { fetch: fetcher, keys: { openalex: "key", courtlistener: "key" }, now });
  expect(fetcher).not.toHaveBeenCalled(); expect(receipts.every(r => r.calls === 0 && r.status === "unavailable")).toBe(true);
});
