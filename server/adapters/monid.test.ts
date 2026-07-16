import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectCompanyEnrichment, describeCompanyEnrichment, enrichPersonViaMonid } from "./monid";

const KEY = "MONID_API_KEY";
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY];
  process.env[KEY] = "monid_live_test";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY];
  else process.env[KEY] = savedKey;
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Monid routes both search and enrichment through POST /v1/run; distinguish by
// the `endpoint` field of the JSON body so one fetcher can serve both calls.
function runFetcher(map: { search?: unknown; enrichment?: unknown }): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) => {
    let endpoint = "";
    try {
      endpoint = (JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string }).endpoint ?? "";
    } catch {
      endpoint = "";
    }
    if (endpoint === "/v1/company/search") return Promise.resolve(jsonResponse(map.search ?? {}));
    if (endpoint === "/v1/company/enrichment") return Promise.resolve(jsonResponse(map.enrichment ?? {}));
    return Promise.resolve(jsonResponse({}, 404));
  }) as unknown as typeof fetch;
}

const searchCompleted = (companies: unknown[]) => ({
  runId: "run_search_1",
  status: "COMPLETED",
  output: { data: companies },
});

const enrichmentCompleted = (data: unknown) => ({
  runId: "run_enrich_1",
  status: "COMPLETED",
  output: { data },
});

describe("collectCompanyEnrichment", () => {
  it("returns { available:false, reason:'no_key' } when MONID_API_KEY is unset", async () => {
    delete process.env[KEY];
    const out = await collectCompanyEnrichment("Acme Labs", { fetcher: runFetcher({}) });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("no_key");
    expect(describeCompanyEnrichment(out).status).toBe("unavailable"); // no key configured → no affirmative data
  });

  it("resolves a company then parses funding rounds (absolute USD) and a founder profile", async () => {
    const fetcher = runFetcher({
      search: searchCompleted([
        {
          uuid: "co-uuid-123",
          name: "Acme Labs",
          website: "acme.xyz",
          product_category: "DeFi",
          company_status: "active",
        },
      ]),
      enrichment: enrichmentCompleted({
        funding_detail: {
          funding_overview: {
            total_funding_usd: 45_000_000,
            funding_stage: "Series B",
            last_funding_date: "2023-06-01",
          },
          funding_rounds: [
            {
              amount_usd: 30_000_000,
              date: { day: 1, month: 6, year: 2023 },
              round: { label: "Series B" },
              investors: [
                { name: "Paradigm", lead_investor: true, type: "VC", website: "paradigm.xyz" },
                { name: "a16z", lead_investor: false, type: "VC" },
              ],
            },
            {
              amount_usd: 15_000_000,
              date: { day: 15, month: 2, year: 2021 },
              round: { label: "Series A" },
              investors: [{ name: "Sequoia", lead_investor: true }],
            },
          ],
          investors: [{ name: "Paradigm" }, { name: "Sequoia" }, { name: "a16z" }],
        },
        management_profile: {
          profiles: [
            {
              name: "Jane Founder",
              designation: "CEO & Co-Founder",
              designation_category: "founder",
              previous_companies: ["Coinbase", "Stripe"],
              social: { linkedin: "https://linkedin.com/in/janefounder" },
              start_date: "2019-05-01",
              overview: "Founding CEO.",
            },
          ],
        },
      }),
    });

    const out = await collectCompanyEnrichment("Acme Labs", { fetcher });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");

    expect(out.value.uuid).toBe("co-uuid-123");
    expect(out.value.name).toBe("Acme Labs");
    expect(out.value.sourceUrl).toBe("https://acme.xyz");

    // funding: amount_usd is already absolute USD — must NOT be multiplied.
    expect(out.value.funding).toBeDefined();
    expect(out.value.funding?.totalRaisedUsd).toBe(45_000_000);
    expect(out.value.funding?.rounds).toHaveLength(2);
    expect(out.value.funding?.rounds[0].amountUsd).toBe(30_000_000);
    expect(out.value.funding?.rounds[0].round).toBe("Series B");
    expect(out.value.funding?.rounds[0].date).toBe("2023-06-01");
    expect(out.value.funding?.rounds[0].leadInvestors).toEqual(["Paradigm"]);
    expect(out.value.funding?.rounds[0].otherInvestors).toEqual(["a16z"]);
    expect(out.value.funding?.rounds[1].amountUsd).toBe(15_000_000);
    expect(out.value.funding?.leadInvestors).toEqual(["Paradigm", "Sequoia"]);

    // management: the founder profile parsed with prior companies + linkedin.
    expect(out.value.management).toHaveLength(1);
    const founder = out.value.management?.[0];
    expect(founder?.name).toBe("Jane Founder");
    expect(founder?.title).toBe("CEO & Co-Founder");
    expect(founder?.priorCompanies).toEqual(["Coinbase", "Stripe"]);
    expect(founder?.linkedin).toBe("https://linkedin.com/in/janefounder");
    expect(founder?.startYear).toBe("2019");

    // firmographic was requested by default but not returned → omitted, not faked.
    expect(out.value.firmographic).toBeUndefined();

    const summary = describeCompanyEnrichment(out);
    expect(summary.status).toBe("confirmed");
    expect(summary.note).toContain("Paradigm");
  });

  it("reports reason:'no_match' when search returns no companies", async () => {
    const out = await collectCompanyEnrichment("Nonexistent Ventures", {
      fetcher: runFetcher({ search: searchCompleted([]) }),
    });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("no_match");
    expect(out.note).toContain("Nonexistent Ventures");
  });

  it("reports reason:'unavailable' on a transport error (never 'no_match')", async () => {
    const throwing = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    const out = await collectCompanyEnrichment("Acme Labs", { fetcher: throwing });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("unavailable");
    expect(describeCompanyEnrichment(out).status).toBe("unavailable");
  });
});

describe("enrichPersonViaMonid (PDL person enrichment through Monid)", () => {
  const pdlFetcher = (response: unknown, status = 200): typeof fetch =>
    (((_input: string | URL | Request, init?: RequestInit) => {
      const endpoint = (() => { try { return (JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string }).endpoint ?? ""; } catch { return ""; } })();
      if (endpoint === "/v5/person/enrich") return Promise.resolve(jsonResponse(response, status));
      return Promise.resolve(jsonResponse({}, 404));
    }) as unknown as typeof fetch);

  it("reports outcome 'error' (never a false no-match) when MONID_API_KEY is unset", async () => {
    delete process.env[KEY];
    expect(await enrichPersonViaMonid({ name: "Hayden Adams" }, pdlFetcher({}))).toEqual({ outcome: "error", note: "no_key" });
  });

  it("returns the full PDL person record (with contact fields) on a match", async () => {
    const fetcher = pdlFetcher({
      status: "COMPLETED",
      output: { status: 200, likelihood: 8, data: {
        full_name: "hayden adams",
        personal_emails: ["haydenzadams@gmail.com"],
        github_username: "haydenadams",
        linkedin_url: "linkedin.com/in/haydenadams",
      } },
    });
    const result = await enrichPersonViaMonid({ name: "Hayden Adams", company: "Uniswap" }, fetcher);
    expect(result.outcome).toBe("match");
    if (result.outcome !== "match") throw new Error("expected match");
    expect(result.record.full_name).toBe("hayden adams");
    expect(result.record.personal_emails).toContain("haydenzadams@gmail.com");
    expect(result.record.github_username).toBe("haydenadams");
  });

  it("reports outcome 'no_match' on a 404 envelope (no person record)", async () => {
    const result = await enrichPersonViaMonid({ name: "Nobody Real" }, pdlFetcher({
      status: "COMPLETED",
      output: { status: 404 },
    }));
    expect(result).toEqual({ outcome: "no_match" });
  });

  it("reports outcome 'error' (not no_match) when the run fails, never throwing", async () => {
    const result = await enrichPersonViaMonid({ name: "X" }, pdlFetcher({ status: "FAILED" }));
    expect(result.outcome).toBe("error");
  });
});
