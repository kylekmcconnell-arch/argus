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
async function oldestActivity(url: string, wallet: string, maxPages = MAX_SIG_PAGES): Promise<{ oldestSigs: string[]; firstBlockTime: number | null; truncated: boolean }> {
  let before: string | undefined;
  let lastBatch: any[] = [];
  for (let pages = 0; pages < maxPages; pages++) {
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

interface Hop { from: string; to: string; label: string | null; kind: "cex" | "wallet" }

// Follow the money back hop by hop: deployer <- funder <- funder's funder <- ...
// until the trail reaches a CEX (the KYC'd cash-out origin), runs dry, loops, or
// hits the hop/time budget. Intermediary hops use shallow pagination to stay fast;
// a deep, multi-hop chain through fresh wallets is the classic launder-before-launch
// pattern, and a CEX terminus is where a subpoena would actually land.
async function traceChain(url: string, deployer: string, maxHops: number, deadline: number): Promise<{ chain: Hop[]; origin: { address: string; label: string | null; kind: "cex" | "wallet" } | null; truncatedAt: string | null }> {
  const chain: Hop[] = [];
  const seen = new Set<string>([deployer]);
  let current = deployer;
  for (let hop = 0; hop < maxHops; hop++) {
    if (Date.now() > deadline) return { chain, origin: chain.length ? { address: current, label: CEX[current] ?? null, kind: CEX[current] ? "cex" : "wallet" } : null, truncatedAt: current };
    const { oldestSigs, truncated } = await oldestActivity(url, current, hop === 0 ? MAX_SIG_PAGES : 3);
    const funder = oldestSigs.length ? await fundingSource(url, current, oldestSigs) : null;
    if (!funder) {
      const originAddr = chain.length ? current : null;
      return { chain, origin: originAddr ? { address: originAddr, label: CEX[originAddr] ?? null, kind: CEX[originAddr] ? "cex" : "wallet" } : null, truncatedAt: truncated ? current : null };
    }
    const label = CEX[funder] ?? null;
    const kind: "cex" | "wallet" = label ? "cex" : "wallet";
    chain.push({ from: current, to: funder, label, kind });
    if (label) return { chain, origin: { address: funder, label, kind }, truncatedAt: null }; // reached a CEX
    if (seen.has(funder)) return { chain, origin: { address: funder, label: null, kind: "wallet" }, truncatedAt: null }; // cycle
    seen.add(funder);
    current = funder;
  }
  const last = chain[chain.length - 1];
  return { chain, origin: last ? { address: last.to, label: last.label, kind: last.kind } : null, truncatedAt: null };
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
    // Deployer's own age + mint count, in parallel with the chain trace.
    const deadline = Date.now() + 22000; // leave margin under the 30s function cap
    const [created, ageInfo, traced] = await Promise.all([
      tokensCreated(url, wallet),
      oldestActivity(url, wallet).then((a) => ({ firstBlockTime: a.firstBlockTime, truncated: a.truncated })),
      traceChain(url, wallet, 4, deadline),
    ]);
    const { chain, origin, truncatedAt } = traced;
    const walletAgeDays = ageInfo.firstBlockTime ? Math.max(0, Math.round((Date.now() / 1000 - ageInfo.firstBlockTime) / 86400)) : null;
    const funder = chain[0] ? { address: chain[0].to, label: chain[0].label, kind: chain[0].kind } : null;
    const terminatesAtCex = origin?.kind === "cex";
    const anonHops = chain.filter((h) => h.kind === "wallet").length;

    const note = !funder
      ? ageInfo.truncated
        ? "Wallet too active to trace the original funder within limits."
        : "No clear funding source found on-chain."
      : terminatesAtCex
        ? `Funding trail: deployer ${"← anon ".repeat(Math.max(0, anonHops))}← ${origin!.label}. The money cashes out at a KYC'd ${origin!.label} account${anonHops > 0 ? ` through ${anonHops} intermediary wallet${anonHops === 1 ? "" : "s"}` : ""}.`
      : truncatedAt
        ? `Funding trail runs ${chain.length} hop${chain.length === 1 ? "" : "s"} back, then goes cold at a high-activity wallet (${truncatedAt.slice(0, 6)}…). No CEX terminus reached.`
        : `Funding trail runs ${chain.length} hop${chain.length === 1 ? "" : "s"} back to an anonymous wallet (${origin?.address.slice(0, 6)}…), with no CEX terminus. Shared funders across launches expose a serial operator.`;

    res.status(200).json({
      wallet,
      available: true,
      funder,
      chain,
      origin,
      terminatesAtCex,
      hops: chain.length,
      tokensCreated: created,
      serialDeployer: typeof created === "number" && created >= 5,
      walletAgeDays,
      firstActivity: ageInfo.firstBlockTime ? new Date(ageInfo.firstBlockTime * 1000).toISOString().slice(0, 10) : null,
      truncated: ageInfo.truncated,
      note,
    });
  } catch (e) {
    res.status(200).json({ wallet, available: true, error: String(e), note: "Funding-trail lookup failed." });
  }
}
