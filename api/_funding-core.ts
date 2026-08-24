// Shared Solana funding-walk primitives (Helius RPC).
//
// The walk itself exists in three places now: api/deployer.ts (panel),
// api/deployer-origin.ts (scan-time port of it) and api/cluster.ts, each with a
// private copy. This module is the first shared home, written for
// api/early-buyers.ts; folding the older routes onto it is the documented
// follow-up (see the panelVsScanTime note in docs/architecture.json) and needs
// those routes to move at once.
//
// Direction discipline: everything here walks BACKWARD (who funded a wallet).
// Nothing follows a lamport forward, so nothing here can support a claim about
// where money went.

import { arr, num, rec, str } from "../src/lib/json.js";

export interface ProviderUsage {
  calls: number;
  succeeded: number;
}

export async function heliusRpc(url: string, method: string, params: unknown, usage: ProviderUsage): Promise<unknown> {
  usage.calls += 1;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`rpc ${method} ${res.status}`);
  const d = rec(await res.json());
  const error = rec(d.error);
  if (d.error) throw new Error(`rpc ${method}: ${str(error.message)}`);
  usage.succeeded += 1;
  return d.result;
}

/**
 * The oldest few signatures for a wallet, oldest first. The funding sits in one
 * of a wallet's first transactions. `truncated` is true when the wallet had
 * more history than the page budget could walk, in which case the "oldest"
 * signatures are merely the oldest REACHED and a funder read from them would
 * describe the wrong era; callers must treat that wallet as unresolved.
 */
export async function oldestWalletSigs(
  url: string,
  wallet: string,
  usage: ProviderUsage,
  maxPages = 3,
): Promise<{ sigs: string[]; truncated: boolean }> {
  let before: string | undefined;
  let last: unknown[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = arr(await heliusRpc(url, "getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }], usage).catch(() => []));
    if (!batch.length) break;
    last = batch;
    if (batch.length < 1000) {
      return { sigs: batch.slice(-6).reverse().map((s) => str(rec(s).signature)), truncated: false };
    }
    before = str(rec(batch[batch.length - 1]).signature);
  }
  return { sigs: last.slice(-6).reverse().map((s) => str(rec(s).signature)), truncated: last.length >= 1000 };
}

/**
 * The account that first sent SOL into the wallet (its seed funder), from its
 * oldest transactions. Recognises the common funding shapes: a plain system
 * transfer, account-create funding, and the balance-delta fallback (the
 * account that lost the most SOL in a transaction where the wallet gained).
 * Strictly inbound; an instruction where the wallet is the source is money
 * leaving and is skipped rather than read backwards.
 */
export async function seedFundingSource(url: string, wallet: string, sigs: string[], usage: ProviderUsage): Promise<string | null> {
  const scan = (instrs: unknown): string | null => {
    for (const ix of arr(instrs)) {
      const parsed = rec(rec(ix).parsed);
      const info = rec(parsed.info);
      const source = str(info.source);
      if (!parsed.info) continue;
      if (parsed.type === "transfer" && info.destination === wallet && source && source !== wallet) return source;
      if ((parsed.type === "createAccount" || parsed.type === "createAccountWithSeed") && info.newAccount === wallet && source && source !== wallet) return source;
    }
    return null;
  };
  for (const sig of sigs) {
    let tx: unknown;
    try {
      tx = await heliusRpc(url, "getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }], usage);
    } catch {
      // The signatures are oldest first. Once one transaction is unreadable,
      // a funder found later could merely be a top-up rather than the seed.
      // Fail closed instead of advancing past the missing evidence.
      return null;
    }
    if (!tx) return null;
    const txRecord = rec(tx);
    const transaction = rec(txRecord.transaction);
    const message = rec(transaction.message);
    const meta = rec(txRecord.meta);
    const direct = scan(message.instructions);
    if (direct) return direct;
    for (const inner of arr(meta.innerInstructions)) {
      const s = scan(rec(inner).instructions);
      if (s) return s;
    }
    const keys = arr(message.accountKeys).map((key) => typeof key === "string" ? key : str(rec(key).pubkey));
    const pre = arr(meta.preBalances).map(num);
    const post = arr(meta.postBalances).map(num);
    const wi = keys.indexOf(wallet);
    if (wi >= 0 && (post[wi] ?? 0) > (pre[wi] ?? 0)) {
      let best = -1, drop = 0;
      for (let i = 0; i < keys.length; i++) {
        if (i === wi) continue;
        const d = (pre[i] ?? 0) - (post[i] ?? 0);
        if (d > drop && d > 1_000_000) { drop = d; best = i; } // > ~0.001 SOL
      }
      if (best >= 0) return keys[best];
    }
  }
  return null;
}

/**
 * The wallet's current balance of one mint, in UI units, summed across its
 * token accounts. Null means the read failed, which is not a zero balance.
 */
export async function currentTokenBalance(url: string, owner: string, mint: string, usage: ProviderUsage): Promise<number | null> {
  try {
    const result = rec(await heliusRpc(url, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }], usage));
    if (!Array.isArray(result.value)) return null;
    const accounts = result.value;
    let sum = 0;
    for (const account of accounts) {
      const accountRecord = rec(account);
      const amount = rec(rec(rec(rec(accountRecord.account).data).parsed).info).tokenAmount;
      const amountRecord = rec(amount);
      const ui = amountRecord.uiAmount;
      if (typeof ui === "number" && Number.isFinite(ui) && ui >= 0) {
        sum += ui;
        continue;
      }
      const uiString = typeof amountRecord.uiAmountString === "string" ? amountRecord.uiAmountString.trim() : "";
      const parsed = uiString ? Number(uiString) : Number.NaN;
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      sum += parsed;
    }
    return sum;
  } catch {
    return null;
  }
}

export async function inChunks<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}
