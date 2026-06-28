// Find-wallet resolver. GET /api/find-wallet?q=<clue>
//
// Turns a clue into wallet address(es): a full or ENS/basename/.sol name, or an X
// handle whose bio/posts disclose an address or name. This is the bridge between
// the people side and the on-chain side — once you have the wallet, the existing
// on-chain forensics (funding trail, activity) can run on it.
//   - ENS / Basenames / Lens  -> web3.bio (free identity resolver)
//   - .sol (SNS)              -> Bonfida proxy
//   - @handle                 -> twitterapi bio + recent posts, scanned for
//                                0x addresses and *.eth/*.base.eth/*.sol names
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME = /\.(eth|lens|sol|cb\.id|crypto|nft|x|dao)$/i;
const ADDR_IN_TEXT = /0x[a-fA-F0-9]{40}/g;
const NAME_IN_TEXT = /\b[a-z0-9][a-z0-9-]{1,38}\.(?:base\.eth|eth|sol|lens)\b/gi;
const TW = "https://api.twitterapi.io";

async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(9000) }); return r.ok ? await r.json() : null; } catch { return null; }
}

async function web3bio(name: string): Promise<string | null> {
  const d = await getJson(`https://api.web3.bio/profile/${encodeURIComponent(name)}`);
  if (!d) return null;
  const arr = Array.isArray(d) ? d : [d];
  const p = arr.find((x: any) => x && typeof x.address === "string" && x.address);
  return p?.address ?? null;
}
async function snsResolve(domain: string): Promise<string | null> {
  const dn = domain.replace(/\.sol$/i, "");
  const j = await getJson(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${encodeURIComponent(dn)}`);
  return j && typeof j.result === "string" ? j.result : null;
}
async function resolveName(name: string): Promise<{ address: string; chain: string } | null> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".sol")) { const a = await snsResolve(lower); return a ? { address: a, chain: "solana" } : null; }
  const a = await web3bio(lower);
  return a ? { address: a, chain: a.startsWith("0x") ? "evm" : "solana" } : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim().replace(/^@/, "");
  if (!q) { res.status(400).json({ error: "q (a handle, ENS/.sol name, or address) required" }); return; }

  const wallets: { address: string; chain: string; source: string }[] = [];
  const seen = new Set<string>();
  const add = (address: string | null, chain: string, source: string) => {
    if (!address) return;
    const k = address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    wallets.push({ address, chain, source });
  };

  try {
    if (EVM.test(q)) {
      add(q, "evm", "direct address");
    } else if (NAME.test(q)) {
      const r = await resolveName(q);
      add(r?.address ?? null, r?.chain ?? "evm", `resolved ${q}`);
    } else if (SOL.test(q)) {
      add(q, "solana", "direct address");
    } else {
      // X handle: mine bio + recent posts for disclosed addresses / names
      const key = process.env.TWITTERAPI_KEY;
      if (key) {
        const prof = await getJson(`${TW}/twitter/user/info?userName=${encodeURIComponent(q)}`, { "x-api-key": key });
        const p = prof?.data ?? prof;
        const postsD = await getJson(`${TW}/twitter/user/last_tweets?userName=${encodeURIComponent(q)}`, { "x-api-key": key });
        const tweets: any[] = postsD?.data?.tweets ?? postsD?.tweets ?? [];
        const text = [p?.description ?? "", p?.profile_bio?.description ?? "", ...tweets.map((t) => t.text ?? "")].join(" \n ");
        for (const m of text.matchAll(ADDR_IN_TEXT)) add(m[0], "evm", "in their X bio/posts");
        const names = new Set<string>();
        for (const m of text.matchAll(NAME_IN_TEXT)) names.add(m[0].toLowerCase());
        for (const nm of [...names].slice(0, 6)) {
          const r = await resolveName(nm);
          add(r?.address ?? null, r?.chain ?? "evm", `${nm} (in their X bio/posts)`);
        }
      }
    }
    res.status(200).json({ query: q, wallets, note: wallets.length ? undefined : "No wallet could be resolved from this clue." });
  } catch (e) {
    res.status(200).json({ query: q, wallets, error: String(e) });
  }
}
