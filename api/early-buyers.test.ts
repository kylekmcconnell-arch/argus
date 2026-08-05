import { describe, expect, it } from "vitest";
import {
  clusterByFunder,
  earlyBuyerNote,
  readEarlyWindow,
  type EnhancedTx,
  type FunderCluster,
  type TracedRecipient,
} from "./early-buyers";

// Base58-plausible addresses, distinct and stable across the fixtures.
const MINT = "MintZ7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB2631";
const CREATOR = "CreatorwiZAhmGqhvkhFXknWU7QSBLQRHGi1GtBpH4";
const POOL = "PooLQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb1";
const BINANCE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
// Base58 has no zero, so the counter is offset to keep addresses gate-valid.
const wallet = (n: number) => `Wa11et${String(n + 10)}xxxxxxxxxxxxxxxxxxxxxxxxxx`;
const funder = (n: number) => `Funder${String(n + 10)}xxxxxxxxxxxxxxxxxxxxxxxxxx`;

function swapTx(overrides: Partial<EnhancedTx> & { to: string; amount?: number; sig?: string; slot?: number }): EnhancedTx {
  const { to, amount = 1000, sig = `sig-${to}`, slot = 100, ...rest } = overrides;
  return {
    signature: sig,
    slot,
    feePayer: to,
    tokenTransfers: [{ fromUserAccount: POOL, toUserAccount: to, mint: MINT, tokenAmount: amount }],
    nativeTransfers: [{ fromUserAccount: to, toUserAccount: POOL, amount: 5_000_000 }],
    ...rest,
  };
}

const traced = (overrides: Partial<TracedRecipient> & { address: string }): TracedRecipient => ({
  firstSig: `sig-${overrides.address}`,
  slot: 100,
  receivedUi: 1000,
  paidInFirstTx: true,
  funder: null,
  funderExchange: null,
  historyTruncated: false,
  ...overrides,
});

describe("reading the early window", () => {
  it("collects the wallets that took supply, in slot order, with what they took", () => {
    const read = readEarlyWindow([
      swapTx({ to: wallet(2), slot: 102, amount: 500 }),
      swapTx({ to: wallet(1), slot: 101 }),
      swapTx({ to: wallet(1), slot: 103, sig: "second-buy", amount: 250 }),
    ], { mint: MINT, creator: null });

    expect(read.recipients.map((r) => r.address)).toEqual([wallet(1), wallet(2)]);
    // Both buys accumulate, but the FIRST transaction stays the anchor.
    expect(read.recipients[0].receivedUi).toBe(1250);
    expect(read.recipients[0].firstSig).toBe(`sig-${wallet(1)}`);
    expect(read.recipients[0].slot).toBe(101);
  });

  it("excludes market infrastructure only on provider-stated grounds, never shape", () => {
    const read = readEarlyWindow([
      swapTx({ to: POOL, slot: 100, amount: 1e9 }),
      swapTx({ to: BINANCE, slot: 101 }),
      swapTx({ to: wallet(1), slot: 102 }),
    ], {
      mint: MINT,
      creator: null,
      knownAccounts: { [POOL]: { name: "Raydium", type: "AMM" } },
    });

    // The pool (RugCheck-labelled AMM) and the exchange custody wallet are not
    // buyers; the plain wallet is. Nothing is excluded for being big.
    expect(read.recipients.map((r) => r.address)).toEqual([wallet(1)]);
  });

  it("tracks the creator's own take separately instead of listing it as a buyer", () => {
    const read = readEarlyWindow([
      swapTx({ to: CREATOR, slot: 100, amount: 7777 }),
      swapTx({ to: wallet(1), slot: 101 }),
    ], { mint: MINT, creator: CREATOR });

    expect(read.recipients.map((r) => r.address)).toEqual([wallet(1)]);
    expect(read.creatorReceivedUi).toBe(7777);
  });

  it("tells a buy from a handed transfer by who paid in the transaction", () => {
    const read = readEarlyWindow([
      swapTx({ to: wallet(1), slot: 100 }),
      {
        signature: "handout",
        slot: 101,
        feePayer: CREATOR,
        tokenTransfers: [{ fromUserAccount: CREATOR, toUserAccount: wallet(2), mint: MINT, tokenAmount: 10 }],
        nativeTransfers: [],
      },
    ], { mint: MINT, creator: null });

    expect(read.recipients.find((r) => r.address === wallet(1))?.paidInFirstTx).toBe(true);
    expect(read.recipients.find((r) => r.address === wallet(2))?.paidInFirstTx).toBe(false);
  });

  it("marks a transaction that delivers to several wallets at once", () => {
    const read = readEarlyWindow([{
      signature: "bundle-tx",
      slot: 100,
      feePayer: CREATOR,
      tokenTransfers: [
        { fromUserAccount: POOL, toUserAccount: wallet(1), mint: MINT, tokenAmount: 10 },
        { fromUserAccount: POOL, toUserAccount: wallet(2), mint: MINT, tokenAmount: 10 },
        { fromUserAccount: POOL, toUserAccount: wallet(3), mint: MINT, tokenAmount: 10 },
      ],
    }], { mint: MINT, creator: null });

    expect(read.sameTx).toEqual([{ signature: "bundle-tx", count: 3 }]);
  });

  it("caps the buyer list and says so, a floor and never a total", () => {
    const txs = Array.from({ length: 8 }, (_, i) => swapTx({ to: wallet(i + 1), slot: 100 + i }));
    const read = readEarlyWindow(txs, { mint: MINT, creator: null, cap: 5 });

    expect(read.recipients).toHaveLength(5);
    expect(read.capped).toBe(true);
  });

  it("ignores another mint's transfers and non-positive amounts", () => {
    const read = readEarlyWindow([
      {
        signature: "other",
        slot: 100,
        feePayer: wallet(1),
        tokenTransfers: [
          { fromUserAccount: POOL, toUserAccount: wallet(1), mint: "OtherMintz3wXBoRgixCa6xjnB7YaB1pPB263111", tokenAmount: 10 },
          { fromUserAccount: POOL, toUserAccount: wallet(2), mint: MINT, tokenAmount: 0 },
        ],
      },
    ], { mint: MINT, creator: null });

    expect(read.recipients).toEqual([]);
  });
});

describe("clustering by shared funder", () => {
  it("groups wallets seeded by one wallet and leaves independents alone", () => {
    const clusters = clusterByFunder([
      traced({ address: wallet(1), funder: funder(1) }),
      traced({ address: wallet(2), funder: funder(1) }),
      traced({ address: wallet(3), funder: funder(1) }),
      traced({ address: wallet(4), funder: funder(2) }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].funder).toBe(funder(1));
    expect(clusters[0].members.map((m) => m.address)).toEqual([wallet(1), wallet(2), wallet(3)]);
  });

  it("never counts a shared exchange hot wallet as a shared funder", () => {
    // Both wallets withdrew from the same Binance address. That is custody,
    // not coordination: thousands of unrelated users share that funder.
    const clusters = clusterByFunder([
      traced({ address: wallet(1), funder: BINANCE, funderExchange: "Binance" }),
      traced({ address: wallet(2), funder: BINANCE, funderExchange: "Binance" }),
    ]);

    expect(clusters).toEqual([]);
  });

  it("never clusters a wallet whose history was too deep to page", () => {
    // The funder read off the oldest page REACHED describes the wrong era.
    const clusters = clusterByFunder([
      traced({ address: wallet(1), funder: funder(1), historyTruncated: true }),
      traced({ address: wallet(2), funder: funder(1) }),
    ]);

    expect(clusters).toEqual([]);
  });

  it("never builds a cluster out of unresolved funding", () => {
    const clusters = clusterByFunder([
      traced({ address: wallet(1), funder: null }),
      traced({ address: wallet(2), funder: null }),
    ]);

    expect(clusters).toEqual([]);
  });
});

describe("the note reports shape, floors and the exchange rule, never a verdict", () => {
  const cluster = (overrides: Partial<FunderCluster> = {}): FunderCluster => ({
    funder: funder(1),
    funderIsCreator: false,
    size: 17,
    members: [],
    receivedTotalUi: 1000,
    remainingTotalUi: 120,
    stillHeldPct: 12,
    ...overrides,
  });

  it("states the shared-funder count over its denominator, with what the group still holds", () => {
    const note = earlyBuyerNote({
      buyersFound: 36,
      buyersCapped: false,
      windowSigCount: 100,
      windowTxCount: 100,
      tracedCount: 36,
      clusters: [cluster()],
      cexFundedCount: 0,
      busyWalletCount: 0,
      sameBlock: [{ slot: 123, count: 9 }],
    });

    expect(note).toContain("17 of the 36 traced");
    expect(note).toContain("still holds 12%");
    expect(note).toContain(", the rest sold or moved on");
    expect(note).toContain("together the group still holds");
    expect(note).toContain("9 of them took supply in a single block");
    expect(note).not.toMatch(/bundled|coordinated|scam/i);
  });

  it("names the creator when the shared funder is the creator itself", () => {
    const note = earlyBuyerNote({
      buyersFound: 10,
      buyersCapped: false,
      windowSigCount: 40,
      windowTxCount: 40,
      tracedCount: 10,
      clusters: [cluster({ funderIsCreator: true, size: 4, stillHeldPct: null })],
      cexFundedCount: 0,
      busyWalletCount: 0,
      sameBlock: [],
    });

    expect(note).toContain("the token's own creator");
    // An unreadable balance publishes nothing about holding or selling.
    expect(note).not.toContain("still holds");
  });

  it("publishes the cap as a floor and explains the exchange exclusion", () => {
    const note = earlyBuyerNote({
      buyersFound: 40,
      buyersCapped: true,
      windowSigCount: 100,
      windowTxCount: 60,
      tracedCount: 30,
      clusters: [],
      cexFundedCount: 1,
      busyWalletCount: 19,
      sameBlock: [],
    });

    expect(note).toContain("a floor");
    expect(note).toContain("No two of the 30 traced wallets share a funding source.");
    expect(note).toContain("never counted as a shared funder");
    // A deep-history sniper wallet is unresolved, never independent, and one
    // exchange-funded wallet gets the singular verb.
    expect(note).toContain("19 of the traced are high-activity wallets");
    expect(note).toContain("unresolved is never counted as independent");
    expect(note).toContain("1 was funded straight from exchange custody");
  });
});
