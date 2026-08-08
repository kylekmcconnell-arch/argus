import { describe, expect, it } from "vitest";
import { reconstructEvmLaunch } from "./evm-launch-buyers";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const topic = (value: string) => `0x${value.slice(2).padStart(64, "0")}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const log = (block: number, from: string, to: string, value: bigint, tx: number, index = 0) => ({
  blockNumber: `0x${block.toString(16)}`,
  transactionIndex: `0x${tx.toString(16)}`,
  logIndex: `0x${index.toString(16)}`,
  transactionHash: hash(tx),
  data: `0x${value.toString(16)}`,
  topics: [TRANSFER, topic(from), topic(to)],
});

describe("EVM launch reconstruction", () => {
  it("finds the launch pool, first recipients, bursts, retention and shared submitters", () => {
    const launcher = address(1);
    const creator = address(2);
    const pool = address(3);
    const buyerA = address(10);
    const buyerB = address(11);
    const buyerC = address(12);
    const relayer = address(99);
    const logs = [
      log(100, address(0), launcher, 1_000n, 1),
      log(100, launcher, pool, 900n, 1, 1),
      log(101, pool, buyerA, 100n, 2),
      log(101, pool, buyerB, 200n, 3),
      log(102, pool, buyerC, 50n, 4),
      // A later transfer between buyers does not become another first buyer.
      log(103, buyerA, buyerC, 10n, 5),
    ];
    const transactions = new Map([
      [hash(2), { from: relayer }],
      [hash(3), { from: relayer }],
      [hash(4), { from: buyerC }],
    ]);
    const balances = new Map([[buyerA, 40n], [buyerB, 20n], [buyerC, 10n]]);
    const codes = new Map([[buyerA, "0x"], [buyerB, "0x1234"], [buyerC, "0x"]]);

    const read = reconstructEvmLaunch({ logs, transactions, balances, codes, launcher, creator, creationBlock: 100, totalSupply: 1_000n });

    expect(read).toMatchObject({
      pool,
      boughtRaw: "350",
      remainingRaw: "70",
      sameBlock: [{ block: 101, count: 2 }],
      sharedOrigins: [{ address: relayer, count: 2 }],
    });
    expect(read?.buyers.map((buyer) => buyer.address)).toEqual([buyerA, buyerB, buyerC]);
    expect(read?.buyers[1].contractWallet).toBe(true);
  });

  it("publishes an unreadable aggregate when even one live balance is missing", () => {
    const pool = address(3);
    const buyerA = address(10);
    const buyerB = address(11);
    const logs = [log(11, pool, buyerA, 10n, 1), log(12, pool, buyerB, 10n, 2)];
    const read = reconstructEvmLaunch({
      logs,
      transactions: new Map(),
      balances: new Map([[buyerA, 2n], [buyerB, null]]),
      codes: new Map(),
      launcher: null,
      creator: null,
      creationBlock: 10,
      totalSupply: 100n,
    });

    expect(read?.remainingRaw).toBeNull();
  });

  it("marks a capped recipient set as a floor and never includes the creator", () => {
    const pool = address(3);
    const creator = address(9);
    const logs = [
      log(11, pool, creator, 50n, 1),
      log(12, pool, address(10), 10n, 2),
      log(13, pool, address(11), 10n, 3),
      log(14, pool, address(12), 10n, 4),
    ];
    const read = reconstructEvmLaunch({
      logs,
      transactions: new Map(), balances: new Map(), codes: new Map(),
      launcher: null, creator, creationBlock: 10, totalSupply: 100n, cap: 2,
    });

    expect(read?.buyers.map((buyer) => buyer.address)).toEqual([address(10), address(11)]);
    expect(read?.buyersCapped).toBe(true);
  });

  it("closes the launch window at the cap instead of adding later re-buys", () => {
    const pool = address(3);
    const buyerA = address(10);
    const buyerB = address(11);
    const logs = [
      log(11, pool, buyerA, 10n, 1),
      log(12, pool, buyerB, 10n, 2),
      log(13, pool, address(12), 10n, 3),
      log(14, pool, buyerA, 1_000n, 4),
    ];
    const read = reconstructEvmLaunch({
      logs,
      transactions: new Map(), balances: new Map(), codes: new Map(),
      launcher: null, creator: null, creationBlock: 10, totalSupply: 2_000n, cap: 2,
    });

    expect(read?.boughtRaw).toBe("20");
    expect(read?.buyersCapped).toBe(true);
  });
});
