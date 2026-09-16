import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "./burns";

// 2026-09-14 deep-dive review, token lane finding 14. A burn() (ERC20Burnable)
// emits a Transfer to 0x0 AND reduces totalSupply, so dividing the burned
// amount by the CURRENT supply overstated the share: a token that burned half
// its supply reported 100% burned (clamped). The share is measured against the
// original supply (current supply plus everything sent to 0x0); transfers to
// 0xdead leave totalSupply untouched and need no correction.

const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const wei = (units: number) => (BigInt(units) * 10n ** 18n).toString();

function stub(opts: { supplyUnits: number; toZero: number[]; toDead: number[] }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("action=tokensupply")) return new Response(JSON.stringify({ status: "1", result: wei(opts.supplyUnits) }), { status: 200 });
    if (u.includes("action=tokentx")) {
      const burn = u.includes(`address=${ZERO}`) ? ZERO : DEAD;
      const amounts = burn === ZERO ? opts.toZero : opts.toDead;
      if (!amounts.length) return new Response(JSON.stringify({ status: "0", message: "No transactions found", result: [] }), { status: 200 });
      return new Response(JSON.stringify({ status: "1", result: amounts.map((units, i) => ({ to: burn, value: wei(units), tokenDecimal: "18", timeStamp: String(1_700_000_000 + i * 86_400) })) }), { status: 200 });
    }
    throw new Error(`unexpected ${u}`);
  }));
}

async function run() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
    setHeader() { return this; },
  };
  await handler({ method: "GET", query: { address: TOKEN, chain: "ethereum" }, headers: {} } as never, res as never);
  return captured.body!;
}

beforeEach(() => vi.stubEnv("ETHERSCAN_API_KEY", "key"));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("burned share of supply", () => {
  it("a burn() that halved the supply is 50% burned, not 100%", async () => {
    // Original 1,000,000; 500,000 burned via burn() -> totalSupply now 500,000.
    stub({ supplyUnits: 500_000, toZero: [250_000, 250_000], toDead: [] });
    const body = await run();
    expect(body.count).toBe(2);
    expect(body.burnedSupplyPct).toBeCloseTo(50, 6);
  });

  it("transfers to 0xdead do not reduce totalSupply and need no correction", async () => {
    stub({ supplyUnits: 1_000_000, toZero: [], toDead: [100_000] });
    const body = await run();
    expect(body.burnedSupplyPct).toBeCloseTo(10, 6);
  });

  it("mixed burns measure both kinds against the original supply", async () => {
    // Original 1,000,000: 200,000 via burn() (supply now 800,000) + 100,000 to dead.
    stub({ supplyUnits: 800_000, toZero: [200_000], toDead: [100_000] });
    const body = await run();
    expect(body.burnedSupplyPct).toBeCloseTo(30, 6);
  });
});
