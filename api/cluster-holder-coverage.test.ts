import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./_auth.js", () => ({ requireArgusAuth: vi.fn(async () => ({ organizationId: "org", userId: "user" })) }));
vi.mock("./_cache.js", () => ({ resolvePanelCostVersion: vi.fn(() => "version"), attachPanelCost: vi.fn(async () => {}) }));
import evm from "./evm-cluster";
import solana from "./cluster";
const token = `0x${"1".repeat(40)}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "a")}`;
async function run(handler: typeof evm, query: Record<string, string>) {
  let body: any;
  const res = { status() { return this; }, json(value: any) { body = value; return this; } };
  await handler({ query, headers: { "x-argus-panel-token": "capability" } } as never, res as never);
  return body;
}
beforeEach(() => { vi.stubEnv("ETHERSCAN_API_KEY", "test"); vi.stubEnv("HELIUS_API_KEY", "test"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("traces rank 25 and keeps unknown contract holders", async () => {
  const holders = Array.from({ length: 25 }, (_, i) => ({ address: { hash: addr(i + 1), is_contract: i === 24 }, value: "1" }));
  vi.stubGlobal("fetch", vi.fn(async input => {
    const url = String(input);
    if (url.includes("goplus")) return Response.json({ result: { [token]: { holders: [] } } });
    if (url.includes("/holders")) return Response.json({ items: holders });
    if (url.includes("/api/v2/tokens/")) return Response.json({ total_supply: "100" });
    return Response.json({ status: "0", result: "No transactions found" });
  }));
  const result = await run(evm, { address: token, chain: "base" });
  expect(result.holderIntelligence).toMatchObject({ target: 25, examined: 25, status: "complete", source: "blockscout" });
  expect(result.allWallets).toHaveLength(25);
  expect(result.allWallets).toContainEqual(expect.objectContaining({ address: addr(25) }));
});
it("keeps GoPlus ten-holder fallback explicitly partial when the explorer is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async input => {
    const url = String(input);
    if (url.includes("goplus")) return Response.json({ result: { [token]: { holders: Array.from({ length: 10 }, (_, i) => ({ address: addr(i + 1), percent: "0.01" })) } } });
    if (url.includes("/api/v2/")) return new Response("unavailable", { status: 403 });
    return Response.json({ status: "0", result: "No transactions found" });
  }));
  const result = await run(evm, { address: token, chain: "base" });
  expect(result.holderIntelligence).toMatchObject({ examined: 10, status: "partial" });
  expect(result.note).toContain("10/25 (partial)");
});
it("aggregates explicit Solana owner accounts and does not assert global top-25 coverage", async () => {
  const owner = "B".repeat(32), other = "C".repeat(32);
  vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("rugcheck")
    ? Response.json({ topHolders: [{ address: "D".repeat(32), owner, pct: 4 }, { address: "E".repeat(32), owner, pct: 3 }, { address: "F".repeat(32), owner: other, pct: 2 }] })
    : Response.json({ result: [] })));
  const result = await run(solana, { mint: "A".repeat(32), chain: "solana" });
  expect(result.holderIntelligence).toMatchObject({ examined: 2, status: "partial", ranking: "observed-owners" });
  expect(result.allWallets).toContainEqual(expect.objectContaining({ address: owner, pct: 7 }));
});
