import { afterEach, describe, expect, it, vi } from "vitest";
import { recordCall } from "../cost";
import {
  bindOfficialPortrait,
  bindProfileAnchor,
  officialPortraitAnchors,
  profileAnchors,
  teamDocumentUrlsFromIndex,
  teamMemberIsDirectlySupported,
} from "./teampage";

const structuredMock = vi.hoisted(() => vi.fn());

vi.mock("../agent", () => ({ structured: structuredMock }));
vi.mock("../cost", () => ({ recordCall: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  structuredMock.mockReset();
});

describe("official project team document discovery", () => {
  it("keeps Sergey Ilin's full biography while rejecting its organization sentence fragment as a person", async () => {
    const sourceUrl = "https://anyone.io/about-us";
    const exactBiography = "Founder: Bloxroute. Senior lead: Forte Group.";
    const html = `<html><body><section><h2>Our Advisors</h2><article><h3>Sergey Ilin</h3><p>${exactBiography}</p></article></section>${"Anyone Protocol advisor team. ".repeat(20)}</body></html>`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === sourceUrl) return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }));
    structuredMock.mockResolvedValue({
      people: [
        { name: "Sergey Ilin", role: "Advisor", biography: exactBiography, source_url: sourceUrl },
        { name: "Bloxroute. Senior", role: "Lead", source_url: sourceUrl },
        { name: "Forte Group", role: "Team", source_url: sourceUrl },
      ],
    });

    const { fetchTeamPage } = await import("./teampage");
    const team = await fetchTeamPage("anyone.io", "Anyone");

    expect(team).toEqual([
      expect.objectContaining({ name: "Sergey Ilin", role: "Advisor", biography: exactBiography }),
    ]);
    expect(team.some((person) => person.name === "Bloxroute. Senior" || person.name === "Forte Group")).toBe(false);
  });

  it("binds ANYONE-style first-party team and advisor portraits to the adjacent named person", async () => {
    const sourceUrl = "https://anyone.io/about-us";
    const html = `
      <html><body>
        <section><h2>Our Team</h2>
          <article class="team-card">
            <img class="team-image" src="https://cdn.prod.website-files.com/anyone/anna-beesoon.JPG" srcset="${"https://cdn.prod.website-files.com/anyone/anna-beesoon.JPG 1704w, ".repeat(12)}">
            <h3>Anna Beesoon</h3><p>Director of The Foundation for Anyone.</p>
          </article>
        </section>
        <section><h2>Our Advisors</h2>
          <article class="team-card">
            <img class="team-image" src="https://cdn.prod.website-files.com/anyone/advisor-1.png">
            <h3>Sean Carey</h3><p>Co-founder, Helium Systems.</p>
          </article>
        </section>
        ${"Anyone Protocol team and advisor evidence. ".repeat(12)}
      </body></html>
    `;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === sourceUrl) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }));
    structuredMock.mockResolvedValue({
      people: [
        { name: "Anna Beesoon", role: "Director", source_url: sourceUrl },
        { name: "Sean Carey", role: "Co-founder", source_url: sourceUrl },
      ],
    });

    const { fetchTeamPage } = await import("./teampage");
    const team = await fetchTeamPage("anyone.io", "Anyone");

    expect(team).toEqual([
      expect.objectContaining({
        name: "Anna Beesoon",
        officialPortraitUrl: "https://cdn.prod.website-files.com/anyone/anna-beesoon.JPG",
        officialPortraitSourceUrl: sourceUrl,
        officialPortraitCapturedAt: expect.any(String),
      }),
      expect.objectContaining({
        name: "Sean Carey",
        officialPortraitUrl: "https://cdn.prod.website-files.com/anyone/advisor-1.png",
        officialPortraitSourceUrl: sourceUrl,
        officialPortraitCapturedAt: expect.any(String),
      }),
    ]);
  });

  it("ignores decorative images and rejects a portrait that is not adjacent to the named person", () => {
    const html = `
      <img class="brand-logo" src="https://example.org/logo.png">
      <img class="team-image" src="https://cdn.example.org/alice.png">
      <h3>Alice Example</h3><p>Founder</p>
      ${"unrelated page copy ".repeat(180)}
      <h3>Bob Example</h3><p>Advisor</p>
    `;
    const portraits = officialPortraitAnchors(html, "https://example.org/team");
    expect(portraits).toHaveLength(1);
    expect(bindOfficialPortrait("Alice Example", html, portraits)).toBe("https://cdn.example.org/alice.png");
    expect(bindOfficialPortrait("Bob Example", html, portraits)).toBeUndefined();
  });

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

  it("recovers an official homepage credit after a direct 403", async () => {
    vi.mocked(recordCall).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    const recoverOfficialText = vi.fn(async (url: string) => url === "https://example.org/"
      ? {
          status: "ok" as const,
          url,
          host: "example.org",
          contentType: "text/plain",
          text: `Built by Alice Example. ${"official protocol product documentation. ".repeat(8)}`,
          contentHash: "recovered-hash",
          capturedAt: "2026-08-24T20:00:00.000Z",
          retrievalMethod: "reader_recovery" as const,
          retrievalProvider: "jina-reader" as const,
          retrievalUrl: `https://r.jina.ai/${url}`,
        }
      : { status: "failed" as const, reason: "reader_recovery_failed_http_404" });

    const { fetchTeamPage } = await import("./teampage");
    const team = await fetchTeamPage("example.org", "Example", { recoverOfficialText });

    expect(team).toEqual([
      expect.objectContaining({ name: "Alice Example", sourceUrl: "https://example.org/" }),
    ]);
    expect(recordCall).toHaveBeenCalledWith(
      "site-fetch",
      "site-credits",
      0,
      "reader_recovery_after_http_403",
      "succeeded",
    );
  });

  it("keeps the original failed outcome when official-site recovery also fails", async () => {
    vi.mocked(recordCall).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    const recoverOfficialText = vi.fn(async () => ({
      status: "failed" as const,
      reason: "reader_recovery_failed_http_403",
    }));

    const { fetchTeamPage } = await import("./teampage");
    await expect(fetchTeamPage("example.org", "Example", { recoverOfficialText })).resolves.toEqual([]);
    expect(recordCall).toHaveBeenCalledWith("site-fetch", "site-credits", 0, "http_403", "failed");
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
