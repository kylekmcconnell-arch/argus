// Wallet resolution for the collector: scan a subject's own bio + posts for a
// self-disclosed wallet (a raw 0x address, or an ENS/basename/.sol name they
// resolve), so a people-audit can connect the person to their on-chain footprint.
// This is the bridge: identity in -> wallet out -> on-chain forensics + the graph.

const ADDR_IN_TEXT = /0x[a-fA-F0-9]{40}/g;
const NAME_IN_TEXT = /\b[a-z0-9][a-z0-9-]{1,38}\.(?:base\.eth|eth|sol|lens)\b/gi;

async function getJson(url: string): Promise<any> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); return r.ok ? await r.json() : null; } catch { return null; }
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
async function resolveName(name: string): Promise<{ address: string; chain: string } | null> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".sol")) { const a = await snsResolve(lower); return a ? { address: a, chain: "solana" } : null; }
  let a = await web3bio(lower);
  if (!a && /\.eth$/i.test(lower)) a = await ensideas(lower);
  return a ? { address: a, chain: a.startsWith("0x") ? "evm" : "solana" } : null;
}

export interface ResolvedWallet { address: string; chain: string; source: string }

export async function resolveWalletsFromText(text: string): Promise<ResolvedWallet[]> {
  if (!text) return [];
  const out: ResolvedWallet[] = [];
  const seen = new Set<string>();
  const add = (address: string | null, chain: string, source: string) => {
    if (!address) return;
    const k = address.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ address, chain, source });
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
