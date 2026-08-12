import { describe, it, expect } from "vitest";
import { checkForClones, normalizeTicker, ORDERING_MARGIN_MS } from "./cloneCheck";

const MINUTE = 60_000;
const REAL = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const IMPOSTOR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

type Pair = {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  pairCreatedAt?: number;
  liquidity?: { usd: number };
};

function pair(mint: string, symbol: string, createdAt: number | undefined, liquidityUsd: number): Pair {
  return {
    chainId: "solana",
    pairAddress: `pool-${mint.slice(0, 6)}-${createdAt ?? "none"}`,
    baseToken: { address: mint, symbol, name: symbol },
    ...(createdAt === undefined ? {} : { pairCreatedAt: createdAt }),
    liquidity: { usd: liquidityUsd },
  };
}

/** Serves one dexscreener search response and fails any other host. */
function searchStub(pairs: Pair[] | null): typeof fetch {
  return (async (url: string | URL) => {
    const href = String(url);
    if (!href.includes("dexscreener.com")) throw new Error(`unexpected fetch: ${href}`);
    if (pairs === null) return { ok: false, status: 500, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => ({ pairs }) } as Response;
  }) as unknown as typeof fetch;
}

describe("normalizeTicker", () => {
  it("folds the disguises that make a ticker collide on screen", () => {
    expect(normalizeTicker("linkr")).toBe("LINKR");
    expect(normalizeTicker(" USDC")).toBe("USDC");
    expect(normalizeTicker("US​DC")).toBe("USDC");
    expect(normalizeTicker("ＵＳＤＣ")).toBe("USDC");
    expect(normalizeTicker(null)).toBe("");
  });
});

describe("checkForClones ordering", () => {
  // The $LINKR shape. The real mint's earliest POOL is 17 minutes after the
  // impostors' pools because dexscreener drops the pump.fun bonding pair on
  // graduation. Ordering on listings alone would tell the project's own buyers
  // that a zero-liquidity impostor is the original.
  it("refuses to call the audited mint later when its own record is only a listing", async () => {
    const impostorPool = Date.parse("2026-07-30T22:35:00Z");
    const realPool = Date.parse("2026-07-30T22:52:20Z");
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana", pairCreatedAt: realPool, liquidityUsd: 84_000 },
      {
        fetchImpl: searchStub([
          pair(REAL, "LINKR", realPool, 84_000),
          pair(IMPOSTOR, "LINKR", impostorPool, 0),
        ]),
        // No creation-grade record for either mint.
        resolveCreatedAt: async () => null,
      },
    );

    expect(result.checked).toBe(true);
    expect(result.audited).toBe("unresolved");
    expect(result.earliestMint).toBeUndefined();
    expect(result.clones.map((c) => c.mint)).toEqual([IMPOSTOR]);
    expect(result.note).toMatch(/first listing/);
  });

  it("calls the audited mint later only when its own record is creation grade", async () => {
    const olderMint = Date.parse("2026-07-01T00:00:00Z");
    const auditedMint = Date.parse("2026-07-30T22:29:09Z");
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana", pairCreatedAt: auditedMint + 20 * MINUTE, liquidityUsd: 84_000 },
      {
        fetchImpl: searchStub([
          pair(REAL, "LINKR", auditedMint + 20 * MINUTE, 84_000),
          pair(IMPOSTOR, "LINKR", olderMint + MINUTE, 1_200_000),
        ]),
        resolveCreatedAt: async (mint) => (mint === REAL ? auditedMint : olderMint),
      },
    );

    expect(result.audited).toBe("later");
    expect(result.earliestMint).toBe(IMPOSTOR);
    expect(result.note).toContain(IMPOSTOR);
  });

  it("never names a wallet, a person, or a shared link", async () => {
    const auditedMint = Date.parse("2026-07-30T22:29:09Z");
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana", pairCreatedAt: auditedMint, liquidityUsd: 84_000 },
      {
        fetchImpl: searchStub([
          pair(REAL, "LINKR", auditedMint, 84_000),
          pair(IMPOSTOR, "LINKR", auditedMint + 6 * MINUTE, 0),
        ]),
        resolveCreatedAt: async (mint) => (mint === REAL ? auditedMint : auditedMint + 6 * MINUTE),
      },
    );

    expect(result.audited).toBe("earliest");
    expect(result.note).not.toMatch(/deployer|creator|wallet|scam|impersonat|x\.com|twitter/i);
  });

  it("holds sub-margin gaps unresolved rather than ordering a bot burst", async () => {
    const auditedMint = Date.parse("2026-07-30T22:29:09Z");
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana", pairCreatedAt: auditedMint, liquidityUsd: 84_000 },
      {
        fetchImpl: searchStub([
          pair(REAL, "LINKR", auditedMint, 84_000),
          pair(IMPOSTOR, "LINKR", auditedMint - (ORDERING_MARGIN_MS - 1_000), 0),
        ]),
        resolveCreatedAt: async (mint) => (mint === REAL ? auditedMint : auditedMint - (ORDERING_MARGIN_MS - 1_000)),
      },
    );

    expect(result.audited).toBe("unresolved");
    expect(result.earliestMint).toBeUndefined();
    expect(result.note).toMatch(/too close together/);
  });
});

describe("checkForClones sweep boundaries", () => {
  it("reports a clean sweep as a floor, not as proof of originality", async () => {
    const auditedMint = Date.parse("2026-07-30T22:29:09Z");
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana", pairCreatedAt: auditedMint, liquidityUsd: 84_000 },
      { fetchImpl: searchStub([pair(REAL, "LINKR", auditedMint, 84_000)]), resolveCreatedAt: async () => null },
    );

    expect(result.audited).toBe("only");
    expect(result.clones).toEqual([]);
    expect(result.note).not.toMatch(/\boriginal\b|\bthe only\b|verified|authentic/i);
  });

  it("separates a failed sweep from a clean one", async () => {
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana" },
      { fetchImpl: searchStub(null), resolveCreatedAt: async () => null },
    );

    expect(result.checked).toBe(false);
    expect(result.audited).toBe("unresolved");
    expect(result.note).toMatch(/did not complete/);
  });

  it("ignores same-name pairs whose ticker does not actually match", async () => {
    const auditedMint = Date.parse("2026-07-30T22:29:09Z");
    const result = await checkForClones(
      { mint: REAL, symbol: "LINKR", chain: "solana", pairCreatedAt: auditedMint, liquidityUsd: 84_000 },
      {
        fetchImpl: searchStub([
          pair(REAL, "LINKR", auditedMint, 84_000),
          pair(IMPOSTOR, "LINKRBOT", auditedMint - 10 * MINUTE, 5_000),
        ]),
        resolveCreatedAt: async () => null,
      },
    );

    expect(result.clones).toEqual([]);
    expect(result.audited).toBe("only");
  });

  it("does not sweep without a ticker", async () => {
    let called = false;
    const result = await checkForClones(
      { mint: REAL, symbol: "", chain: "solana" },
      {
        fetchImpl: (async () => { called = true; throw new Error("should not fetch"); }) as unknown as typeof fetch,
        resolveCreatedAt: async () => null,
      },
    );

    expect(called).toBe(false);
    expect(result.checked).toBe(false);
    expect(result.audited).toBe("unresolved");
  });
});
