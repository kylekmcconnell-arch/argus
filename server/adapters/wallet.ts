// Wallet resolution: turn an identity into wallet address(es), several ways, so a
// people-audit (and the standalone /api/find-wallet) can connect a person to their
// on-chain footprint. Bridge: identity in -> wallet out -> on-chain forensics.
//   - self-disclosed: a 0x address or *.eth/*.base.eth/*.sol name in bio/posts
//   - Farcaster: the handle's on-chain VERIFIED addresses (cryptographically
//     proven the Farcaster user controls them)
//   - handle-as-name: <handle>.eth / <handle>.base.eth (a possible match, opt-in)

import { recordCall } from "../cost";

const ADDR_IN_TEXT = /0x[a-fA-F0-9]{40}/g;
const NAME_IN_TEXT = /\b[a-z0-9][a-z0-9-]{1,38}\.(?:base\.eth|eth|sol|lens)\b/gi;

async function getJson(url: string): Promise<any> {
  try { recordCall("wallet-resolve", new URL(url).host, 0); const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function web3bio(name: string): Promise<string | null> {
  const d = await getJson(`https://api.web3.bio/profile/${encodeURIComponent(name)}`);
  const arr = Array.isArray(d) ? d : d ? [d] : [];
  return (arr.find((x: any) => x && typeof x.address === "string" && x.address) as any)?.address ?? null;
}
async function ensideas(name: string): Promise<string | null> {
  const d = await getJson(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`);
  return d && typeof d.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(d.address) ? d.address : null;
}
async function snsResolve(name: string): Promise<string | null> {
  const j = await getJson(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${encodeURIComponent(name.replace(/\.sol$/i, ""))}`);
  return j && typeof j.result === "string" ? j.result : null;
}
export async function resolveName(name: string): Promise<{ address: string; chain: string } | null> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".sol")) { const a = await snsResolve(lower); return a ? { address: a, chain: "solana" } : null; }
  let a = await web3bio(lower);
  if (!a && /\.eth$/i.test(lower)) a = await ensideas(lower);
  return a ? { address: a, chain: a.startsWith("0x") ? "evm" : "solana" } : null;
}

export type WalletTier = "SelfDoxxed" | "InvestigatorAttributed";
export interface ResolvedWallet { address: string; chain: string; source: string; tier: WalletTier }

// Farcaster: the handle's on-chain verified addresses (assumes the FC username
// matches the X handle, common for crypto-natives; labeled so a human can judge).
async function farcasterWallets(handle: string): Promise<ResolvedWallet[]> {
  const u = handle.replace(/^@/, "");
  const ud = await getJson(`https://api.warpcast.com/v2/user-by-username?username=${encodeURIComponent(u)}`);
  const fid = ud?.result?.user?.fid;
  if (!fid) return [];
  const vd = await getJson(`https://api.warpcast.com/v2/verifications?fid=${fid}`);
  const verifs: any[] = vd?.result?.verifications ?? [];
  return verifs
    .filter((v) => typeof v.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(v.address))
    .map((v) => ({ address: v.address, chain: "evm", source: `Farcaster verified wallet (@${u})`, tier: "InvestigatorAttributed" as WalletTier }));
}

export async function resolveWalletsFromText(text: string): Promise<ResolvedWallet[]> {
  if (!text) return [];
  const out: ResolvedWallet[] = [];
  const seen = new Set<string>();
  const add = (address: string | null, chain: string, source: string) => {
    if (!address) return;
    const k = address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ address, chain, source, tier: "SelfDoxxed" });
  };
  for (const m of text.matchAll(ADDR_IN_TEXT)) add(m[0], "evm", "0x address self-disclosed in X bio/posts");
  const names = new Set<string>();
  for (const m of text.matchAll(NAME_IN_TEXT)) names.add(m[0].toLowerCase());
  for (const nm of [...names].slice(0, 6)) {
    const r = await resolveName(nm);
    add(r?.address ?? null, r?.chain ?? "evm", `${nm} (self-disclosed in X bio/posts)`);
  }
  return out.slice(0, 6);
}

// Every angle for a handle. `includePossible` adds the lower-confidence
// handle-as-name guess (anyone can own <handle>.eth), for the explicit find-wallet
// tool — the auto-audit path leaves it off to avoid mis-attribution.
export async function resolveForHandle(handle: string, text: string, opts: { includePossible?: boolean } = {}): Promise<ResolvedWallet[]> {
  const u = handle.replace(/^@/, "").toLowerCase();
  const out: ResolvedWallet[] = [];
  const seen = new Set<string>();
  const add = (w: ResolvedWallet | null) => { if (!w) return; const k = w.address.toLowerCase(); if (seen.has(k)) return; seen.add(k); out.push(w); };
  const [fromText, fromFc] = await Promise.all([resolveWalletsFromText(text), farcasterWallets(handle)]);
  fromText.forEach(add);
  fromFc.forEach(add);
  if (opts.includePossible) {
    for (const nm of [`${u}.eth`, `${u}.base.eth`]) {
      const r = await resolveName(nm);
      if (r) add({ address: r.address, chain: r.chain, source: `${nm} (handle-name match, unconfirmed)`, tier: "InvestigatorAttributed" });
    }
  }
  return out.slice(0, 8);
}
