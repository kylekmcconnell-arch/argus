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
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 30 };

const MAX_SIG_PAGES = 10; // 1000 sigs/page; bounds pagination on busy wallets
interface ProviderUsage { calls: number; succeeded: number }

// Well-known Solana CEX hot wallets. A funder match here means the trail leads
// back to a KYC'd exchange account (a real subpoena target), not an anonymous
// wallet. It says where the SOL CAME FROM; it says nothing about where any of it
// went afterwards.
// Duplicated verbatim in api/cluster.ts and api/funder.ts. Left duplicated on
// purpose: those two files are owned by a separate change, and a shared module
// has to land with all three call sites at once.
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

async function rpc(url: string, method: string, params: unknown, usage: ProviderUsage): Promise<any> {
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

// Walk getSignaturesForAddress back to the wallet's very first signatures. We
// keep the oldest few (not just one) because the absolute-oldest tx is sometimes
// the token mint itself; the funding sits in a neighbouring early tx.
async function oldestActivity(url: string, wallet: string, usage: ProviderUsage, maxPages = MAX_SIG_PAGES): Promise<{ oldestSigs: string[]; firstBlockTime: number | null; truncated: boolean }> {
  let before: string | undefined;
  let lastBatch: any[] = [];
  for (let pages = 0; pages < maxPages; pages++) {
    const batch: any[] = await rpc(url, "getSignaturesForAddress", [wallet, { limit: 1000, ...(before ? { before } : {}) }], usage);
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

interface Account { address: string; label: string | null; kind: "cex" | "wallet" }

// Follow the money BACK hop by hop: deployer <- funder <- funder's funder <- ...
// until the trail reaches a CEX (the KYC'd account the SOL was withdrawn from),
// runs dry, loops, or hits the hop/time budget. `fundedFrom` is therefore the
// furthest UPSTREAM account reached, never a destination: this walk never follows
// a lamport forward, so nothing here can support a claim about where money went.
// Intermediary hops use shallow pagination to stay fast; a deep, multi-hop chain
// through fresh wallets is the classic launder-before-launch pattern, and a CEX
// origin is where a subpoena would actually land.
async function traceChain(url: string, deployer: string, maxHops: number, deadline: number, usage: ProviderUsage): Promise<{ chain: Hop[]; fundedFrom: Account | null; truncatedAt: string | null }> {
  const chain: Hop[] = [];
  const seen = new Set<string>([deployer]);
  let current = deployer;
  for (let hop = 0; hop < maxHops; hop++) {
    if (Date.now() > deadline) return { chain, fundedFrom: chain.length ? { address: current, label: CEX[current] ?? null, kind: CEX[current] ? "cex" : "wallet" } : null, truncatedAt: current };
    const { oldestSigs, truncated } = await oldestActivity(url, current, usage, hop === 0 ? MAX_SIG_PAGES : 3);
    const funder = oldestSigs.length ? await inboundFunder(url, current, oldestSigs, usage) : null;
    if (!funder) {
      const originAddr = chain.length ? current : null;
      return { chain, fundedFrom: originAddr ? { address: originAddr, label: CEX[originAddr] ?? null, kind: CEX[originAddr] ? "cex" : "wallet" } : null, truncatedAt: truncated ? current : null };
    }
    const label = CEX[funder] ?? null;
    const kind: "cex" | "wallet" = label ? "cex" : "wallet";
    chain.push({ from: current, to: funder, label, kind });
    if (label) return { chain, fundedFrom: { address: funder, label, kind }, truncatedAt: null }; // reached a CEX
    if (seen.has(funder)) return { chain, fundedFrom: { address: funder, label: null, kind: "wallet" }, truncatedAt: null }; // cycle
    seen.add(funder);
    current = funder;
  }
  const last = chain[chain.length - 1];
  return { chain, fundedFrom: last ? { address: last.to, label: last.label, kind: last.kind } : null, truncatedAt: null };
}

// Strictly INBOUND: matches only instructions where the wallet is the RECEIVING
// side and returns the account that paid. An instruction where the wallet is the
// source is money leaving, which this trace does not model, so it is skipped
// rather than reported in the opposite direction.
export function inboundFunderFromInstructions(instrs: any[], wallet: string): string | null {
  for (const ix of instrs ?? []) {
    const p = ix.parsed;
    if (!p?.info) continue;
    // plain SOL transfer to the wallet
    if (p.type === "transfer" && p.info.destination === wallet && p.info.source && p.info.source !== wallet) return p.info.source;
    // wallet created + funded by another account (rent-funding the new account)
    if ((p.type === "createAccount" || p.type === "createAccountWithSeed") && p.info.newAccount === wallet && p.info.source && p.info.source !== wallet) return p.info.source;
  }
  return null;
}

// Find the account that first sent SOL INTO the wallet, scanning the oldest few
// transactions (oldest first) and recognising the common funding shapes.
async function inboundFunder(url: string, wallet: string, sigs: string[], usage: ProviderUsage): Promise<string | null> {
  for (const sig of sigs) {
    const tx = await rpc(url, "getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }], usage);
    if (!tx) continue;
    const direct = inboundFunderFromInstructions(tx.transaction?.message?.instructions, wallet);
    if (direct) return direct;
    for (const inner of tx.meta?.innerInstructions ?? []) {
      const s = inboundFunderFromInstructions(inner.instructions, wallet);
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

// Count tokens this wallet has MINTED, from Helius enhanced-tx TOKEN_MINT events.
// NOT DAS getAssetsByCreator — that returns 0 for pump.fun / fresh-SPL dev wallets
// (the launchpad is the on-chain creator), so it silently under-reported serial
// deployers. The mint event is deterministic; stablecoin/wSOL legs are excluded.
const DENY_MINT = new Set<string>([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112", // wSOL
]);
async function tokensCreated(key: string, wallet: string, usage: ProviderUsage): Promise<number | null> {
  usage.calls += 1;
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&limit=100`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const txs = await r.json();
    usage.succeeded += 1;
    if (!Array.isArray(txs)) return null;
    const mints = new Set<string>();
    for (const t of txs) {
      if (t.type !== "TOKEN_MINT" && t.type !== "CREATE") continue;
      for (const x of t.tokenTransfers ?? []) if (typeof x.mint === "string" && x.mint && !DENY_MINT.has(x.mint)) mints.add(x.mint);
    }
    return mints.size;
  } catch {
    return null;
  }
}

// The user-facing sentence for the trail. Every branch describes an UPSTREAM
// origin: the deployer wallet was FUNDED FROM the account we traced back to.
// Nothing in this endpoint follows a lamport forward, so no branch may say the
// money cashes out, withdraws, or lands anywhere. A KYC'd exchange on the
// inbound side and a KYC'd exchange on the outbound side are opposite claims,
// and only the inbound one is evidenced here.
export function fundingTrailNote(input: {
  funder: Account | null;
  fundedFrom: Account | null;
  hops: number;
  anonHops: number;
  truncatedAt: string | null;
  walletTooActive: boolean;
}): string {
  const { funder, fundedFrom, hops, anonHops, truncatedAt, walletTooActive } = input;
  if (!funder) {
    return walletTooActive
      ? "Wallet too active to trace the original funder within limits."
      : "No clear funding source found on-chain.";
  }
  const hopCount = `${hops} hop${hops === 1 ? "" : "s"}`;
  if (fundedFrom?.kind === "cex") {
    const via = anonHops > 0 ? ` through ${anonHops} intermediary wallet${anonHops === 1 ? "" : "s"}` : "";
    return `Funding trail: deployer ${"← anon ".repeat(Math.max(0, anonHops))}← ${fundedFrom.label}. The deployer wallet was funded from a KYC'd ${fundedFrom.label} account${via}.`;
  }
  if (truncatedAt) {
    return `Funding trail runs ${hopCount} back, then goes cold at a high-activity wallet (${truncatedAt.slice(0, 6)}…). No KYC'd exchange origin reached.`;
  }
  return `Funding trail runs ${hopCount} back to an anonymous wallet (${fundedFrom?.address.slice(0, 6)}…), with no KYC'd exchange origin. Shared funders across launches expose a serial operator.`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

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
  const usage: ProviderUsage = { calls: 0, succeeded: 0 };
  try {
    // Deployer's own age + mint count, in parallel with the chain trace.
    const deadline = Date.now() + 22000; // leave margin under the 30s function cap
    const [created, ageInfo, traced] = await Promise.all([
      tokensCreated(key, wallet, usage),
      oldestActivity(url, wallet, usage).then((a) => ({ firstBlockTime: a.firstBlockTime, truncated: a.truncated })),
      traceChain(url, wallet, 4, deadline, usage),
    ]);
    const { chain, fundedFrom, truncatedAt } = traced;
    const walletAgeDays = ageInfo.firstBlockTime ? Math.max(0, Math.round((Date.now() / 1000 - ageInfo.firstBlockTime) / 86400)) : null;
    const funder = chain[0] ? { address: chain[0].to, label: chain[0].label, kind: chain[0].kind } : null;
    const fundedFromCex = fundedFrom?.kind === "cex";
    const anonHops = chain.filter((h) => h.kind === "wallet").length;

    const note = fundingTrailNote({ funder, fundedFrom, hops: chain.length, anonHops, truncatedAt, walletTooActive: ageInfo.truncated });

    res.status(200).json({
      wallet,
      available: true,
      // `funder`, `origin` and `terminatesAtCex` are all UPSTREAM facts (who paid
      // this wallet, and the furthest account back). The wire names predate the
      // fundedFrom vocabulary and are read by src/lib/investigation.ts and three
      // report components, so they stay until that change lands with them.
      funder,
      chain,
      origin: fundedFrom,
      terminatesAtCex: fundedFromCex,
      hops: chain.length,
      tokensCreated: created,
      // Counts mints in the DEPLOYER's own recent transactions (see tokensCreated),
      // not launches it bankrolled. A floor, not a total: the enhanced-tx window is
      // the last 100 transactions, and an unavailable count reads as false here.
      serialDeployer: typeof created === "number" && created >= 5,
      walletAgeDays,
      firstActivity: ageInfo.firstBlockTime ? new Date(ageInfo.firstBlockTime * 1000).toISOString().slice(0, 10) : null,
      truncated: ageInfo.truncated,
      note,
    });
  } catch (e) {
    res.status(200).json({ wallet, available: true, error: String(e), note: "Funding-trail lookup failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "helius",
        op: "panel:solana-deployer",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
