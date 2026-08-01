import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenDossier } from "../token/audit";
import type { Investigation } from "./investigation";

const harness = vi.hoisted(() => ({ auditToken: vi.fn(), runRecon: vi.fn(), probeBackend: vi.fn(), streamAudit: vi.fn() }));

vi.mock("../token/audit", () => ({ auditToken: harness.auditToken }));
vi.mock("../collect/recon", () => ({ runRecon: harness.runRecon }));
vi.mock("./live", () => ({ probeBackend: harness.probeBackend, streamAudit: harness.streamAudit }));

import { streamInvestigation } from "./investigation";

const DEPLOYER = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const COINBASE = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const POOL_CREATED_AT = 1785450548000; // DexScreener reports pool creation in milliseconds
const ORIGIN_SENTENCE = "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It launched this token 95 minutes later.";

const TRAIL = {
  wallet: DEPLOYER,
  available: true,
  funder: { address: COINBASE, label: "Coinbase", kind: "cex" },
  origin: { address: COINBASE, label: "Coinbase", kind: "cex" },
  terminatesAtCex: true,
  hops: 1,
  tokensCreated: 1,
  serialDeployer: false,
  walletAgeDays: 0,
  walletAgeMinutes: 95,
  walletAgeBasis: "mint",
  walletAgeAsOf: "2026-07-30T22:29:08.000Z",
  seedFunding: { from: COINBASE, label: "Coinbase", lamports: 2_000_000_000, sol: 2, at: "2026-07-30T20:54:04.000Z" },
  firstActivity: "2026-07-30",
  note: `${ORIGIN_SENTENCE} Funding trail: deployer ← Coinbase.`,
};

function token(extra: Record<string, unknown> = {}): TokenDossier {
  return {
    address: "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump",
    chain: "solana",
    symbol: "TEST",
    name: "Test",
    verdict: "CAUTION",
    score: 50,
    socials: [],
    projectX: null,
    deployer: DEPLOYER,
    ...extra,
  } as unknown as TokenDossier;
}

function investigate(): Promise<{ inv: Investigation | null; urls: string[] }> {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: unknown) => {
    urls.push(String(input));
    return new Response(JSON.stringify(TRAIL), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return new Promise((resolve) => {
    streamInvestigation({ kind: "token", via: "solana", ref: "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump" } as never, {
      onStep: () => {},
      onHop: () => {},
      onDone: (inv) => resolve({ inv, urls }),
      onError: () => resolve({ inv: null, urls }),
    });
  });
}

beforeEach(() => {
  harness.runRecon.mockReset().mockResolvedValue(null);
  harness.probeBackend.mockReset().mockResolvedValue([]);
  harness.streamAudit.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("investigation deployer funding origin", () => {
  // The defect: /api/deployer hard-requires a panel token bound to a PERSISTED
  // report version, and a live scan has none, so the trail always came back
  // null and the report published "we could not confirm who owns the wallet".
  it("traces the deployer through the scan-time route, not the gated panel one", async () => {
    harness.auditToken.mockResolvedValue(token({ pairCreatedAt: POOL_CREATED_AT }));

    const { inv, urls } = await investigate();

    expect(urls.some((u) => u.startsWith("/api/deployer-origin?"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/deployer?"))).toBe(false);
    expect(inv?.deployerTrail?.note).toContain(ORIGIN_SENTENCE);
  });

  it("pins the launch instant so the age is measured at the launch", async () => {
    harness.auditToken.mockResolvedValue(token({ pairCreatedAt: POOL_CREATED_AT }));

    const { inv, urls } = await investigate();

    expect(urls.some((u) => u.includes(`mintedAt=${POOL_CREATED_AT}`))).toBe(true);
    expect(inv?.deployerTrail?.walletAgeBasis).toBe("mint");
    expect(inv?.deployerTrail?.walletAgeMinutes).toBe(95);
    expect(inv?.deployerTrail?.seedFunding?.sol).toBe(2);
  });

  // A dossier frozen before the launch instant was recorded has none, and "now"
  // is not a substitute: it would date a months-old launch to today.
  it("asks for a scan-basis age when the dossier carries no launch instant", async () => {
    harness.auditToken.mockResolvedValue(token());

    const { urls } = await investigate();

    expect(urls.some((u) => u.startsWith("/api/deployer-origin?"))).toBe(true);
    expect(urls.some((u) => u.includes("mintedAt="))).toBe(false);
  });

  it("leaves the trail null on a chain it cannot trace", async () => {
    harness.auditToken.mockResolvedValue(token({ chain: "ethereum" }));

    const { inv, urls } = await investigate();

    expect(inv?.deployerTrail).toBeNull();
    expect(urls.some((u) => u.includes("deployer"))).toBe(false);
  });
});
