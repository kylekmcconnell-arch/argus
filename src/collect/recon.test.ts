// Reproduces the miss against the real modules, with no network: a server
// rendered page whose socials are icon-only anchors reported "no social or
// community links found", because the only thing recon ever scanned was text
// that the tag strip had already thrown the hrefs out of.
import { describe, expect, it, vi } from "vitest";

import { analyzeContent } from "./recon";
import { scoreProject } from "./projectverdict";
import { extractLinks, visibleText, type Retrieval } from "./retrieve";

const ICON_FOOTER = `
  <footer>
    <a href="https://x.com/enigmafund" aria-label="X"><svg><path d="M1 1"/></svg></a>
    <a href="https://github.com/enigmafund" aria-label="GitHub"><svg><path d="M2 2"/></svg></a>
    <a href="https://www.linkedin.com/company/enigmafund" aria-label="LinkedIn"><svg><path d="M3 3"/></svg></a>
  </footer>`;

function fromHtml(html: string, over: Partial<Retrieval> = {}): Retrieval {
  return {
    url: "https://enigma.example",
    status: "rendered",
    content: visibleText(html),
    links: extractLinks(html),
    title: null,
    stages: [],
    coverageNote: "Retrieved directly; full page content available.",
    ...over,
  };
}

describe("social links on a server-rendered page", () => {
  it("finds the icon-only footer anchors that the text strip erased", () => {
    const html = `<h1>Enigma</h1><p>Settlement rails for institutions.</p>${ICON_FOOTER}`;
    const recon = analyzeContent(fromHtml(html));

    expect(recon.socials.map((s) => s.url)).toEqual([
      "https://x.com/enigmafund",
      "https://github.com/enigmafund",
      "https://www.linkedin.com/company/enigmafund",
    ]);
    expect(recon.findings.map((f) => f.claim)).not.toContain("No social or community links found in the rendered content.");
  });

  it("still reads socials written out in the text, with no anchors at all", () => {
    const recon = analyzeContent(fromHtml("", {
      content: "Follow us at https://x.com/enigmafund or join https://t.me/enigma. Handle: @enigmafund",
      links: undefined,
    }));

    const urls = recon.socials.map((s) => s.url);
    expect(urls).toContain("https://x.com/enigmafund");
    expect(urls).toContain("https://t.me/enigma");
  });

  it("counts a link found in both the text and the markup once", () => {
    const html = `<p>Follow us at https://x.com/enigmafund</p><a href="https://x.com/enigmafund/">X</a>`;
    const recon = analyzeContent(fromHtml(html));

    expect(recon.socials.filter((s) => /x\.com\/enigmafund/i.test(s.url))).toHaveLength(1);
  });

  it("does not report a share button as the project's own account", () => {
    const html = `
      <a href="https://x.com/intent/tweet?url=https://enigma.example">Share on X</a>
      <a href="https://www.linkedin.com/shareArticle?mini=true&amp;url=https://enigma.example">Share</a>
      <a href="https://t.me/share/url?url=https://enigma.example">Share</a>
      <a href="https://x.com/enigmafund">Follow</a>`;
    const recon = analyzeContent(fromHtml(html));

    expect(recon.socials.map((s) => s.url)).toEqual(["https://x.com/enigmafund"]);
  });

  it("does not let an anchor invent a team name or a funding claim", () => {
    // The anchor list feeds the social scan only. A slug is not prose, and must
    // never be read as a roster or a raise.
    const html = `<a href="https://x.com/Jane-Doe-Founder">x</a><a href="https://example.org/raised-25m-series-a-round">news</a>`;
    const recon = analyzeContent(fromHtml(html, { content: "A protocol." }));

    expect(recon.team.names).toEqual([]);
    expect(recon.funding).toEqual([]);
  });

  it("reads the markup without following any of it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      analyzeContent(fromHtml(`<p>Enigma</p>${ICON_FOOTER}`));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a coverage gap absolute: no anchors are claimed for a site never read", () => {
    const recon = analyzeContent({
      url: "https://enigma.example",
      status: "gap",
      content: "",
      title: null,
      stages: [],
      coverageNote: "Could not retrieve or render the site.",
    });

    expect(recon.socials).toEqual([]);
    expect(recon.team.state).toBe("not-retrieved");
  });
});

// 10xcapital.com saved recon V1: a fund page whose bios contain a Title-case
// desk phrase next to "Advisor" and affiliation @mentions (MBA @UNC, CEO
// @Kraken). The extractor treated those as a named individual and the
// project's socials, then minted 89 PASS from that junk.
const DESK_AND_MENTION_COPY = `
10X Capital is a next-generation merchant bank. Core Team.
Omar Al Yousuf
Senior Advisor
Emerging Markets Digital Assets Treasuries. Government Affairs & Defense @Siemens AG. Board Member @CoinW @Legend Technologies
Alex Monje
Partner, Chief Legal Officer
DWAC, GAMCO. Morgan Stanley. MBA @UNC. JD @University of Miami
Austin Alexander
Partner
Head of Bitcoin Strategy. Fmr. CEO @Kraken EMEA. Co-Founder @NY Bitcoin Center
`;

describe("site recon identity extract", () => {
  it("does not treat an org/desk phrase or bio @mentions as a named team that supports PASS", () => {
    const recon = analyzeContent({
      url: "https://10xcapital.com/",
      status: "recovered",
      content: DESK_AND_MENTION_COPY,
      title: "10X Capital",
      stages: [],
      coverageNote: "Direct retrieval failed; content recovered by rendering the JavaScript app.",
    });
    const verdict = scoreProject(recon);

    expect(recon.team.names).not.toContain("Emerging Markets Digital");
    expect(recon.team.names.join(" ")).not.toMatch(/Yousuf/);
    expect(recon.team.state).not.toBe("named");
    expect(recon.identityLine).not.toMatch(/Emerging Markets Digital/);

    const socialLabels = recon.socials.map((s) => s.label);
    for (const junk of ["@UNC", "@NY", "@University", "@Siemens", "@Kraken", "@CoinW", "@Legend"]) {
      expect(socialLabels).not.toContain(junk);
    }
    expect(recon.findings.some((f) => /social link/i.test(f.claim) && f.tone === "good")).toBe(false);

    expect(verdict.reasons.some((r) => r.tone === "good" && /Team identified/i.test(r.text))).toBe(false);
    expect(verdict.score).not.toBe(89);
    expect(verdict.score === null || verdict.score < 89).toBe(true);
  });

  it("still extracts a real person next to a role", () => {
    const recon = analyzeContent(fromHtml("", {
      content: "Jane Smith, Managing Partner leads the fund. Hans Thomas Founder & CEO since 1999.",
    }));

    expect(recon.team.state).toBe("named");
    expect(recon.team.names).toEqual(expect.arrayContaining(["Jane Smith", "Hans Thomas"]));
    expect(recon.team.names).not.toContain("Emerging Markets Digital");
  });

  it("still extracts real social URLs and a first-party framed handle", () => {
    const recon = analyzeContent({
      url: "https://10xcapital.com/",
      status: "rendered",
      content: "Follow us @10xcapital or https://x.com/10xcapital and https://t.me/10xcapital plus https://www.linkedin.com/company/10xcapital",
      links: undefined,
      title: "10X Capital",
      stages: [],
      coverageNote: "Retrieved directly; full page content available.",
    });

    const urls = recon.socials.map((s) => s.url);
    expect(urls).toContain("https://x.com/10xcapital");
    expect(urls).toContain("https://t.me/10xcapital");
    expect(urls).toContain("https://www.linkedin.com/company/10xcapital");
  });

  it("keeps a host-matching bare handle and drops an unframed mention", () => {
    const recon = analyzeContent({
      url: "https://10xcapital.com/",
      status: "rendered",
      content: "The desk. @10xcapital in the footer. Alumni @UNC and fmr CEO @Kraken.",
      title: "10X Capital",
      stages: [],
      coverageNote: "Retrieved directly; full page content available.",
    });

    expect(recon.socials.map((s) => s.label)).toEqual(["@10xcapital"]);
  });

  it("does not let a junk named extract mint the team score bonus", () => {
    const verdict = scoreProject({
      retrieval: {
        url: "https://10xcapital.com/",
        status: "recovered",
        content: DESK_AND_MENTION_COPY,
        title: "10X Capital",
        stages: [],
        coverageNote: "Direct retrieval failed; content recovered by rendering the JavaScript app.",
      },
      title: "10X Capital",
      team: { state: "named", names: ["Emerging Markets Digital"], note: "Names 1 individual with roles." },
      socials: [
        { label: "@UNC", url: "https://x.com/UNC" },
        { label: "@NY", url: "https://x.com/NY" },
      ],
      funding: [],
      tokenSignals: [],
      findings: [],
      identityLine: "Team identified: Emerging Markets Digital.",
    });

    expect(verdict.reasons.some((r) => /Team identified: Emerging Markets Digital/i.test(r.text))).toBe(false);
    expect(verdict.score).toBeLessThan(89);
  });
});
