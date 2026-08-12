import { afterEach, describe, expect, it, vi } from "vitest";
import { traceOperator } from "./operatorTrace";

// The loudest fact on a fresh launch is already computed server-side: who first
// funded the deployer, with how much, and how old the wallet was when it minted.
// The client type used to declare none of those fields, so the whole answer was
// parsed away one line after it arrived.
const root = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const coinbase = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const anonFunder = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const MINTED_AT = 1785450548;
const NOTE = "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It launched this token 95 minutes later. Funding trail: deployer ← Coinbase.";

const opts = { panelCostToken: "signed-panel-capability", checkLiveness: false, record: false };

const rootTrace = {
  available: true,
  tokensCreated: 1,
  chain: [{ from: root, to: coinbase, label: "Coinbase", kind: "cex" }],
  funder: { address: coinbase, label: "Coinbase", kind: "cex" },
  origin: { address: coinbase, label: "Coinbase", kind: "cex" },
  walletAgeDays: 0,
  walletAgeMinutes: 95,
  walletAgeBasis: "mint",
  walletAgeAsOf: "2026-07-30T22:29:08.000Z",
  seedFunding: { from: coinbase, label: "Coinbase", lamports: 2_000_000_000, sol: 2, at: "2026-07-30T20:54:04.000Z" },
  note: NOTE,
};

function stubRoutes(routes: Array<{ match: string; body: unknown }>) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    const hit = routes.find((r) => url.includes(r.match));
    if (!hit) throw new Error(`unexpected request: ${url}`);
    return { ok: true, json: async () => hit.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator trace launch origin", () => {
  it("carries the seed funding, the age at launch and the origin sentence onto the root wallet", async () => {
    stubRoutes([{ match: `deployer?wallet=${root}`, body: rootTrace }]);

    const cluster = await traceOperator(root, opts, () => {});
    const rootWallet = cluster?.wallets.find((w) => w.isRoot);

    expect(rootWallet?.ageDays).toBe(0);
    expect(rootWallet?.ageMinutes).toBe(95);
    expect(rootWallet?.ageBasis).toBe("mint");
    expect(rootWallet?.ageAsOf).toBe("2026-07-30T22:29:08.000Z");
    expect(rootWallet?.seed).toEqual({ from: coinbase, label: "Coinbase", sol: 2, at: "2026-07-30T20:54:04.000Z" });
    expect(rootWallet?.note).toBe(NOTE);
  });

  // Without a launch instant the server measures the age to the scan and says so.
  // Passing that through unchanged is what stops a frozen report from re-reading
  // the same launch as older every time it is opened.
  it("keeps a scan-basis age labelled as one", async () => {
    stubRoutes([{
      match: `deployer?wallet=${root}`,
      body: { ...rootTrace, walletAgeBasis: "scan", walletAgeMinutes: 4320, walletAgeDays: 3, note: "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. Funding trail: deployer ← Coinbase." },
    }]);

    const cluster = await traceOperator(root, opts, () => {});
    const rootWallet = cluster?.wallets.find((w) => w.isRoot);

    expect(rootWallet?.ageBasis).toBe("scan");
    expect(rootWallet?.note).not.toContain("later");
  });

  it("reports an unmeasured age as absent rather than as zero", async () => {
    stubRoutes([{
      match: `deployer?wallet=${root}`,
      body: { ...rootTrace, walletAgeDays: null, walletAgeMinutes: null, seedFunding: null },
    }]);

    const cluster = await traceOperator(root, opts, () => {});
    const rootWallet = cluster?.wallets.find((w) => w.isRoot);

    expect(rootWallet?.ageDays ?? null).toBeNull();
    expect(rootWallet?.ageMinutes ?? null).toBeNull();
    expect(rootWallet?.seed ?? null).toBeNull();
  });

  // The server stamps walletAgeBasis "mint" only when the caller pins the launch
  // instant, and only the root deployer's age is a fact about THIS launch.
  it("pins the launch instant on the root trace and on no other hop", async () => {
    const fetchMock = stubRoutes([
      {
        match: `deployer?wallet=${root}`,
        body: { ...rootTrace, chain: [{ from: root, to: anonFunder, label: null, kind: "wallet" }], origin: { address: anonFunder, label: null, kind: "wallet" } },
      },
      { match: `funder?wallet=${anonFunder}`, body: { available: true, completed: true, truncated: false, providerFailed: false, seededCount: 0, seededDeployers: [] } },
      { match: `deployer?wallet=${anonFunder}`, body: { available: true } },
    ]);

    await traceOperator(root, { ...opts, mintedAt: MINTED_AT }, () => {});

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(`/api/deployer?wallet=${root}`) && u.includes(`mintedAt=${MINTED_AT}`))).toBe(true);
    expect(urls.some((u) => u.includes(anonFunder) && u.includes("mintedAt="))).toBe(false);
  });
});
