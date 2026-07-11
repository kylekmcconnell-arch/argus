import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  requireArgusAuth,
  resolvePanelCostVersion,
} = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  resolvePanelCostVersion,
}));

import arkhamCounterpartiesHandler from "./arkham-counterparties";
import arkhamHoldingsHandler from "./arkham-holdings";
import arkhamRiskPathsHandler from "./arkham-risk-paths";
import arkhamHandler from "./arkham";
import clusterHandler from "./cluster";
import cryptorankHandler from "./cryptorank";
import deployerHandler from "./deployer";
import evmClusterHandler from "./evm-cluster";
import evmDeployerHandler from "./evm-deployer";
import evmFunderHandler from "./evm-funder";
import funderHandler from "./funder";
import githubForensicsHandler from "./github-forensics";
import identitySweepHandler from "./identity-sweep";
import resolveGithubHandler from "./resolve-github";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000222";
const ADDRESS = `0x${"1".repeat(40)}`;
const SOL_ADDRESS = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";

type CostLine = { provider: string; op: string; calls: number; usd: number; meta: string };
type Handler = (req: never, res: never) => Promise<void>;
type Route = {
  name: string;
  handler: Handler;
  query: Record<string, string>;
  costs: CostLine[];
};

const routes: Route[] = [
  { name: "cryptorank", handler: cryptorankHandler, query: { symbol: "ARGUS" }, costs: [{ provider: "cryptorank", op: "panel:cryptorank", calls: 1, usd: 0, meta: "subscription/keyed" }] },
  { name: "arkham labels", handler: arkhamHandler, query: { address: ADDRESS }, costs: [{ provider: "arkham", op: "panel:arkham-labels", calls: 2, usd: 0, meta: "subscription/keyed" }] },
  { name: "arkham holdings", handler: arkhamHoldingsHandler, query: { address: ADDRESS, symbol: "ARGUS" }, costs: [{ provider: "arkham", op: "panel:arkham-holdings", calls: 1, usd: 0, meta: "subscription/keyed" }] },
  { name: "arkham counterparties", handler: arkhamCounterpartiesHandler, query: { address: ADDRESS }, costs: [{ provider: "arkham", op: "panel:arkham-counterparties", calls: 1, usd: 0, meta: "subscription/keyed" }] },
  { name: "arkham risk paths", handler: arkhamRiskPathsHandler, query: { address: ADDRESS }, costs: [{ provider: "arkham", op: "panel:arkham-risk-paths", calls: 1, usd: 0, meta: "subscription/keyed" }] },
  { name: "EVM deployer", handler: evmDeployerHandler, query: { address: ADDRESS, chain: "ethereum" }, costs: [{ provider: "etherscan", op: "panel:evm-deployer", calls: 1, usd: 0, meta: "subscription/keyed" }] },
  { name: "EVM cluster", handler: evmClusterHandler, query: { address: ADDRESS, chain: "ethereum" }, costs: [{ provider: "goplus", op: "panel:evm-cluster", calls: 1, usd: 0, meta: "keyless" }] },
  { name: "EVM funder", handler: evmFunderHandler, query: { wallet: ADDRESS, chain: "ethereum" }, costs: [{ provider: "etherscan", op: "panel:evm-funder", calls: 2, usd: 0, meta: "subscription/keyed" }] },
  { name: "Solana deployer", handler: deployerHandler, query: { wallet: SOL_ADDRESS }, costs: [{ provider: "helius", op: "panel:solana-deployer", calls: 3, usd: 0, meta: "subscription/keyed" }] },
  { name: "Solana funder", handler: funderHandler, query: { wallet: SOL_ADDRESS }, costs: [{ provider: "helius", op: "panel:solana-funder", calls: 2, usd: 0, meta: "subscription/keyed" }] },
  { name: "Solana cluster", handler: clusterHandler, query: { mint: SOL_ADDRESS, chain: "solana" }, costs: [{ provider: "rugcheck", op: "panel:solana-cluster", calls: 1, usd: 0, meta: "keyless" }] },
  { name: "GitHub resolver", handler: resolveGithubHandler, query: { handle: "alice", name: "Alice" }, costs: [{ provider: "github", op: "panel:resolve-github", calls: 2, usd: 0, meta: "subscription/keyed" }] },
  { name: "GitHub forensics", handler: githubForensicsHandler, query: { login: "alice" }, costs: [{ provider: "github", op: "panel:github-forensics", calls: 1, usd: 0, meta: "subscription/keyed" }] },
  {
    name: "identity sweep",
    handler: identitySweepHandler,
    query: { handle: "alice" },
    costs: [
      { provider: "memory.lol", op: "panel:identity-sweep", calls: 1, usd: 0, meta: "keyless" },
      { provider: "github", op: "panel:identity-sweep", calls: 1, usd: 0, meta: "subscription/keyed" },
      { provider: "warpcast", op: "panel:identity-sweep", calls: 1, usd: 0, meta: "keyless" },
      { provider: "reddit", op: "panel:identity-sweep", calls: 1, usd: 0, meta: "keyless" },
      { provider: "telegram", op: "panel:identity-sweep", calls: 1, usd: 0, meta: "keyless" },
    ],
  },
];

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function request(route: Route, panelToken?: string) {
  return {
    method: "GET",
    query: route.query,
    headers: panelToken ? { "x-argus-panel-token": panelToken } : {},
  };
}

describe("keyed supplemental route report capabilities", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    resolvePanelCostVersion.mockReset().mockReturnValue(undefined);
    vi.stubEnv("ARKHAM_API_KEY", "arkham-key");
    vi.stubEnv("CRYPTORANK_API_KEY", "cryptorank-key");
    vi.stubEnv("ETHERSCAN_API_KEY", "etherscan-key");
    vi.stubEnv("GITHUB_TOKEN", "github-key");
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "expired-panel-token"])("rejects %s context before every cache or provider call", async (panelToken) => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    for (const route of routes) {
      const { res, captured } = response();
      await route.handler(request(route, panelToken) as never, res as never);
      expect(captured.status, route.name).toBe(409);
      expect(captured.body, route.name).toMatchObject({ error: "invalid_panel_context" });
    }

    expect(requireArgusAuth).toHaveBeenCalledTimes(routes.length);
    expect(resolvePanelCostVersion).toHaveBeenCalledTimes(routes.length);
    for (const call of resolvePanelCostVersion.mock.calls) {
      expect(call).toEqual([ORGANIZATION_ID, panelToken]);
    }
    expect(cacheGetJson).not.toHaveBeenCalled();
    expect(cacheSetJson).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it.each(routes)("allows a valid capability through $name and records attempted provider calls", async (route) => {
    resolvePanelCostVersion.mockReturnValue(VERSION_ID);
    const providerFetch = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    await route.handler(request(route, "signed-panel-token") as never, res as never);

    expect(captured.status).not.toBe(409);
    expect(resolvePanelCostVersion).toHaveBeenCalledWith(ORGANIZATION_ID, "signed-panel-token");
    expect(providerFetch).toHaveBeenCalled();
    expect(attachPanelCost).toHaveBeenCalledTimes(route.costs.length);
    for (const line of route.costs) {
      expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, {
        ...line,
        initiatedBy: USER_ID,
        status: "succeeded",
      });
    }
  });

  it("records a rejected provider request as failed while preserving its attempted call", async () => {
    resolvePanelCostVersion.mockReturnValue(VERSION_ID);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const route = routes.find((candidate) => candidate.name === "arkham holdings")!;
    const { res, captured } = response();

    await route.handler(request(route, "signed-panel-token") as never, res as never);

    expect(captured.status).toBe(200);
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, {
      provider: "arkham",
      op: "panel:arkham-holdings",
      calls: 1,
      usd: 0,
      meta: "subscription/keyed",
      initiatedBy: USER_ID,
      status: "failed",
    });
  });
});
