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
import arkhamMoneyFlowHandler from "./arkham-money-flow";
import arkhamRiskPathsHandler from "./arkham-risk-paths";
import arkhamTokenHoldersHandler from "./arkham-token-holders";
import arkhamHandler from "./arkham";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000222";
const SOLANA_ADDRESS = "SoLanaMixedCaseAddress111111111111111111111";
const EVM_ADDRESS = `0x${"AbCd".repeat(10)}`;

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function request(query: Record<string, string>) {
  return {
    method: "GET",
    query,
    headers: { "x-argus-panel-token": "signed-panel-token" },
  };
}

describe("Arkham address case safety", () => {
  beforeEach(() => {
    vi.stubEnv("ARKHAM_API_KEY", "arkham-key");
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    resolvePanelCostVersion.mockReset().mockReturnValue(VERSION_ID);
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    cacheGetJson.mockReset();
    cacheSetJson.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    { label: "Solana", input: SOLANA_ADDRESS, expected: SOLANA_ADDRESS },
    { label: "EVM", input: EVM_ADDRESS, expected: EVM_ADDRESS.toLowerCase() },
  ])("uses the canonical $label cache and output key", async ({ input, expected }) => {
    cacheGetJson.mockResolvedValue({
      name: "Case-safe label",
      isCex: false,
      isContract: false,
    });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    await arkhamHandler(request({ address: input }) as never, res as never);

    expect(captured.status).toBe(200);
    expect(cacheGetJson).toHaveBeenCalledWith(`arkham:${expected}:v3`);
    expect(captured.body).toMatchObject({
      available: true,
      labels: { [expected]: { name: "Case-safe label" } },
    });
    expect(Object.keys((captured.body as { labels: Record<string, unknown> }).labels)).toEqual([expected]);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });

  it("keeps Arkham entity footprint, behavior tags, and the full risk briefing", async () => {
    cacheGetJson.mockResolvedValue(null);
    const providerFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes("/intelligence/address_enriched/")
        ? {
            arkhamEntity: {
              id: "example-fund",
              name: "Example Fund",
              type: "fund",
              service: false,
              twitter: "https://x.com/example",
              linkedin: "https://linkedin.com/company/example",
              addresses: {
                ethereum: ["0x1", "0x2"],
                solana: ["SoL1"],
              },
              populatedTags: [{ id: "whale", label: "Whale", rank: 20 }],
            },
            arkhamLabel: { name: "Treasury" },
            populatedTags: [{ id: "deployer", label: "Contract deployer", rank: 10 }],
            contract: false,
          }
        : {
            risk_level: "HIGH",
            greatest_risk_category: "hacker",
            max_score: 66,
            hacker_score: 66,
            risk_weighted_incoming_usd: 1503.02,
            risk_weighted_outgoing_usd: 40,
            hop_distance: 1,
            is_seed: false,
            updated_at: "2026-07-23T00:00:00Z",
            top_sources: [{
              seed_address: "0xrisk",
              risk_category: "hacker",
              direction: "forward",
              contribution_usd: 1503.02,
              contribution_pct: 100,
              hop_distance: 1,
            }],
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", providerFetch);
    const { res, captured } = response();

    await arkhamHandler(request({ address: EVM_ADDRESS }) as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      available: true,
      labels: {
        [EVM_ADDRESS.toLowerCase()]: {
          name: "Example Fund",
          entityId: "example-fund",
          sublabel: "Treasury",
          entityWalletCount: 3,
          entityChainCount: 2,
          tags: [
            { id: "deployer", label: "Contract deployer" },
            { id: "whale", label: "Whale" },
          ],
          risk: {
            level: "HIGH",
            score: 66,
            outgoingUsd: 40,
            categoryScores: [{ category: "hacker", score: 66 }],
            topSources: [{ address: "0xrisk", category: "hacker", scoreUsd: 1503.02 }],
          },
        },
      },
    });
    expect(attachPanelCost).toHaveBeenCalledWith(ORGANIZATION_ID, VERSION_ID, expect.objectContaining({
      provider: "arkham",
      op: "panel:arkham-labels",
      calls: 2,
      status: "succeeded",
    }));
  });

  it("preserves mixed-case Solana identity in every Arkham panel cache", async () => {
    cacheGetJson.mockResolvedValue({ available: true });
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const panels = [
      {
        handler: arkhamHoldingsHandler,
        query: { address: SOLANA_ADDRESS, symbol: "ARG" } as Record<string, string>,
        cacheKey: `arkham-hold:${SOLANA_ADDRESS}:ARG:v1`,
      },
      {
        handler: arkhamCounterpartiesHandler,
        query: { address: SOLANA_ADDRESS } as Record<string, string>,
        cacheKey: `arkham-cp:${SOLANA_ADDRESS}:v1`,
      },
      {
        handler: arkhamRiskPathsHandler,
        query: { address: SOLANA_ADDRESS } as Record<string, string>,
        cacheKey: `arkham-paths:${SOLANA_ADDRESS}:v2`,
      },
      {
        handler: arkhamMoneyFlowHandler,
        query: { address: SOLANA_ADDRESS, chain: "solana" } as Record<string, string>,
        cacheKey: `arkham-money-flow:solana:${SOLANA_ADDRESS}:v1`,
      },
      {
        handler: arkhamTokenHoldersHandler,
        query: { address: SOLANA_ADDRESS, chain: "solana" } as Record<string, string>,
        cacheKey: `arkham-token-holders:solana:${SOLANA_ADDRESS}:v1`,
      },
    ];

    for (const panel of panels) {
      cacheGetJson.mockClear();
      const { res, captured } = response();
      await panel.handler(request(panel.query) as never, res as never);
      expect(captured.status).toBe(200);
      expect(cacheGetJson).toHaveBeenCalledWith(panel.cacheKey);
    }

    expect(providerFetch).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
  });
});
