// visibleText() deletes every tag, and an href only ever lives inside a tag. A
// footer of icon-only anchors therefore leaves NOTHING behind: the links are not
// absent from the page, they are invisible to everything downstream of the strip.
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractLinks, retrieveSite, visibleText } from "./retrieve";

const ICON_FOOTER = `
  <footer>
    <a href="https://x.com/enigmafund" aria-label="X"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></a>
    <a href="https://github.com/enigmafund" aria-label="GitHub"><svg><path d="M2 2"/></svg></a>
    <a href='https://www.linkedin.com/company/enigmafund' aria-label="LinkedIn"><svg><path d="M3 3"/></svg></a>
  </footer>`;

describe("anchor extraction", () => {
  it("keeps the hrefs of an icon-only footer that visibleText erases", () => {
    const text = visibleText(ICON_FOOTER);
    expect(text).not.toContain("x.com");
    expect(text).not.toContain("linkedin");

    expect(extractLinks(ICON_FOOTER)).toEqual([
      "https://x.com/enigmafund",
      "https://github.com/enigmafund",
      "https://www.linkedin.com/company/enigmafund",
    ]);
  });

  it("skips script bodies, in-page anchors, mailto and tel", () => {
    const html = `
      <script>const t = '<a href="https://x.com/from-a-bundle">x</a>';</script>
      <a href="#top">Top</a>
      <a href="mailto:hi@example.org">Mail us</a>
      <a href="tel:+15550000">Call</a>
      <a href="/about">About</a>`;
    expect(extractLinks(html)).toEqual(["/about"]);
  });

  it("decodes escaped ampersands and keeps each href once", () => {
    const html = `<a href="https://x.com/a?ref=1&amp;src=2">one</a><a href="https://x.com/a?ref=1&amp;src=2">again</a>`;
    expect(extractLinks(html)).toEqual(["https://x.com/a?ref=1&src=2"]);
  });

  it("is bounded so a link farm cannot balloon a stored retrieval", () => {
    const html = Array.from({ length: 500 }, (_, i) => `<a href="/p/${i}">p</a>`).join("");
    expect(extractLinks(html).length).toBeLessThanOrEqual(300);
  });

  it("does not read a href out of a data attribute", () => {
    expect(extractLinks(`<a data-href="https://x.com/nope">x</a>`)).toEqual([]);
  });
});

describe("retrieveSite link preservation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carries the anchors of a server-rendered page alongside the stripped text", async () => {
    const body = `<html><head><title>Enigma</title></head><body><p>${"Enigma builds settlement rails. ".repeat(20)}</p>${ICON_FOOTER}</body></html>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })));

    const retrieval = await retrieveSite("enigma.example");

    expect(retrieval.status).toBe("rendered");
    expect(retrieval.content).not.toContain("x.com");
    expect(retrieval.links).toContain("https://x.com/enigmafund");
    expect(retrieval.links).toContain("https://github.com/enigmafund");
  });

  it("leaves links undefined on a coverage gap, because nothing was read to extract from", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("blocked"); }));

    const retrieval = await retrieveSite("enigma.example");

    expect(retrieval.status).toBe("gap");
    expect(retrieval.links).toBeUndefined();
  });
});
