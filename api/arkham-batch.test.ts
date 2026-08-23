import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAddressLabelsBatch, fetchAddressRiskBatch, fetchAddressRiskPaths } from "./_arkham-core";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Arkham batch reads", () => {
  it("sends one call for many addresses and keys rows case-insensitively", async () => {
    const fetchMock = vi.fn(async () => json({ addresses: {
      "0xAAA": { arkhamEntity: { name: "Binance", type: "cex" } },
      "0xBBB": { contract: true, arkhamLabel: { name: "Some Token" } },
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAddressLabelsBatch(["0xAAA", "0xBBB", "0xCCC"], "key");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/intelligence/address_enriched/batch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ addresses: ["0xAAA", "0xBBB", "0xCCC"] });
    expect(result.rows.get("0xaaa")).toMatchObject({ name: "Binance", isCex: true, isContract: false });
    expect(result.rows.get("0xbbb")?.isContract).toBe(true);
    expect(result.rows.has("0xccc")).toBe(false);
  });

  it("reads isUserAddress:false as a contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ addresses: { "0xAAA": { isUserAddress: false } } })));
    expect((await fetchAddressLabelsBatch(["0xAAA"], "key")).rows.get("0xaaa")?.isContract).toBe(true);
  });

  it("accepts a bare address-keyed risk response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      "0xAAA": { risk_level: "SEVERE", max_score: 100, mixer_score: 100, is_seed: true },
    })));
    const result = await fetchAddressRiskBatch(["0xAAA"], "key");
    expect(result.rows.get("0xaaa")).toMatchObject({ level: "SEVERE", score: 100, isSeed: true });
    expect(result.rows.get("0xaaa")?.categoryScores).toEqual([{ category: "mixer", score: 100 }]);
  });

  it.each([402, 403])("separates an unentitled add-on (%i) from provider failure", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "nope" }, status)));
    expect(await fetchAddressRiskBatch(["0xAAA"], "key")).toMatchObject({ outcome: "unentitled", status });
  });

  it.each([429, 500, 503])("reports other HTTP failures as unavailable (%i)", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "nope" }, status)));
    expect((await fetchAddressRiskBatch(["0xAAA"], "key")).outcome).toBe("unavailable");
  });

  it("reports transport failure as unavailable and spends no call on an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect((await fetchAddressLabelsBatch(["0xAAA"], "key")).outcome).toBe("unavailable");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAddressRiskBatch([], "key")).toMatchObject({ outcome: "answered", calls: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Arkham risk-path seed labelling", () => {
  const paths = {
    risk_level: "HIGH",
    max_score: 70,
    top_sources: [
      { seed_address: "0xSEED1", direction: "backward", contribution_usd: 90, hop_distance: 1 },
      { seed_address: "0xSEED2", direction: "forward", contribution_usd: 40, hop_distance: 2 },
    ],
  };

  it("keeps the legacy per-seed default for existing panel callers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/intelligence/address/")
      ? json({ arkhamEntity: { name: "Tornado.Cash", type: "mixer" } })
      : json(paths));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAddressRiskPaths("0xAAA", "key");
    expect(result.calls).toBe(3);
    expect(result.paths[0].seedName).toBe("Tornado.Cash");
  });

  it("uses a supplied batch labeller in the audit lane", async () => {
    const fetchMock = vi.fn(async () => json(paths));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAddressRiskPaths("0xAAA", "key", async (seeds) => ({
      names: new Map(seeds.map((seed) => [seed.toLowerCase(), { name: `entity ${seed}` }])),
      calls: 1,
      succeeded: 1,
    }));
    expect(result.paths.map((path) => path.seedName)).toEqual(["entity 0xSEED1", "entity 0xSEED2"]);
    expect(result.calls).toBe(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
