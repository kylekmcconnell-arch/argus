// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CompanyEnrichmentSnapshot,
  ProtocolFundingSnapshot,
  ProtocolTvlSnapshot,
} from "../data/evidence";
import {
  DiligenceEvidenceLedgers,
} from "./DiligenceEvidenceLedgers";
import { isExactDomainBoundCompanyEnrichment } from "../lib/diligenceEvidenceBinding";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const company: CompanyEnrichmentSnapshot = {
  name: "Fixture Labs",
  uuid: "company-fixture",
  identityMatch: "official_domain",
  requestedDomain: "app.fixture.xyz",
  matchedDomain: "fixture.xyz",
  matchMethod: "parent_or_subdomain",
  firmographic: {
    legalName: "Fixture Labs, Inc.",
    foundedYear: "2022",
    headcountRange: "11-50",
    ownership: "Private",
  },
  funding: {
    totalRaisedUsd: 20_000_000,
    leadInvestors: ["Lead Capital", "Seed Partners"],
    rounds: [
      {
        date: "2025-03-04",
        round: "Series A",
        amountUsd: 15_000_000,
        leadInvestors: ["Lead Capital"],
        otherInvestors: ["Other Ventures"],
      },
      {
        date: "2023-01",
        round: "Seed",
        amountUsd: 5_000_000,
        leadInvestors: ["Seed Partners"],
        otherInvestors: ["Angel One", "Angel Two"],
      },
    ],
  },
  management: [
    {
      name: "Ada Example",
      title: "Chief Executive Officer",
      priorCompanies: ["Prior Co"],
      linkedin: "https://www.linkedin.com/in/ada-example",
      startYear: "2022",
    },
    {
      name: "Lin Example",
      title: "Chief Technology Officer",
      priorCompanies: ["Earlier Labs", "Old Systems"],
      linkedin: null,
      startYear: null,
    },
  ],
  sourceUrl: "https://fixture.xyz",
  capturedAt: "2026-08-06T12:00:00.000Z",
};

const protocolTvl: ProtocolTvlSnapshot = {
  slug: "fixture",
  name: "Fixture",
  symbol: "FIX",
  tvlUsd: 10_000_000,
  chains: ["Ethereum"],
  chainBreakdown: [{ chain: "Ethereum", tvlUsd: 10_000_000 }],
  geckoId: "fixture-token",
  hacks: [
    {
      date: "2025-06-02",
      amountUsd: 2_000_000,
      returnedFunds: false,
      returnedAmountUsd: null,
      classification: "Protocol Logic",
      technique: "Oracle manipulation",
    },
    {
      date: "2024-02-01",
      amountUsd: 1_500_000,
      returnedFunds: true,
      returnedAmountUsd: 500_000,
      classification: "Access Control",
      technique: "Key compromise",
    },
    {
      date: null,
      amountUsd: null,
      returnedFunds: null,
      classification: null,
      technique: null,
    },
  ],
  sourceUrl: "https://defillama.com/protocol/fixture",
  capturedAt: "2026-08-06T12:00:00.000Z",
};

const protocolFunding: ProtocolFundingSnapshot = {
  slug: "fixture",
  name: "Fixture",
  geckoId: "fixture-token",
  rounds: [{
    date: "2025-01-15",
    round: "Strategic",
    amountUsd: 8_000_000,
    leadInvestors: ["Protocol Lead"],
    otherInvestors: ["Protocol Participant"],
    valuationUsd: 80_000_000,
  }, {
    date: "2023-02-01",
    round: "Seed",
    amountUsd: null,
    leadInvestors: [],
    otherInvestors: ["Early Backer"],
    valuationUsd: null,
  }],
  totalRaisedUsd: 8_000_000,
  leadInvestors: ["Protocol Lead"],
  sourceUrl: "https://defillama.com/protocol/fixture",
  capturedAt: "2026-08-06T12:00:00.000Z",
};

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

function render(overrides: Partial<ComponentProps<typeof DiligenceEvidenceLedgers>> = {}) {
  act(() => {
    root.render(
      <DiligenceEvidenceLedgers
        company={company}
        officialWebsite="https://app.fixture.xyz"
        protocolFunding={protocolFunding}
        protocolTvl={protocolTvl}
        canonicalGeckoId="fixture-token"
        {...overrides}
      />,
    );
  });
}

describe("provider evidence ledgers", () => {
  it("renders the binding receipt, all company fields, rounds, investors, and management rows", () => {
    render();

    const ledger = container.querySelector('[aria-label="Provider evidence ledgers"]');
    expect(ledger?.textContent).toContain("app.fixture.xyz");
    expect(ledger?.textContent).toContain("fixture.xyz");
    expect(ledger?.textContent).toContain("parent or subdomain");
    expect(ledger?.textContent).toContain("Fixture Labs, Inc.");
    expect(ledger?.textContent).toContain("2022");
    expect(ledger?.textContent).toContain("11-50");
    expect(ledger?.textContent).toContain("Private");
    expect(ledger?.textContent).toContain("Series A");
    expect(ledger?.textContent).toContain("Seed");
    expect(ledger?.textContent).toContain("Lead Capital");
    expect(ledger?.textContent).toContain("Seed Partners");
    expect(ledger?.textContent).toContain("Other Ventures");
    expect(ledger?.textContent).toContain("Angel One, Angel Two");
    expect(ledger?.textContent).toContain("Ada Example");
    expect(ledger?.textContent).toContain("Lin Example");
    expect(ledger?.textContent).toContain("Prior Co");
    expect(ledger?.querySelector('a[href="https://www.linkedin.com/in/ada-example"]')).not.toBeNull();
    expect(ledger?.textContent).toContain("not token treasury, token value, token ownership, or any person's capital");
  });

  it("renders every provider incident and only bounded aggregate amounts", () => {
    render();

    const ledger = container.querySelector('[aria-label="All provider-recorded protocol incidents"]');
    const text = container.textContent ?? "";
    expect(ledger?.children).toHaveLength(3);
    expect(text).toContain("$3,500,000");
    expect(text).toContain("$500,000");
    expect(text).toContain("Gross total uses 2 of 3 rows with an explicit amount");
    expect(text).toContain("Returned total uses 1 row with an explicit returned amount");
    expect(text).toContain("Protocol Logic");
    expect(text).toContain("Oracle manipulation");
    expect(text).toContain("Access Control");
    expect(text).toContain("Key compromise");
    expect(text).toContain("Returned-funds field: No");
    expect(text).toContain("Returned-funds field: Yes");
    expect(text).toContain("Returned-funds field: Not recorded");
    expect(text).toContain("Amounts are gross event amounts in the provider record");
    expect(text).toContain("A missing returned amount is not treated as unrecovered capital");
    expect(text).toContain("do not establish cause or current protocol security");
    expect(text.toLowerCase()).not.toContain("unrecovered loss");
    expect(text.toLowerCase()).not.toContain("protocol is insecure");
  });

  it("renders every exact-bound protocol funding row, investor class, and valuation without implying treasury or ownership", () => {
    render();

    const ledger = container.querySelector('[aria-label="All provider-recorded protocol funding rounds"]');
    const text = container.textContent ?? "";
    expect(ledger?.children).toHaveLength(2);
    expect(text).toContain("Protocol Lead");
    expect(text).toContain("Protocol Participant");
    expect(text).toContain("Early Backer");
    expect(text).toContain("$80,000,000");
    expect(text).toContain("Sum of explicit amounts");
    expect(text).toContain("not a claim about current treasury cash");
    expect(text).toContain("do not establish current ownership, token rights, endorsement, lockups");
  });

  it("withholds a company or protocol ledger when its exact identity receipt fails", () => {
    render({
      officialWebsite: "https://different.example",
      canonicalGeckoId: "namesake-token",
    });

    expect(container.querySelector('[aria-label="Provider evidence ledgers"]')).toBeNull();
  });

  it("withholds company enrichment without a frozen official website and funding without both identity IDs", () => {
    render({
      officialWebsite: null,
      protocolTvl: null,
      protocolFunding: { ...protocolFunding, geckoId: null },
      canonicalGeckoId: null,
    });

    expect(container.querySelector('[aria-label="Provider evidence ledgers"]')).toBeNull();
  });

  it("rejects name-only company enrichment even when its display name matches", () => {
    render({
      company: {
        ...company,
        identityMatch: "name_only",
        matchMethod: "exact_name",
      },
      protocolFunding: null,
      protocolTvl: null,
    });

    expect(container.textContent).toBe("");
  });

  it("rejects a receipt whose declared exact-host method contradicts its domains", () => {
    expect(isExactDomainBoundCompanyEnrichment({
      ...company,
      matchMethod: "exact_host",
    }, "https://app.fixture.xyz")).toBe(false);
  });

  it("rejects shared-host, stale-shaped, and unrelated-source company receipts", () => {
    expect(isExactDomainBoundCompanyEnrichment({
      ...company,
      requestedDomain: "project.github.io",
      matchedDomain: "github.io",
      sourceUrl: "https://github.io",
      matchMethod: "parent_or_subdomain",
    }, "https://project.github.io")).toBe(false);
    expect(isExactDomainBoundCompanyEnrichment({
      ...company,
      capturedAt: "not-a-time",
    }, "https://app.fixture.xyz")).toBe(false);
    expect(isExactDomainBoundCompanyEnrichment({
      ...company,
      sourceUrl: "https://unrelated.example/company-fixture",
    }, "https://app.fixture.xyz")).toBe(false);
  });

  it("distinguishes uncollected optional company sections from explicit empty provider sections", () => {
    render({
      company: { ...company, funding: undefined, management: undefined },
      protocolFunding: null,
      protocolTvl: null,
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Funding enrichment was not collected");
    expect(text).toContain("This is not a zero-round result");
    expect(text).toContain("Management enrichment was not collected");
    expect(text).toContain("not evidence that no management records exist");
    expect(text).not.toContain("0 funding rounds recorded");
    expect(text).not.toContain("Management records (0)");
  });
});
