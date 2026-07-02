// Serial-operator funder sweep. GET /api/funder?wallet=<funder>
//
// The deployer trail (api/deployer.ts) runs BACKWARD: deployer <- funder <- CEX.
// This runs FORWARD from that funder: every wallet it sent SOL to, filtered to
// the ones that went on to DEPLOY tokens. That exposes the whole rug factory in
// one query — "this wallet seeded 14 launches, 11 of them dead" — a pattern an
// investigator would spend days assembling by hand, and one that's invisible on
// any single token's page.
//
// Solana only (Helius). Gated on HELIUS_API_KEY. Heavier than the backward trace
// (one enhanced-tx scan + one getAssetsByCreator per recipient), so it's a
// separate, on-demand endpoint rather than part of the default audit.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const SOL = 1_000_000_000; // lamports
const MIN_SEED = 0.002 * SOL; // ignore dust
const MAX_SEED = 200 * SOL; // above this it's a CEX deposit, not launch-seeding
const TX_PAGES = 6; // enhanced-tx pages of the funder (100 tx/page)
const MAX_CANDIDATES = 40; // distinct recipients we bother to check
const CHECK_CHUNK = 6; // concurrency for the getAssetsByCreator checks
const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// CEX hot wallets + common program/system accounts to exclude as recipients —
// they receive SOL constantly and are never a seeded deployer.
const SKIP = new Set<string>([
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm",
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5", "AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS",
  "5VVBHtk2QQBy5rZ2pBdgcb4yj9DBYy8tDksBs2pWnUKr", "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo",
  "6gnCPhXtLnUD76HjQuSYPENLSZdG8RvDB1pTLM5aLSss",
  "11111111111111111111111111111111", // system program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // token program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // token-2022 program
  "ComputeBudget111111111111111111111111111111",
]);

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

// Distinct wallets the funder sent SOL to (in the launch-seeding size band),
// newest first, bounded by TX_PAGES.
async function seedRecipients(key: string, funder: string, deadline: number): Promise<{ recipients: string[]; scanned: number; truncated: boolean }> {
  const recipients = new Set<string>();
  let before = "";
  let scanned = 0;
  let truncated = false;
  for (let page = 0; page < TX_PAGES; page++) {
    if (Date.now() > deadline) { truncated = true; break; }
    const u = `https://api.helius.xyz/v0/addresses/${funder}/transactions?api-key=${key}&limit=100${before ? `&before=${before}` : ""}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) break;
    const txs = (await r.json()) as any[];
    if (!Array.isArray(txs) || !txs.length) break;
    scanned += txs.length;
    for (const tx of txs) {
      for (const nt of tx.nativeTransfers ?? []) {
        if (nt.fromUserAccount !== funder) continue;
        const to = nt.toUserAccount;
        const amt = Number(nt.amount ?? 0);
        if (!to || to === funder || SKIP.has(to) || !SOLADDR.test(to)) continue;
        if (amt < MIN_SEED || amt > MAX_SEED) continue;
        recipients.add(to);
      }
    }
    before = txs[txs.length - 1]?.signature ?? "";
    if (!before || txs.length < 100) break;
    if (recipients.size >= MAX_CANDIDATES * 2) break; // plenty of candidates already
  }
  return { recipients: [...recipients].slice(0, MAX_CANDIDATES), scanned, truncated };
}

// Tokens a wallet has created, via the DAS getAssetsByCreator (Helius). Returns
// the count + a few sample mints with names, so a recipient that minted tokens
// is flagged as a seeded deployer and its launches are one click from an audit.
async function createdTokens(url: string, wallet: string): Promise<{ total: number; sample: { mint: string; name?: string; symbol?: string }[] }> {
  try {
    const r = await rpc(url, "getAssetsByCreator", { creatorAddress: wallet, onlyVerified: false, page: 1, limit: 50 });
    const items: any[] = r?.items ?? [];
    const total = typeof r?.total === "number" ? r.total : items.length;
    const sample = items.slice(0, 6).map((it) => ({
      mint: it.id,
      name: it.content?.metadata?.name || undefined,
      symbol: it.content?.metadata?.symbol || undefined,
    }));
    return { total, sample };
  } catch {
    return { total: 0, sample: [] };
  }
}

async function inChunks<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.HELIUS_API_KEY;
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet || !SOLADDR.test(wallet)) { res.status(400).json({ error: "valid Solana wallet required" }); return; }
  if (!key) { res.status(200).json({ wallet, available: false, note: "Helius not configured; funder sweep unavailable." }); return; }

  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  const deadline = Date.now() + 50000;

  // TEMP diagnostic: inspect raw enhanced-tx shape for a wallet (removed after
  // I confirm how pump.fun token creation is labeled).
  if (typeof req.query.raw === "string" && SOLADDR.test(req.query.raw)) {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${req.query.raw}/transactions?api-key=${key}&limit=30`, { signal: AbortSignal.timeout(12000) });
    const txs = (await r.json()) as any[];
    res.status(200).json({
      count: Array.isArray(txs) ? txs.length : 0,
      types: [...new Set((txs || []).map((t) => `${t.type}/${t.source}`))],
      creates: (txs || []).filter((t) => t.type === "CREATE" || t.source === "PUMP_FUN").slice(0, 3).map((t) => ({ type: t.type, source: t.source, mints: (t.tokenTransfers || []).map((x: any) => x.mint).filter(Boolean), desc: (t.description || "").slice(0, 100) })),
    });
    return;
  }
  try {
    const { recipients, scanned, truncated } = await seedRecipients(key, wallet, deadline);
    const checked = await inChunks(recipients, CHECK_CHUNK, async (w) => {
      if (Date.now() > deadline) return null;
      const t = await createdTokens(url, w);
      return t.total > 0 ? { wallet: w, tokensCreated: t.total, sampleTokens: t.sample } : null;
    });
    const seededDeployers = checked.filter(Boolean).sort((a: any, b: any) => b.tokensCreated - a.tokensCreated) as {
      wallet: string; tokensCreated: number; sampleTokens: { mint: string; name?: string; symbol?: string }[];
    }[];
    const totalTokens = seededDeployers.reduce((s, d) => s + d.tokensCreated, 0);

    const note = !recipients.length
      ? "No SOL-seeding transfers found from this wallet (not a funder, or too far back to scan)."
      : !seededDeployers.length
        ? `Sent SOL to ${recipients.length} wallet${recipients.length === 1 ? "" : "s"}, none of which deployed tokens. Not a serial-launch funder.`
        : `This wallet seeded ${seededDeployers.length} deployer${seededDeployers.length === 1 ? "" : "s"} that collectively launched ${totalTokens} token${totalTokens === 1 ? "" : "s"}. A shared funder across launches is the signature of a serial operator.`;

    res.status(200).json({
      wallet,
      available: true,
      seededDeployers,
      seededCount: seededDeployers.length,
      totalTokens,
      candidatesScanned: recipients.length,
      txScanned: scanned,
      truncated,
      note,
    });
  } catch (e) {
    res.status(200).json({ wallet, available: true, seededDeployers: [], error: String(e), note: "Funder sweep failed." });
  }
}
