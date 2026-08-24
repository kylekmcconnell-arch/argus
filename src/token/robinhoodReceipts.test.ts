// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenChecks } from "../lib/scanChecklist";
import { auditToken } from "./audit";

const ADDRESS = "0x5a86828Efd322bfb16d93cFeD16EE9BC14940D7F";
const ADDRESS_KEY = ADDRESS.toLowerCase();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Robinhood Chain completion receipts", () => {
  it("completes Qutron tradeability and clean clustering without inventing a simulation", async () => {
    const pair = {
      chainId: "robinhood",
      dexId: "uniswap",
      pairAddress: "0x0b142aaf734f1b063355bfe854e282a13b26dcac86e2e564e74540f9b218d069",
      baseToken: { address: ADDRESS, name: "Qutron", symbol: "QUTRON" },
      quoteToken: { symbol: "WETH" },
      priceUsd: "0.0042",
      liquidity: { usd: 215_863.66 },
      marketCap: 4_210_000,
      fdv: 4_210_000,
      volume: { h24: 1_614_234.05 },
      txns: { h24: { buys: 2_322, sells: 1_577 } },
      priceChange: { h24: 4 },
    };
    const goplus = {
      is_in_dex: "0",
      cannot_buy: "0",
      cannot_sell_all: null,
      buy_tax: "",
      sell_tax: "",
      is_honeypot: "0",
      holder_count: "1467",
      creator_address: "0x7171e64e979265aed6588577d1c6b60a701d7866",
      owner_change_balance: "1",
      is_blacklisted: "1",
      transfer_pausable: "1",
      holders: [],
    };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("dexscreener")) return json({ pairs: [pair] });
      if (url.includes("gopluslabs")) return json({ code: 1, result: { [ADDRESS_KEY]: goplus } });
      if (url.includes("api.honeypot.is")) return json({ error: "Unsupported chain" }, 400);
      if (url.endsWith(`/api/v2/tokens/${ADDRESS}/holders`)) {
        return json({ items: [
          { value: "40000000", address: { hash: "0x1111111111111111111111111111111111111111", is_contract: false } },
          { value: "30000000", address: { hash: "0x2222222222222222222222222222222222222222", is_contract: false } },
        ] });
      }
      if (url.endsWith(`/api/v2/tokens/${ADDRESS}`)) return json({ total_supply: "1000000000" });
      if (url.includes("/api/v2/smart-contracts/")) return json({ name: "Qutron", is_verified: true, source_code: "contract Qutron {}" });
      return json({}, 404);
    }));

    const dossier = await auditToken(
      { kind: "token", ref: ADDRESS, via: "evm" },
      undefined,
      {
        force: true,
        screenSanctions: async () => ({
          available: true,
          checked: 3,
          listSize: 189,
          sanctioned: [],
          completedAt: "2026-08-24T06:45:00.000Z",
        }),
      },
    );

    expect(dossier?.safety).toMatchObject({
      simChecked: false,
      tradeabilityAssessed: true,
      tradeabilityMethod: "observed-market",
      observedBuys24h: 2_322,
      observedSells24h: 1_577,
    });
    expect(dossier?.holdersAssessed).toBe(true);
    const checks = tokenChecks(dossier!);
    expect(checks.find((check) => check.checkId === "buy-sell-simulation")).toMatchObject({
      label: "Tradeability check",
      status: "finding",
    });
    expect(checks.find((check) => check.checkId === "wallet-clustering")).toMatchObject({
      status: "confirmed",
    });
  });
});
