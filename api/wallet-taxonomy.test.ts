import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import taxonomy from "./wallet-taxonomy";

const mint = "A".repeat(32);
const holder = "B".repeat(32);
const evmToken = `0x${"1".repeat(40)}`;
const evmHolder = `0x${"2".repeat(40)}`;

async function run(query: Record<string, string>) {
  let status = 200;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) { status = code; return this; },
    json(value: Record<string, unknown>) { body = value; return this; },
    setHeader() { return this; },
  };
  await taxonomy({ query } as never, res as never);
  return { status, body };
}

beforeEach(() => {
  vi.stubEnv("HELIUS_API_KEY", "helius");
  vi.stubEnv("ETHERSCAN_API_KEY", "etherscan");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("wallet taxonomy provider outages", () => {
  it("does not treat a Helius RPC error as measured unknown age", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      if (String(input).includes("rugcheck")) {
        return new Response(JSON.stringify({ topHolders: [{ owner: holder, pct: 12 }] }));
      }
      return new Response(JSON.stringify({ error: { code: -32000, message: "rate limited" } }));
    }));
    expect(await run({ address: mint, chain: "solana" })).toMatchObject({
      status: 200,
      body: { available: false, analyzed: 0, coverage: { attempted: 1, assessed: 0 }, cohorts: { unknown: { n: 0, pct: 0 } } },
    });
  });

  it("does not treat an Etherscan NOTOK as a completed holder history", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      if (String(input).includes("gopluslabs")) {
        return new Response(JSON.stringify({ result: { [evmToken]: { holders: [{ address: evmHolder, percent: 0.2 }] } } }));
      }
      return new Response(JSON.stringify({ status: "0", message: "NOTOK", result: "Max rate limit reached" }));
    }));
    expect(await run({ address: evmToken, chain: "ethereum" })).toMatchObject({
      status: 200,
      body: { available: false, analyzed: 0, coverage: { attempted: 1, assessed: 0 } },
    });
  });
});
