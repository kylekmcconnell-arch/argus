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
    expect(cacheGetJson).toHaveBeenCalledWith(`arkham:${expected}:v2`);
    expect(captured.body).toMatchObject({
      available: true,
      labels: { [expected]: { name: "Case-safe label" } },
    });
    expect(Object.keys((captured.body as { labels: Record<string, unknown> }).labels)).toEqual([expected]);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(attachPanelCost).not.toHaveBeenCalled();
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
        cacheKey: `arkham-paths:${SOLANA_ADDRESS}:v1`,
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
