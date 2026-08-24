import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachPanelCost, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ attachPanelCost, resolvePanelCostVersion }));

import evmFunderHandler from "./evm-funder";
import solanaFunderHandler from "./funder";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const VERSION_ID = "00000000-0000-4000-8000-000000000222";
const SOL_WALLET = "A".repeat(32);
const EVM_WALLET = "0x1111111111111111111111111111111111111111";

function response() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
  };
  return { res, captured };
}

function request(wallet: string, chain?: string) {
  return {
    method: "GET",
    headers: { "x-argus-panel-token": "signed-panel" },
    query: { wallet, ...(chain ? { chain } : {}) },
  };
}

const noTransactions = () => new Response(JSON.stringify({
  status: "0",
  message: "No transactions found",
  result: "No transactions found",
}), { status: 200 });

describe("funder sweep completion contracts", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: "user-1" });
    resolvePanelCostVersion.mockReset().mockReturnValue(VERSION_ID);
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    vi.stubEnv("ETHERSCAN_API_KEY", "etherscan-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["Solana", solanaFunderHandler, request(SOL_WALLET)],
    ["EVM", evmFunderHandler, request(EVM_WALLET, "ethereum")],
  ])("does not turn a %s provider failure into exact zero launches", async (_chain, handler, req) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const { res, captured } = response();

    await handler(req as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      completed: false,
      truncated: false,
      providerFailed: true,
      countsAreLowerBounds: true,
      ownLaunches: null,
      seededCount: null,
      totalTokens: null,
      note: expect.stringContaining("cannot rule out a serial-launch pattern"),
    });
    expect(captured.body?.note).not.toMatch(/no launches|none of which|no serial-launch pattern/i);
  });

  it.each([
    ["Solana", "HELIUS_API_KEY", solanaFunderHandler, request(SOL_WALLET)],
    ["EVM", "ETHERSCAN_API_KEY", evmFunderHandler, request(EVM_WALLET, "ethereum")],
  ])("exposes explicit incomplete state when the %s provider is not configured", async (_chain, envName, handler, req) => {
    vi.stubEnv(envName, "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(req as never, res as never);

    expect(captured.body).toMatchObject({
      available: false,
      completed: false,
      truncated: false,
      providerFailed: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks a full Helius page as truncated instead of publishing zero launches", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ signature: `sig-${index}` }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(fullPage), { status: 200 }))));
    const { res, captured } = response();

    await solanaFunderHandler(request(SOL_WALLET) as never, res as never);

    expect(captured.body).toMatchObject({
      available: true,
      completed: false,
      truncated: true,
      providerFailed: false,
      ownLaunches: null,
      seededCount: null,
      totalTokens: null,
      coverage: { ownHistory: { completed: false, truncated: true } },
    });
    expect(captured.body?.note).toContain("bounded history was cut short");
  });

  it("marks the EVM recipient cap as truncated and keeps empty observations unknown", async () => {
    const recipients = Array.from({ length: 31 }, (_, index) => `0x${(index + 100).toString(16).padStart(40, "0")}`);
    const seedRows = recipients.map((to) => ({
      from: EVM_WALLET,
      to,
      value: "10000000000000000",
    }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = new URL(String(input));
      const address = url.searchParams.get("address")?.toLowerCase();
      const offset = url.searchParams.get("offset");
      if (address === EVM_WALLET && offset === "4000") {
        return Promise.resolve(new Response(JSON.stringify({ status: "1", result: seedRows }), { status: 200 }));
      }
      return Promise.resolve(noTransactions());
    }));
    const { res, captured } = response();

    await evmFunderHandler(request(EVM_WALLET, "ethereum") as never, res as never);

    expect(captured.body).toMatchObject({
      available: true,
      completed: false,
      truncated: true,
      providerFailed: false,
      ownLaunches: null,
      seededCount: null,
      totalTokens: null,
      candidatesConsidered: 30,
      candidatesScanned: 30,
      coverage: { funderHistory: { completed: false, truncated: true } },
    });
    expect(captured.body?.note).toContain("cannot rule out a serial-launch pattern");
  });

  it.each([
    ["Solana", solanaFunderHandler, request(SOL_WALLET), () => new Response("[]", { status: 200 })],
    ["EVM", evmFunderHandler, request(EVM_WALLET, "ethereum"), noTransactions],
  ])("permits an exact zero only after the %s sweep completes", async (_chain, handler, req, providerResponse) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(providerResponse())));
    const { res, captured } = response();

    await handler(req as never, res as never);

    expect(captured.body).toMatchObject({
      available: true,
      completed: true,
      truncated: false,
      providerFailed: false,
      countsAreLowerBounds: false,
      ownLaunches: 0,
      seededCount: 0,
      totalTokens: 0,
    });
  });
});
