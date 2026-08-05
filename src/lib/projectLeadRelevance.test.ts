import { describe, expect, it } from "vitest";
import { projectLeadIsRelevant, type ProjectLeadSubject } from "./projectLeadRelevance";

// The reported failure: an audit of the memecoin $STONKBROKER, whose project is
// named Clutch, published a funding round taken from a Toronto law firm's deal
// page about Clutch, the Canadian used-car retailer. The namesake DOES name the
// subject, so naming is not the guard; industry vocabulary is.
const CLUTCH: ProjectLeadSubject = {
  handle: "@stonkbroker",
  display_name: "Clutch",
  website: "https://clutch.example",
};

const carDealerRound = {
  predicate: "funding",
  value: "$60,000,000 Series B",
  qualifier: "Clutch closed a US$60 million Series B financing round.",
  sourceTitle: "Torys advises on Clutch's Series B financing",
  sourceUrl: "https://www.torys.com/en/work/2025/02/230d0ce9-417f-41c8-84d3-6bc50785f7fb",
  excerpt: "Clutch, Canada's leading online used-car retailer, closed a Series B financing to expand its vehicle reconditioning capacity.",
};

describe("a same-named company in another industry cannot fund this project", () => {
  it("drops the used-car retailer's Series B from the memecoin's leads", () => {
    expect(projectLeadIsRelevant(CLUTCH, carDealerRound)).toBe(false);
  });

  it("drops it even though the page names the subject, because the name IS the collision", () => {
    const text = `${carDealerRound.qualifier} ${carDealerRound.excerpt}`.toLowerCase();
    // Proof the old guard could not have helped: the page really does say Clutch.
    expect(text).toContain("clutch");
    expect(projectLeadIsRelevant(CLUTCH, carDealerRound)).toBe(false);
  });

  it("drops the same collision arriving as an investor lead", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      ...carDealerRound,
      predicate: "investor",
      value: "Canaan Partners",
      qualifier: "Canaan Partners led the financing round for Clutch.",
    })).toBe(false);
  });

  it("still publishes a funding lead that reads as this industry", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "funding",
      value: "$4,000,000 seed",
      qualifier: "Clutch raised a $4M seed round to build its DeFi protocol.",
      sourceTitle: "Clutch raises $4M for on-chain trading",
      sourceUrl: "https://www.theblock.co/post/1/clutch-raises-4m",
      excerpt: "The crypto startup Clutch raised $4 million to expand its on-chain trading protocol.",
    })).toBe(true);
  });

  it("still publishes anything on the project's own domain", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "funding",
      value: "$4,000,000 seed",
      qualifier: "We raised a $4M seed round.",
      sourceUrl: "https://clutch.example/blog/seed",
      excerpt: "Today we are announcing our seed financing.",
    })).toBe(true);
  });

  it("still publishes from the exact official X profile", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "funding",
      value: "$4,000,000 seed",
      qualifier: "We closed our seed round.",
      sourceUrl: "https://x.com/stonkbroker",
      excerpt: "Our seed financing is closed.",
    })).toBe(true);
  });

  it("drops a funding lead that names nobody at all", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "funding",
      value: "$200,000,000",
      qualifier: "The protocol raised $200 million in a Series C.",
      sourceUrl: "https://example.com/some-other-protocol",
      excerpt: "An unrelated protocol raised $200 million in a Series C round.",
    })).toBe(false);
  });
});

describe("the rest of the lead rules are unchanged by the funding fix", () => {
  it("keeps dropping a name-matched social result off the official scope", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "product",
      value: "Clutch",
      sourceUrl: "https://www.linkedin.com/company/clutch",
      excerpt: "Clutch is a blockchain protocol.",
    })).toBe(false);
  });

  it("keeps requiring relationship language for a partnership", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "partnership",
      value: "Solana",
      sourceUrl: "https://example.com/a",
      excerpt: "Clutch is a token deployed on the Solana blockchain.",
    })).toBe(false);
  });

  it("keeps requiring repository language for a repository lead", () => {
    expect(projectLeadIsRelevant(CLUTCH, {
      predicate: "repository",
      value: "docs site",
      sourceUrl: "https://example.com/docs",
      excerpt: "Read the Clutch protocol documentation.",
    })).toBe(false);
  });
});
