// Reliable deployer resolution. GET /api/resolve-deployer?mint=<addr>[&debug=1]
//
// GoPlus doesn't always expose a token's creator, and paginating a busy mint's
// history to its first tx is too slow. This resolves the deployer from Helius by
// two indexed/bounded methods, in order:
//   1. DAS getAsset(mint).creators / update authority — indexed, instant, works
//      on busy mints (excluding launchpad/program addresses).
//   2. the mint's OLDEST transaction fee payer — the wallet that paid to create
//      the mint (bounded pagination; the ground truth when reachable).
// Solana only (Helius). Gated on HELIUS_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SIG_PAGES = 8;

// Programs / launchpad + system accounts that show up as a "creator" or authority
// but are never the human deployer.
const NOT_A_DEV = new Set<string>([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // pump.fun program
  "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM", // pump.fun fee/authority
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", // metaplex metadata program
  "ComputeBudget111111111111111111111111111111",
]);
const ok = (a: unknown): a is string => typeof a === "string" && SOLADDR.test(a) && !NOT_A_DEV.has(a);

async function rpc(url: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`rpc ${method} ${res.status}`);
  const d = (await res.json()) as any;
  if (d.error) throw new Error(`rpc ${method}: ${d.error.message}`);
  return d.result;
}

// Method 1: DAS getAsset — indexed creators + update authority.
async function fromAsset(url: string, mint: string): Promise<{ creators: string[]; authority: string | null }> {
  try {
    const a = await rpc(url, "getAsset", { id: mint });
    const creators = (a?.creators ?? []).map((c: any) => c?.address).filter(ok);
    const authority = (a?.authorities ?? []).map((x: any) => x?.address).find(ok) ?? null;
    return { creators, authority };
  } catch {
    return { creators: [], authority: null };
  }
}

// Method 2: the mint's oldest tx fee payer (the account that created the mint).
async function firstTxSigner(url: string, mint: string): Promise<string | null> {
  try {
    let before: string | undefined;
    let oldest: string | null = null;
    for (let p = 0; p < MAX_SIG_PAGES; p++) {
      const batch: any[] = await rpc(url, "getSignaturesForAddress", [mint, { limit: 1000, ...(before ? { before } : {}) }]);
      if (!batch?.length) break;
      if (batch.length < 1000) { oldest = batch[batch.length - 1].signature; break; }
      before = batch[batch.length - 1].signature;
      if (p === MAX_SIG_PAGES - 1) return null; // too active to reach creation
    }
    if (!oldest) return null;
    const tx = await rpc(url, "getTransaction", [oldest, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
    const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
    // fee payer = first signer/writable account key
    const payer = keys.find((k) => (typeof k === "object" ? k.signer : false)) ?? keys[0];
    const addr = typeof payer === "string" ? payer : payer?.pubkey;
    return ok(addr) ? addr : null;
  } catch {
    return null;
  }
}

// Method 3 (pump.fun + any launchpad): the enhanced-tx API filters server-side by
// type and gives a parsed feePayer, so we can reach the mint's CREATE / TOKEN_MINT
// tx directly without paginating the whole busy history. The feePayer of that tx
// is the dev — the reliable pump.fun deployer source.
async function fromEnhancedCreate(key: string, mint: string): Promise<string | null> {
  for (const type of ["CREATE", "TOKEN_MINT"]) {
    try {
      const r = await fetch(`https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${key}&type=${type}&limit=100`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const txs = await r.json();
      if (!Array.isArray(txs) || !txs.length) continue;
      // the creation is the OLDEST matching tx; the batch is newest-first
      const create = txs[txs.length - 1];
      const payer = create?.feePayer;
      if (ok(payer)) return payer;
    } catch { /* try next type */ }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.HELIUS_API_KEY;
  const mint = typeof req.query.mint === "string" ? req.query.mint.trim() : "";
  if (!mint || !SOLADDR.test(mint)) { res.status(400).json({ error: "valid Solana mint required" }); return; }
  if (!key) { res.status(200).json({ mint, available: false, note: "Helius not configured." }); return; }

  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  try {
    const [asset, firstTx, createPayer] = await Promise.all([
      fromAsset(url, mint),
      firstTxSigner(url, mint),
      fromEnhancedCreate(key, mint),
    ]);
    // Prefer a real creation-tx fee payer (ground truth), then the enhanced-tx
    // create payer (pump.fun), then an indexed creator, then the update authority.
    const deployer = firstTx ?? createPayer ?? asset.creators[0] ?? asset.authority ?? null;
    const via = firstTx ? "creation-tx fee payer" : createPayer ? "enhanced create feePayer" : asset.creators[0] ? "DAS creator" : asset.authority ? "update authority" : null;
    const body: any = { mint, available: true, deployer, via };
    if (req.query.debug) body.candidates = { firstTx, createPayer, creators: asset.creators, authority: asset.authority };
    res.status(200).json(body);
  } catch (e) {
    res.status(200).json({ mint, available: true, deployer: null, error: String(e) });
  }
}
