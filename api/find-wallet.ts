// Find-wallet resolver. GET /api/find-wallet?q=<clue>
//
// Turns a clue into wallet address(es): a full address, an ENS/basename/.sol name,
// or an X handle (its bio/posts, its Farcaster-verified addresses, or a
// handle-name match). The bridge between the people side and the on-chain side.
// Self-contained on purpose: a Vercel function can't bundle a raw server/ module
// at runtime, so the resolution logic mirrors server/adapters/wallet.ts.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME = /\.(eth|lens|sol|cb\.id|crypto|nft|x|dao)$/i;
const ADDR_IN_TEXT = /0x[a-fA-F0-9]{40}/g;
const NAME_IN_TEXT = /\b[a-z0-9][a-z0-9-]{1,38}\.(?:base\.eth|eth|sol|lens)\b/gi;
const TW = "https://api.twitterapi.io";

async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(7000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function web3bio(name: string): Promise<string | null> {
  const d = await getJson(`https://api.web3.bio/profile/${encodeURIComponent(name)}`);
  const arr = Array.isArray(d) ? d : d ? [d] : [];
  return (arr.find((x: any) => x && typeof x.address === "string" && x.address) as any)?.address ?? null;
}
async function ensideas(name: string): Promise<string | null> {
  const d = await getJson(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`);
  return d && typeof d.address === "string" && EVM.test(d.address) ? d.address : null;
}
async function snsResolve(name: string): Promise<string | null> {
  const j = await getJson(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${encodeURIComponent(name.replace(/\.sol$/i, ""))}`);
  return j && typeof j.result === "string" ? j.result : null;
}
async function resolveName(name: string): Promise<{ address: string; chain: string } | null> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".sol")) { const a = await snsResolve(lower); return a ? { address: a, chain: "solana" } : null; }
  let a = await web3bio(lower);
  if (!a && /\.eth$/i.test(lower)) a = await ensideas(lower);
  return a ? { address: a, chain: a.startsWith("0x") ? "evm" : "solana" } : null;
}
async function farcasterWallets(handle: string): Promise<{ address: string; chain: string; source: string }[]> {
  const u = handle.replace(/^@/, "");
  const ud = await getJson(`https://api.warpcast.com/v2/user-by-username?username=${encodeURIComponent(u)}`);
  const fid = ud?.result?.user?.fid;
  if (!fid) return [];
  const vd = await getJson(`https://api.warpcast.com/v2/verifications?fid=${fid}`);
  const verifs: any[] = vd?.result?.verifications ?? [];
  return verifs.filter((v) => typeof v.address === "string" && EVM.test(v.address)).map((v) => ({ address: v.address, chain: "evm", source: `Farcaster verified wallet (@${u})` }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim().replace(/^@/, "");
  if (!q) { res.status(400).json({ error: "q (a handle, ENS/.sol name, or address) required" }); return; }

  const wallets: { address: string; chain: string; source: string }[] = [];
  const seen = new Set<string>();
  const add = (address: string | null | undefined, chain: string, source: string) => {
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
      add(r?.address, r?.chain ?? "evm", `resolved ${q}`);
    } else if (SOL.test(q)) {
      add(q, "solana", "direct address");
    } else {
      // X handle: bio/posts scan + Farcaster verified + handle-name match
      const key = process.env.TWITTERAPI_KEY;
      let text = "";
      if (key) {
        const prof = await getJson(`${TW}/twitter/user/info?userName=${encodeURIComponent(q)}`, { "x-api-key": key });
        const p = prof?.data ?? prof;
        const postsD = await getJson(`${TW}/twitter/user/last_tweets?userName=${encodeURIComponent(q)}`, { "x-api-key": key });
        const tweets: any[] = postsD?.data?.tweets ?? postsD?.tweets ?? [];
        text = [p?.description ?? "", ...tweets.map((t) => t.text ?? "")].join(" \n ");
      }
      // self-disclosed in bio/posts
      for (const m of text.matchAll(ADDR_IN_TEXT)) add(m[0], "evm", "0x in their X bio/posts");
      const names = new Set<string>();
      for (const m of text.matchAll(NAME_IN_TEXT)) names.add(m[0].toLowerCase());
      // Farcaster + handle-name + disclosed names, all concurrent + bounded
      const [fc, named, hEth, hBase] = await Promise.all([
        farcasterWallets(q),
        Promise.all([...names].slice(0, 4).map((nm) => resolveName(nm).then((r) => ({ nm, r })))),
        resolveName(`${q.toLowerCase()}.eth`),
        resolveName(`${q.toLowerCase()}.base.eth`),
      ]);
      for (const w of fc) add(w.address, w.chain, w.source);
      for (const { nm, r } of named) add(r?.address, r?.chain ?? "evm", `${nm} (in their X bio/posts)`);
      add(hEth?.address, hEth?.chain ?? "evm", `${q.toLowerCase()}.eth (handle-name match, unconfirmed)`);
      add(hBase?.address, hBase?.chain ?? "evm", `${q.toLowerCase()}.base.eth (handle-name match, unconfirmed)`);
    }
    res.status(200).json({ query: q, wallets, note: wallets.length ? undefined : "No wallet could be resolved from this clue." });
  } catch (e) {
    res.status(200).json({ query: q, wallets, error: String(e) });
  }
}
