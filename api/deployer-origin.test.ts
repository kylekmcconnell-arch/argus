import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// api/deployer.ts is imported for its copy helpers, so its own module-level
// dependencies have to resolve. Mocking them here also proves this route never
// reaches for the panel-cost machinery: resolvePanelCostVersion is the gate that
// 409s a live scan, and this suite asserts it is never consulted.
const { attachPanelCost, cacheGetJson, cacheSetJson, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  attachPanelCost: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion }));

import handler from "./deployer-origin";

// Observed on the public Solana RPC for deployer BpH4h6pd… (mint 5NHPWfma…pump):
// oldest signature blockTime 1785444844 = 2026-07-30 20:54:04 UTC, a 2000000000
// lamport transfer from Coinbase hot wallet GJRs4FwH…; the launch landed at
// 1785450548 = 22:29:08 UTC, 5704 seconds (95 minutes) later.
const FIRST_FUNDED_AT = 1785444844;
const MINTED_AT = 1785450548;

const DEPLOYER = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const COINBASE = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const FUNDING_SIG = "5H5eLiPbgUcKCuhbMg3AgocUbQYsRnkNsk6iQPLZpvLfszh3p1LBrtSVaxoJcNbYsv5TjTPYfpNxeraqxH7X9ZEy";
const MINT_SIG = "4smaaJ48RMbo8WHggQZGSbLhUDVavprfVbsFWNzhGZw8fu4CisToCTzABmuAwYn5QmBtcWrE39NY9ixKvQxbYaDT";
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";

function jsonRpc(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
}

function chainFetch() {
  return vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.startsWith("https://api.helius.xyz/")) {
      return new Response(JSON.stringify([{ type: "TOKEN_MINT", tokenTransfers: [{ mint: MINT }] }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
    if (body.method === "getSignaturesForAddress") {
      if (body.params[0] !== DEPLOYER) return jsonRpc([]);
      return jsonRpc([
        { signature: MINT_SIG, blockTime: MINTED_AT },
        { signature: FUNDING_SIG, blockTime: FIRST_FUNDED_AT },
      ]);
    }
    if (body.method === "getTransaction") {
      if (body.params[0] !== FUNDING_SIG) return jsonRpc(null);
      return jsonRpc({
        blockTime: FIRST_FUNDED_AT,
        transaction: {
          message: {
            accountKeys: [{ pubkey: COINBASE }, { pubkey: DEPLOYER }],
            instructions: [{ parsed: { type: "transfer", info: { source: COINBASE, destination: DEPLOYER, lamports: 2_000_000_000 } } }],
          },
        },
        meta: { preBalances: [45672521288118, 0], postBalances: [45670521280118, 2_000_000_000] },
      });
    }
    throw new Error(`unexpected rpc ${body.method}`);
  });
}

// The live scan sends no panel token: it has no persisted report version yet.
async function run(query: Record<string, string>) {
  const captured: { status?: number; body: Record<string, unknown> } = { body: {} };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
  };
  await handler({ method: "GET", query, headers: {} } as never, res as never);
  return captured;
}

describe("GET /api/deployer-origin", () => {
  beforeEach(() => {
    attachPanelCost.mockReset().mockResolvedValue(undefined);
    requireArgusAuth.mockReset();
    resolvePanelCostVersion.mockReset();
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("HELIUS_API_KEY", "helius-key");
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // The defect this route exists for: /api/deployer hard-requires a panel token
  // bound to a PERSISTED version, so a live scan always got 409 and the report
  // fell back to "we could not confirm who owns the wallet".
  it("traces a live scan that has no persisted report version yet", async () => {
    vi.setSystemTime((MINTED_AT + 600) * 1000);
    vi.stubGlobal("fetch", chainFetch());

    const { status, body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(resolvePanelCostVersion).not.toHaveBeenCalled();
    expect(body.note).toBe(
      "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It launched this token 95 minutes later. Funding trail: deployer ← Coinbase.",
    );
  });

  it("dates the wallet's age to the pinned launch instant", async () => {
    vi.setSystemTime((MINTED_AT + 86_400) * 1000);
    vi.stubGlobal("fetch", chainFetch());

    const { body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(body.walletAgeBasis).toBe("mint");
    expect(body.walletAgeMinutes).toBe(95);
    expect(body.walletAgeDays).toBe(0);
    expect(body.walletAgeAsOf).toBe("2026-07-30T22:29:08.000Z");
    expect(body.seedFunding).toMatchObject({ from: COINBASE, label: "Coinbase", lamports: 2_000_000_000, sol: 2, at: "2026-07-30T20:54:04.000Z" });
  });

  // DexScreener reports pool creation in milliseconds; the browser passes the raw
  // value through, so a ms epoch must not be rejected as out of range.
  it("accepts a millisecond launch instant from the browser", async () => {
    vi.setSystemTime((MINTED_AT + 600) * 1000);
    vi.stubGlobal("fetch", chainFetch());

    const { body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT * 1000) });

    expect(body.walletAgeBasis).toBe("mint");
    expect(body.walletAgeMinutes).toBe(95);
  });

  it("returns the same upstream wire shape the panel route does", async () => {
    vi.setSystemTime((MINTED_AT + 600) * 1000);
    vi.stubGlobal("fetch", chainFetch());

    const { body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(body.funder).toEqual({ address: COINBASE, label: "Coinbase", kind: "cex" });
    expect(body.origin).toEqual({ address: COINBASE, label: "Coinbase", kind: "cex" });
    expect(body.terminatesAtCex).toBe(true);
    expect(body.hops).toBe(1);
    expect(body.tokensCreated).toBe(1);
    expect(body.serialDeployer).toBe(false);
    expect(body.firstActivity).toBe("2026-07-30");
  });

  // An age measured to "now" is a fact about now. Replaying yesterday's cached
  // answer would quietly answer a different question than the one asked.
  it("caches a pinned-instant trace and never a scan-basis one", async () => {
    vi.setSystemTime((MINTED_AT + 600) * 1000);
    vi.stubGlobal("fetch", chainFetch());
    await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });
    expect(cacheSetJson).toHaveBeenCalledTimes(1);
    expect(String(cacheSetJson.mock.calls[0][0])).toContain(DEPLOYER);

    cacheSetJson.mockClear();
    cacheGetJson.mockClear();
    vi.stubGlobal("fetch", chainFetch());
    const { body } = await run({ wallet: DEPLOYER });
    expect(body.walletAgeBasis).toBe("scan");
    expect(cacheGetJson).not.toHaveBeenCalled();
    expect(cacheSetJson).not.toHaveBeenCalled();
  });

  it("rejects a wallet that is not a Solana address before spending a call", async () => {
    const fetchMock = chainFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { status } = await run({ wallet: "0x4444444444444444444444444444444444444444" });

    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failed walk as a failure, never as an empty trail", async () => {
    vi.setSystemTime((MINTED_AT + 600) * 1000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const { body } = await run({ wallet: DEPLOYER, mintedAt: String(MINTED_AT) });

    expect(body.note).toBe("Funding-trail lookup failed.");
    expect(body.funder).toBeUndefined();
    expect(cacheSetJson).not.toHaveBeenCalled();
  });
});
