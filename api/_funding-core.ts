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

export interface ProviderUsage {
  calls: number;
  succeeded: number;
}

export async function heliusRpc(url: string, method: string, params: unknown, usage: ProviderUsage): Promise<any> {
  usage.calls += 1;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`rpc ${method} ${res.status}`);
  const d = (await res.json()) as any;
  if (d.error) throw new Error(`rpc ${method}: ${d.error.message}`);
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
  let last: any[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch: any[] = await heliusRpc(url, "getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }], usage).catch(() => []);
    if (!batch?.length) break;
    last = batch;
    if (batch.length < 1000) {
      return { sigs: batch.slice(-6).reverse().map((s) => s.signature), truncated: false };
    }
    before = batch[batch.length - 1].signature;
  }
  return { sigs: last.slice(-6).reverse().map((s) => s.signature), truncated: last.length >= 1000 };
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
  const scan = (instrs: any[]): string | null => {
    for (const ix of instrs ?? []) {
      const p = ix.parsed;
      if (!p?.info) continue;
      if (p.type === "transfer" && p.info.destination === wallet && p.info.source && p.info.source !== wallet) return p.info.source;
      if ((p.type === "createAccount" || p.type === "createAccountWithSeed") && p.info.newAccount === wallet && p.info.source && p.info.source !== wallet) return p.info.source;
    }
    return null;
  };
  for (const sig of sigs) {
    const tx = await heliusRpc(url, "getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }], usage).catch(() => null);
    if (!tx) continue;
    const direct = scan(tx.transaction?.message?.instructions);
    if (direct) return direct;
    for (const inner of tx.meta?.innerInstructions ?? []) {
      const s = scan(inner.instructions);
      if (s) return s;
    }
    const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
    const pre: number[] = tx.meta?.preBalances ?? [];
    const post: number[] = tx.meta?.postBalances ?? [];
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
    const result = await heliusRpc(url, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }], usage);
    const accounts: any[] = Array.isArray(result?.value) ? result.value : [];
    let sum = 0;
    for (const account of accounts) {
      const ui = account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof ui === "number" && Number.isFinite(ui)) sum += ui;
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
