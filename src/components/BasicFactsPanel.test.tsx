// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BasicFactsPanel } from "./BasicFactsPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BasicFactsPanel", () => {
  it("shows every required question, honest coverage, and clickable supporting or conflicting sources", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          fillRequired
          facts={[
            {
              factId: "fact-identity",
              predicate: "identity",
              value: "Jupiter is a Solana liquidity aggregation and trading platform.",
              status: "verified",
              critical: true,
              sources: [{
                url: "https://jup.ag/",
                title: "Jupiter",
                relation: "supports",
                excerpt: "Jupiter is Solana's leading liquidity infrastructure.",
                provider: "official-site",
              }],
            },
            {
              factId: "fact-founders",
              predicate: "founders",
              value: "Meow and Siong",
              status: "corroborated",
              critical: true,
              sources: [
                { url: "https://docs.jup.ag/tokenomics", title: "Official tokenomics", relation: "supports" },
                { url: "https://discuss.jup.ag/founders", title: "Governance forum", relation: "supports" },
              ],
            },
            {
              factId: "fact-launch",
              predicate: "launch_date",
              value: "October 2021",
              status: "conflicted",
              critical: false,
              sources: [
                { url: "https://example.com/launch-one", title: "Source one", relation: "supports" },
                { url: "https://example.com/launch-two", title: "Source two", relation: "contradicts" },
              ],
            },
          ]}
        />,
      );
    });

    expect(container.querySelector("#basic-facts")).not.toBeNull();
    expect(container.querySelectorAll('ol[aria-label="Required diligence questions"] > li')).toHaveLength(15);
    expect(container.textContent).toContain("2/15");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("What does the project actually do?");
    expect(container.textContent).toContain("No verified answer was found in this snapshot.");
    expect(container.textContent).toContain("Corroborated");
    expect(container.textContent).toContain("The sources disagree");

    const sourceLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')];
    expect(sourceLinks.map((link) => link.href)).toEqual(expect.arrayContaining([
      "https://jup.ag/",
      "https://docs.jup.ag/tokenomics",
      "https://discuss.jup.ag/founders",
      "https://example.com/launch-one",
      "https://example.com/launch-two",
    ]));
    expect(sourceLinks.find((link) => link.href === "https://example.com/launch-two")?.textContent).toContain("Contradicts");
    expect(sourceLinks.every((link) => link.rel === "noopener noreferrer")).toBe(true);
  });

  it("keeps AI answers in a visibly separate, unscored lead area and rejects unsafe links", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          fillRequired
          facts={[{
            predicate: "founder",
            value: "Candidate founder from model search",
            status: "lead",
            sources: [{ url: "https://example.com/candidate", provider: "claude-web-search" }],
          }]}
          leads={[{
            predicate: "funding",
            value: "$25 million",
            provider: "claude-web-search",
            sourceUrl: "https://example.com/primary-funding",
            sourceTitle: "Funding announcement",
            candidateUrls: ["javascript:alert(1)", "https://example.com/funding"],
          }]}
        />,
      );
    });

    expect(container.textContent).toContain("Unverified discovery leads");
    expect(container.textContent).toContain("They do not affect the verdict");
    expect(container.textContent).toContain("Candidate founder from model search");
    expect(container.textContent).toContain("$25 million");
    expect(container.textContent).toContain("0/15");
    expect(container.textContent).toContain("No verified answer was found in this snapshot.");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect([...container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')].map((link) => link.href)).toEqual([
      "https://example.com/candidate",
      "https://example.com/primary-funding",
      "https://example.com/funding",
    ]);
    expect(container.textContent).toContain("Funding announcement");
  });

  it("renders only supplied questions for a non-project subject", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[{
            predicate: "legal_name",
            value: "Ada Example",
            status: "verified",
            sources: [{ url: "https://example.com/profile", title: "Official profile", relation: "supports" }],
          }]}
        />,
      );
    });

    expect(container.querySelectorAll('ol[aria-label="Required diligence questions"] > li')).toHaveLength(1);
    expect(container.textContent).toContain("Legal name");
    expect(container.textContent).not.toContain("Who founded it?");
  });

  it("combines repeatable answers without turning multiple founders into a conflict", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[
            {
              predicate: "founder",
              value: "Meow",
              status: "verified",
              sources: [{ url: "https://docs.jup.ag/tokenomics", relation: "supports" }],
            },
            {
              predicate: "co_founders",
              value: "Siong",
              status: "verified",
              sources: [{ url: "https://discuss.jup.ag/founders", relation: "supports" }],
            },
            {
              predicate: "repositories",
              value: "jup-ag/jupiter-swap-api-client",
              status: "verified",
              sources: [{ url: "https://github.com/jup-ag/jupiter-swap-api-client", relation: "supports" }],
            },
            {
              predicate: "repository",
              value: "jup-ag/jupiter-core-example",
              status: "verified",
              sources: [{ url: "https://github.com/jup-ag/jupiter-core-example", relation: "supports" }],
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Meow, Siong");
    expect(container.textContent).toContain("jup-ag/jupiter-swap-api-client, jup-ag/jupiter-core-example");
    expect(container.textContent).not.toContain("Conflicted");
    expect(container.textContent).not.toContain("The sources disagree");
  });

  it("maps every canonical collector predicate to a plain investor question", () => {
    const canonicalFacts = [
      ["official_identity", "Jupiter"],
      ["product", "Swap aggregation"],
      ["founder", "Meow"],
      ["executive", "Siong"],
      ["founded", "2021"],
      ["launched", "October 2021"],
      ["official_token", "JUP"],
      ["network", "Solana"],
      ["legal_entity", "Jupiter Exchange"],
      ["funding", "$10 million"],
      ["investor", "Example Ventures"],
      ["governance", "Jupiter DAO"],
      ["audit", "OtterSec review"],
      ["repository", "jup-ag"],
      ["traction", "Daily trading volume"],
    ] as const;

    act(() => {
      root.render(
        <BasicFactsPanel
          fillRequired
          facts={canonicalFacts.map(([predicate, value]) => ({
            predicate,
            value,
            normalizedValue: value.toLowerCase(),
            status: "verified" as const,
            sources: [{ url: `https://example.com/${predicate}`, relation: "supports" as const }],
          }))}
        />,
      );
    });

    expect(container.querySelectorAll('ol[aria-label="Required diligence questions"] > li')).toHaveLength(15);
    expect(container.textContent).toContain("15/15");
    expect(container.textContent).toContain("Who founded it?");
    expect(container.textContent).toContain("Who operates it today?");
    expect(container.textContent).toContain("When was it founded?");
    expect(container.textContent).toContain("When did the product launch?");
    expect(container.textContent).toContain("Which networks does it run on?");
    expect(container.textContent).toContain("Who funded it?");
    expect(container.textContent).toContain("Meow");
    expect(container.textContent).not.toContain("meowVerified");
    expect(container.textContent).not.toMatch(/official_identity|official_token|legal_entity/);
  });

  it("rejects local, credential-bearing, and secret-bearing source URLs", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[{
            predicate: "identity",
            value: "Example",
            status: "verified",
            sources: [
              { url: "http://127.0.0.1/internal" },
              { url: "http://localhost/admin" },
              { url: "http://[::1]/internal" },
              { url: "https://user:pass@example.com/private" },
              { url: "https://example.com/source?token=secret" },
              { url: "https://example.com/public-source" },
            ],
          }]}
        />,
      );
    });

    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')];
    expect(links.map((link) => link.href)).toEqual(["https://example.com/public-source"]);
  });
});
