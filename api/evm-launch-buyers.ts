// Scan-time EVM launch-buyer trace. GET /api/evm-launch-buyers?chain=<chain>&address=<token>
//
// This is the Blockscout/RPC counterpart to early-buyers.ts. It reconstructs
// the first buyers from the token's Transfer logs, rather than pretending that
// a current holder chart describes the launch. The result deliberately keeps
// common transaction submitters separate from common funders: on modern EVM
// chains an ERC-4337 bundler or relayer can submit transactions for unrelated
// users, so adopting that address as wallet identity would create a false
// bundle finding.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { classifyMarketAddress } from "../src/lib/marketAddresses.js";

export const config = { maxDuration: 30 };

const CHAIN: Record<string, { explorer: string; rpc: string }> = {
  robinhood: {
    explorer: "https://robinhoodchain.blockscout.com",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
  },
};

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const BUYER_CAP = 36;
const LAUNCH_BLOCK_WINDOW = 2_000;
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const isAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value);
const lc = (value: string): string => value.toLowerCase();

interface RpcLog {
  address?: string;
  blockNumber?: string;
  transactionHash?: string;
  transactionIndex?: string;
  logIndex?: string;
  data?: string;
  topics?: string[];
}

interface RpcTransaction { hash?: string; from?: string; to?: string | null }

export interface EvmLaunchBuyer {
  address: string;
  firstBlock: number;
  firstTransaction: string;
  boughtRaw: string;
  remainingRaw: string | null;
  transactionOrigin: string | null;
  contractWallet: boolean | null;
}

export interface EvmLaunchRead {
  pool: string;
  launcher: string | null;
  creator: string | null;
  creationBlock: number;
  buyers: EvmLaunchBuyer[];
  buyersCapped: boolean;
  sameBlock: Array<{ block: number; count: number }>;
  sharedOrigins: Array<{ address: string; count: number }>;
  boughtRaw: string;
  remainingRaw: string | null;
  totalSupplyRaw: string;
}

function topicAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[a-fA-F0-9]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function hexInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]+$/.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function hexNumber(value: unknown): number | null {
  const parsed = hexInt(value);
  return parsed !== null && parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null;
}

/** Pure reconstruction, exported so fixtures exercise the exact launch rule. */
export function reconstructEvmLaunch(input: {
  logs: RpcLog[];
  transactions: Map<string, RpcTransaction>;
  balances: Map<string, bigint | null>;
  codes: Map<string, string | null>;
  launcher: string | null;
  creator: string | null;
  creationBlock: number;
  totalSupply: bigint;
  cap?: number;
}): EvmLaunchRead | null {
  const ordered = [...input.logs]
    .filter((log) => lc(log.topics?.[0] ?? "") === TRANSFER)
    .sort((a, b) => (hexNumber(a.blockNumber) ?? 0) - (hexNumber(b.blockNumber) ?? 0)
      || (hexNumber(a.transactionIndex) ?? 0) - (hexNumber(b.transactionIndex) ?? 0)
      || (hexNumber(a.logIndex) ?? 0) - (hexNumber(b.logIndex) ?? 0));

  // The launch pool is the address that sends the token to the most distinct
  // recipients after creation. This works for factory launches without trusting
  // a provider's field name, and refuses when no trading source is established.
  const outgoing = new Map<string, Set<string>>();
  for (const log of ordered) {
    const block = hexNumber(log.blockNumber);
    const from = topicAddress(log.topics?.[1]);
    const to = topicAddress(log.topics?.[2]);
    if (block === null || block <= input.creationBlock || !from || !to || from === ZERO) continue;
    const recipients = outgoing.get(from) ?? new Set<string>();
    recipients.add(to);
    outgoing.set(from, recipients);
  }
  const pool = [...outgoing.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0] ?? null;
  if (!pool || (outgoing.get(pool)?.size ?? 0) < 2) return null;

  const cap = input.cap ?? BUYER_CAP;
  const buyers = new Map<string, EvmLaunchBuyer>();
  let capped = false;
  for (const log of ordered) {
    const block = hexNumber(log.blockNumber);
    const from = topicAddress(log.topics?.[1]);
    const to = topicAddress(log.topics?.[2]);
    const amount = hexInt(log.data);
    const hash = typeof log.transactionHash === "string" ? lc(log.transactionHash) : "";
    if (block === null || block <= input.creationBlock || from !== pool || !to || amount === null || amount <= 0n || !hash) continue;
    if (to === pool || to === lc(input.launcher ?? "") || to === lc(input.creator ?? "")) continue;
    // Exchange custody and other known venues are market infrastructure, not
    // launch buyers. Excluding only the pool, launcher and creator let a CEX
    // deposit address inside the window count as a first buyer and inflate
    // the "still holds" figure with customer float.
    if (classifyMarketAddress(to)) continue;
    const prior = buyers.get(to);
    if (prior) {
      prior.boughtRaw = (BigInt(prior.boughtRaw) + amount).toString();
      continue;
    }
    // The bounded launch window closes when the next distinct recipient would
    // exceed the cap. Do not keep adding later re-buys by the first wallets,
    // which would turn a launch measurement into a 2,000-block trading total.
    if (buyers.size >= cap) { capped = true; break; }
    const tx = input.transactions.get(hash);
    const origin = tx?.from && isAddress(tx.from) ? lc(tx.from) : null;
    const code = input.codes.get(to);
    buyers.set(to, {
      address: to,
      firstBlock: block,
      firstTransaction: hash,
      boughtRaw: amount.toString(),
      remainingRaw: input.balances.get(to)?.toString() ?? null,
      transactionOrigin: origin,
      contractWallet: code === null || code === undefined ? null : code !== "0x" && code !== "0x0",
    });
  }
  if (buyers.size === 0) return null;

  const rows = [...buyers.values()];
  const byBlock = new Map<number, number>();
  const byOrigin = new Map<string, Set<string>>();
  for (const buyer of rows) {
    byBlock.set(buyer.firstBlock, (byBlock.get(buyer.firstBlock) ?? 0) + 1);
    if (buyer.transactionOrigin && buyer.transactionOrigin !== buyer.address && buyer.transactionOrigin !== pool) {
      const members = byOrigin.get(buyer.transactionOrigin) ?? new Set<string>();
      members.add(buyer.address);
      byOrigin.set(buyer.transactionOrigin, members);
    }
  }
  const bought = rows.reduce((sum, buyer) => sum + BigInt(buyer.boughtRaw), 0n);
  const allBalances = rows.every((buyer) => buyer.remainingRaw !== null);
  const remaining = allBalances ? rows.reduce((sum, buyer) => sum + BigInt(buyer.remainingRaw ?? "0"), 0n) : null;

  return {
    pool,
    launcher: input.launcher ? lc(input.launcher) : null,
    creator: input.creator ? lc(input.creator) : null,
    creationBlock: input.creationBlock,
    buyers: rows,
    buyersCapped: capped,
    sameBlock: [...byBlock.entries()].filter(([, count]) => count >= 2).map(([block, count]) => ({ block, count })).sort((a, b) => b.count - a.count),
    sharedOrigins: [...byOrigin.entries()].filter(([, members]) => members.size >= 2).map(([address, members]) => ({ address, count: members.size })).sort((a, b) => b.count - a.count),
    boughtRaw: bought.toString(),
    remainingRaw: remaining?.toString() ?? null,
    totalSupplyRaw: input.totalSupply.toString(),
  };
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${method} ${response.status}`);
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? `${method} returned no result`);
  return body.result;
}

const word = (value: bigint): string => value.toString(16).padStart(64, "0");
const paddedBytes = (hex: string): string => {
  const body = hex.replace(/^0x/, "");
  return `${word(BigInt(body.length / 2))}${body.padEnd(Math.ceil(body.length / 64) * 64, "0")}`;
};

/** ABI for Multicall3 aggregate((address,bytes)[]), kept local to avoid adding
 * a 100KB client-side web3 dependency to one server route. */
export function encodeAggregate(calls: Array<{ target: string; data: string }>): string {
  const tuples = calls.map((call) => `${call.target.slice(2).toLowerCase().padStart(64, "0")}${word(64n)}${paddedBytes(call.data)}`);
  let offset = BigInt(calls.length * 32);
  const offsets = tuples.map((tuple) => {
    const here = word(offset);
    offset += BigInt(tuple.length / 2);
    return here;
  }).join("");
  return `0x252dba42${word(32n)}${word(BigInt(calls.length))}${offsets}${tuples.join("")}`;
}

/** Decode aggregate's (blockNumber, bytes[]) return. */
export function decodeAggregate(value: string, expected: number): Array<string | null> {
  const hex = value.replace(/^0x/, "");
  if (!/^[a-fA-F0-9]+$/.test(hex) || hex.length < 128) return Array(expected).fill(null);
  const arrayOffset = Number(BigInt(`0x${hex.slice(64, 128)}`)) * 2;
  const count = Number(BigInt(`0x${hex.slice(arrayOffset, arrayOffset + 64)}`));
  const head = arrayOffset + 64;
  const out: Array<string | null> = [];
  for (let i = 0; i < Math.min(count, expected); i++) {
    const relative = Number(BigInt(`0x${hex.slice(head + i * 64, head + (i + 1) * 64)}`)) * 2;
    const at = head + relative;
    const length = Number(BigInt(`0x${hex.slice(at, at + 64)}`)) * 2;
    const body = hex.slice(at + 64, at + 64 + length);
    out.push(body.length === length ? `0x${body}` : null);
  }
  while (out.length < expected) out.push(null);
  return out;
}

const callAddress = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return address === ZERO ? null : lc(address);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const chain = String(req.query.chain ?? "").trim().toLowerCase();
  const address = String(req.query.address ?? "").trim();
  if (!isAddress(address)) return res.status(400).json({ error: "valid EVM token address required" });
  const source = CHAIN[chain];
  if (!source) return res.status(200).json({ address, chain, available: false, note: `ARGUS does not yet have a launch-log source for ${chain}.` });

  try {
    // The young Robinhood Blockscout occasionally returns a transient 500 on
    // this otherwise keyless endpoint. One retry prevents that provider wobble
    // from erasing an entire launch reading.
    let meta: { creation_transaction_hash?: string } | null = null;
    let metaStatus = 0;
    for (let attempt = 0; attempt < 2 && !meta; attempt++) {
      const metaResponse = await fetch(`${source.explorer}/api/v2/addresses/${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      metaStatus = metaResponse?.status ?? 0;
      if (metaResponse?.ok) meta = await metaResponse.json() as { creation_transaction_hash?: string };
    }
    if (!meta) throw new Error(`Blockscout address ${metaStatus || "unreachable"}`);
    const creationHash = typeof meta.creation_transaction_hash === "string" ? meta.creation_transaction_hash : "";
    if (!/^0x[a-fA-F0-9]{64}$/.test(creationHash)) throw new Error("creation transaction unavailable");

    const receipt = await rpc<{ blockNumber?: string }>(source.rpc, "eth_getTransactionReceipt", [creationHash]);
    const creationBlock = hexNumber(receipt?.blockNumber);
    if (creationBlock === null) throw new Error("creation block unavailable");

    // Robinhood's public RPC accepts ordinary calls but rejects JSON-RPC batch
    // envelopes. Four small calls here plus one Multicall below keep the request
    // count bounded without depending on provider-specific batch behavior.
    const totalSupplyResult = await rpc<string>(source.rpc, "eth_call", [{ to: address, data: "0x18160ddd" }, "latest"]);
    const decimalsResult = await rpc<string>(source.rpc, "eth_call", [{ to: address, data: "0x313ce567" }, "latest"]);
    const launcherResult = await rpc<string>(source.rpc, "eth_call", [{ to: address, data: "0x16eebd1e" }, "latest"]).catch(() => "0x");
    const creatorResult = await rpc<string>(source.rpc, "eth_call", [{ to: address, data: "0x02d05d3f" }, "latest"]).catch(() => "0x");
    const totalSupply = hexInt(totalSupplyResult);
    const decimals = hexNumber(decimalsResult);
    if (totalSupply === null || totalSupply <= 0n) throw new Error("total supply unavailable");

    const logs = await rpc<RpcLog[]>(source.rpc, "eth_getLogs", [{
      address,
      fromBlock: `0x${creationBlock.toString(16)}`,
      toBlock: `0x${(creationBlock + LAUNCH_BLOCK_WINDOW).toString(16)}`,
      topics: [TRANSFER],
    }]);
    if (!Array.isArray(logs) || logs.length === 0) throw new Error("launch transfer logs unavailable");

    // First pass establishes the pool and candidate buyers. Transaction,
    // balance and code reads then fit in one bounded JSON-RPC batch.
    const preliminary = reconstructEvmLaunch({
      logs,
      transactions: new Map(), balances: new Map(), codes: new Map(),
      launcher: callAddress(launcherResult), creator: callAddress(creatorResult),
      creationBlock, totalSupply,
    });
    if (!preliminary) {
      return res.status(200).json({ address, chain, available: false, note: "A launch pool and first-buyer window could not be reconstructed from the token's first 2,000 blocks." });
    }

    // One on-chain Multicall returns every live balance. Unlike JSON-RPC batch,
    // this is one ordinary eth_call and works on the chain's rate-limited RPC.
    const balanceCall = encodeAggregate(preliminary.buyers.map((buyer) => ({
      target: address,
      data: `0x70a08231000000000000000000000000${buyer.address.slice(2)}`,
    })));
    const balanceResult = await rpc<string>(source.rpc, "eth_call", [{ to: MULTICALL3, data: balanceCall }, "latest"]);
    const decodedBalances = decodeAggregate(balanceResult, preliminary.buyers.length);

    // Transaction origins are read only for the largest same-block bursts. A
    // whole block returns all transaction senders in one call, which is enough
    // to identify a shared submitter without one request per buyer.
    const burstBlocks = preliminary.sameBlock.slice(0, 4).map((burst) => burst.block);
    const transactions = new Map<string, RpcTransaction>();
    for (const block of burstBlocks) {
      const blockRead = await rpc<{ transactions?: RpcTransaction[] }>(source.rpc, "eth_getBlockByNumber", [`0x${block.toString(16)}`, true]).catch(() => null);
      for (const tx of blockRead?.transactions ?? []) if (tx.hash) transactions.set(lc(tx.hash), tx);
    }
    const balances = new Map<string, bigint | null>();
    const codes = new Map<string, string | null>();
    preliminary.buyers.forEach((buyer, index) => {
      balances.set(buyer.address, hexInt(decodedBalances[index]));
      codes.set(buyer.address, null);
    });

    const reading = reconstructEvmLaunch({
      logs, transactions, balances, codes,
      launcher: callAddress(launcherResult), creator: callAddress(creatorResult),
      creationBlock, totalSupply,
    });
    if (!reading) throw new Error("launch reconstruction failed");

    res.setHeader("cache-control", "private, max-age=300");
    return res.status(200).json({
      address, chain, available: true, decimals,
      windowBlocks: LAUNCH_BLOCK_WINDOW,
      ...reading,
      sourceUrl: `${source.explorer}/token/${address}?tab=token_transfers`,
      note: `${reading.buyers.length}${reading.buyersCapped ? "+" : ""} first distinct pool recipients were reconstructed from the token's first ${LAUNCH_BLOCK_WINDOW.toLocaleString("en-US")} blocks.`,
    });
  } catch (error) {
    return res.status(200).json({ address, chain, available: false, note: "The EVM launch-buyer trace did not complete; no bundle conclusion was drawn.", error: String(error) });
  }
}
