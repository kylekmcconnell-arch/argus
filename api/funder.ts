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

export const config = { maxDuration: 60 };

const SOL = 1_000_000_000; // lamports
const MIN_SEED = 0.002 * SOL; // ignore dust
const MAX_SEED = 200 * SOL; // above this it's a CEX deposit, not launch-seeding
const TX_PAGES = 6; // enhanced-tx pages of the funder (100 tx/page)
const MAX_CANDIDATES = 40; // distinct recipients we bother to check
const CHECK_CHUNK = 6; // concurrency for the per-recipient mint scans
const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// CEX hot wallets + program/system accounts to exclude as recipients — they
// receive SOL constantly and are never a seeded deployer.
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

// Stablecoins / wrapped SOL appear in a mint tx as the payment leg; they are not
// the launched token, so they never count as a "created" mint.
const DENY_MINT = new Set<string>([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112", // wSOL
]);

async function enhancedTx(key: string, addr: string, before: string): Promise<any[]> {
  const u = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${key}&limit=100${before ? `&before=${before}` : ""}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : [];
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
    const txs = await enhancedTx(key, funder, before);
    if (!txs.length) break;
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
    if (recipients.size >= MAX_CANDIDATES * 2) break;
  }
  return { recipients: [...recipients].slice(0, MAX_CANDIDATES), scanned, truncated };
}

// Tokens a wallet has MINTED (created), from its recent TOKEN_MINT events. The
// launched mint is the non-stablecoin token in the transfer; the name comes free
// from the enhanced-tx description when the mint touches exactly one real token.
async function mintedTokens(key: string, wallet: string): Promise<{ total: number; sample: { mint: string; name?: string }[] }> {
  const txs = await enhancedTx(key, wallet, "").catch(() => []);
  const mints = new Set<string>();
  const nameByMint = new Map<string, string>();
  for (const t of txs) {
    if (t.type !== "TOKEN_MINT" && t.type !== "CREATE") continue;
    const real = [...new Set((t.tokenTransfers ?? []).map((x: any) => x.mint).filter((m: any) => typeof m === "string" && m && !DENY_MINT.has(m)))] as string[];
    for (const m of real) mints.add(m);
    const nm = typeof t.description === "string" ? t.description.match(/minted\s+[\d.,]+\s+(.+)$/i) : null;
    if (nm && real.length === 1) nameByMint.set(real[0], nm[1].trim().slice(0, 40));
  }
  const sample = [...mints].slice(0, 8).map((m) => ({ mint: m, name: nameByMint.get(m) }));
  return { total: mints.size, sample };
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

  // TEMP: isolate mint-detection on a single wallet. ?check=<wallet>
  if (typeof req.query.check === "string" && SOLADDR.test(req.query.check)) {
    const t = await mintedTokens(key, req.query.check);
    res.status(200).json({ check: req.query.check, ...t });
    return;
  }

  const deadline = Date.now() + 50000;
  try {
    const { recipients, scanned, truncated } = await seedRecipients(key, wallet, deadline);
    const checked = await inChunks(recipients, CHECK_CHUNK, async (w) => {
      if (Date.now() > deadline) return null;
      const t = await mintedTokens(key, w);
      return t.total > 0 ? { wallet: w, tokensCreated: t.total, sampleTokens: t.sample } : null;
    });
    const seededDeployers = (checked.filter(Boolean) as {
      wallet: string; tokensCreated: number; sampleTokens: { mint: string; name?: string }[];
    }[]).sort((a, b) => b.tokensCreated - a.tokensCreated);
    const totalTokens = seededDeployers.reduce((s, d) => s + d.tokensCreated, 0);

    const note = !recipients.length
      ? "No SOL-seeding transfers found from this wallet (not a funder, or too far back to scan)."
      : !seededDeployers.length
        ? `Sent SOL to ${recipients.length} wallet${recipients.length === 1 ? "" : "s"}, none of which minted tokens. Not a serial-launch funder.`
        : `This wallet seeded ${seededDeployers.length} deployer${seededDeployers.length === 1 ? "" : "s"} that launched ${totalTokens} token${totalTokens === 1 ? "" : "s"}. A shared funder across launches is the signature of a serial operator.`;

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
