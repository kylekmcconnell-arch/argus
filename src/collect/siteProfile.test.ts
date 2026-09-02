// The usefulness contract for a pasted URL: what this is, whether it is live,
// which accounts are the project's own, who is actually named, and the one next
// step the page binds. Every fixture is content ARGUS would hold after
// retrieval; nothing is fetched.
import { describe, expect, it, vi } from "vitest";

import { analyzeContent, profileOf, runRecon, type Recon } from "./recon";
import { scoreProject } from "./projectverdict";
import { classifyAccountUrl, selfDescribesAsFund } from "./siteProfile";
import { extractLinks, metaDescription, visibleText, type Retrieval } from "./retrieve";

const crawlerRead = (url: string, content: string, title: string | null, direct: "blocked" | "spa-stub" = "blocked"): Retrieval => ({
  url, status: "recovered", content, title,
  stages: [
    { method: "direct fetch", outcome: direct, chars: 0, note: "" },
    { method: "rendering crawler", outcome: "ok", chars: content.length, note: "" },
  ],
  coverageNote: "recovered",
});

// The real shape of a fund homepage through the rendering crawler: a long
// og:title, a self-description heading, a card grid with bio @mentions, a
// "founded by" prose line, and no social links anywhere.
const FUND_MARKDOWN = `
![Image 1: logo](https://10xcapital.com/images/logo-white.png)

### The Future of Capital is Digital

## 10X Capital is a next-generation merchant bank, where Wall Street meets Silicon Valley. Thematically focused on digital transformation, we bring institutional capital to exceptional opportunities through our funds, portfolio companies, treasury business, and our affiliated investment bank.

[Learn More](https://10xcapital.com/#about)

## Core Team

*   #### [Hans Thomas](http://www.hansthomas.com/)

Founder & CEO

Entrepreneur, & Investor in Tech & Digital Assets since 1999.

*   #### Alex Monje

Partner, Chief Legal Officer

DWAC($DJT), GAMCO. Morgan Stanley. MBA @UNC. JD @University of Miami

*   #### Austin Alexander

Partner

Head of Bitcoin Strategy. Fmr. CEO @Kraken EMEA. Co-Founder @NY Bitcoin Center

*   #### Omar Al Yousuf

Senior Advisor

Emerging Markets Digital Assets Treasuries. Government Affairs & Defense @Siemens AG. Board Member @CoinW @Legend Technologies

### [**Mission** Statement](https://10xcapital.com/)

10X Capital is a next-generation investment firm focused on digital transformation. Founded by pioneering digital currency and fintech entrepreneur Hans Thomas (founding team, InternetCash), 10X brings institutional capital to exceptional opportunities worldwide.
`;
const FUND_TITLE = "Alternative Asset Management firm providing institutional investors with access to best of breed strategies across multiple asset classes. Hans Thomas. Russell Read. Max Staedtler. Alex Monje. Guhan Kandasamy.";

describe("a fund-like page (10xcapital shape)", () => {
  const recon = analyzeContent(crawlerRead("https://10xcapital.com/", FUND_MARKDOWN, FUND_TITLE));
  const profile = recon.profile!;
  const verdict = scoreProject(recon);

  it("says what it is, in the site's own words", () => {
    expect(profile.kind).toBe("fund");
    expect(profile.brand).toBe("10X Capital");
    expect(profile.selfDescription).toBe("10X Capital is a next-generation merchant bank, where Wall Street meets Silicon Valley.");
    expect(profile.summary).toBe("10X Capital says it is a fund / investment firm: “10X Capital is a next-generation merchant bank, where Wall Street meets Silicon Valley.”");
    expect(profile.kindEvidence).toMatch(/merchant bank/);
    expect(recon.isFund).toBe(true);
  });

  it("says how it was read: live, direct fetch blocked, crawler read (not 'a JavaScript app')", () => {
    expect(profile.availability).toBe("crawler-read");
    expect(profile.availabilityNote).toMatch(/direct fetch was blocked/i);
    expect(profile.availabilityNote).not.toMatch(/javascript app/i);
  });

  it("names the real principals with roles and does not invent any", () => {
    expect(recon.team.state).toBe("named");
    expect(recon.team.people?.map((p) => [p.name, p.role])).toEqual([
      ["Hans Thomas", "Founder & CEO"],
      ["Alex Monje", "Partner, Chief Legal Officer"],
      ["Austin Alexander", "Partner"],
      ["Omar Al Yousuf", "Senior Advisor"],
    ]);
    expect(recon.team.people?.[0].link).toBe("http://www.hansthomas.com/");
    // Title-listed names with no role on the page are not promoted.
    expect(recon.team.names).not.toContain("Russell Read");
    expect(recon.team.names).not.toContain("Emerging Markets Digital");
    expect(recon.identityLine).toBe("Team identified on the site: Hans Thomas (Founder & CEO), Alex Monje (Partner, Chief Legal Officer), Austin Alexander (Partner), Omar Al Yousuf (Senior Advisor).");
  });

  it("reports no official accounts rather than mention soup, and offers no unbound next step", () => {
    expect(recon.socials).toEqual([]);
    expect(profile.officialAccounts).toEqual([]);
    expect(profile.linkedAccounts).toEqual([]);
    expect(profile.nextStep.kind).toBe("none");
    expect(profile.nextStep.reason).toMatch(/No official X account is linked/);
    expect(recon.findings.map((f) => f.claim)).toContain("No official X, Telegram, Discord, GitHub, or LinkedIn account is linked on the rendered page.");
  });

  it("scores the real team, not junk, and is never reality-checked as a token", () => {
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.reasons.some((r) => r.tone === "good" && /Team identified on the site: Hans Thomas \(Founder & CEO\)/.test(r.text))).toBe(true);
    expect(verdict.reasons.some((r) => /not reality-checked as a token/.test(r.text))).toBe(true);
    expect(verdict.reasons.some((r) => /Emerging Markets Digital|@UNC|@Kraken/.test(r.text))).toBe(false);
  });

  it("does not launch the on-chain pivot for a fund", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith("https://r.jina.ai/")) return new Response(`Title: ${FUND_TITLE}\nURL Source: https://10xcapital.com/\nMarkdown Content:\n${FUND_MARKDOWN}`, { status: 200 });
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const live = await runRecon("10xcapital.com");
      expect(live.profile?.kind).toBe("fund");
      expect(live.pivot).toBeUndefined();
      expect(live.retrieval.coverageNote).toMatch(/blocked/);
      expect(fetchMock.mock.calls.every(([input]) => /10xcapital\.com|r\.jina\.ai/.test(String(input)))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const TOKEN_MARKDOWN = `
# Nebula Protocol

Nebula Protocol is a decentralized perpetuals exchange on Solana. Trade with up to 50x leverage.

[Launch App](https://app.nebula.xyz) [Docs](https://docs.nebula.xyz)

## $NEB Tokenomics
Total supply: 1,000,000,000 NEB. Airdrop for early traders. Staking live.

## Team
#### Priya Raman
Co-Founder & CEO
Former quant at Jump. [LinkedIn](https://www.linkedin.com/in/priyaraman)

#### Diego Alvarez
CTO
Ex-Solana Labs.

Backed by leading venture capital firms.

Follow us on [X](https://x.com/nebulaprotocol) · [Telegram](https://t.me/nebulaprotocol) · [Discord](https://discord.gg/nebula) · [GitHub](https://github.com/nebula-protocol/contracts)
Our partner: [Jump](https://x.com/jumptrading)
`;

describe("a token-project site with a real x.com link and a named founder", () => {
  const recon = analyzeContent(crawlerRead("https://nebula.xyz/", TOKEN_MARKDOWN, "Nebula Protocol", "spa-stub"));
  const profile = recon.profile!;

  it("is a token project, not a fund, despite the 'backed by venture capital' line", () => {
    expect(recon.isFund).toBe(false);
    expect(profile.kind).toBe("token-project");
    expect(profile.availability).toBe("js-app");
    expect(profile.selfDescription).toBe("Nebula Protocol is a decentralized perpetuals exchange on Solana.");
  });

  it("surfaces both the founder with her role and the official X account", () => {
    expect(recon.team.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Priya Raman", role: "Co-Founder & CEO", link: "https://www.linkedin.com/in/priyaraman" }),
      expect.objectContaining({ name: "Diego Alvarez", role: "CTO" }),
    ]));
    expect(profile.officialAccounts.map((a) => [a.label, a.basis])).toEqual([
      ["@nebulaprotocol", "host-match"],
      ["Telegram · nebulaprotocol", "host-match"],
      ["Discord invite", "sole-link"],
      ["GitHub · nebula-protocol", "host-match"],
    ]);
  });

  it("separates a partner's account and a person's profile from the project's own", () => {
    expect(profile.linkedAccounts.map((a) => [a.label, a.basis])).toEqual([
      ["LinkedIn · priyaraman", "person-profile"],
      ["@jumptrading", "linked"],
    ]);
  });

  it("binds the next step to the official handle on the page", () => {
    expect(profile.nextStep).toEqual(expect.objectContaining({ kind: "handle", ref: "@nebulaprotocol", label: "Run full ARGUS on @nebulaprotocol" }));
  });
});

describe("pages that are not a project", () => {
  it("reports a parked domain as parked and caps it out of PASS", () => {
    const html = `<html><head><title>nebulafi.io</title></head><body><h1>nebulafi.io</h1><p>This domain is for sale! Buy this domain today. Related searches: crypto, finance, loans. 2025 Copyright. All Rights Reserved. The Sponsored Listings displayed above are served automatically by a third party. Privacy Policy</p></body></html>`;
    const recon = analyzeContent({
      url: "https://nebulafi.io/", status: "rendered", content: visibleText(html), links: extractLinks(html), description: metaDescription(html), title: "nebulafi.io",
      stages: [{ method: "direct fetch", outcome: "ok", chars: 300, note: "" }], coverageNote: "direct",
    });
    const verdict = scoreProject(recon);

    expect(recon.profile?.kind).toBe("parked");
    expect(recon.profile?.availability).toBe("parked");
    expect(recon.profile?.summary).toMatch(/parked domain/);
    expect(recon.team.names).toEqual([]);
    expect(recon.socials).toEqual([]);
    expect(recon.profile?.nextStep.kind).toBe("none");
    expect(verdict.verdict).toBe("CAUTION");
    expect(verdict.score).toBeLessThanOrEqual(40);
    expect(verdict.capApplied).toBe("parked_domain");
    expect(recon.findings.some((f) => /no team or leadership section/i.test(f.claim))).toBe(false);
  });

  it("reports a bot-protection challenge as blocked and issues no content verdict", () => {
    const wall = "Just a moment...\nEnable JavaScript and cookies to continue\nVerifying you are human. This may take a few seconds.\nsomeproject.io needs to review the security of your connection before proceeding.\nRay ID: 8a1b2c3d4e5f6789 Performance & security by Cloudflare";
    const recon = analyzeContent(crawlerRead("https://someproject.io/", wall, "Just a moment..."));
    const verdict = scoreProject(recon);

    expect(recon.profile?.kind).toBe("blocked");
    expect(recon.profile?.availability).toBe("blocked");
    expect(recon.team.state).toBe("not-retrieved");
    expect(verdict.verdict).toBe("INCOMPLETE");
    expect(verdict.score).toBeNull();
    expect(verdict.capApplied).toBe("bot_wall");
    expect(recon.profile?.nextStep.kind).toBe("none");
  });

  it("reports a coming-soon placeholder as one, but still binds a host-matching handle it links", () => {
    const recon = analyzeContent({
      url: "https://zephyrlabs.xyz/", status: "rendered", title: "Zephyr Labs",
      content: "Zephyr Labs\nSomething big is coming. Coming soon.\nBe the first to know. Enter your email.\nFollow us on X: https://x.com/zephyrlabs",
      stages: [{ method: "direct fetch", outcome: "ok", chars: 100, note: "" }], coverageNote: "direct",
    });
    const verdict = scoreProject(recon);

    expect(recon.profile?.kind).toBe("coming-soon");
    expect(recon.profile?.officialAccounts.map((a) => a.label)).toEqual(["@zephyrlabs"]);
    expect(recon.profile?.nextStep).toEqual(expect.objectContaining({ kind: "handle", ref: "@zephyrlabs" }));
    expect(verdict.verdict).toBe("CAUTION");
    expect(verdict.capApplied).toBe("coming_soon");
  });

  it("does not mint a confident PASS from a page with no identity signals at all", () => {
    const recon = analyzeContent({
      url: "https://mystery.xyz/", status: "rendered", title: "Mystery",
      content: "Welcome\nThe future of finance.\nBuilt different.\nJoin the waitlist. " + "Lorem ipsum dolor sit amet consectetur. ".repeat(20),
      stages: [{ method: "direct fetch", outcome: "ok", chars: 900, note: "" }], coverageNote: "direct",
    });
    const verdict = scoreProject(recon);

    expect(recon.profile?.identitySignals).toBe(0);
    expect(recon.profile?.summary).toMatch(/never says what it is/);
    expect(verdict.verdict).toBe("CAUTION");
    expect(verdict.capApplied).toBe("no_identity_evidence");
  });

  it("keeps pseudonymity neutral: a self-described project with official accounts and no names still passes", () => {
    const recon = analyzeContent({
      url: "https://enigma.example/", status: "rendered", title: "Enigma",
      content: "Enigma is a settlement network for institutions. Docs: https://docs.enigma.example. Follow us at https://x.com/enigmafund and https://github.com/enigmafund. Built by pioneers.",
      stages: [{ method: "direct fetch", outcome: "ok", chars: 200, note: "" }], coverageNote: "direct",
    });
    const verdict = scoreProject(recon);

    expect(recon.team.state).toBe("unnamed-section");
    expect(recon.profile?.officialAccounts.map((a) => a.label)).toEqual(["@enigmafund", "GitHub · enigmafund"]);
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.capApplied).toBeNull();
  });
});

describe("official versus merely linked accounts", () => {
  it("classifies platform URLs and drops noise paths", () => {
    expect(classifyAccountUrl("https://x.com/enigmafund")).toEqual({ platform: "x", handle: "enigmafund", personProfile: false });
    expect(classifyAccountUrl("https://x.com/intent/tweet?text=hi").handle).toBeNull();
    expect(classifyAccountUrl("https://www.linkedin.com/company/enigmafund")).toEqual({ platform: "linkedin", handle: "enigmafund", personProfile: false });
    expect(classifyAccountUrl("https://www.linkedin.com/in/jane-doe").personProfile).toBe(true);
    expect(classifyAccountUrl("https://github.com/nebula-protocol/contracts").handle).toBe("nebula-protocol");
    expect(classifyAccountUrl("https://t.me/share/url?url=x").handle).toBeNull();
  });

  it("does not hand a fund's portfolio X links to the next-step button", () => {
    const recon = analyzeContent({
      url: "https://enigma-fund.com/", status: "rendered", title: "Enigma Fund",
      content: "Enigma is a venture fund backing early-stage crypto founders.\nPortfolio: https://x.com/krakenfx and https://x.com/jupiterexchange\nhttps://www.linkedin.com/company/enigmafund\nOur team\nBuilt by pioneers.",
      stages: [{ method: "direct fetch", outcome: "ok", chars: 200, note: "" }], coverageNote: "direct",
    });

    expect(recon.profile?.kind).toBe("fund");
    expect(recon.profile?.officialAccounts.map((a) => a.label)).toEqual(["LinkedIn · enigmafund"]);
    expect(recon.profile?.linkedAccounts.map((a) => a.label)).toEqual(["@krakenfx", "@jupiterexchange"]);
    expect(recon.profile?.nextStep.kind).toBe("none");
  });

  it("treats a named person's own X account as a profile, not the project's account", () => {
    const recon = analyzeContent({
      url: "https://clutch.example/", status: "rendered", title: "Clutch Markets",
      content: "Clutch Markets is a prediction market for sports.\nTeam\nSam Clutchfield\nFounder\nhttps://x.com/samclutchfield\nhttps://x.com/clutchmarkets",
      stages: [{ method: "direct fetch", outcome: "ok", chars: 200, note: "" }], coverageNote: "direct",
    });

    expect(recon.team.people?.map((p) => p.name)).toEqual(["Sam Clutchfield"]);
    expect(recon.profile?.officialAccounts.map((a) => [a.label, a.basis])).toEqual([["@clutchmarkets", "host-match"]]);
    expect(recon.profile?.linkedAccounts.map((a) => [a.label, a.basis])).toEqual([["@samclutchfield", "person-profile"]]);
    expect(recon.profile?.nextStep).toEqual(expect.objectContaining({ kind: "handle", ref: "@clutchmarkets" }));
  });
});

describe("fund gate", () => {
  it("still gates a self-described fund, but not a token project that is merely backed by one", () => {
    expect(selfDescribesAsFund("Enigma is a venture fund backing founders.")).toBe(true);
    expect(selfDescribesAsFund("We are an accelerator for web3 teams.")).toBe(true);
    expect(selfDescribesAsFund("Nebula is a perps DEX. Backed by leading venture capital firms.")).toBe(false);
    expect(selfDescribesAsFund("A token.", "10X Capital")).toBe(true);
  });
});

describe("profiles for records saved before profiles existed", () => {
  it("rebuilds what-is-this / is-it-live / official accounts from the stored recon", () => {
    const legacy = {
      retrieval: {
        url: "https://enigma.example/", status: "rendered",
        content: "Enigma is a settlement network for institutions. Launch app. Read the docs. Follow us at https://x.com/enigmafund. "
          + "Institutions settle tokenized cash and securities on Enigma with finality in seconds, with counterparties they already know. ".repeat(3),
        title: "Enigma", stages: [], coverageNote: "direct",
      },
      title: "Enigma",
      team: { state: "named", names: ["Ada Site"], note: "Names 1 individual with roles." },
      socials: [{ label: "x.com", url: "https://x.com/enigmafund" }],
      funding: [], tokenSignals: [], findings: [],
      identityLine: "Team identified: Ada Site.",
    } as unknown as Recon;

    const profile = profileOf(legacy);

    expect(profile.kind).toBe("product");
    expect(profile.availability).toBe("live");
    expect(profile.people).toEqual([{ name: "Ada Site", role: null, basis: "inline-role" }]);
    expect(profile.officialAccounts.map((a) => a.label)).toEqual(["@enigmafund"]);
    expect(profile.nextStep).toEqual(expect.objectContaining({ kind: "handle", ref: "@enigmafund" }));
  });
});
