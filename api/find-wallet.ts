// Find-wallet resolver. GET /api/find-wallet?q=<clue>
//
// Turns a clue into wallet address(es): a full address, an ENS/basename/.sol name,
// or an X handle (its bio/posts, its Farcaster-verified addresses, or a
// handle-name match). The bridge between the people side and the on-chain side.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolveName, resolveForHandle } from "../server/adapters/wallet";

export const config = { maxDuration: 30 };

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME = /\.(eth|lens|sol|cb\.id|crypto|nft|x|dao)$/i;
const TW = "https://api.twitterapi.io";

async function twText(handle: string, key: string): Promise<string> {
  try {
    const prof = await fetch(`${TW}/twitter/user/info?userName=${encodeURIComponent(handle)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const p = (prof as any)?.data ?? prof;
    const postsD = await fetch(`${TW}/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const tweets: any[] = (postsD as any)?.data?.tweets ?? (postsD as any)?.tweets ?? [];
    return [p?.description ?? "", ...tweets.map((t) => t.text ?? "")].join(" \n ");
  } catch {
    return "";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim().replace(/^@/, "");
  if (!q) { res.status(400).json({ error: "q (a handle, ENS/.sol name, or address) required" }); return; }

  try {
    let wallets: { address: string; chain: string; source: string }[] = [];
    if (EVM.test(q)) {
      wallets = [{ address: q, chain: "evm", source: "direct address" }];
    } else if (NAME.test(q)) {
      const r = await resolveName(q);
      if (r) wallets = [{ address: r.address, chain: r.chain, source: `resolved ${q}` }];
    } else if (SOL.test(q)) {
      wallets = [{ address: q, chain: "solana", source: "direct address" }];
    } else {
      const key = process.env.TWITTERAPI_KEY;
      const text = key ? await twText(q, key) : "";
      const found = await resolveForHandle(q, text, { includePossible: true });
      wallets = found.map((w) => ({ address: w.address, chain: w.chain, source: w.source }));
    }
    res.status(200).json({ query: q, wallets, note: wallets.length ? undefined : "No wallet could be resolved from this clue." });
  } catch (e) {
    res.status(200).json({ query: q, wallets: [], error: String(e) });
  }
}
