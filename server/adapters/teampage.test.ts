import { afterEach, describe, expect, it, vi } from "vitest";
import { bindProfileAnchor, profileAnchors, teamDocumentUrlsFromIndex, teamMemberIsDirectlySupported } from "./teampage";

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

describe("profile anchors on a team page", () => {
  // The shape of the Orbit roster: each person's name wrapped in a link to
  // their LinkedIn. htmlToText deleted these hrefs before anything read them.
  const roster = `
    <div class="member">
      <h3>Niklas Homan</h3><p>Founder &amp; Chief Executive Officer</p>
      <a href="https://www.linkedin.com/in/niklas-homan/">LinkedIn</a>
    </div>
    <div class="member">
      <h3>Alexander Vermeulen</h3><p>Founder &amp; Chief Technology Officer</p>
      <a href="https://linkedin.com/in/avermeulen">Alexander Vermeulen</a>
      <a href="https://x.com/avermeulen">Twitter</a>
    </div>
    <div class="footer">
      <a href="https://www.linkedin.com/company/orbitgroup">Company page</a>
      <a href="https://x.com/orbitgroup_ai/status/123">Latest post</a>
    </div>`;

  it("reads profile links out of the markup and ignores company pages and status links", () => {
    const anchors = profileAnchors(roster);
    expect(anchors.map((a) => a.value)).toEqual([
      "linkedin.com/in/niklas-homan",
      "linkedin.com/in/avermeulen",
      "@avermeulen",
    ]);
    expect(anchors.some((a) => a.value.includes("company"))).toBe(false);
  });

  it("binds a profile by nearby position, by anchor text, and by slug", () => {
    const anchors = profileAnchors(roster);
    // Anchor text is just "LinkedIn", so this one binds by proximity.
    expect(bindProfileAnchor("Niklas Homan", roster, anchors, "linkedin"))
      .toBe("linkedin.com/in/niklas-homan");
    // Anchor text carries the full name.
    expect(bindProfileAnchor("Alexander Vermeulen", roster, anchors, "linkedin"))
      .toBe("linkedin.com/in/avermeulen");
    expect(bindProfileAnchor("Alexander Vermeulen", roster, anchors, "x"))
      .toBe("@avermeulen");
  });

  it("never attaches a profile to someone the page does not name", () => {
    const anchors = profileAnchors(roster);
    expect(bindProfileAnchor("Satoshi Nakamoto", roster, anchors, "linkedin")).toBeUndefined();
    // A single-token name is too weak to bind on.
    expect(bindProfileAnchor("Niklas", roster, anchors, "linkedin")).toBeUndefined();
  });
});
