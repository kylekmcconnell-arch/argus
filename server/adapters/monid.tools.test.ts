import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectCompanyNews, collectTokenContractRisk } from "./monid";

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

const completed = (runId: string, data: unknown) => ({ runId, status: "COMPLETED", output: { data } });

// Every collector routes through POST /v1/run; distinguish by the `endpoint`
// field of the JSON body so one fetcher can serve search + news (or strale).
function runFetcher(map: {
  search?: unknown;
  news?: unknown;
  pretrade?: unknown;
}): typeof fetch {
  return ((_input: string | URL | Request, init?: RequestInit) => {
    let endpoint = "";
    try {
      endpoint = (JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string }).endpoint ?? "";
    } catch {
      endpoint = "";
    }
    if (endpoint === "/v1/company/search") return Promise.resolve(jsonResponse(map.search ?? {}));
    if (endpoint === "/v1/news") return Promise.resolve(jsonResponse(map.news ?? {}));
    if (endpoint === "/x402/solutions/web3-pre-trade") return Promise.resolve(jsonResponse(map.pretrade ?? {}));
    return Promise.resolve(jsonResponse({}, 404));
  }) as unknown as typeof fetch;
}

const throwingFetcher = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;

describe("collectCompanyNews", () => {
  it("returns { available:false, reason:'no_key' } when MONID_API_KEY is unset", async () => {
    delete process.env[KEY];
    const out = await collectCompanyNews("Acme Labs", { fetcher: runFetcher({}) });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("no_key");
  });

  it("resolves a bare name via search then parses articles defensively", async () => {
    const fetcher = runFetcher({
      search: completed("run_search_1", [{ uuid: "co-uuid-123", name: "Acme Labs", website: "acme.xyz" }]),
      news: completed("run_news_1", [
        {
          title: "Acme raises Series B",
          ai_summary: "Acme closed a large round.",
          sentiment: "positive",
          publisher_domain: "theblock.co",
          url: "https://theblock.co/acme-b",
          published_date: "2023-06-01",
          entities: { company: "Acme" },
        },
        {
          title: "Acme ships mainnet",
          summary: "Mainnet is live.",
          sentiment: "neutral",
          publisher: "CoinDesk",
          url: "https://coindesk.com/acme-mainnet",
          date: "2023-07-15",
        },
      ]),
    });

    const out = await collectCompanyNews("Acme Labs", { fetcher, limit: 5 });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");

    expect(out.value.company).toBe("co-uuid-123");
    expect(out.value.count).toBe(2);
    expect(out.value.articles).toHaveLength(2);

    const [first, second] = out.value.articles;
    expect(first.title).toBe("Acme raises Series B");
    expect(first.summary).toBe("Acme closed a large round."); // ai_summary fallback
    expect(first.sentiment).toBe("positive");
    expect(first.publisher).toBe("theblock.co"); // publisher_domain fallback
    expect(first.url).toBe("https://theblock.co/acme-b");
    expect(first.date).toBe("2023-06-01"); // published_date

    expect(second.publisher).toBe("CoinDesk");
    expect(second.summary).toBe("Mainnet is live.");
    expect(second.date).toBe("2023-07-15"); // date fallback
  });

  it("passes a website through without a search resolution and tolerates a { data:[...] } nest", async () => {
    let sawSearch = false;
    const base = runFetcher({
      news: completed("run_news_2", { data: [{ title: "News item", sentiment: "negative" }] }),
    });
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
      const endpoint = (() => {
        try {
          return (JSON.parse(String(init?.body ?? "{}")) as { endpoint?: string }).endpoint ?? "";
        } catch {
          return "";
        }
      })();
      if (endpoint === "/v1/company/search") sawSearch = true;
      return (base as unknown as (i: unknown, x?: unknown) => Promise<Response>)(input, init);
    }) as unknown as typeof fetch;

    const out = await collectCompanyNews("acme.xyz", { fetcher, sentiment: "negative" });
    expect(sawSearch).toBe(false); // url skips resolution
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.company).toBe("acme.xyz");
    expect(out.value.articles).toHaveLength(1);
    expect(out.value.articles[0].sentiment).toBe("negative");
  });

  it("reports reason:'unavailable' on a transport error", async () => {
    const out = await collectCompanyNews("acme.xyz", { fetcher: throwingFetcher });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("unavailable");
  });
});

describe("collectTokenContractRisk", () => {
  it("returns { available:false, reason:'no_key' } when MONID_API_KEY is unset", async () => {
    delete process.env[KEY];
    const out = await collectTokenContractRisk({ tokenId: "ethereum", fetcher: runFetcher({}) });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("no_key");
  });

  it("parses risk signals from a completed run and preserves raw", async () => {
    const data = {
      market_price: { usd: 1.23 },
      token_contract_safety: { honeypot: false, score: 88 },
      deployer_wallet_risk: { flagged: false },
      protocol_health: { tvl_usd: 1_000_000 },
      sentiment: { label: "neutral" },
      gas: { gwei: 12 },
    };
    const out = await collectTokenContractRisk({
      tokenId: "0xtoken",
      contractAddress: "0xabc",
      protocol: "uniswap",
      chainId: "1",
      fetcher: runFetcher({ pretrade: completed("run_pretrade_1", data) }),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");

    expect(out.value.tokenId).toBe("0xtoken");
    expect(out.value.contractSafety).toEqual({ honeypot: false, score: 88 });
    expect(out.value.deployerRisk).toEqual({ flagged: false });
    expect(out.value.protocolHealth).toEqual({ tvl_usd: 1_000_000 });
    expect(out.value.sentiment).toEqual({ label: "neutral" });
    expect(out.value.raw).toEqual(data); // nothing lost
  });

  it("reports reason:'unavailable' on a transport error", async () => {
    const out = await collectTokenContractRisk({ tokenId: "0xtoken", fetcher: throwingFetcher });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.reason).toBe("unavailable");
  });
});
