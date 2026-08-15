// Behind the Ledger core: address classification + sell attribution on
// synthetic ledgers. The shapes mirror the real $BULL case this module was
// built from: a genesis mint, allocation vaults claimed by insiders, a venue
// with same-tx passthrough, an arb bot, an emission farm dripping to many
// wallets, hop-wallet funded sellers, and plain churn.
import { describe, expect, it } from "vitest";
import {
  addressStats, classifyAddresses, attributeSells, farmStats, vaultStats,
  resolveOrigin,
  type LedgerTransfer,
} from "../../api/_ledgerflow";

const ZERO = "0x0000000000000000000000000000000000000000";
const GENESIS = "0xaaaa000000000000000000000000000000000001";
const VAULT = "0xaaaa000000000000000000000000000000000002";
const PAIR = "0xbbbb000000000000000000000000000000000001";
const ROUTER = "0xbbbb000000000000000000000000000000000002";
const FARM = "0xcccc000000000000000000000000000000000001";
const INSIDER = "0xdddd000000000000000000000000000000000001";
const TRADER = "0xdddd000000000000000000000000000000000002";
const HOPPER = "0xdddd000000000000000000000000000000000003";
const HOP_WALLET = "0xdddd000000000000000000000000000000000004";
const HOP_SOURCE = "0xdddd000000000000000000000000000000000005";

const BPD = 1000; // blocks per synthetic day

let nextLi = 0;
const tr = (b: number, tx: string, f: string, t: string, v: number): LedgerTransfer => ({ b, tx, li: nextLi++, f, t, v });
const farmerAddr = (i: number) => `0xf${String(i).padStart(3, "0")}${"0".repeat(36)}`;
const buyerAddr = (i: number) => `0xe${String(i).padStart(3, "0")}${"0".repeat(36)}`;

// Build the synthetic ledger once; individual tests slice into it.
function buildLedger(): LedgerTransfer[] {
  nextLi = 0;
  const out: LedgerTransfer[] = [];
  // mint 1M to genesis, genesis loads the vault
  out.push(tr(1, "mint", ZERO, GENESIS, 1_000_000));
  out.push(tr(2, "load1", GENESIS, VAULT, 100_000));
  out.push(tr(3, "load2", GENESIS, VAULT, 95_000));
  // insider claims from the vault, then sells into the pair at launch (block 10)
  out.push(tr(10, "claim1", VAULT, INSIDER, 50_000));
  out.push(tr(11, "sell-insider", INSIDER, PAIR, 40_000));
  // the router: many users buy through it (same-tx passthrough, many peers)
  for (let i = 0; i < 30; i++) {
    out.push(tr(20 + i, `buy${i}`, PAIR, ROUTER, 1_000));
    out.push(tr(20 + i, `buy${i}`, ROUTER, buyerAddr(i), 1_000));
  }
  // the trader bought from the pair earlier, then churns it back
  out.push(tr(100, "buy-trader", PAIR, TRADER, 20_000));
  out.push(tr(2_500, "sell-trader", TRADER, PAIR, 15_000));
  // emission farm: funded by the vault, drips to 60 wallets across 3 days
  out.push(tr(200, "fund-farm", VAULT, FARM, 60_000));
  for (let i = 0; i < 120; i++) {
    out.push(tr(300 + i * 25, `payout${i}`, FARM, farmerAddr(i % 60), 100));
  }
  // one farmer dumps their emissions
  out.push(tr(3_400, "sell-farmer", farmerAddr(0), PAIR, 150));
  // hop chain: source -> hop wallet -> hopper, hopper sells
  out.push(tr(3_000, "hop1", HOP_SOURCE, HOP_WALLET, 10_000));
  out.push(tr(3_010, "hop2", HOP_WALLET, HOPPER, 10_000));
  out.push(tr(3_500, "sell-hopper", HOPPER, PAIR, 8_000));
  return out.sort((a, b) => a.b - b.b || a.li - b.li);
}

function classify(transfers: LedgerTransfer[]) {
  const stats = addressStats(transfers);
  const cls = classifyAddresses(transfers, stats, { pair: PAIR, blocksPerDay: BPD, totalMinted: 1_000_000 });
  return { stats, cls };
}

describe("classifyAddresses", () => {
  it("finds genesis, vault, farm, and venue from flow shape alone", () => {
    const { cls } = classify(buildLedger());
    expect(cls.genesis.has(GENESIS)).toBe(true);
    expect(cls.vaults.has(VAULT)).toBe(true);
    expect(cls.farms.has(FARM)).toBe(true);
    expect(cls.venues.has(PAIR)).toBe(true);
  });

  it("classifies a same-tx passthrough with few peers as a bot, not a farm", () => {
    nextLi = 0;
    const bot = "0xabab000000000000000000000000000000000001";
    const transfers: LedgerTransfer[] = [tr(1, "mint", ZERO, GENESIS, 1_000_000)];
    for (let i = 0; i < 30; i++) {
      transfers.push(tr(10 + i, `arb${i}`, PAIR, bot, 500));
      transfers.push(tr(10 + i, `arb${i}`, bot, PAIR, 500));
    }
    const { cls } = classify(transfers);
    expect(cls.bots.has(bot)).toBe(true);
    expect(cls.farms.has(bot)).toBe(false);
  });

  it("does not mistake a plain holder for a vault", () => {
    nextLi = 0;
    const whale = "0xabab000000000000000000000000000000000002";
    const transfers: LedgerTransfer[] = [
      tr(1, "mint", ZERO, GENESIS, 1_000_000),
      tr(2, "whale", GENESIS, whale, 100_000), // big allocation, never distributes
    ];
    const { cls } = classify(transfers);
    expect(cls.vaults.has(whale)).toBe(false);
  });
});

describe("resolveOrigin", () => {
  it("walks a sell back through vault custody hops in the same tx", () => {
    nextLi = 0;
    const user = "0xabab000000000000000000000000000000000003";
    const hop: LedgerTransfer[] = [
      tr(50, "s", user, VAULT, 1_000),
      tr(50, "s", VAULT, PAIR, 1_000),
    ];
    const all = [...buildLedger(), ...hop].sort((a, b) => a.b - b.b || a.li - b.li);
    const { cls } = classify(all);
    const venueBound = hop[1];
    expect(resolveOrigin(venueBound, hop, cls)).toBe(user);
  });
});

describe("attributeSells", () => {
  it("splits sold volume into insider, churn, farm, and hop-funded shares", () => {
    const transfers = buildLedger();
    const { stats, cls } = classify(transfers);
    const a = attributeSells(transfers, stats, cls, { pair: PAIR, earlyEndBlock: 2 * BPD });
    // insider 40K + trader 15K + farmer 150 + hopper 8K = 63.15K user sells
    expect(a.totalUserSold).toBeCloseTo(63_150, 0);
    expect(a.vaultPct).toBeGreaterThan(50); // the insider dump dominates
    expect(a.churnPct).toBeGreaterThan(15); // the trader's re-sell
    expect(a.farmPct).toBeGreaterThan(0);
    expect(a.hopPct).toBeGreaterThan(10); // the hopper's supply came via a hop wallet
    // the insider sold at launch: their whole vault-sourced exit is early
    expect(a.earlyVaultSoldPct).toBeGreaterThan(95);
    const top = a.sellers[0];
    expect(top.address).toBe(INSIDER);
    expect(top.vaultPct).toBeGreaterThan(95);
    const hopper = a.sellers.find((s) => s.address === HOPPER);
    expect(hopper?.hopFunded).toBe(true);
  });

  it("excludes LP adds from selling when lpTx classification is present", () => {
    const transfers = buildLedger();
    nextLi = 1_000;
    const lpAdd = tr(2_600, "lp-add", TRADER, PAIR, 5_000);
    const all = [...transfers, lpAdd].sort((a, b) => a.b - b.b || a.li - b.li);
    const { stats, cls } = classify(all);
    const withLp = attributeSells(all, stats, cls, { pair: PAIR, lpTx: new Set(["lp-add"]), earlyEndBlock: 2 * BPD });
    const without = attributeSells(all, stats, cls, { pair: PAIR, earlyEndBlock: 2 * BPD });
    expect(without.totalUserSold - withLp.totalUserSold).toBeCloseTo(5_000, 0);
  });
});

describe("farmStats / vaultStats", () => {
  it("reports the farm's payout shape and the vault's claimants", () => {
    const transfers = buildLedger();
    const { stats, cls } = classify(transfers);
    const farms = farmStats(cls, stats, BPD);
    expect(farms).toHaveLength(1);
    expect(farms[0].recipients).toBe(60);
    expect(farms[0].payouts).toBe(120);
    expect(farms[0].activeDays).toBeGreaterThanOrEqual(2);
    const vaults = vaultStats(transfers, cls);
    expect(vaults).toHaveLength(1);
    // farm funding + insider claim leave the vault; the farm is infra, so only
    // the insider counts as a claimant
    expect(vaults[0].claimants).toBe(1);
    expect(vaults[0].tokensOut).toBe(50_000);
  });
});
