// Scan-time deployer funding-origin trace. GET /api/deployer-origin?wallet=<addr>&mintedAt=<ts>
//
// The panel route (api/deployer) requires an x-argus-panel-token bound to a
// PERSISTED report version. A live scan does not have one: it is still producing
// the version that token would be issued against. So every scan-time call to
// /api/deployer answered 409 and the investigation fell back to "we could not
// confirm who owns the wallet that deployed the contract", with the seed
// funding, the funder, and the wallet's age at launch already computed on the
// server and thrown away. This route runs the same walk during collection, on
// the pattern api/deployer-risk.ts set for the Arkham trace, and returns the
// same wire shape so a caller can swap between the two.
//
// Like that sibling it is deliberately left analyst-metered by middleware rather
// than re-checking auth here: Helius is a keyed subscription (no per-call
// marginal cost), so the daily API-budget gate is the abuse guard, and there is
// no persisted report version to attach a cost line to yet. The gated
// /api/deployer stays for post-persist panels, which do have a version and do
// bill against it.
//
// The RPC walk below is a port of the one in api/deployer.ts. Only the walk is
// duplicated: every user-facing sentence is imported from that file, so the two
// routes cannot word the same fact differently and one copy-policy test covers
// both. Extracting the walk into a shared api/_deployer-core.ts is the right
// end state and needs both routes to move at once.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SOLANA_CEX_WALLETS as CEX } from "../src/lib/marketAddresses.js";
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";
import {
  fundingTrailNote,
  inboundFundingFromInstructions,
  launchOriginNote,
  parseMintedAt,
  walletAgeAtLaunch,
} from "./deployer.js";

export const config = { maxDuration: 30 };

const MAX_SIG_PAGES = 10; // 1000 sigs/page; bounds pagination on busy wallets
interface ProviderUsage { calls: number; succeeded: number }

// Well-known Solana CEX hot wallets. A funder match here means the trail leads
// back to a KYC'd exchange account (a real subpoena target), not an anonymous
// wallet. It says where the SOL CAME FROM; it says nothing about where any of it
// went afterwards.

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

// The first SOL that landed in the deployer: who paid, how much, and when.
interface SeedFunding { source: string; lamports: number | null; fundedAt: number | null }

// Find the account that first sent SOL INTO the wallet, scanning the oldest few
// transactions (oldest first) and recognising the common funding shapes. Strictly
// INBOUND: an instruction where the wallet is the SOURCE is money leaving, which
// this trace does not model, so it is skipped rather than reported in the
// opposite direction.
async function inboundFunding(url: string, wallet: string, sigs: string[], usage: ProviderUsage): Promise<SeedFunding | null> {
  for (const sig of sigs) {
    const tx = await rpc(url, "getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }], usage);
    if (!tx) continue;
    const fundedAt = typeof tx.blockTime === "number" ? tx.blockTime : null;
    const direct = inboundFundingFromInstructions(tx.transaction?.message?.instructions, wallet);
    if (direct) return { ...direct, fundedAt };
    for (const inner of tx.meta?.innerInstructions ?? []) {
      const s = inboundFundingFromInstructions(inner.instructions, wallet);
      if (s) return { ...s, fundedAt };
    }
    // Balance-delta fallback: if the wallet gained SOL in this tx, the account
    // that lost the most SOL is the funder. The amount reported is what the
    // WALLET gained, not what the payer lost: the payer's drop also carries the
    // fee, and the credited amount is the checkable one.
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
      if (best >= 0) return { source: keys[best], lamports: (post[wi] ?? 0) - (pre[wi] ?? 0), fundedAt };
    }
  }
  return null;
}

// Follow the money BACK hop by hop: deployer <- funder <- funder's funder <- ...
// until the trail reaches a CEX, runs dry, loops, or hits the hop/time budget.
// `fundedFrom` is the furthest UPSTREAM account reached, never a destination:
// this walk never follows a lamport forward, so nothing here can support a claim
// about where money went.
async function traceChain(url: string, deployer: string, maxHops: number, deadline: number, usage: ProviderUsage): Promise<{ chain: Hop[]; fundedFrom: Account | null; truncatedAt: string | null; unresolvedAt: string | null; seed: SeedFunding | null }> {
  const chain: Hop[] = [];
  const seen = new Set<string>([deployer]);
  let current = deployer;
  let seed: SeedFunding | null = null;
  for (let hop = 0; hop < maxHops; hop++) {
    if (Date.now() > deadline) return { chain, fundedFrom: chain.length ? { address: current, label: CEX[current] ?? null, kind: CEX[current] ? "cex" : "wallet" } : null, truncatedAt: current, unresolvedAt: current, seed };
    const { oldestSigs, truncated } = await oldestActivity(url, current, usage, hop === 0 ? MAX_SIG_PAGES : 3);
    const funding = oldestSigs.length ? await inboundFunding(url, current, oldestSigs, usage) : null;
    // Only the first hop's seed describes THIS deployer; upstream hops describe
    // the funder's own funding, which is a different wallet's story.
    if (hop === 0) seed = funding;
    if (!funding) {
      const originAddr = chain.length ? current : null;
      return { chain, fundedFrom: originAddr ? { address: originAddr, label: CEX[originAddr] ?? null, kind: CEX[originAddr] ? "cex" : "wallet" } : null, truncatedAt: truncated ? current : null, unresolvedAt: truncated ? current : null, seed };
    }
    const funder = funding.source;
    const label = CEX[funder] ?? null;
    const kind: "cex" | "wallet" = label ? "cex" : "wallet";
    chain.push({ from: current, to: funder, label, kind });
    if (label) return { chain, fundedFrom: { address: funder, label, kind }, truncatedAt: null, unresolvedAt: null, seed }; // reached a CEX
    if (seen.has(funder)) return { chain, fundedFrom: { address: funder, label: null, kind: "wallet" }, truncatedAt: null, unresolvedAt: null, seed }; // cycle
    seen.add(funder);
    current = funder;
  }
  const last = chain[chain.length - 1];
  // The hop budget ran out with the trail still live. `truncatedAt` stays null
  // because that field drives the "goes cold at a high-activity wallet" copy;
  // `unresolvedAt` records the honest fact that the walk stopped where it did.
  return { chain, fundedFrom: last ? { address: last.to, label: last.label, kind: last.kind } : null, truncatedAt: null, unresolvedAt: current, seed };
}

// Count tokens this wallet has MINTED, from Helius enhanced-tx TOKEN_MINT events.
// A floor, not a total: the window is the wallet's last 100 transactions.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.HELIUS_API_KEY;
  const nowSeconds = Math.floor(Date.now() / 1000);
  // The block time of the launch this wallet is being investigated FOR. With it
  // the wallet's age comes back measured AT THE LAUNCH and stays that number
  // forever; without it the response says so in walletAgeBasis rather than
  // passing today's number off as a launch-time one.
  const mintedAt = parseMintedAt(req.query.mintedAt, nowSeconds);
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    res.status(400).json({ error: "valid Solana wallet required" });
    return;
  }
  if (!key) {
    res.status(200).json({ wallet, available: false, note: "Helius not configured; funding trail unavailable." });
    return;
  }

  // Cached ONLY when the caller pinned a launch instant. Against a fixed instant
  // the whole answer is a fixed fact, so a cache hit repeats it exactly. A
  // scan-basis age is a fact about NOW, and replaying yesterday's number for a
  // question asked today would quietly answer a different question.
  const cacheKey = mintedAt ? `deployer-origin:${providerAddressKey(wallet)}:${mintedAt}:v1` : null;
  if (cacheKey) {
    const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
    if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }
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
    const { chain, fundedFrom, truncatedAt, unresolvedAt, seed } = traced;
    const funder = chain[0] ? { address: chain[0].to, label: chain[0].label, kind: chain[0].kind } : null;
    const anonHops = chain.filter((h) => h.kind === "wallet").length;
    const age = walletAgeAtLaunch({ firstActivityAt: ageInfo.firstBlockTime, mintedAt, nowSeconds });

    const originNote = launchOriginNote({ funder, seed, mintedAt });
    const trailNote = fundingTrailNote({ funder, fundedFrom, hops: chain.length, anonHops, truncatedAt, walletTooActive: ageInfo.truncated, seedStated: !!originNote });

    // Same wire shape as /api/deployer, field for field, so a caller can move
    // between the gated panel route and this scan-time one without reshaping.
    const body = {
      wallet,
      available: true,
      funder,
      chain,
      origin: fundedFrom,
      terminatesAtCex: fundedFrom?.kind === "cex",
      hops: chain.length,
      trailTruncatedAt: unresolvedAt,
      tokensCreated: created,
      serialMinter: typeof created === "number" ? created >= 5 : null,
      serialDeployer: typeof created === "number" ? created >= 5 : null,
      walletAgeDays: age.ageDays,
      walletAgeMinutes: age.ageMinutes,
      walletAgeBasis: age.basis,
      walletAgeAsOf: new Date(age.asOf * 1000).toISOString(),
      mintedAt: mintedAt ? new Date(mintedAt * 1000).toISOString() : null,
      seedFunding: seed
        ? {
            from: seed.source,
            label: CEX[seed.source] ?? null,
            lamports: seed.lamports,
            sol: typeof seed.lamports === "number" ? seed.lamports / 1_000_000_000 : null,
            at: seed.fundedAt ? new Date(seed.fundedAt * 1000).toISOString() : null,
          }
        : null,
      firstActivity: ageInfo.firstBlockTime ? new Date(ageInfo.firstBlockTime * 1000).toISOString().slice(0, 10) : null,
      firstActivityAt: ageInfo.firstBlockTime ?? null,
      truncated: ageInfo.truncated,
      note: [originNote, trailNote].filter(Boolean).join(" "),
    };
    if (cacheKey) await cacheSetJson(cacheKey, body);
    res.status(200).json(body);
  } catch (e) {
    // A failed walk is never cached and never reported as an empty trail: the
    // caller has to be able to tell "nothing found" from "never completed".
    res.status(200).json({ wallet, available: true, error: String(e), note: "Funding-trail lookup failed." });
  }
}
