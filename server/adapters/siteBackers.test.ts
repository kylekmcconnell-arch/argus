import { describe, expect, it } from "vitest";
import { collectSiteBackers, extractSiteBackers } from "./siteBackers";

const WALL = `
<html><body>
  <section><h2>Backed by the best in DeFi</h2>
    <div class="logos">
      <img src="/selini.svg" alt="Selini Capital">
      <img src="/robot.svg" alt="Robot Ventures">
      <img src="/framework.svg" alt="Framework Ventures">
      <img src="/ngc.svg" alt="NGC Ventures">
      <a href="https://faction.vc">Faction</a>
      <img src="/deco.svg" alt="logo">
      <img src="/bg.png" alt="background">
      <a href="/team">Learn more</a>
    </div>
  </section>
  <footer><a href="https://x.com/ammalgam">X</a></footer>
</body></html>`;

describe("extractSiteBackers", () => {
  it("reads backer names from the wall's image attributes and anchors, filtering decoration", () => {
    const section = extractSiteBackers(WALL);
    expect(section).not.toBeNull();
    expect(section!.heading.toLowerCase()).toContain("backed by");
    expect(section!.names).toEqual(["Selini Capital", "Robot Ventures", "Framework Ventures", "NGC Ventures", "Faction"]);
    expect(section!.excerpt).toContain("Selini Capital");
  });

  it("extracts nothing without a backers heading, and never from page-wide noise", () => {
    expect(extractSiteBackers("<html><body><img alt='Selini Capital'></body></html>")).toBeNull();
    expect(extractSiteBackers("<h2>Our product</h2><img alt='Robot Ventures'>")).toBeNull();
  });

  it("scopes extraction to the section window after the heading", () => {
    const farAway = `<h2>Backed by</h2>${"x".repeat(8000)}<img alt="Too Far Capital">`;
    expect(extractSiteBackers(farAway)).toBeNull();
  });
});

describe("collectSiteBackers", () => {
  const html = (body: string, url: string) => {
    const response = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };

  it("reads the wall from the official site with the exact page as the receipt", async () => {
    const fetcher = ((input: string | URL | Request) =>
      Promise.resolve(html(WALL, String(input)))) as unknown as typeof fetch;
    const outcome = await collectSiteBackers("https://ammalgam.xyz/", fetcher);
    expect(outcome.available).toBe(true);
    expect(outcome.value).toMatchObject({ sourceUrl: "https://ammalgam.xyz/" });
    expect(outcome.value!.names).toContain("Framework Ventures");
  });

  it("discards a wall served after a redirect off the controlled apex", async () => {
    const fetcher = ((input: string | URL | Request) => {
      void input;
      return Promise.resolve(html(WALL, "https://parking.example/lander"));
    }) as unknown as typeof fetch;
    const outcome = await collectSiteBackers("https://ammalgam.xyz/", fetcher);
    expect(outcome.available).toBe(false);
  });
});
