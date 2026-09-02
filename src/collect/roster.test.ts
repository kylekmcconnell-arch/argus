// The roster reader: real people with the roles the page gives them, from the
// structural shape of a team page, without ever promoting a heading, a desk
// phrase, a bio @mention, or a nav item into a person.
import { describe, expect, it } from "vitest";

import { isRoleLine, nameOnLine, readRoster } from "./roster";
import { visibleText } from "./retrieve";

// The rendering crawler's markdown for a card grid: image, linked heading,
// role line, bio line with affiliation @mentions.
const CRAWLER_MARKDOWN = `
## Core Team

← Swipe for more →

*   ![Image 3: image](https://10xcapital.com/images/hans.png)

*   #### [Hans Thomas](http://www.hansthomas.com/)

Founder & CEO

Entrepreneur, & Investor in Tech & Digital Assets since 1999.

 Founding teams of InternetCash, RefinanceOne, TheNumber. 1/0 Capital. NYU

*   ![Image 4: Alex Monje](https://10xcapital.com/images/alex.png)

*   #### Alex Monje

Partner, Chief Legal Officer

DWAC($DJT), GAMCO. Morgan Stanley. MBA @UNC. JD @University of Miami

*   #### Omar Al Yousuf

Senior Advisor

Emerging Markets Digital Assets Treasuries. Government Affairs & Defense @Siemens AG. Board Member @CoinW @Legend Technologies

*   #### Curtis Pierce

Business Development

Public Company Treasury Asset Management. Investment Banking @Wells Fargo. University of Utah

### [**Mission** Statement](https://10xcapital.com/)

10X Capital is a next-generation investment firm. Founded by pioneering digital currency and fintech entrepreneur Hans Thomas (founding team, InternetCash), 10X brings institutional capital to exceptional opportunities worldwide.
`;

describe("roster reader", () => {
  it("reads a crawler-rendered card grid as people with roles and keeps the name's own link", () => {
    const people = readRoster(CRAWLER_MARKDOWN);

    expect(people).toEqual([
      { name: "Hans Thomas", role: "Founder & CEO", link: "http://www.hansthomas.com/", basis: "roster" },
      { name: "Alex Monje", role: "Partner, Chief Legal Officer", link: undefined, basis: "roster" },
      { name: "Omar Al Yousuf", role: "Senior Advisor", link: undefined, basis: "roster" },
      { name: "Curtis Pierce", role: "Business Development", link: undefined, basis: "roster" },
    ]);
    expect(people.map((p) => p.name)).not.toContain("Emerging Markets Digital");
    expect(people.map((p) => p.name)).not.toContain("Mission Statement");
    expect(people.map((p) => p.name)).not.toContain("Core Team");
  });

  it("reads a server-rendered card grid once block boundaries survive the tag strip", () => {
    const html = `
      <h2>Core Team</h2>
      <div class="card"><img src="a.png"><h4>Hans Thomas</h4><p>Founder &amp; CEO</p><p>Entrepreneur since 1999.</p></div>
      <div class="card"><h4>Alex Monje</h4><p>Partner, Chief Legal Officer</p><p>MBA @UNC. JD @University of Miami</p></div>
      <div class="card"><h4>Caleb Goding</h4><p>Managing Director, Asset Management</p><p>Wells Fargo.</p></div>
      <nav><a href="/">Home</a><a href="/team">Team</a><a href="/contact">Contact</a></nav>`;
    const people = readRoster(visibleText(html));

    expect(people.map((p) => [p.name, p.role])).toEqual([
      ["Hans Thomas", "Founder & CEO"],
      ["Alex Monje", "Partner, Chief Legal Officer"],
      ["Caleb Goding", "Managing Director, Asset Management"],
    ]);
  });

  it("reads one-line 'Name — Role' rows and 'Role / Name' stacks", () => {
    const people = readRoster("Team\nJane Doe — CTO\nCEO\nRavi Patel\nHead of Growth | Mei Lin\n");

    expect(people.map((p) => [p.name, p.role])).toEqual(expect.arrayContaining([
      ["Jane Doe", "CTO"],
      ["Ravi Patel", "CEO"],
    ]));
    // A role before a pipe is a role, not a name; the row is not read backwards.
    expect(people.map((p) => p.name)).not.toContain("Head of Growth");
  });

  it("does not read a name without a role, a nav item, or a legal line as a person", () => {
    const people = readRoster([
      "Russell Read",                 // named on the page, but no role anywhere near
      "Max Staedtler",
      "Learn More",
      "Contact Us",
      "Privacy Policy",
      "Sign Up",
      "Terms of Service",
      "All Rights Reserved",
      "10X Capital is a Registered Trademark of 10X LLC.",
    ].join("\n"));

    expect(people).toEqual([]);
  });

  it("reads 'founded by … Name' from prose but not a backing organization", () => {
    const people = readRoster(
      "Founded by pioneering digital currency and fintech entrepreneur Hans Thomas (founding team, InternetCash).\n"
      + "Founded by veterans from Goldman Sachs.\n"
      + "Founded by the team behind Uniswap Labs.\n"
      + "Backed by Andreessen Horowitz.",
    );

    expect(people).toEqual([{ name: "Hans Thomas", role: "Founder (per site copy)", basis: "founded-by" }]);
  });

  it("still reads inline prose adjacency in both orders", () => {
    const people = readRoster("Jane Smith, Managing Partner leads the fund. The desk is run by CTO Hans Thomas today.");

    expect(people.map((p) => [p.name, p.role])).toEqual(expect.arrayContaining([
      ["Jane Smith", "Managing Partner"],
      ["Hans Thomas", "CTO"],
    ]));
  });

  it("rejects bio lines and sentences as role lines", () => {
    expect(isRoleLine("Partner, Chief Legal Officer")).toBe(true);
    expect(isRoleLine("Founder & CEO")).toBe(true);
    expect(isRoleLine("Fmr. CEO @Kraken EMEA. Co-Founder @NY Bitcoin Center")).toBe(false);
    expect(isRoleLine("Entrepreneur, & Investor in Tech & Digital Assets since 1999.")).toBe(false);
    expect(isRoleLine("Charleston Capital Management. Wells Fargo. University of South Carolina")).toBe(false);
  });

  it("rejects org and UI phrases as name lines while keeping real surnames", () => {
    expect(nameOnLine("Emerging Markets Digital")).toBeNull();
    expect(nameOnLine("Mission Statement")).toBeNull();
    expect(nameOnLine("Clutch Markets")).toBeNull();
    expect(nameOnLine("Omar Al Yousuf")).toBe("Omar Al Yousuf");
    expect(nameOnLine("Russell Read")).toBe("Russell Read");
    expect(nameOnLine("Larry Page, PhD")).toBe("Larry Page");
  });
});
