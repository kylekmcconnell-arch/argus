// EVM wallet identity clustering. GET /api/evm-cluster?address=<token>&chain=<id>
//
// The EVM parallel to api/cluster.ts (Solana/RugCheck). Same question — how many
// of the "top holders" are secretly one hand? — answered with EVM sources: GoPlus
// for the holder list (keyless) and Etherscan for each holder's first funder and
// its transfers. Any two holders tied by a SHARED non-exchange FUNDER or a DIRECT
// transfer are unioned into one operator; the combined supply each group controls
// is the concentration a per-wallet holder chart hides. Returns the SAME shape as
// the Solana endpoint so the client panel is chain-agnostic.
//
// EVM only. Gated on ETHERSCAN_API_KEY (GoPlus is keyless). Bounded + graceful.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, linea: 59144, scroll: 534352,
};
const MAX_WALLETS = 20;
const CHUNK = 4;
const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const lc = (s: string) => s.toLowerCase();

// Exchange hot + cold wallets and burn/null addresses: a shared EXCHANGE funder is
// not a same-operator signal (everyone withdraws from Binance), and an exchange
// custody wallet holding supply is not an insider. Includes the big cold wallets
// GoPlus leaves untagged (e.g. Binance 0xf977…) that would otherwise read as a
// concentrated "holder".
const SKIP = new Set<string>([
  "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead",
  "0xf977814e90da44bfa03b6295a0616a897441acec", "0x28c6c06298d514db089934071355e5743bf21d60",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549", "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f", "0x9696f59e4d72e237be84ffd425dcad154bf96976",
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be", "0xd551234ae421e3bcba99a0da6d736074f22192ff",
  "0x564286362092d8e7936f0549571a803b203aaced", "0x0681d8db095565fe8a346fa0277bffde9c0edbbf",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", "0x503828976d22510aad0201ac7ec88293211d23da",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43", "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b", "0xf89d7b9c864f589bbf53a82105107622b35eaa40",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe", "0x1522900b6dafac587d499a862861c0869be6e428",
]);

const ES = "https://api.etherscan.io/v2/api";
async function txlist(chainid: number, address: string, key: string, offset: number): Promise<any[]> {
  const q = new URLSearchParams({ chainid: String(chainid), module: "account", action: "txlist", address, startblock: "0", endblock: "99999999", page: "1", offset: String(offset), sort: "asc", apikey: key });
  const r = await fetch(`${ES}?${q}`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!r || !r.ok) return [];
  const d = (await r.json().catch(() => null)) as any;
  return Array.isArray(d?.result) ? d.result : [];
}

// ERC-20 transfers of a SPECIFIC token for a wallet — holders passing the token
// among themselves is a stronger coordination signal than sharing ETH.
async function tokentx(chainid: number, wallet: string, token: string, key: string): Promise<any[]> {
  const q = new URLSearchParams({ chainid: String(chainid), module: "account", action: "tokentx", contractaddress: token, address: wallet, page: "1", offset: "200", sort: "desc", apikey: key });
  const r = await fetch(`${ES}?${q}`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!r || !r.ok) return [];
  const d = (await r.json().catch(() => null)) as any;
  return Array.isArray(d?.result) ? d.result : [];
}

// A holder's first funder + the set-members it directly transacted with. Reads both
// ETH (txlist, oldest-first — captures the funding tx) AND transfers of the token
// itself (tokentx) so wallets that pass the token to each other are linked.
async function profile(chainid: number, wallet: string, token: string, key: string, inSet: Set<string>): Promise<{ wallet: string; funder: string | null; cps: string[] }> {
  const [txs, ttx] = await Promise.all([txlist(chainid, wallet, key, 2000), tokentx(chainid, wallet, token, key)]);
  let funder: string | null = null;
  const cps = new Set<string>();
  for (const t of txs) {
    if (!funder && lc(t.to) === lc(wallet) && t.from && lc(t.from) !== lc(wallet) && Number(t.value) > 0 && t.isError !== "1") funder = lc(t.from);
    const other = lc(t.from) === lc(wallet) ? lc(t.to || "") : lc(t.from || "");
    if (other && other !== lc(wallet) && inSet.has(other)) cps.add(other);
  }
  for (const t of ttx) {
    const other = lc(t.from) === lc(wallet) ? lc(t.to || "") : lc(t.from || "");
    if (other && other !== lc(wallet) && inSet.has(other)) cps.add(other);
  }
  return { wallet: lc(wallet), funder, cps: [...cps] };
}

class DSU {
  p = new Map<string, string>();
  find(x: string): string { const pp = this.p.get(x) ?? x; if (pp === x) { this.p.set(x, x); return x; } const r = this.find(pp); this.p.set(x, r); return r; }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}
async function inChunks<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.ETHERSCAN_API_KEY;
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  const chainid = CHAINID[chain];
  if (!isAddr(address)) { res.status(400).json({ error: "valid EVM token address required" }); return; }
  if (!chainid) { res.status(200).json({ address, chain, available: false, note: `No chain id for '${chain}'.` }); return; }
  if (!key) { res.status(200).json({ address, chain, available: false, note: "Etherscan not configured; EVM clustering unavailable." }); return; }

  try {
    // 1. Holder set from GoPlus (keyless). percent is a 0..1 fraction.
    const gr = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainid}?contract_addresses=${address}`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    const gd = gr && gr.ok ? ((await gr.json().catch(() => null)) as any) : null;
    const tok = gd?.result?.[lc(address)] ?? gd?.result?.[address] ?? null;
    if (!tok) { res.status(200).json({ address, chain, available: true, clusters: [], walletsAnalyzed: 0, note: "No holder data available for this token." }); return; }
    const creator = typeof tok.creator_address === "string" && isAddr(tok.creator_address) ? lc(tok.creator_address) : null;
    const holders = (tok.holders ?? [])
      .map((h: any) => ({ address: lc(String(h.address || "")), pct: Number(h.percent || 0) * 100, isContract: Number(h.is_contract) === 1, tag: String(h.tag || "") }))
      .filter((h: any) => isAddr(h.address) && !h.isContract && !h.tag && !SKIP.has(h.address));

    const set: string[] = [];
    const pctOf = new Map<string, number>();
    for (const h of holders.slice(0, MAX_WALLETS)) if (!pctOf.has(h.address)) { set.push(h.address); pctOf.set(h.address, h.pct); }
    if (creator && !SKIP.has(creator) && !pctOf.has(creator)) { set.push(creator); pctOf.set(creator, 0); }
    if (set.length < 2) { res.status(200).json({ address, chain, available: true, clusters: [], walletsAnalyzed: set.length, note: "Not enough non-exchange holders to cluster." }); return; }

    // 2. Each holder's funder + in-set counterparties.
    const inSet = new Set(set);
    const deadline = Date.now() + 50000;
    const profiles = await inChunks(set, CHUNK, async (w) => (Date.now() > deadline ? { wallet: w, funder: null, cps: [] } : profile(chainid, w, lc(address), key, inSet)));

    // 3. Union: shared non-exchange funder, or a direct transfer between members.
    const dsu = new DSU();
    for (const w of set) dsu.find(w);
    const links: { a: string; b: string; type: "co-funded" | "transfer"; via?: string }[] = [];
    const byFunder = new Map<string, string[]>();
    for (const p of profiles) {
      if (!p.funder || SKIP.has(p.funder)) continue;
      (byFunder.get(p.funder) ?? byFunder.set(p.funder, []).get(p.funder)!).push(p.wallet);
    }
    for (const [funder, ws] of byFunder) {
      if (ws.length < 2) continue;
      for (let i = 1; i < ws.length; i++) { dsu.union(ws[0], ws[i]); links.push({ a: ws[0], b: ws[i], type: "co-funded", via: funder }); }
    }
    for (const p of profiles) for (const cp of p.cps) {
      const a = p.wallet < cp ? p.wallet : cp, b = p.wallet < cp ? cp : p.wallet;
      if (!links.some((l) => l.type === "transfer" && l.a === a && l.b === b)) { dsu.union(a, b); links.push({ a, b, type: "transfer" }); }
    }

    // 4. Assemble clusters (size >= 2), same shape as the Solana endpoint.
    const groups = new Map<string, string[]>();
    for (const w of set) { const r = dsu.find(w); (groups.get(r) ?? groups.set(r, []).get(r)!).push(w); }
    const clusters = [...groups.values()].filter((ws) => ws.length >= 2).map((ws) => {
      const combinedPct = ws.reduce((s, w) => s + (pctOf.get(w) ?? 0), 0);
      const clinks = links.filter((l) => ws.includes(l.a) && ws.includes(l.b));
      const funders = [...new Set(clinks.filter((l) => l.via).map((l) => l.via as string))];
      return {
        wallets: ws.map((w) => ({ address: w, pct: pctOf.get(w) ?? 0, insider: false, isCreator: w === creator })),
        size: ws.length, combinedPct, sharedFunders: funders, links, includesCreator: creator ? ws.includes(creator) : false,
      };
    }).sort((a, b) => b.combinedPct - a.combinedPct || b.size - a.size);

    const top = clusters[0];
    const note = !clusters.length
      ? `Analyzed ${set.length} top holders; found no on-chain links between them (independently funded, no direct transfers). No hidden common ownership detected.`
      : `${clusters.length} coordinated wallet group${clusters.length === 1 ? "" : "s"} among the top holders. The largest is ${top.size} wallets controlling a combined ${top.combinedPct.toFixed(1)}% of supply${top.sharedFunders.length ? `, seeded by one funder (${top.sharedFunders[0].slice(0, 8)}…)` : " via direct transfers"}${top.includesCreator ? ", including the token's creator" : ""}. A holder chart shows these as separate wallets; on-chain they are one hand.`;

    res.status(200).json({ address, chain, available: true, walletsAnalyzed: set.length, clusters, note });
  } catch (e) {
    res.status(200).json({ address, chain, available: true, clusters: [], error: String(e), note: "EVM wallet clustering failed." });
  }
}
