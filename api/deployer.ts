// Deployer funding-trail forensics. GET /api/deployer?wallet=<addr>
//
// A token's deployer wallet is a pseudonym, but the money that FUNDED it usually
// is not: the first SOL into a fresh deployer comes from somewhere — a CEX
// withdrawal (KYC'd, traceable by subpoena) or another wallet. When several
// deployers trace back to the SAME funding wallet, that funder is a serial-launch
// hub, and that pattern is invisible in any single token's page. This endpoint
// pulls the trail: who funded the deployer, how much SOL seeded it, how old the
// wallet was WHEN IT MINTED, and how many tokens it has minted (a one-shot
// deployer vs a serial factory).
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

// The first SOL that landed in the deployer: who paid, how much, and when. The
// amount and the timestamp are the difference between "funded by Coinbase" and a
// fact a reader can act on, and the timestamp is what anchors the wallet's age to
// the launch instead of to today.
interface SeedFunding { source: string; lamports: number | null; fundedAt: number | null }

// Follow the money BACK hop by hop: deployer <- funder <- funder's funder <- ...
// until the trail reaches a CEX (the KYC'd account the SOL was withdrawn from),
// runs dry, loops, or hits the hop/time budget. `fundedFrom` is therefore the
// furthest UPSTREAM account reached, never a destination: this walk never follows
// a lamport forward, so nothing here can support a claim about where money went.
// Intermediary hops use shallow pagination to stay fast; a deep, multi-hop chain
// through fresh wallets is the classic launder-before-launch pattern, and a CEX
// origin is where a subpoena would actually land.
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
  // because that field drives the "goes cold at a high-activity wallet" copy and
  // this wallet is not that; `unresolvedAt` records the honest fact that the walk
  // stopped where it did, so no consumer can read this as a finished trail.
  return { chain, fundedFrom: last ? { address: last.to, label: last.label, kind: last.kind } : null, truncatedAt: null, unresolvedAt: current, seed };
}

// Strictly INBOUND: matches only instructions where the wallet is the RECEIVING
// side and returns the account that paid plus the amount it paid. An instruction
// where the wallet is the source is money leaving, which this trace does not
// model, so it is skipped rather than reported in the opposite direction.
export function inboundFundingFromInstructions(instrs: any[], wallet: string): { source: string; lamports: number | null } | null {
  for (const ix of instrs ?? []) {
    const p = ix.parsed;
    if (!p?.info) continue;
    const lamports = typeof p.info.lamports === "number" ? p.info.lamports : null;
    // plain SOL transfer to the wallet
    if (p.type === "transfer" && p.info.destination === wallet && p.info.source && p.info.source !== wallet) return { source: p.info.source, lamports };
    // wallet created + funded by another account (rent-funding the new account)
    if ((p.type === "createAccount" || p.type === "createAccountWithSeed") && p.info.newAccount === wallet && p.info.source && p.info.source !== wallet) return { source: p.info.source, lamports };
  }
  return null;
}

// Find the account that first sent SOL INTO the wallet, scanning the oldest few
// transactions (oldest first) and recognising the common funding shapes. Returns
// the seed amount and the block time of the funding transaction with it, because
// "2.0 SOL on 2026-07-30 20:54 UTC" is checkable and "funded by Coinbase" is not.
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
    // that lost the most SOL is the funder. Skip system/vote programs. The amount
    // reported is what the WALLET gained, not what the payer lost: the payer's
    // drop also carries the fee, and the credited amount is the checkable one.
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

// How old the wallet was AT THE MINT, not how old it is today. Age against
// Date.now() is not a fact about the launch: the same frozen report reads "2 days"
// this week and "30 days" next month, and the number a reader acts on silently
// changes under them. The mint instant is the fixed reference; when the caller
// cannot supply one the age is still measured, but stamped `scan` and dated so
// nothing reads as a launch-time fact.
export interface WalletAgeAtLaunch {
  basis: "mint" | "scan";
  asOf: number;              // unix seconds the age is measured TO
  ageSeconds: number | null;
  ageMinutes: number | null;
  ageDays: number | null;
}

export function walletAgeAtLaunch(input: { firstActivityAt: number | null; mintedAt: number | null; nowSeconds: number }): WalletAgeAtLaunch {
  const { firstActivityAt, mintedAt, nowSeconds } = input;
  const basis = mintedAt != null ? "mint" : "scan";
  const asOf = mintedAt ?? nowSeconds;
  const span = firstActivityAt == null ? null : asOf - firstActivityAt;
  // A mint that predates the oldest signature we reached means the wallet's real
  // first activity is outside our pagination window, so its age at the mint is
  // unknown. A negative span reported as an age would invent the one number the
  // reader is here for.
  const ageSeconds = span == null || span < 0 ? null : span;
  return {
    basis,
    asOf,
    ageSeconds,
    // Age floors: a wallet 20 hours old is 0 days old, not 1.
    ageMinutes: ageSeconds == null ? null : Math.floor(ageSeconds / 60),
    ageDays: ageSeconds == null ? null : Math.floor(ageSeconds / 86400),
  };
}

// Accepts unix seconds, unix milliseconds, or an ISO timestamp, and refuses
// anything outside plausible Solana history so a malformed caller value can never
// masquerade as a launch instant.
const MINT_TIME_FLOOR = 1_577_836_800; // 2020-01-01, before any Solana SPL launch ARGUS audits
export function parseMintedAt(raw: unknown, nowSeconds: number): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  let seconds: number | null = null;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    seconds = n > 1e11 ? Math.floor(n / 1000) : n; // millisecond epochs are common in JS callers
  } else {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) seconds = Math.floor(parsed / 1000);
  }
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < MINT_TIME_FLOOR || seconds > nowSeconds + 300) return null; // 300s of clock skew
  return seconds;
}

export function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol >= 100) return `${Math.round(sol)} SOL`;
  if (sol >= 0.01) {
    const fixed = sol.toFixed(2);
    return `${fixed.endsWith("0") ? fixed.slice(0, -1) : fixed} SOL`;
  }
  return `${sol.toFixed(4)} SOL`;
}

function utcStamp(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// Elapsed whole units, floored, so the sentence and the walletAgeMinutes field
// can never disagree by a rounding step in the same card.
function humanSpan(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? "" : "s"}`;
}

// The seed fact, stated flat: when the wallet was first funded, with how much,
// by whom, and how long after that it minted.
//
// A Coinbase withdrawal 95 minutes before a launch is ALSO the most common
// legitimate first-time-launcher pattern, so this sentence carries no adjective,
// no comparison and no tone. It reports; the reader judges. Anything here that
// reads as an accusation is a bug, and the copy test enforces it.
export function launchOriginNote(input: {
  funder: Account | null;
  seed: { lamports: number | null; fundedAt: number | null } | null;
  mintedAt: number | null;
}): string {
  const { funder, seed, mintedAt } = input;
  if (!funder || !seed?.fundedAt) return "";
  const who = funder.kind === "cex" && funder.label ? `a KYC'd ${funder.label} account` : `${funder.address.slice(0, 6)}…${funder.address.slice(-4)}`;
  const amount = typeof seed.lamports === "number" && seed.lamports > 0 ? ` with ${formatSol(seed.lamports)}` : "";
  const first = `Wallet first funded ${utcStamp(seed.fundedAt)}${amount} from ${who}.`;
  if (mintedAt == null) return first;
  const gap = mintedAt - seed.fundedAt;
  // A launch before the funding we matched means we matched the wrong
  // transaction or the caller's instant is wrong; either way there is no gap to
  // state.
  if (gap < 0) return first;
  // "Launched", not "minted". The only instant any caller can supply is the
  // token's first POOL creation: on a launchpad that is the mint's twin, but a
  // token that migrated pools would date it days after the actual mint. The
  // wallet did launch this token at that instant under either reading, and
  // claiming it signed the mint there is a claim the evidence does not carry.
  return `${first} It launched this token ${humanSpan(gap)} later.`;
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
  // True when launchOriginNote already stated the dated, amounted seed from this
  // same direct funder. The generic restatement then adds words, not evidence.
  seedStated?: boolean;
}): string {
  const { funder, fundedFrom, hops, anonHops, truncatedAt, walletTooActive, seedStated } = input;
  if (!funder) {
    return walletTooActive
      ? "Wallet too active to trace the original funder within limits."
      : "No clear funding source found on-chain.";
  }
  const hopCount = `${hops} hop${hops === 1 ? "" : "s"}`;
  if (fundedFrom?.kind === "cex") {
    const via = anonHops > 0 ? ` through ${anonHops} intermediary wallet${anonHops === 1 ? "" : "s"}` : "";
    const arrows = `Funding trail: deployer ${"← anon ".repeat(Math.max(0, anonHops))}← ${fundedFrom.label}.`;
    // With intermediaries the hop count is a fact the seed sentence never made,
    // so it is still worth its own clause.
    if (seedStated && anonHops === 0) return arrows;
    return `${arrows} The deployer wallet was funded from a KYC'd ${fundedFrom.label} account${via}.`;
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
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Optional: the block time of the mint this wallet is being investigated FOR.
  // With it the wallet's age is a fixed fact about the launch; without it the
  // response says so in walletAgeBasis rather than passing today's number off as
  // a launch-time one.
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
    const fundedFromCex = fundedFrom?.kind === "cex";
    const anonHops = chain.filter((h) => h.kind === "wallet").length;
    const age = walletAgeAtLaunch({ firstActivityAt: ageInfo.firstBlockTime, mintedAt, nowSeconds });

    const originNote = launchOriginNote({ funder, seed, mintedAt });
    const trailNote = fundingTrailNote({ funder, fundedFrom, hops: chain.length, anonHops, truncatedAt, walletTooActive: ageInfo.truncated, seedStated: !!originNote });
    const note = [originNote, trailNote].filter(Boolean).join(" ");

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
      // Where the upward walk stopped without resolving an origin (pagination went
      // cold, the hop budget ran out, or the deadline hit). A client that treats a
      // truncated trail as a finished one publishes a clean bill for a check that
      // never completed.
      trailTruncatedAt: unresolvedAt,
      tokensCreated: created,
      // Verified: `created` counts DISTINCT mints inside the DEPLOYER's OWN recent
      // transactions (tokensCreated above), so this flag is about launches this
      // wallet minted itself, never launches it bankrolled. That second question
      // is the funder-hub one and lives in api/funder.ts, so the flag is named for
      // what it measures. A floor, not a total: the enhanced-tx window is the last
      // 100 transactions. Null when the count is unavailable, because an absent
      // check is not a "no".
      serialMinter: typeof created === "number" ? created >= 5 : null,
      // Legacy wire name for serialMinter, read by src/lib/investigation.ts and
      // three report components. It stays until that rename lands with them.
      serialDeployer: typeof created === "number" ? created >= 5 : null,
      // Age AT THE MINT when the caller supplied one, otherwise as of this scan.
      // walletAgeBasis says which, and walletAgeAsOf dates it, so a number pulled
      // into a frozen report can never drift into a different claim.
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
