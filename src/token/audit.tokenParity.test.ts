// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken, deployerWalletAddress } from "./audit";
import { tokenChecks } from "../lib/scanChecklist";

// 2026-09-14 deep-dive review, token lane findings 4, 6, 8, 9, 13 and 16.
// Every case drives auditToken through a mocked provider surface: DexScreener
// for the market, GoPlus for safety, ARGUS's own bytecode route for the
// creator-kind check. No simulation, no CoinGecko (skipSim).

const ADDRESS = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const WALLET = "0x4444444444444444444444444444444444444444";
const FACTORY = "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb";
const input = { kind: "token", via: "evm", ref: ADDRESS } as const;

const pair = (chainId: string, symbol = "TEST") => ({
  chainId, dexId: "uniswap", pairAddress: POOL,
  baseToken: { address: ADDRESS, name: "Test", symbol },
  quoteToken: { address: "0xweth", symbol: "WETH" },
  liquidity: { usd: 100_000 }, fdv: 1_000_000, marketCap: 1_000_000,
  txns: { h24: { buys: 3, sells: 4 } }, volume: { h24: 5_000 },
});

const CLEAN_GOPLUS = {
  is_open_source: "1", is_mintable: "0", transfer_pausable: "0", selfdestruct: "0", is_in_dex: "1",
  buy_tax: "0", sell_tax: "0", cannot_sell_all: "0", is_honeypot: "0", holder_count: "120",
  owner_address: "0x0000000000000000000000000000000000000000", hidden_owner: "0", can_take_back_ownership: "0",
  holders: [{ address: WALLET, percent: "0.04", is_contract: 0 }],
};

function stubProviders(opts: { goplus: Record<string, unknown>; pairs?: unknown[]; bytecode?: (address: string) => unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/latest/dex/tokens/")) return Response.json({ pairs: opts.pairs ?? [pair("ethereum")] });
    if (u.includes("gopluslabs")) return Response.json({ code: 1, result: { [ADDRESS]: opts.goplus } });
    if (u.includes("/api/bytecode")) {
      const address = new URL(u, "http://localhost").searchParams.get("address") ?? "";
      return Response.json(opts.bytecode ? opts.bytecode(address) : { available: false });
    }
    return Response.json({});
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("finding 4: honest owner state", () => {
  it("a hidden owner behind a visible 0x0 is not a renounced owner: owner-power vectors stay live", async () => {
    stubProviders({ goplus: { ...CLEAN_GOPLUS, hidden_owner: "1", owner_change_balance: "1", is_blacklisted: "1", slippage_modifiable: "1" } });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.ownerAssessed).toBe(true);
    expect(d?.safety.ownerRenounced).toBe(false);
    const claims = d!.findings.map((f) => f.claim);
    expect(claims.some((c) => c.startsWith("Ownership renounced"))).toBe(false);
    expect(claims.some((c) => c.startsWith("Hidden owner detected"))).toBe(true);
    expect(claims.some((c) => c.startsWith("Owner can modify holder balances"))).toBe(true);
    expect(claims.some((c) => c.startsWith("Tax is modifiable"))).toBe(true);
    expect(claims.some((c) => c.startsWith("Owner can blacklist"))).toBe(true);
    // The lowest cap governs: balance rewrite (20) beats reclaimable ownership (35).
    expect(d?.capApplied).toBe("owner_can_modify_balance");
  });

  it("an owner GoPlus could not detect is unmeasured, never 'renounced'", async () => {
    const { owner_address: _omit, ...withoutOwner } = CLEAN_GOPLUS;
    void _omit;
    stubProviders({ goplus: { ...withoutOwner, owner_change_balance: "1", is_blacklisted: "1" } });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.contractPropertiesAssessed).toBe(false);
    expect(d?.safety.ownerAssessed).toBe(false);
    expect(d?.safety.ownerRenounced).toBe(false);
    const claims = d!.findings.map((f) => f.claim);
    expect(claims.some((c) => c.startsWith("Ownership renounced"))).toBe(false);
    expect(claims.find((c) => c.startsWith("Owner can modify holder balances"))).toMatch(/could not be identified/);
    expect(claims.find((c) => c.startsWith("Owner can blacklist"))).toMatch(/could not be identified/);
  });

  it("a reversible renounce is not a renounce either", async () => {
    stubProviders({ goplus: { ...CLEAN_GOPLUS, can_take_back_ownership: "1", is_blacklisted: "1" } });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.ownerRenounced).toBe(false);
    expect(d!.findings.some((f) => f.claim.startsWith("Ownership renounced"))).toBe(false);
    expect(d!.findings.some((f) => f.claim.startsWith("Owner can blacklist"))).toBe(true);
  });

  it("a genuinely renounced owner still earns the positive", async () => {
    stubProviders({ goplus: { ...CLEAN_GOPLUS, is_blacklisted: "1" } });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.ownerRenounced).toBe(true);
    expect(d!.findings.some((f) => f.claim.startsWith("Ownership renounced"))).toBe(true);
    expect(d!.findings.some((f) => f.claim.startsWith("Owner can blacklist"))).toBe(false);
  });
});

describe("finding 6: the in-session cache is keyed by the requested chain", () => {
  it("scanning Base then Ethereum for the same address within 60s returns the Ethereum dossier", async () => {
    stubProviders({ goplus: CLEAN_GOPLUS, pairs: [pair("base", "BASETKN"), pair("ethereum", "ETHTKN")] });
    const base = await auditToken({ ...input, chain: "base" }, undefined, { force: true, skipSim: true });
    expect(base).toMatchObject({ chain: "base", symbol: "BASETKN" });
    const eth = await auditToken({ ...input, chain: "ethereum" }, undefined, { skipSim: true });
    expect(eth).toMatchObject({ chain: "ethereum", symbol: "ETHTKN" });
  });
});

describe("finding 8: an all-infrastructure holder list leaves the top wallet unmeasured", () => {
  it("does not republish the excluded pool as the top holder", async () => {
    stubProviders({ goplus: { ...CLEAN_GOPLUS, holders: [
      { address: POOL, percent: "0.60", is_contract: 1 },
    ] } });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.safety.topHolderPct).toBeNull();
    const t4 = d!.axes.find((a) => a.key === "T4");
    expect(t4?.rationale).not.toMatch(/top holder/);
    const holderCheck = tokenChecks(d!).find((c) => c.checkId === "holder-distribution");
    expect(holderCheck?.status).not.toBe("finding");
    expect(holderCheck?.note).toMatch(/top unknown/);
  });
});

describe("findings 9 and 16: a factory contract is never 'the deployer'", () => {
  it("records a contract creator as a factory attribution and keeps it out of wallet forensics", async () => {
    const screenDeployerRisk = vi.fn(async () => ({ available: true, paths: [], completedAt: "x" }));
    stubProviders({
      goplus: { ...CLEAN_GOPLUS, creator_address: FACTORY },
      bytecode: (address) => ({ available: true, isContract: address.toLowerCase() === FACTORY, isToken: false }),
    });
    const d = await auditToken(input, undefined, { force: true, skipSim: true, screenDeployerRisk });
    expect(d?.deployerAttribution).toMatchObject({ address: FACTORY, method: "contract factory", kind: "attributed" });
    expect(d?.deployer).toBe(FACTORY);
    expect(deployerWalletAddress(d!)).toBeNull();
    // No Arkham funding trace on a contract (finding 16).
    expect(screenDeployerRisk).not.toHaveBeenCalled();
    expect(d!.trace.some((s) => s.label === "Factory-minted")).toBe(true);
  });

  it("a wallet creator keeps the proven deployer attribution and its funding trace", async () => {
    const screenDeployerRisk = vi.fn(async () => ({ available: true, paths: [], completedAt: "x" }));
    stubProviders({
      goplus: { ...CLEAN_GOPLUS, creator_address: WALLET },
      bytecode: () => ({ available: true, isContract: false }),
    });
    const d = await auditToken(input, undefined, { force: true, skipSim: true, screenDeployerRisk });
    expect(d?.deployerAttribution).toMatchObject({ address: WALLET, method: "contract creator", kind: "deployer" });
    expect(deployerWalletAddress(d!)).toBe(WALLET);
    expect(screenDeployerRisk).toHaveBeenCalledWith(WALLET);
  });
});

describe("finding 13: cannot_sell_all is honeypot-class in both lanes", () => {
  it("caps the audit at the AVOID line, matching the judge's RUG trap", async () => {
    stubProviders({ goplus: { ...CLEAN_GOPLUS, cannot_sell_all: "1" } });
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.capApplied).toBe("cannot_sell_all");
    expect(d?.verdict).toBe("AVOID");
    expect(d?.score).toBeLessThanOrEqual(10);
  });
});
