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

it("uses an already sourced prior venture to investigate outcomes within the four-query budget", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ organic: [] })));
  const result = await collectPersonResearch({ ...member, projects: [{ name: "Prior Labs" }], projects_evidence_origin: "deterministic" }, "Example Labs", "key", { fetch: fetcher, read: vi.fn() });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).q).toContain('"Prior Labs"');
  expect(result.plannedQuestions?.[1].reason).toContain("prior venture");
});
it("uses a credits lead to test advertised backing without claiming it proved deception", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ organic: [{ link: "https://example.com/credits", title: "Programme", snippet: "Cloud credits for startups" }] })));
  const result = await collectPersonResearch({ ...member, role: "Investor" }, "Example Labs", "key", { fetch: fetcher, read: vi.fn().mockResolvedValue({ status: "failed" }) });
  expect(fetcher).toHaveBeenCalledTimes(4); expect(result.plannedQuestions?.[3].question).toContain("Reconcile");
  expect(result.stopReason).toBe("completed_budget");
});
