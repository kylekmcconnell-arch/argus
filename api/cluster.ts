// Wallet identity clustering. GET /api/cluster?mint=<mint>&chain=solana
//
// "Top 10 holders hold 40%" is only half the question. The half that matters is:
// how many of those wallets are the SAME hand? A team that splits its supply
// across ten fresh wallets looks decentralised on a holder chart and controls the
// float in practice. RugCheck flags SOME insiders but doesn't label every wallet
// and sums overlapping networks; this proves the linkage from first principles.
//
// We take the token's top holders (+ its deployer) and connect any two wallets by
// the two on-chain signals that mean "same operator": (1) a SHARED FUNDER — both
// wallets got their first SOL from the same non-exchange address (siblings seeded
// by one hand); (2) a DIRECT TRANSFER between them. Union-find over those edges
// yields the real distinct entities, and the combined supply each cluster controls
// is the concentration that a per-wallet holder chart hides.
//
// Solana only (Helius RPC + RugCheck). Gated on HELIUS_API_KEY. Bounded + graceful.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_WALLETS = 20;   // top holders we bother to cluster (cost bound)
const CHUNK = 5;          // per-wallet concurrency

// CEX hot wallets + programs: a shared *exchange* funder is NOT a same-operator
// signal (thousands of unrelated users withdraw from Binance), so these can never
// be the "via" of a co-funding link.
const CEX: Record<string, string> = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance", "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance", GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: "Coinbase",
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: "Coinbase", "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase",
  FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5: "Kraken", AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS: "OKX",
  "5VVBHtk2QQBy5rZ2pBdgcb4yj9DBYy8tDksBs2pWnUKr": "Bybit", "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo": "Gate.io",
  "6gnCPhXtLnUD76HjQuSYPENLSZdG8RvDB1pTLM5aLSss": "MEXC",
};
const SYSTEM = new Set<string>([
  "11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ComputeBudget111111111111111111111111111111",
]);
// A holder whose RugCheck label is market infrastructure (AMM/LP/CEX/program) is
// liquidity or custody, not a person — exclude it from the operator analysis.
const MARKET = /amm|dex|pool|cex|exchange|program|vault|locker|market|raydium|meteora|orca|pump/i;

async function rpc(url: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`rpc ${method} ${res.status}`);
  const d = (await res.json()) as any;
  if (d.error) throw new Error(`rpc ${method}: ${d.error.message}`);
  return d.result;
}

// The oldest few signatures for a wallet — the funding sits in one of its first txs.
async function oldestSigs(url: string, wallet: string): Promise<string[]> {
  let before: string | undefined;
  let last: any[] = [];
  for (let page = 0; page < 4; page++) {
    const batch: any[] = await rpc(url, "getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }]).catch(() => []);
    if (!batch?.length) break;
    last = batch;
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  return last.slice(-6).reverse().map((s) => s.signature);
}

// The account that first sent SOL into the wallet (the funder). Same shapes the
// deployer trail recognises: plain transfer, account-create funding, or the
// balance-delta fallback (the account that lost the most SOL in a funding tx).
async function fundingSource(url: string, wallet: string, sigs: string[]): Promise<string | null> {
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
    const tx = await rpc(url, "getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]).catch(() => null);
    if (!tx) continue;
    const direct = scan(tx.transaction?.message?.instructions);
    if (direct) return direct;
    for (const inner of tx.meta?.innerInstructions ?? []) { const s = scan(inner.instructions); if (s) return s; }
    const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
    const pre: number[] = tx.meta?.preBalances ?? [], post: number[] = tx.meta?.postBalances ?? [];
    const wi = keys.indexOf(wallet);
    if (wi >= 0 && (post[wi] ?? 0) > (pre[wi] ?? 0)) {
      let best = -1, drop = 0;
      for (let i = 0; i < keys.length; i++) { if (i === wi) continue; const d = (pre[i] ?? 0) - (post[i] ?? 0); if (d > drop && d > 1_000_000) { drop = d; best = i; } }
      if (best >= 0) return keys[best];
    }
  }
  return null;
}

// Native-SOL counterparties of a wallet (recent), to catch a DIRECT transfer
// between two members of the holder set — a wallet paying another is a hard link.
async function counterparties(key: string, wallet: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&limit=100`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return out;
    const txs = await r.json();
    for (const t of Array.isArray(txs) ? txs : []) {
      for (const nt of t.nativeTransfers ?? []) {
        if (nt.fromUserAccount === wallet && nt.toUserAccount) out.add(nt.toUserAccount);
        if (nt.toUserAccount === wallet && nt.fromUserAccount) out.add(nt.fromUserAccount);
      }
    }
  } catch { /* best-effort */ }
  return out;
}

// Union-find for grouping linked wallets into distinct operators.
class DSU {
  p = new Map<string, string>();
  find(x: string): string { const pp = this.p.get(x) ?? x; if (pp === x) { this.p.set(x, x); return x; } const r = this.find(pp); this.p.set(x, r); return r; }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

async function inChunks<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.HELIUS_API_KEY;
  const mint = typeof req.query.mint === "string" ? req.query.mint.trim() : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "solana").toLowerCase();
  if (!mint || !SOLADDR.test(mint)) { res.status(400).json({ error: "valid Solana mint required" }); return; }
  if (chain !== "solana") { res.status(200).json({ available: false, note: "Wallet clustering is Solana-only for now." }); return; }
  if (!key) { res.status(200).json({ mint, available: false, note: "Helius not configured; clustering unavailable." }); return; }

  try {
    // 1. Pull the holder set + labels + creator from RugCheck (full addresses).
    const rr = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
    if (!rr.ok) { res.status(200).json({ mint, available: false, error: `rugcheck ${rr.status}` }); return; }
    const rc = (await rr.json()) as any;
    const ka: Record<string, { name?: string; type?: string }> = rc.knownAccounts ?? {};
    const isMarket = (h: any) => { const lab = ka[h.address] || ka[h.owner]; return !!(lab?.type && MARKET.test(lab.type)); };
    const holders = (rc.topHolders ?? [])
      .map((h: any) => ({ address: String(h.owner || h.address || ""), pct: Number(h.pct ?? 0), insider: !!h.insider, market: isMarket(h) }))
      .filter((h: any) => SOLADDR.test(h.address) && !h.market && !CEX[h.address] && !SYSTEM.has(h.address));
    const creator = typeof rc.creator === "string" && SOLADDR.test(rc.creator) ? rc.creator : null;

    const set: string[] = [];
    const pctOf = new Map<string, number>();
    const insiderOf = new Map<string, boolean>();
    for (const h of holders.slice(0, MAX_WALLETS)) { if (!pctOf.has(h.address)) { set.push(h.address); pctOf.set(h.address, h.pct); insiderOf.set(h.address, h.insider); } }
    if (creator && !pctOf.has(creator)) { set.push(creator); pctOf.set(creator, 0); }
    if (set.length < 2) { res.status(200).json({ mint, available: true, clusters: [], walletsAnalyzed: set.length, note: "Not enough non-market holders to cluster." }); return; }

    // 2. For each wallet, resolve its funder + its recent SOL counterparties.
    const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
    const deadline = Date.now() + 50000;
    const profiles = await inChunks(set, CHUNK, async (w) => {
      if (Date.now() > deadline) return { wallet: w, funder: null as string | null, cps: new Set<string>() };
      const [sigs, cps] = await Promise.all([oldestSigs(url, w), counterparties(key, w)]);
      const funder = sigs.length ? await fundingSource(url, w, sigs) : null;
      return { wallet: w, funder, cps };
    });

    // 3. Build links + union-find. A shared non-CEX funder OR a direct transfer
    //    between two set members ties them into one operator.
    const inSet = new Set(set);
    const dsu = new DSU();
    for (const w of set) dsu.find(w);
    const links: { a: string; b: string; type: "co-funded" | "transfer"; via?: string }[] = [];
    // co-funding: group by funder
    const byFunder = new Map<string, string[]>();
    for (const p of profiles) {
      if (!p.funder || CEX[p.funder] || SYSTEM.has(p.funder)) continue;
      (byFunder.get(p.funder) ?? byFunder.set(p.funder, []).get(p.funder)!).push(p.wallet);
    }
    for (const [funder, ws] of byFunder) {
      if (ws.length < 2) continue;
      for (let i = 1; i < ws.length; i++) { dsu.union(ws[0], ws[i]); links.push({ a: ws[0], b: ws[i], type: "co-funded", via: funder }); }
    }
    // direct transfers between set members
    for (const p of profiles) {
      for (const cp of p.cps) {
        if (cp !== p.wallet && inSet.has(cp)) {
          const a = p.wallet < cp ? p.wallet : cp, b = p.wallet < cp ? cp : p.wallet;
          if (!links.some((l) => l.type === "transfer" && l.a === a && l.b === b)) { dsu.union(a, b); links.push({ a, b, type: "transfer" }); }
        }
      }
    }

    // 4. Assemble clusters (size >= 2), with the combined supply each controls.
    const groups = new Map<string, string[]>();
    for (const w of set) { const r = dsu.find(w); (groups.get(r) ?? groups.set(r, []).get(r)!).push(w); }
    const clusters = [...groups.values()]
      .filter((ws) => ws.length >= 2)
      .map((ws) => {
        const combinedPct = ws.reduce((s, w) => s + (pctOf.get(w) ?? 0), 0);
        const clinks = links.filter((l) => ws.includes(l.a) && ws.includes(l.b));
        const funders = [...new Set(clinks.filter((l) => l.via).map((l) => l.via as string))];
        return {
          wallets: ws.map((w) => ({ address: w, pct: pctOf.get(w) ?? 0, insider: !!insiderOf.get(w), isCreator: w === creator })),
          size: ws.length,
          combinedPct,
          sharedFunders: funders,
          links: clinks,
          includesCreator: creator ? ws.includes(creator) : false,
        };
      })
      .sort((a, b) => b.combinedPct - a.combinedPct || b.size - a.size);

    const top = clusters[0];
    const note = !clusters.length
      ? `Analyzed ${set.length} top holders; found no on-chain links between them (independently funded, no direct transfers). No hidden common ownership detected.`
      : `${clusters.length} coordinated wallet group${clusters.length === 1 ? "" : "s"} among the top holders. The largest is ${top.size} wallets controlling a combined ${top.combinedPct.toFixed(1)}% of supply${top.sharedFunders.length ? `, seeded by one funder (${top.sharedFunders[0].slice(0, 6)}…)` : " via direct transfers"}${top.includesCreator ? ", including the token's creator" : ""}. A holder chart shows these as separate wallets; on-chain they are one hand.`;

    res.status(200).json({ mint, available: true, walletsAnalyzed: set.length, clusters, note });
  } catch (e) {
    res.status(200).json({ mint, available: true, clusters: [], error: String(e), note: "Wallet clustering failed." });
  }
}
