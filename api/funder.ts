// Serial-operator funder sweep. GET /api/funder?wallet=<funder>
//
// The deployer trail (api/deployer.ts) runs BACKWARD: deployer <- funder <- CEX.
// This runs FORWARD from that funder: every wallet it sent SOL to, filtered to
// the ones that went on to MINT tokens. That exposes the whole rug factory in
// one query — "this wallet seeded 14 launches, 11 of them dead" — a pattern an
// investigator would spend days assembling by hand, and one that's invisible on
// any single token's page.
//
// Detection note: token creation is read from Helius enhanced-tx TOKEN_MINT
// events, NOT DAS getAssetsByCreator — DAS does not attribute pump.fun / fresh
// SPL mints to the dev wallet (the launchpad is the on-chain creator), so it
// returns 0 for exactly the wallets we're hunting. The mint event is deterministic.
//
// Solana only (Helius). Gated on HELIUS_API_KEY. Bounded + graceful when unset.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { arr, rec, str } from "../src/lib/json.js";
import { SOLANA_CEX_WALLETS } from "../src/lib/marketAddresses.js";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 60 };

const SOL = 1_000_000_000; // lamports
const MIN_SEED = 0.002 * SOL; // ignore dust
const MAX_SEED = 200 * SOL; // above this it's a CEX deposit, not launch-seeding
const TX_PAGES = 6; // enhanced-tx pages of the funder (100 tx/page)
const MAX_CANDIDATES = 40; // distinct recipients we bother to check
const CHECK_CHUNK = 6; // concurrency for the per-recipient mint scans
const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
interface ProviderUsage { calls: number; succeeded: number }
interface EnhancedTxRead { rows: unknown[]; completed: boolean; providerFailed: boolean }
interface MintScan {
  total: number;
  sample: { mint: string; name?: string }[];
  completed: boolean;
  truncated: boolean;
  providerFailed: boolean;
}

// CEX hot wallets + program/system accounts to exclude as recipients — they
// receive SOL constantly and are never a seeded deployer.
const SKIP = new Set<string>([
  // The exchange wallets come from the one shared map, so a hot wallet added
  // there is excluded here too rather than only where somebody remembered.
  ...Object.keys(SOLANA_CEX_WALLETS),
  "11111111111111111111111111111111", // system program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // token program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // token-2022 program
  "ComputeBudget111111111111111111111111111111",
]);

// Stablecoins / wrapped SOL appear in a mint tx as the payment leg; they are not
// the launched token, so they never count as a "created" mint.
const DENY_MINT = new Set<string>([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112", // wSOL
]);

async function enhancedTx(key: string, addr: string, before: string, usage: ProviderUsage): Promise<EnhancedTxRead> {
  usage.calls += 1;
  const u = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${key}&limit=100${before ? `&before=${before}` : ""}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!r || !r.ok) return { rows: [], completed: false, providerFailed: true };
  const d = await r.json().catch(() => null);
  if (!Array.isArray(d)) return { rows: [], completed: false, providerFailed: true };
  usage.succeeded += 1;
  return { rows: d, completed: true, providerFailed: false };
}

// Distinct wallets the funder sent SOL to (in the launch-seeding size band),
// newest first, bounded by TX_PAGES.
async function seedRecipients(
  key: string,
  funder: string,
  deadline: number,
  usage: ProviderUsage,
): Promise<{ recipients: string[]; scanned: number; completed: boolean; truncated: boolean; providerFailed: boolean }> {
  const recipients = new Set<string>();
  let before = "";
  let scanned = 0;
  let truncated = false;
  let providerFailed = false;
  let reachedEnd = false;
  for (let page = 0; page < TX_PAGES; page++) {
    if (Date.now() > deadline) { truncated = true; break; }
    const read = await enhancedTx(key, funder, before, usage);
    if (!read.completed) { providerFailed = true; break; }
    const txs = read.rows;
    if (!txs.length) { reachedEnd = true; break; }
    scanned += txs.length;
    for (const value of txs) {
      const tx = rec(value);
      for (const transfer of arr(tx.nativeTransfers)) {
        const nativeTransfer = rec(transfer);
        if (nativeTransfer.fromUserAccount !== funder) continue;
        const to = str(nativeTransfer.toUserAccount);
        const amt = Number(nativeTransfer.amount ?? 0);
        if (!to || to === funder || SKIP.has(to) || !SOLADDR.test(to)) continue;
        if (amt < MIN_SEED || amt > MAX_SEED) continue;
        recipients.add(to);
      }
    }
    const nextBefore = str(rec(txs[txs.length - 1]).signature);
    if (txs.length < 100) { reachedEnd = true; break; }
    if (!nextBefore || nextBefore === before) { truncated = true; break; }
    before = nextBefore;
    if (recipients.size >= MAX_CANDIDATES * 2) { truncated = true; break; }
    if (page === TX_PAGES - 1) truncated = true;
  }
  const allRecipients = [...recipients];
  if (allRecipients.length > MAX_CANDIDATES) truncated = true;
  return {
    recipients: allRecipients.slice(0, MAX_CANDIDATES),
    scanned,
    completed: reachedEnd && !truncated && !providerFailed,
    truncated,
    providerFailed,
  };
}

// Tokens a wallet has MINTED (created), from its recent TOKEN_MINT events. The
// launched mint is the non-stablecoin token in the transfer; the name comes free
// from the enhanced-tx description when the mint touches exactly one real token.
async function mintedTokens(key: string, wallet: string, usage: ProviderUsage): Promise<MintScan> {
  const read = await enhancedTx(key, wallet, "", usage);
  const txs = read.rows;
  const mints = new Set<string>();
  const nameByMint = new Map<string, string>();
  for (const value of txs) {
    const tx = rec(value);
    if (tx.type !== "TOKEN_MINT" && tx.type !== "CREATE") continue;
    const real = [...new Set(arr(tx.tokenTransfers).map((transfer) => str(rec(transfer).mint)).filter((mint) => mint && !DENY_MINT.has(mint)))];
    for (const m of real) mints.add(m);
    const nm = typeof tx.description === "string" ? tx.description.match(/minted\s+[\d.,]+\s+(.+)$/i) : null;
    if (nm && real.length === 1) nameByMint.set(real[0], nm[1].trim().slice(0, 40));
  }
  const sample = [...mints].slice(0, 8).map((m) => ({ mint: m, name: nameByMint.get(m) }));
  // This lane intentionally reads one enhanced-transaction page. A full page
  // means older mint events may exist, so the observed count is a lower bound.
  const truncated = read.completed && txs.length >= 100;
  return {
    total: mints.size,
    sample,
    completed: read.completed && !truncated,
    truncated,
    providerFailed: read.providerFailed,
  };
}

async function inChunks<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
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
  if (!wallet || !SOLADDR.test(wallet)) { res.status(400).json({ error: "valid Solana wallet required" }); return; }
  if (!key) {
    res.status(200).json({
      wallet,
      available: false,
      completed: false,
      truncated: false,
      providerFailed: false,
      note: "Helius not configured; funder sweep unavailable.",
    });
    return;
  }

  const deadline = Date.now() + 50000;
  const usage: ProviderUsage = { calls: 0, succeeded: 0 };
  try {
    // Two operator shapes, one call: (1) this wallet's OWN launches — a single
    // wallet that serial-mints is a rug farm on its own; (2) the forward sweep —
    // a funder that spreads launches across fresh dev wallets to look independent.
    const [own, seed] = await Promise.all([
      mintedTokens(key, wallet, usage),
      seedRecipients(key, wallet, deadline, usage),
    ]);
    const { recipients, scanned } = seed;
    const checked = await inChunks(recipients, CHECK_CHUNK, async (w) => {
      if (Date.now() > deadline) {
        return { wallet: w, scan: { total: 0, sample: [], completed: false, truncated: true, providerFailed: false } as MintScan };
      }
      return { wallet: w, scan: await mintedTokens(key, w, usage) };
    });
    const seededDeployers = checked
      .filter(({ scan }) => scan.total > 0)
      .map(({ wallet: seededWallet, scan }) => ({ wallet: seededWallet, tokensCreated: scan.total, sampleTokens: scan.sample }))
      .sort((a, b) => b.tokensCreated - a.tokensCreated);
    const totalTokens = seededDeployers.reduce((s, d) => s + d.tokensCreated, 0);
    const candidateCompleted = checked.filter(({ scan }) => scan.completed).length;
    const candidateTruncated = checked.some(({ scan }) => scan.truncated);
    const candidateProviderFailed = checked.some(({ scan }) => scan.providerFailed);
    const providerFailed = own.providerFailed || seed.providerFailed || candidateProviderFailed;
    const truncated = own.truncated || seed.truncated || candidateTruncated;
    const completed = own.completed && seed.completed && checked.every(({ scan }) => scan.completed);

    const parts: string[] = [];
    if (completed) {
      if (own.total > 1) parts.push(`This wallet itself minted ${own.total} tokens, indicating a serial launcher.`);
      if (seededDeployers.length) parts.push(`It seeded ${seededDeployers.length} other deployer${seededDeployers.length === 1 ? "" : "s"} that launched ${totalTokens} token${totalTokens === 1 ? "" : "s"}. A shared funder across launches is the signature of a serial operator.`);
      if (!parts.length) parts.push(recipients.length ? `Sent SOL to ${recipients.length} wallet${recipients.length === 1 ? "" : "s"}, none of which minted tokens, and minted none itself. No serial-launch pattern.` : "No launches or SOL-seeding found for this wallet.");
    } else {
      if (own.total > 0) parts.push(`The partial sweep observed at least ${own.total} token${own.total === 1 ? "" : "s"} minted by this wallet.`);
      if (seededDeployers.length) parts.push(`It also observed at least ${seededDeployers.length} seeded deployer${seededDeployers.length === 1 ? "" : "s"} behind ${totalTokens} token${totalTokens === 1 ? "" : "s"}.`);
      const reason = providerFailed && truncated ? "provider reads failed and bounded history was cut short" : providerFailed ? "one or more provider reads failed" : "bounded history was cut short";
      parts.push(`The funder sweep did not complete because ${reason}. Counts are lower bounds, and the sweep cannot rule out a serial-launch pattern.`);
    }

    res.status(200).json({
      wallet,
      available: true,
      completed,
      truncated,
      providerFailed,
      countsAreLowerBounds: !completed,
      ownLaunches: completed || own.total > 0 ? own.total : null,
      ownTokens: own.sample,
      seededDeployers,
      seededCount: completed || seededDeployers.length > 0 ? seededDeployers.length : null,
      totalTokens: completed || totalTokens > 0 ? totalTokens : null,
      candidatesConsidered: recipients.length,
      candidatesScanned: candidateCompleted,
      txScanned: scanned,
      coverage: {
        ownHistory: { completed: own.completed, truncated: own.truncated, providerFailed: own.providerFailed },
        funderHistory: { completed: seed.completed, truncated: seed.truncated, providerFailed: seed.providerFailed },
        candidateHistories: {
          requested: recipients.length,
          completed: candidateCompleted,
          truncated: candidateTruncated,
          providerFailed: candidateProviderFailed,
        },
      },
      note: parts.join(" "),
    });
  } catch (e) {
    res.status(200).json({
      wallet,
      available: false,
      completed: false,
      truncated: false,
      providerFailed: true,
      seededDeployers: [],
      ownLaunches: null,
      seededCount: null,
      totalTokens: null,
      error: String(e),
      note: "Funder sweep failed. No serial-launch conclusion can be drawn.",
    });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "helius",
        op: "panel:solana-funder",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
