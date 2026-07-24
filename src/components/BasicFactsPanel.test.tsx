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
    expect(container.querySelectorAll('ul[aria-label="Key verified answers"] > li, ul[aria-label="Confirmed basic facts"] > li')).toHaveLength(2);
    expect(container.querySelectorAll('ul[aria-label="Unresolved basic facts"] > li')).toHaveLength(14);
    expect(container.textContent).toContain("2 confirmed");
    expect(container.textContent).toContain("14 questions");
    expect(container.textContent).toContain("What does the project actually do?");
    expect(container.textContent).toContain("Still to confirm");
    expect(container.textContent).toContain("Confirmed twice");
    expect(container.textContent).toContain("Sources disagree");

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

    expect(container.textContent).toContain("Possible leads");
    expect(container.textContent).toContain("Not confirmed and not used in the score");
    expect(container.textContent).toContain("Candidate founder from model search");
    expect(container.textContent).toContain("$25 million");
    expect(container.textContent).toContain("0 confirmed");
    expect(container.textContent).toContain("Foundational answers are still being verified");
    expect(container.textContent).toContain("ARGUS found 2 possible answers");
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

    expect(container.querySelectorAll('ul[aria-label="Key verified answers"] > li, ul[aria-label="Confirmed basic facts"] > li')).toHaveLength(1);
    expect(container.textContent).toContain("Legal name");
    expect(container.textContent).not.toContain("Who founded it?");
  });

  it("uses founder decision questions instead of a project questionnaire", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="founder"
          fillRequired
          facts={[
            {
              predicate: "official_identity",
              value: "Brian Armstrong",
              status: "verified",
              sources: [{ url: "https://www.coinbase.com/about", relation: "supports" }],
            },
            {
              predicate: "current_role",
              value: "Co-founder, Chair and CEO of Coinbase",
              status: "corroborated",
              sources: [{ url: "https://investor.coinbase.com/governance/default.aspx", relation: "supports" }],
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Who is this person?");
    expect(container.textContent).toContain("What do they lead or control today?");
    expect(container.textContent).toContain("What legal or regulatory events actually name them?");
    expect(container.textContent).toContain("2 confirmed");
    expect(container.textContent).toContain("10 questions");
    expect(container.textContent).not.toContain("Which networks does it run on?");
    expect(container.textContent).not.toContain("When did the product launch?");
  });

  it("shows direct legal attribution, status, and entity as compact founder metadata", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="founder"
          facts={[{
            factId: "legal-brian-resolved",
            predicate: "legal_regulatory_event",
            value: "A shareholder action was dismissed.",
            eventStatus: "dismissed",
            attributedEntity: "Brian Armstrong",
            attributionScope: "direct_subject",
            status: "verified",
            sources: [{ url: "https://example.com/court-order", relation: "supports" }],
          }]}
        />,
      );
    });

    const metadata = container.querySelector('[aria-label="Legal event details"]');
    expect(metadata).not.toBeNull();
    expect(metadata?.querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(metadata?.textContent).toContain("Attributed to Brian Armstrong");
    expect(metadata?.textContent).toContain("Status: Dismissed");
    expect(metadata?.textContent).toContain("Directly attributed");
  });

  it.each(["founder", "person"] as const)(
    "clearly labels related-company legal context on %s reports",
    (audience) => {
      act(() => {
        root.render(
          <BasicFactsPanel
            audience={audience}
            facts={[{
              factId: `legal-coinbase-${audience}`,
              predicate: "legal_regulatory_event",
              value: "Coinbase settled a regulatory action.",
              eventStatus: "settled",
              attributedEntity: "Coinbase, Inc.",
              attributionScope: "related_entity",
              status: "verified",
              sources: [{ url: "https://example.com/regulator-order", relation: "supports" }],
            }]}
          />,
        );
      });

      const metadata = container.querySelector('[aria-label="Legal event details"]');
      expect(metadata?.textContent).toContain("Attributed to Coinbase, Inc.");
      expect(metadata?.textContent).toContain("Status: Settled");
      expect(metadata?.textContent).toContain("Related entity, not this person");
      expect(metadata?.textContent).not.toContain("Directly attributed");
    },
  );

  it("labels a namesake legal event as identity-unresolved", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="person"
          facts={[{
            factId: "legal-namesake",
            predicate: "legal_regulatory_event",
            value: "An SEC settlement names Brian Armstrong.",
            eventStatus: "resolved",
            attributedEntity: "Brian Armstrong",
            attributionScope: "identity_unresolved",
            status: "verified",
            sources: [{ url: "https://example.com/regulator-order", relation: "supports" }],
          }]}
        />,
      );
    });

    const metadata = container.querySelector('[aria-label="Legal event details"]');
    expect(metadata?.textContent).toContain("Exact name only, identity not confirmed");
    expect(metadata?.textContent).not.toContain("Directly attributed");
    expect(container.querySelector('[aria-label="Confirmed basic facts"]')).toBeNull();
    expect(container.querySelector('[aria-label="Key verified answers"]')).toBeNull();
    expect(container.querySelector('[aria-label="Identity review required"]')?.textContent)
      .toContain("Same name, identity not confirmed");
    expect(container.querySelector('[aria-label="Basic facts found"]')?.textContent)
      .toContain("0 confirmed");
  });

  it("keeps conflicting legal statuses in separate visible cards", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="person"
          facts={[
            {
              factId: "legal-pending",
              predicate: "legal_regulatory_event",
              value: "A regulatory action was reported.",
              eventStatus: "pending",
              attributedEntity: "Founder Name",
              attributionScope: "direct_subject",
              status: "conflicted",
              sources: [{ url: "https://example.com/pending", relation: "supports" }],
            },
            {
              factId: "legal-closed",
              predicate: "legal_regulatory_event",
              value: "A regulatory action was reported.",
              eventStatus: "closed",
              attributedEntity: "Founder Name",
              attributionScope: "direct_subject",
              status: "conflicted",
              sources: [{ url: "https://example.com/closed", relation: "contradicts" }],
            },
          ]}
        />,
      );
    });

    expect(container.querySelectorAll('[aria-label="Conflicted basic facts"] li')).toHaveLength(2);
    const details = [...container.querySelectorAll<HTMLElement>('[aria-label="Legal event details"]')];
    expect(details).toHaveLength(2);
    expect(details.map((detail) => detail.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Status: Pending"),
      expect.stringContaining("Status: Closed"),
    ]));
  });

  it("shows a completed no-token outcome separately from a verified public security", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="founder"
          fillRequired
          facts={[{
            predicate: "public_security",
            value: "NASDAQ: COIN",
            status: "verified",
            sources: [{ url: "https://www.sec.gov/Archives/edgar/data/1679788/", relation: "supports" }],
          }]}
          questionLedger={[
            { predicate: "public_security", status: "answered", providerRuns: [{ state: "succeeded" }] },
            { predicate: "official_token", status: "unanswered", providerRuns: [{ state: "completed_empty" }] },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("NASDAQ: COIN");
    expect(container.textContent).toContain("No verified official crypto token was found when this report was saved.");
    expect(container.textContent).toContain("1 with no result");
    expect(container.textContent).toContain("10 questions");
    expect(container.querySelector('[aria-label="Completed empty basic-fact searches"]')?.textContent)
      .toContain("Is an official crypto token tied to a venture they control?");
    expect(container.querySelector('[aria-label="Unresolved basic facts"]')?.textContent)
      .not.toContain("Is an official crypto token tied to a venture they control?");
  });

  it("preserves separate completed-empty outcomes when neither asset class is verified", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="founder"
          fillRequired
          questionLedger={[
            { predicate: "public_security", status: "unanswered", providerRuns: [{ state: "completed_empty" }] },
            { predicate: "official_token", status: "unanswered", providerRuns: [{ state: "completed_empty" }] },
          ]}
        />,
      );
    });

    const emptySearches = container.querySelector('[aria-label="Completed empty basic-fact searches"]');
    expect(emptySearches?.textContent).toContain("No verified public security was found when this report was saved.");
    expect(emptySearches?.textContent).toContain("No verified official crypto token was found when this report was saved.");
    expect(container.textContent).toContain("2 with no result");
    expect(container.textContent).not.toContain("Foundational answers are still being verified");
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

  it("does not present JUP and $JUP as conflicting token identities", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[
            {
              predicate: "official_token",
              value: "JUP",
              status: "verified",
              sources: [{ url: "https://jup.ag/token", relation: "supports" }],
            },
            {
              predicate: "official_token",
              value: "$JUP",
              status: "verified",
              sources: [{ url: "https://coingecko.com/en/coins/jupiter-exchange-solana", relation: "supports" }],
            },
          ]}
        />,
      );
    });

    expect(container.querySelectorAll('ul[aria-label="Key verified answers"] > li, ul[aria-label="Confirmed basic facts"] > li')).toHaveLength(1);
    expect(container.textContent).toContain("JUP");
    expect(container.textContent).not.toContain("Conflicted");
    expect(container.textContent).not.toContain("Sources disagree");
  });

  it("shows multiple founder-linked tokens plainly without descriptive lead qualifiers", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          audience="founder"
          facts={[
            {
              predicate: "official_token",
              value: "cbBTC",
              qualifier: "ERC20 token backed 1:1 by Bitcoin held by Coinbase",
              status: "verified",
              sources: [{ url: "https://www.coinbase.com/cbbtc", relation: "supports" }],
            },
            {
              predicate: "official_token",
              value: "cbETH",
              qualifier: "ERC-20 token representing staked ETH issued by Coinbase",
              status: "verified",
              sources: [{ url: "https://www.coinbase.com/cbeth", relation: "supports" }],
            },
          ]}
          leads={[
            {
              predicate: "official_token",
              value: "cbBTC",
              qualifier: "ERC20 token backed 1:1 by Bitcoin held by Coinbase",
              sourceUrl: "https://www.coinbase.com/cbbtc",
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("cbBTC, cbETH");
    expect(container.textContent).not.toContain("ERC20 token backed");
    expect(container.textContent).not.toContain("ERC-20 token representing");
    expect(container.textContent).not.toContain("Conflicted");
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

    expect(container.querySelectorAll('ul[aria-label="Key verified answers"] > li, ul[aria-label="Confirmed basic facts"] > li')).toHaveLength(15);
    expect(container.textContent).toContain("15 confirmed");
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

  it("renders a supply disclosure as its own answer, never a conflict with the token symbol", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[
            {
              predicate: "official_token",
              value: "$AAVE",
              status: "verified",
              sources: [{ url: "https://coingecko.com/en/coins/aave", relation: "supports" }],
            },
            {
              predicate: "tokenomics",
              value: "15.2M of 16.0M supply circulating (95%)",
              status: "verified",
              sources: [{ url: "https://coingecko.com/en/coins/aave", relation: "supports" }],
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("$AAVE");
    expect(container.textContent).toContain("15.2M of 16.0M supply circulating (95%)");
    expect(container.textContent).toContain("What token allocation or supply disclosures are published?");
    expect(container.textContent).not.toContain("Sources disagree");
    expect(container.textContent).not.toContain("Conflicted");
  });

  it("a supply disclosure alone never answers the official-token question", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[
            {
              predicate: "tokenomics",
              value: "50% community allocation",
              status: "verified",
              sources: [{ url: "https://example.com/tokenomics", relation: "supports" }],
            },
          ]}
          fillRequired
          audience="project"
        />,
      );
    });

    expect(container.textContent).toContain("50% community allocation");
    // The token-identity question stays open instead of being silently
    // "answered" by an allocation string.
    expect(container.textContent).toContain("Does it have an official token?");
    expect(container.textContent).not.toContain("Sources disagree");
  });

  it("collapses enumerated single-chain answers into the footprint answer", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[
            ...["Ethereum", "Polygon", "Avalanche", "BNB Chain", "Fantom"].map((chain) => ({
              predicate: "network",
              value: chain,
              status: "verified" as const,
              sources: [{ url: `https://aave.com/docs/${chain.toLowerCase().replace(/\s+/g, "-")}`, relation: "supports" as const }],
            })),
            {
              predicate: "network",
              value: "22 chains incl. Ethereum, Plasma, Base, Arbitrum",
              status: "verified",
              sources: [{ url: "https://defillama.com/protocol/aave", relation: "supports" }],
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("22 chains incl. Ethereum, Plasma, Base, Arbitrum");
    expect(container.textContent).not.toContain("Sources disagree");
    expect(container.textContent).not.toContain("Conflicted");
  });

  it("treats overlapping network lists as corroboration, showing the richer footprint", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[
            {
              predicate: "network",
              value: "Ethereum, Polygon, Avalanche, BNB Chain, Fantom",
              status: "verified",
              sources: [{ url: "https://aave.com/docs", relation: "supports" }],
            },
            {
              predicate: "network",
              value: "22 chains incl. Ethereum, Plasma, Base, Arbitrum",
              status: "verified",
              sources: [{ url: "https://defillama.com/protocol/aave", relation: "supports" }],
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("22 chains incl. Ethereum, Plasma, Base, Arbitrum");
    expect(container.textContent).not.toContain("Sources disagree");
    expect(container.textContent).not.toContain("Conflicted");
  });

  it("renders repeated stale market captures as one stat grid with only the latest numbers", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[{
            factId: "fact-traction",
            predicate: "traction",
            // The real frozen shape: pairwise upstream merges baked ", " joins
            // into ONE string, with stale captures interleaved.
            value: "CoinGecko rank #39 · $2.40B market cap · $15.5M on-chain liquidity · $166M 24h volume · captured 2026-07-22, $3.18B total value locked (Ethereum, Base, Arbitrum) · up 2.1% vs 30 days ago · captured 2026-07-22, $83.0M protocol fees in 30 days · captured 2026-07-22, CoinGecko rank #39 · $2.36B market cap · $15.4M on-chain liquidity · $165M 24h volume · captured 2026-07-23, $85.8M protocol fees in 30 days · captured 2026-07-23",
            status: "verified",
            critical: true,
            sources: [{ url: "https://www.coingecko.com/en/coins/uniswap", title: "CoinGecko token record", relation: "supports" }],
          }]}
        />,
      );
    });
    expect(container.textContent).toContain("$2.36B");
    expect(container.textContent).toContain("$85.8M");
    expect(container.textContent).toContain("$3.18B");
    expect(container.textContent).not.toContain("$2.40B");
    expect(container.textContent).not.toContain("$83.0M");
    expect(container.textContent).toContain("captured 2026-07-23");
    expect(container.textContent).not.toContain("captured 2026-07-22");
    expect(container.querySelector('dl[class*="grid"]')).not.toBeNull();
  });

  it("collapses a pre-joined repeated liveness sentence to its latest copy without a grid", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[{
            factId: "fact-product",
            predicate: "product",
            value: "Uniswap Web App, Uniswap Wallet, Uniswap Protocol, Uniswap operates a live on-chain protocol; its canonical token UNI is established and actively traded (CoinGecko rank #39 · $2.40B market cap), Uniswap operates a live on-chain protocol; its canonical token UNI is established and actively traded (CoinGecko rank #39 · $2.36B market cap)",
            status: "corroborated",
            critical: false,
            sources: [{ url: "https://www.coingecko.com/en/coins/uniswap", title: "On-chain market liveness", relation: "supports" }],
          }]}
        />,
      );
    });
    const detailsButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Show details");
    act(() => detailsButton?.click());
    const text = container.textContent ?? "";
    expect(text).toContain("Uniswap Web App");
    expect(text).toContain("$2.36B");
    expect(text).not.toContain("$2.40B");
    expect(text.match(/operates a live blockchain protocol/g)?.length).toBe(1);
  });

  it("lists disclosed funding rounds newest first under the funding answer", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[{
            factId: "fact-funding",
            predicate: "funding",
            value: "Series B, 6 public funding rounds · $178M raised · led by Andreessen Horowitz, Polychain",
            status: "corroborated",
            critical: true,
            sources: [{ url: "https://theblock.co/uniswap-series-b", title: "theblock.co", relation: "supports" }],
          }]}
          fundingRounds={[
            { date: "2020-08-01", round: "Series A", amountUsd: 11_000_000, leadInvestors: ["Andreessen Horowitz"], otherInvestors: ["USV"], valuationUsd: null },
            { date: "2022-10-13", round: "Series B", amountUsd: 165_000_000, leadInvestors: ["Polychain"], otherInvestors: [], valuationUsd: 1_660_000_000 },
          ]}
        />,
      );
    });
    const list = container.querySelector('[aria-label="Disclosed funding rounds"]');
    expect(list).not.toBeNull();
    const rows = [...(list?.querySelectorAll("li") ?? [])].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("Series B");
    expect(rows[0]).toContain("$165M");
    expect(rows[0]).toContain("led by Polychain");
    expect(rows[0]).toContain("$1.7B valuation");
    expect(rows[1]).toContain("Series A");
    expect(rows[1]).toContain("$11.0M");
    expect(rows[1]).toContain("+1 more");
  });

  it("preserves distinct numeric facts that share the same prose shape", () => {
    act(() => {
      root.render(
        <BasicFactsPanel
          facts={[{
            factId: "fact-funding-values",
            predicate: "funding",
            value: "raised $11M, raised $165M",
            status: "corroborated",
            critical: true,
            sources: [{ url: "https://example.com/funding", relation: "supports" }],
          }]}
        />,
      );
    });

    expect(container.textContent).toContain("$11M");
    expect(container.textContent).toContain("$165M");
  });
});
