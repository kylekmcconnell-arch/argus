import { afterEach, describe, expect, it, vi } from "vitest";
import { teamDocumentUrlsFromIndex, teamMemberIsDirectlySupported } from "./teampage";

const structuredMock = vi.hoisted(() => vi.fn());

vi.mock("../agent", () => ({ structured: structuredMock }));
vi.mock("../cost", () => ({ recordCall: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  structuredMock.mockReset();
});

describe("official project team document discovery", () => {
  it("finds founder-bearing official docs while rejecting unrelated hosts", () => {
    const index = `
      - [Tokenomics](https://docs.jup.ag/user-docs/more/jup-token/tokenomics)
      - [API](https://developers.jup.ag/api-reference)
      - [Fake team](https://jup-team.example/team)
      <loc>https://discuss.jup.ag/t/flawed-governance/38575/6</loc>
    `;

    expect(teamDocumentUrlsFromIndex("jup.ag", index)).toEqual([
      "https://docs.jup.ag/user-docs/more/jup-token/tokenomics",
      "https://discuss.jup.ag/t/flawed-governance/38575/6",
    ]);
  });

  it("requires identity and founder language in the same passage", () => {
    const tokenomics = "Details are in this post from Meow, co-founder of Jupiter. Team vesting follows.";
    expect(teamMemberIsDirectlySupported(tokenomics, "Meow", "@weremeow", "co-founder")).toBe(true);

    const governance = "The core cofounders are me & Siong. He has been here since day one.";
    expect(teamMemberIsDirectlySupported(governance, "Siong", "@sssionggg", "cofounder")).toBe(true);

    const unrelated = `Meow spoke at the event. ${"shipping products ".repeat(40)} The founder was not named.`;
    expect(teamMemberIsDirectlySupported(unrelated, "Meow", "@weremeow", "co-founder")).toBe(false);
  });

  it("fetches an indexed official document and preserves its exact citation URL", async () => {
    const sourceUrl = "https://docs.jup.ag/user-docs/more/jup-token/tokenomics.md";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://docs.jup.ag/llms.txt") {
        return new Response(`- [Tokenomics](${sourceUrl}): allocation, vesting and founder context`, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (url === sourceUrl) {
        return new Response("# Tokenomics\n\nDetails are available in this post from Meow, co-founder of Jupiter.\n\n" + "Team vesting is disclosed onchain. ".repeat(20), {
          status: 200,
          headers: { "content-type": "text/markdown" },
        });
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }));
    structuredMock.mockResolvedValue({
      people: [{ name: "Meow", role: "co-founder", twitter: "@weremeow", source_url: sourceUrl }],
    });

    const { fetchTeamPage } = await import("./teampage");
    await expect(fetchTeamPage("jup.ag", "Jupiter")).resolves.toEqual([
      expect.objectContaining({
        name: "Meow",
        handle: "@weremeow",
        role: "co-founder",
        source: sourceUrl,
        sourceUrl,
      }),
    ]);
  });

  it("expands the roster only from forum posts authored by an already verified founder", async () => {
    const docsUrl = "https://docs.jup.ag/user-docs/more/jup-token/tokenomics.md";
    const forumUrl = "https://discuss.jup.ag/t/flawed-governance/38575/6";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://docs.jup.ag/llms.txt") {
        return new Response(`- [Tokenomics](${docsUrl})`, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url === docsUrl) {
        return new Response("# Tokenomics\n\nMeow, co-founder of Jupiter, describes the team vesting schedule.\n" + "Official project disclosure. ".repeat(20), {
          status: 200,
          headers: { "content-type": "text/markdown" },
        });
      }
      if (url === "https://discuss.jup.ag/search.json?q=cofounder") {
        return Response.json({
          posts: [
            { username: "meow", name: "meow", topic_id: 38575, post_number: 6 },
            { username: "random-user", name: "Random", topic_id: 999, post_number: 1 },
          ],
          topics: [
            { id: 38575, slug: "flawed-governance" },
            { id: 999, slug: "untrusted-founder-claim" },
          ],
        });
      }
      if (url === "https://discuss.jup.ag/search.json?q=co-founder") return Response.json({ posts: [], topics: [] });
      if (url === forumUrl) {
        return new Response("<html><body><h1>Flawed Governance</h1><p>meow writes: this is one of the core cofounders, along with me and Siong. He has been here since day one and built the core of Jupiter.</p>" + "<p>Official governance context.</p>".repeat(20) + "</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }));
    structuredMock
      .mockResolvedValueOnce({ people: [{ name: "Meow", role: "co-founder", twitter: "@weremeow", source_url: docsUrl }] })
      .mockResolvedValueOnce({ people: [{ name: "siong", role: "cofounder", twitter: "@sssionggg", source_url: forumUrl }] });

    const { fetchTeamPage } = await import("./teampage");
    const team = await fetchTeamPage("jup.ag", "Jupiter");
    expect(team).toEqual([
      expect.objectContaining({ name: "Meow", handle: "@weremeow", sourceUrl: docsUrl }),
      expect.objectContaining({ name: "Siong", handle: "@sssionggg", sourceUrl: forumUrl }),
    ]);
    expect(team.some((person) => person.name === "Random")).toBe(false);
  });

  it("rejects a team page whose redirect chain lands off the project's domain", async () => {
    const roster = `Founder Alice Example leads engineering and the core team. ${"Product protocol leadership. ".repeat(20)}`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://jup.ag/team") {
        // Simulate redirect:"follow" landing on an unrelated host: the body is a
        // convincing roster, but response.url reports the redirect target.
        const res = new Response(roster, { status: 200, headers: { "content-type": "text/plain" } });
        Object.defineProperty(res, "url", { value: "https://parked-lander.example/team" });
        return res;
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }));

    const { fetchTeamPage } = await import("./teampage");
    const team = await fetchTeamPage("jup.ag", "Jupiter");
    expect(team).toEqual([]);
    // The off-domain roster must never reach extraction as first-party content.
    expect(structuredMock).not.toHaveBeenCalled();
  });
});
