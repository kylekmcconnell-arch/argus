import { expect, it, vi } from "vitest";
import { collectPersonResearch, personResearchQuestions, researchExcerpt } from "./personResearch";
const member = { name: "Ada Example", role: "Founder", source: "team-page", linkedin: "https://linkedin.com/in/ada-example" };
it("researches name plus company without requiring or inventing an X handle", () => {
  const questions = personResearchQuestions(member, "Example Labs");
  expect(questions).toHaveLength(4);
  expect(questions[0].query).toContain('"Ada Example"');
  expect(questions[0].query).toContain('"Example Labs"');
});
it("stops spending on throttling and retains explicit failed coverage", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  const result = await collectPersonResearch(member, "Example Labs", "key", { fetch: fetcher, read: vi.fn() });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.searches[0].status).toBe("failed");
  expect(result.sources).toEqual([]);
});
it("does not claim a profile read from a LinkedIn search snippet", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ organic: [] })));
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ organic: [{ link: member.linkedin, title: "Possible namesake", snippet: "Former founder" }] })));
  const read = vi.fn();
  const result = await collectPersonResearch(member, "Example Labs", "key", { fetch: fetcher, read });
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0].access).toBe("search_snippet");
  expect(read).not.toHaveBeenCalled();
  expect(result.note).toContain("namesakes");
});
it("a malformed provider success is failed coverage, not searched empty", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  const result = await collectPersonResearch(member, "Example Labs", "key", { fetch: fetcher, read: vi.fn() });
  expect(result.searches[0].status).toBe("failed");
});

it("renders readable page excerpts near the person instead of HTML and scripts", () => {
  const text = researchExcerpt('<script>ignore this</script><style>hidden</style><nav>Menu</nav><p>Ada Example founded a company.</p>', "Ada Example");
  expect(text).toContain("Ada Example founded a company.");
  expect(text).not.toContain("<"); expect(text).not.toContain("ignore this");
});
