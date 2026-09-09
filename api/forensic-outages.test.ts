import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./_auth.js", () => ({ requireArgusAuth: vi.fn(async () => ({ organizationId: "org", userId: "user" })) }));
vi.mock("./_cache.js", () => ({ resolvePanelCostVersion: vi.fn(() => "version"), attachPanelCost: vi.fn(), cacheGetJson: vi.fn(async () => null), cacheSetJson: vi.fn() }));
import { attachPanelCost, cacheSetJson } from "./_cache.js";
import arkham from "./arkham";
import evm from "./evm-deployer";
import flow from "./arkham-money-flow";
import burns from "./burns";
const address = `0x${"1".repeat(40)}`;
async function run(handler: (req: never, res: never) => Promise<unknown>, query = { address, chain: "ethereum" } as Record<string, string>) {
  let body: Record<string, unknown> = {};
  const res = { status() { return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
  await handler({ headers: { "x-argus-panel-token": "token" }, query } as never, res as never);
  return body;
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ARKHAM_API_KEY", "test"); vi.stubEnv("ETHERSCAN_API_KEY", "test"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("forensic provider outages", () => {
  it("does not cache rate-limited Arkham as a riskless unlabeled wallet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limit", { status: 429 })));
    expect(await run(arkham)).toMatchObject({ available: false });
    expect(cacheSetJson).not.toHaveBeenCalled();
    expect(attachPanelCost).toHaveBeenCalledWith("org", "version", expect.objectContaining({ status: "failed" }));
  });
  it("treats Etherscan HTTP-200 NOTOK as failed provider work", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "0", message: "NOTOK", result: "Max rate limit reached" }))));
    expect(await run(evm)).toMatchObject({ available: false });
    expect(attachPanelCost).toHaveBeenCalledWith("org", "version", expect.objectContaining({ status: "failed" }));
    expect(await run(burns)).toMatchObject({ available: false });
  });
  it("does not cache money flow when only one read completes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url).includes("transfers") ? new Response("error", { status: 503 }) : new Response("{}")));
    expect(await run(flow)).toMatchObject({ available: false, coverage: { flow: true, transfers: false } });
    expect(cacheSetJson).not.toHaveBeenCalled();
  });
});


describe("burn history measured absence", () => {
  it.each([[[]], ["No transactions found"]])("preserves a completed empty history (%j)", async (result) => {
    vi.stubGlobal("fetch", vi.fn(async (input) => new Response(JSON.stringify(
      String(input).includes("action=tokensupply") ? { status: "1", result: "1000000000000000000000" }
        : { status: "0", message: "No transactions found", result },
    ))));
    expect(await run(burns)).toMatchObject({ available: true, count: 0, totalBurned: 0, cadence: "none" });
  });
  it("retains burns when the other burn address completes empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));
      const data = url.searchParams.get("action") === "tokensupply" ? { status: "1", result: "1000000" }
        : url.searchParams.get("address")?.endsWith("dead") ? { status: "1", result: [{
          to: url.searchParams.get("address"), tokenDecimal: "3", value: "1000", timeStamp: "1700000000",
        }] } : { status: "0", message: "No transactions found", result: [] };
      return new Response(JSON.stringify(data));
    }));
    expect(await run(burns)).toMatchObject({ available: true, count: 1, totalBurned: 1, burnedSupplyPct: 0.1 });
  });
});


describe("independent Arkham outcomes", () => {
  it("retains and caches a successful address beside an unavailable sibling", async () => {
    const other = `0x${"2".repeat(40)}`;
    vi.stubGlobal("fetch", vi.fn(async (input) => String(input).includes(other)
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify(String(input).includes("/risk/") ? { risk_level: "NONE" } : { arkhamEntity: { name: "Verified label" } }))));
    expect(await run(arkham, { addresses: `${address},${other}` })).toMatchObject({ available: false,
      labels: { [address]: { name: "Verified label" } }, coverage: { addresses: { [address]: "complete", [other]: "unavailable" } } });
    expect(cacheSetJson).toHaveBeenCalledTimes(1);
    expect(cacheSetJson).toHaveBeenCalledWith(expect.stringContaining(address), expect.objectContaining({ name: "Verified label" }));
  });
  it("accepts a completed basic fallback while accounting for the failed enriched call", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => String(input).includes("address_enriched")
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify(String(input).includes("/risk/") ? { risk_level: "NONE" } : { arkhamEntity: { name: "Fallback label" } }))));
    expect(await run(arkham)).toMatchObject({ available: true, labels: { [address]: { name: "Fallback label" } }, coverage: { attempted: 3, succeeded: 2 } });
    expect(attachPanelCost).toHaveBeenCalledWith("org", "version", expect.objectContaining({ calls: 3, status: "partial" }));
  });
});

describe("Etherscan creation measured absence", () => {
  it("returns not resolvable for a completed no-data creation lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "0", message: "NOTOK", result: "No data found" }))));
    expect(await run(evm)).toMatchObject({ available: true, deployer: null, note: "Deployer not resolvable from contract-creation records." });
    expect(attachPanelCost).toHaveBeenCalledWith("org", "version", expect.objectContaining({ status: "succeeded", calls: 1 }));
  });
  it("does not treat that creation-only response as a completed wallet history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "0", message: "NOTOK", result: "No data found" }))));
    expect(await run(evm, { wallet: address, chain: "ethereum" })).toMatchObject({ available: false });
  });
});
