// Deployer funding-trail forensics. GET /api/deployer?wallet=<addr>
//
// A token's deployer wallet is a pseudonym, but the money that FUNDED it usually
// is not: the first SOL into a fresh deployer comes from somewhere — a CEX
// withdrawal (KYC'd, traceable by subpoena) or another wallet. When several
// deployers trace back to the SAME funding wallet, that funder is a serial-launch
// hub, and that pattern is invisible in any single token's page. This endpoint
// pulls the trail: who funded the deployer, how old the wallet is, and how many
// tokens it has minted (a one-shot deployer vs a serial factory).
//
// Solana only (Helius RPC). Gated on HELIUS_API_KEY. ~a few RPC calls per wallet.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const MAX_SIG_PAGES = 10; // 1000 sigs/page; bounds pagination on busy wallets

// Well-known Solana CEX hot wallets. A funder match here means the trail leads to
// a KYC'd exchange account (a real subpoena target), not an anonymous wallet.
const CEX: Record<string, string> = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance",
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: "Coinbase",
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: "Coinbase",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase",
  FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5: "Kraken",
  AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS: "OKX",
  "5VVBHtk2QQBy5rZ2pBdgcb4yj9DBYy8tDksBs2pWnUKr": "Bybit",
  "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo": "Gate.io",
  "6gnCPhXtLnUD76HjQuSYPENLSZdG8RvDB1pTLM5aLSss": "MEXC",
};

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

// Walk getSignaturesForAddress back to the wallet's very first signatures. We
// keep the oldest few (not just one) because the absolute-oldest tx is sometimes
// the token mint itself; the funding sits in a neighbouring early tx.
async function oldestActivity(url: string, wallet: string): Promise<{ oldestSigs: string[]; firstBlockTime: number | null; truncated: boolean }> {
  let before: string | undefined;
  let lastBatch: any[] = [];
  for (let pages = 0; pages < MAX_SIG_PAGES; pages++) {
    const batch: any[] = await rpc(url, "getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!batch?.length) break;
    lastBatch = batch;
    if (batch.length < 1000) {
      const tail = batch.slice(-6).reverse(); // oldest first
      return { oldestSigs: tail.map((s) => s.signature), firstBlockTime: batch[batch.length - 1].blockTime ?? null, truncated: false };
    }
    before = batch[batch.length - 1].signature;
  }
  const tail = lastBatch.slice(-6).reverse();
  return { oldestSigs: tail.map((s) => s.signature), firstBlockTime: lastBatch[lastBatch.length - 1]?.blockTime ?? null, truncated: true };
}

// Find the account that first sent SOL INTO the wallet, scanning the oldest few
// transactions (oldest first) and recognising the common funding shapes.
async function fundingSource(url: string, wallet: string, sigs: string[]): Promise<string | null> {
  const scan = (instrs: any[]): string | null => {
    for (const ix of instrs ?? []) {
      const p = ix.parsed;
      if (!p?.info) continue;
      // plain SOL transfer to the wallet
      if (p.type === "transfer" && p.info.destination === wallet && p.info.source && p.info.source !== wallet) return p.info.source;
      // wallet created + funded by another account (rent-funding the new account)
      if ((p.type === "createAccount" || p.type === "createAccountWithSeed") && p.info.newAccount === wallet && p.info.source && p.info.source !== wallet) return p.info.source;
    }
    return null;
  };
  for (const sig of sigs) {
    const tx = await rpc(url, "getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
    if (!tx) continue;
    const direct = scan(tx.transaction?.message?.instructions);
    if (direct) return direct;
    for (const inner of tx.meta?.innerInstructions ?? []) {
      const s = scan(inner.instructions);
      if (s) return s;
    }
    // Balance-delta fallback: if the wallet gained SOL in this tx, the account
    // that lost the most SOL is the funder. Skip system/vote programs.
    const keys: string[] = (tx.transaction?.message?.accountKeys ?? []).map((k: any) => (typeof k === "string" ? k : k.pubkey));
    const pre: number[] = tx.meta?.preBalances ?? [];
    const post: number[] = tx.meta?.postBalances ?? [];
    const wi = keys.indexOf(wallet);
    if (wi >= 0 && (post[wi] ?? 0) > (pre[wi] ?? 0)) {
      let best = -1, bestDrop = 0;
      for (let i = 0; i < keys.length; i++) {
        if (i === wi) continue;
        const drop = (pre[i] ?? 0) - (post[i] ?? 0);
        if (drop > bestDrop && drop > 1_000_000) { bestDrop = drop; best = i; } // > ~0.001 SOL
      }
      if (best >= 0) return keys[best];
    }
  }
  return null;
}

async function tokensCreated(url: string, wallet: string): Promise<number | null> {
  try {
    const r = await rpc(url, "getAssetsByCreator", { creatorAddress: wallet, onlyVerified: false, page: 1, limit: 1000 });
    return typeof r?.total === "number" ? r.total : (r?.items?.length ?? null);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.HELIUS_API_KEY;
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    res.status(400).json({ error: "valid Solana wallet required" });
    return;
  }
  if (!key) {
    res.status(200).json({ wallet, available: false, note: "Helius not configured; funding trail unavailable." });
    return;
  }
  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  try {
    const { oldestSigs, firstBlockTime, truncated } = await oldestActivity(url, wallet);
    const [funderAddr, created] = await Promise.all([
      oldestSigs.length ? fundingSource(url, wallet, oldestSigs) : Promise.resolve(null),
      tokensCreated(url, wallet),
    ]);
    const walletAgeDays = firstBlockTime ? Math.max(0, Math.round((Date.now() / 1000 - firstBlockTime) / 86400)) : null;
    const cexLabel = funderAddr ? CEX[funderAddr] : undefined;
    const funder = funderAddr
      ? { address: funderAddr, label: cexLabel ?? null, kind: cexLabel ? "cex" : "wallet" }
      : null;

    const note = funder
      ? cexLabel
        ? `Deployer was funded from ${cexLabel} — the trail ends at a KYC'd exchange account.`
        : `Deployer was funded by an anonymous wallet (${funderAddr!.slice(0, 6)}…). If other launches trace to the same funder, it is a serial operator.`
      : truncated
        ? "Wallet too active to trace the original funder within limits."
        : "No clear funding source found on-chain.";

    res.status(200).json({
      wallet,
      available: true,
      funder,
      tokensCreated: created,
      serialDeployer: typeof created === "number" && created >= 5,
      walletAgeDays,
      firstActivity: firstBlockTime ? new Date(firstBlockTime * 1000).toISOString().slice(0, 10) : null,
      truncated,
      note,
    });
  } catch (e) {
    res.status(200).json({ wallet, available: true, error: String(e), note: "Funding-trail lookup failed." });
  }
}
