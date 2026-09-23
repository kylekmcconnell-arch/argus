import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectCompaniesHouseRecord,
  collectOpenCorporatesRecord,
  collectSecRegistrant,
  collectSiteDeclaredRegistrations,
  companiesHouseConfigured,
  siteDeclaredRegistrations,
} from "./companyRegistries";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetcherReturning = (make: () => Response) =>
  ((input: string | URL | Request) => {
    void input;
    return Promise.resolve(make());
  }) as unknown as typeof fetch;

beforeEach(() => {
  vi.stubEnv("COMPANIES_HOUSE_API_KEY", "ch-key");
  vi.stubEnv("OPENCORPORATES_API_TOKEN", "oc-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("collectSecRegistrant", () => {
  const submissions = (over: Record<string, unknown> = {}) => ({
    cik: 320193,
    name: "Example Corp",
    tickers: ["EXMP"],
    exchanges: ["Nasdaq"],
    sicDescription: "Prepackaged Software",
    stateOfIncorporationDescription: "Delaware",
    ein: "123456789",
    lei: "LEI000000000000000000",
    website: "https://example.com",
    filings: {
      recent: {
        form: ["8-K", "10-Q", "4", "10-K"],
        filingDate: ["2026-09-01", "2026-08-01", "2026-07-15", "2026-02-01"],
      },
    },
    ...over,
  });

  it("reads the registrant record with filing recency by form class", async () => {
    const out = await collectSecRegistrant(320193, { fetcher: fetcherReturning(() => jsonResponse(submissions())) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value).toMatchObject({
      cik: 320193,
      entityName: "Example Corp",
      stateOfIncorporation: "Delaware",
      lastAnnualReportAt: "2026-02-01",
      lastQuarterlyReportAt: "2026-08-01",
      lastFilingAt: "2026-09-01",
      registrantWebsite: "https://example.com",
    });
    expect(out.value.sourceUrl).toBe("https://data.sec.gov/submissions/CIK0000320193.json");
  });

  it("keeps outage distinct from a missing record and rejects junk CIKs", async () => {
    expect(await collectSecRegistrant(320193, { fetcher: fetcherReturning(() => jsonResponse({}, 404)) }))
      .toMatchObject({ available: false, reason: "no_data" });
    expect(await collectSecRegistrant(320193, { fetcher: fetcherReturning(() => jsonResponse({}, 503)) }))
      .toMatchObject({ available: false, reason: "unavailable" });
    expect(await collectSecRegistrant(-1)).toMatchObject({ available: false, reason: "no_data" });
  });
});

describe("siteDeclaredRegistrations", () => {
  it("extracts numbers with their declared jurisdiction and prefers the jurisdiction-bearing mention", () => {
    const text = `Acme Ltd is registered in England and Wales, company no. 09876543.
      Footer: Company Number: 09876543. VAT GB123.`;
    const found = siteDeclaredRegistrations(text, "https://acme.example/legal");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ number: "09876543", jurisdiction: "gb" });
    expect(found[0].excerpt).toContain("England");
  });

  it("keeps a generic company number with no jurisdiction claim as jurisdictionless", () => {
    const found = siteDeclaredRegistrations("Company No: 1234567", "https://acme.example/");
    expect(found).toEqual([
      expect.objectContaining({ number: "1234567", jurisdiction: null }),
    ]);
  });

  it("extracts nothing from ordinary prose", () => {
    expect(siteDeclaredRegistrations("Our company number one priority is users.", "https://a.example/")).toHaveLength(0);
  });
});

describe("collectSiteDeclaredRegistrations", () => {
  it("discards a body served after a redirect off the controlled apex", async () => {
    const fetcher = ((input: string | URL | Request) => {
      void input;
      const response = new Response("registered in England and Wales, company no. 01234567", { status: 200 });
      Object.defineProperty(response, "url", { value: "https://parking-lot.example/landing" });
      return Promise.resolve(response);
    }) as unknown as typeof fetch;
    expect(await collectSiteDeclaredRegistrations("https://acme.example/", fetcher)).toHaveLength(0);
  });

  it("collects numbers from the site's own pages, deduplicated", async () => {
    const fetcher = ((input: string | URL | Request) => {
      const url = String(input);
      const response = new Response(
        url.endsWith("/legal")
          ? "Acme Ltd, registered in England and Wales. Company No. 09876543."
          : "Welcome to Acme. Company No. 09876543.",
        { status: 200 },
      );
      Object.defineProperty(response, "url", { value: url });
      return Promise.resolve(response);
    }) as unknown as typeof fetch;
    const found = await collectSiteDeclaredRegistrations("https://acme.example/", fetcher);
    expect(found).toHaveLength(1);
    expect(found[0].number).toBe("09876543");
  });
});

describe("collectCompaniesHouseRecord", () => {
  const record = () => ({
    company_number: "09876543",
    company_name: "ACME LIMITED",
    company_status: "active",
    type: "ltd",
    date_of_creation: "2015-01-02",
    jurisdiction: "england-wales",
    registered_office_address: { address_line_1: "1 Test Street", locality: "London" },
  });

  it("reports not_configured without touching the network when the key is absent", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    expect(companiesHouseConfigured()).toBe(false);
    const fetcher = vi.fn();
    const out = await collectCompaniesHouseRecord("09876543", { fetcher: fetcher as unknown as typeof fetch });
    expect(out).toMatchObject({ available: false, reason: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads a record by the site-declared number", async () => {
    const out = await collectCompaniesHouseRecord("09876543", { fetcher: fetcherReturning(() => jsonResponse(record())) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value).toMatchObject({
      companyNumber: "09876543",
      companyName: "ACME LIMITED",
      status: "active",
      incorporatedOn: "2015-01-02",
      registeredOffice: "1 Test Street, London",
    });
    expect(out.value.sourceUrl).toContain("find-and-update.company-information.service.gov.uk");
  });

  it("keeps rejected key, missing record, and malformed numbers distinct", async () => {
    expect(await collectCompaniesHouseRecord("09876543", { fetcher: fetcherReturning(() => jsonResponse({}, 401)) }))
      .toMatchObject({ available: false, reason: "unavailable" });
    expect(await collectCompaniesHouseRecord("09876543", { fetcher: fetcherReturning(() => jsonResponse({}, 404)) }))
      .toMatchObject({ available: false, reason: "no_data" });
    expect(await collectCompaniesHouseRecord("not-a-number")).toMatchObject({ available: false, reason: "no_data" });
  });
});

describe("collectOpenCorporatesRecord", () => {
  it("reads a record by jurisdiction plus site-declared number", async () => {
    const out = await collectOpenCorporatesRecord("gb", "09876543", {
      fetcher: fetcherReturning(() => jsonResponse({
        results: {
          company: {
            name: "ACME LIMITED",
            company_number: "09876543",
            current_status: "Active",
            incorporation_date: "2015-01-02",
            company_type: "Private Limited Company",
            opencorporates_url: "https://opencorporates.com/companies/gb/09876543",
          },
        },
      })),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value).toMatchObject({ jurisdiction: "gb", companyName: "ACME LIMITED", status: "Active" });
  });

  it("never probes without a jurisdiction-shaped input", async () => {
    const fetcher = vi.fn();
    const out = await collectOpenCorporatesRecord("", "09876543", { fetcher: fetcher as unknown as typeof fetch });
    expect(out).toMatchObject({ available: false, reason: "no_data" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
