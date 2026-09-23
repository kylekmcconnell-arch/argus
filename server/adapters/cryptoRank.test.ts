import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectCryptoRankFunding,
  contractJoin,
  cryptoRankConfigured,
  officialSurfacesFromLinks,
  roundDateFromEpoch,
} from "./cryptoRank";

const AMMALGAM_ADDRESS = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.stubEnv("CRYPTORANK_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes each request path to a canned response; unmatched paths 404. */
const routedFetcher = (routes: Array<[RegExp, () => Response]>) =>
  ((input: string | URL | Request) => {
    const url = String(input);
    for (const [pattern, make] of routes) {
      if (pattern.test(url)) return Promise.resolve(make());
    }
    return Promise.resolve(jsonResponse({ message: "not found" }, 404));
  }) as unknown as typeof fetch;

const listBody = (items: unknown[]) => ({ status: { usedCredits: 1 }, data: items });

const detailBody = (over: Record<string, unknown> = {}) => ({
  status: { usedCredits: 1 },
  data: {
    id: 42,
    key: "ammalgam",
    symbol: "AMLG",
    name: "Ammalgam",
    hasFundingRounds: true,
    contracts: [
      { address: AMMALGAM_ADDRESS, decimals: 18, platform: { id: 1, key: "ethereum", name: "Ethereum" } },
    ],
    ...over,
  },
});

const roundsBody = () => ({
  status: { usedCredits: 1 },
  data: {
    id: 42,
    key: "ammalgam",
    totalFundingRaise: "3250000",
    fundingRounds: [
      {
        stage: "PRE SEED",
        announcementDate: 1_672_531_200_000, // 2023-01-01 → year-only per provider convention
        announcementLink: "https://example.com/pre-seed",
        raise: "750000",
        valuation: null,
        funds: [{ id: 1, key: "af", name: "Angel Fund", logo: null, tier: 2, isLead: false }],
      },
      {
        stage: "SEED",
        announcementDate: 1_717_200_000_000, // 2024-06-01
        announcementLink: "https://example.com/seed",
        raise: "2500000",
        valuation: "25000000",
        funds: [
          { id: 2, key: "lf", name: "Lightspeed Faction", logo: null, tier: 1, isLead: true },
          { id: 3, key: "fw", name: "Framework Ventures", logo: null, tier: 1, isLead: true },
          { id: 4, key: "sc", name: "Small Cap Partners", logo: null, tier: 3, isLead: false },
        ],
      },
    ],
  },
});

const metadataBody = (over: Record<string, unknown> = {}) => ({
  status: { usedCredits: 1 },
  data: {
    id: 42,
    key: "ammalgam",
    symbol: null,
    name: "Ammalgam",
    hasFundingRounds: true,
    links: [
      { type: "web", value: "https://ammalgam.xyz/" },
      { type: "twitter", value: "https://x.com/ammalgam" },
    ],
    funds: [
      { id: 2, key: "lf", name: "Lightspeed Faction", logo: null, tier: 1, isLead: true },
      { id: 3, key: "fw", name: "Framework Ventures", logo: null, tier: 1, isLead: true },
    ],
    ...over,
  },
});

describe("cryptoRankConfigured", () => {
  it("reflects the presence of the API key", () => {
    expect(cryptoRankConfigured()).toBe(true);
    vi.stubEnv("CRYPTORANK_API_KEY", "");
    expect(cryptoRankConfigured()).toBe(false);
  });
});

describe("roundDateFromEpoch", () => {
  it("degrades a 01-01 date to the bare year the provider actually knows", () => {
    expect(roundDateFromEpoch(1_672_531_200_000)).toBe("2023");
    expect(roundDateFromEpoch(1_717_200_000_000)).toBe("2024-06-01");
  });

  it("tolerates second-precision epochs and rejects junk", () => {
    expect(roundDateFromEpoch(1_717_200_000)).toBe("2024-06-01");
    expect(roundDateFromEpoch("2024-06-01")).toBeNull();
    expect(roundDateFromEpoch(0)).toBeNull();
  });
});

describe("contractJoin", () => {
  const contracts = [
    { address: AMMALGAM_ADDRESS.toUpperCase().replace("0X", "0x"), decimals: 18, platform: { key: "ethereum", name: "Ethereum" } },
  ];

  it("joins EVM addresses case-insensitively and honors chain agreement", () => {
    expect(contractJoin(contracts, AMMALGAM_ADDRESS, "Ethereum")).toMatchObject({ platform: "Ethereum" });
    expect(contractJoin(contracts, AMMALGAM_ADDRESS, null)).not.toBeNull();
  });

  it("fails closed when both sides name clearly different chains", () => {
    expect(contractJoin(contracts, AMMALGAM_ADDRESS, "solana")).toBeNull();
  });

  it("never joins a different address", () => {
    expect(contractJoin(contracts, "0x2222222222222222222222222222222222222222", "ethereum")).toBeNull();
  });
});

describe("officialSurfacesFromLinks", () => {
  it("extracts the site and the bare X handle from profile-URL links", () => {
    expect(officialSurfacesFromLinks([
      { type: "web", value: "https://ammalgam.xyz/" },
      { type: "twitter", value: "https://x.com/ammalgam" },
      { type: "github", value: "https://github.com/ammalgam-protocol" },
    ])).toEqual({ officialTwitter: "ammalgam", officialUrl: "https://ammalgam.xyz/" });
  });
});

describe("collectCryptoRankFunding", () => {
  it("reports not_configured without touching the network when the key is absent", async () => {
    vi.stubEnv("CRYPTORANK_API_KEY", "");
    const fetcher = vi.fn();
    const out = await collectCryptoRankFunding({ name: "Ammalgam" }, { fetcher: fetcher as unknown as typeof fetch });
    expect(out).toMatchObject({ available: false, reason: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("binds by exact contract address and maps rounds, leads, and totals", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\?symbol=AMLG/, () => jsonResponse(listBody([{ id: 42, key: "ammalgam", symbol: "AMLG", name: "Ammalgam", type: "token" }]))],
      [/\/currencies\/42\/funding-rounds$/, () => jsonResponse(roundsBody())],
      [/\/currencies\/42$/, () => jsonResponse(detailBody())],
    ]);
    const out = await collectCryptoRankFunding(
      { name: "Ammalgam", symbol: "AMLG", contractAddress: AMMALGAM_ADDRESS, chain: "ethereum" },
      { fetcher },
    );
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.binding).toMatchObject({ method: "canonical_token_address", address: AMMALGAM_ADDRESS });
    expect(out.value.rounds).toHaveLength(2);
    expect(out.value.rounds[0]).toMatchObject({ stage: "PRE SEED", date: "2023", amountUsd: 750_000 });
    expect(out.value.rounds[1]).toMatchObject({
      stage: "SEED",
      date: "2024-06-01",
      amountUsd: 2_500_000,
      valuationUsd: 25_000_000,
      leadInvestors: ["Lightspeed Faction", "Framework Ventures"],
      otherInvestors: ["Small Cap Partners"],
      announcementUrl: "https://example.com/seed",
    });
    expect(out.value.totalRaisedUsd).toBe(3_250_000);
    expect(out.value.access).toEqual({ fundingRounds: "ok", fullMetadata: "not_needed" });
    expect(out.value.sourceUrl).toBe("https://cryptorank.io/price/ammalgam");
  });

  it("never binds a namesake: candidates without a contract or identity join stay unused", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\?symbol=AMLG/, () => jsonResponse(listBody([{ id: 7, key: "ammalgam-fake", symbol: "AMLG", name: "Ammalgam", type: "token" }]))],
      [/\/currencies\/7$/, () => jsonResponse(detailBody({
        id: 7,
        key: "ammalgam-fake",
        contracts: [{ address: "0x9999999999999999999999999999999999999999", decimals: 18, platform: { key: "ethereum", name: "Ethereum" } }],
      }))],
    ]);
    const out = await collectCryptoRankFunding(
      { name: "Ammalgam", symbol: "AMLG", contractAddress: AMMALGAM_ADDRESS, chain: "ethereum" },
      { fetcher },
    );
    expect(out).toMatchObject({ available: false, reason: "no_data" });
  });

  it("binds a tokenless project through full-metadata official surfaces", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\/map/, () => jsonResponse(listBody([
        { id: 41, key: "ammo", symbol: null, name: "Ammo Protocol", type: "no-token" },
        { id: 42, key: "ammalgam", symbol: null, name: "Ammalgam", type: "no-token" },
      ]))],
      [/\/currencies\/42\/full-metadata$/, () => jsonResponse(metadataBody())],
      [/\/currencies\/42\/funding-rounds$/, () => jsonResponse(roundsBody())],
      [/\/currencies\/42$/, () => jsonResponse(detailBody({ contracts: [] }))],
    ]);
    const out = await collectCryptoRankFunding(
      {
        name: "Ammalgam",
        matchesOfficialIdentity: (record) => record.officialTwitter === "ammalgam",
      },
      { fetcher },
    );
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.binding).toMatchObject({ method: "official_identity", officialTwitter: "ammalgam", officialUrl: "https://ammalgam.xyz/" });
    expect(out.value.rounds).toHaveLength(2);
  });

  it("degrades to named funds when the rounds endpoint is plan-gated", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\?symbol=AMLG/, () => jsonResponse(listBody([{ id: 42, key: "ammalgam", symbol: "AMLG", name: "Ammalgam", type: "token" }]))],
      [/\/currencies\/42\/funding-rounds$/, () => jsonResponse({ message: "forbidden" }, 403)],
      [/\/currencies\/42\/full-metadata$/, () => jsonResponse(metadataBody())],
      [/\/currencies\/42$/, () => jsonResponse(detailBody())],
    ]);
    const out = await collectCryptoRankFunding(
      { name: "Ammalgam", symbol: "AMLG", contractAddress: AMMALGAM_ADDRESS, chain: "ethereum" },
      { fetcher },
    );
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.rounds).toHaveLength(0);
    expect(out.value.hasFundingRounds).toBe(true);
    expect(out.value.funds.map((fund) => fund.name)).toEqual(["Lightspeed Faction", "Framework Ventures"]);
    expect(out.value.access).toEqual({ fundingRounds: "plan_gated", fullMetadata: "ok" });
  });

  it("keeps the bare hint when every detail endpoint is plan-gated", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\?symbol=AMLG/, () => jsonResponse(listBody([{ id: 42, key: "ammalgam", symbol: "AMLG", name: "Ammalgam", type: "token" }]))],
      [/\/currencies\/42\/(funding-rounds|full-metadata)$/, () => jsonResponse({ message: "forbidden" }, 403)],
      [/\/currencies\/42$/, () => jsonResponse(detailBody())],
    ]);
    const out = await collectCryptoRankFunding(
      { name: "Ammalgam", symbol: "AMLG", contractAddress: AMMALGAM_ADDRESS, chain: "ethereum" },
      { fetcher },
    );
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.hasFundingRounds).toBe(true);
    expect(out.value.rounds).toHaveLength(0);
    expect(out.value.funds).toHaveLength(0);
    expect(out.value.access).toEqual({ fundingRounds: "plan_gated", fullMetadata: "plan_gated" });
  });

  it("reports unavailable, never unfunded, when the identity surfaces are plan-gated for a tokenless subject", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\/map/, () => jsonResponse(listBody([{ id: 42, key: "ammalgam", symbol: null, name: "Ammalgam", type: "no-token" }]))],
      [/\/currencies\/42\/full-metadata$/, () => jsonResponse({ message: "forbidden" }, 403)],
      [/\/currencies\/42$/, () => jsonResponse(detailBody({ contracts: [] }))],
    ]);
    const out = await collectCryptoRankFunding(
      { name: "Ammalgam", matchesOfficialIdentity: () => true },
      { fetcher },
    );
    expect(out).toMatchObject({ available: false, reason: "unavailable" });
  });

  it("distinguishes a rejected key and a provider outage from no_data", async () => {
    const unauthorized = routedFetcher([[/\/currencies\?symbol=/, () => jsonResponse({ message: "unauthorized" }, 401)]]);
    expect(await collectCryptoRankFunding({ name: "Ammalgam", symbol: "AMLG" }, { fetcher: unauthorized }))
      .toMatchObject({ available: false, reason: "unavailable" });
    const outage = routedFetcher([[/\/currencies\?symbol=/, () => jsonResponse({ message: "boom" }, 500)]]);
    expect(await collectCryptoRankFunding({ name: "Ammalgam", symbol: "AMLG" }, { fetcher: outage }))
      .toMatchObject({ available: false, reason: "unavailable" });
  });

  it("reports checked-empty corroboration when the bound record lists no rounds", async () => {
    const fetcher = routedFetcher([
      [/\/currencies\?symbol=AMLG/, () => jsonResponse(listBody([{ id: 42, key: "ammalgam", symbol: "AMLG", name: "Ammalgam", type: "token" }]))],
      [/\/currencies\/42$/, () => jsonResponse(detailBody({ hasFundingRounds: false }))],
    ]);
    const out = await collectCryptoRankFunding(
      { name: "Ammalgam", symbol: "AMLG", contractAddress: AMMALGAM_ADDRESS, chain: "ethereum" },
      { fetcher },
    );
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.hasFundingRounds).toBe(false);
    expect(out.value.rounds).toHaveLength(0);
  });
});
