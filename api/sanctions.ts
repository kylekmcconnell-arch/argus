// OFAC sanctioned-address screening. GET /api/sanctions?addresses=a,b,c&chain=
//
// A wallet on the US Treasury OFAC SDN list is the hardest signal a due-diligence
// tool can produce — a sanctioned deployer, funder, or holder is an instant AVOID
// that no heuristic can match, and it's a real legal-exposure flag for anyone
// touching the token. Source: 0xB10C/ofac-sanctioned-digital-currency-addresses
// (the maintained, auto-updated extraction of Treasury's sdn_advanced.xml). Free,
// public domain. We fetch the relevant per-asset lists, union + cache them, and
// check the addresses the audit already resolved.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 15 };

const RAW = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_";
// EVM addresses are shared across chains, so the Ethereum-format lists (ETH +
// stablecoins + L2s) cover Base/BSC/Arbitrum/etc. Solana has its own list.
const LISTS: Record<string, string[]> = {
  evm: ["ETH", "USDC", "USDT", "BSC", "ARB"],
  solana: ["SOL"],
};

async function sanctionedSet(family: "evm" | "solana"): Promise<Set<string>> {
  const ck = `ofac:${family}:v1`;
  const cached = await cacheGetJson<string[]>(ck);
  if (cached && cached.length) return new Set(cached);
  const set = new Set<string>();
  await Promise.all(
    LISTS[family].map(async (asset) => {
      try {
        const r = await fetch(`${RAW}${asset}.txt`, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) return;
        const t = await r.text();
        for (const line of t.split("\n")) { const a = line.trim().toLowerCase(); if (a && !a.startsWith("#")) set.add(a); }
      } catch { /* one list failing shouldn't sink the screen */ }
    }),
  );
  if (set.size) await cacheSetJson(ck, [...set]);
  return set;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw: string = typeof req.query.addresses === "string" ? req.query.addresses : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  const family: "evm" | "solana" = chain === "solana" ? "solana" : "evm";
  const addresses: string[] = [...new Set(raw.split(",").map((a: string) => a.trim()).filter(Boolean))].slice(0, 40);
  if (!addresses.length) { res.status(400).json({ error: "addresses required" }); return; }
  try {
    const set = await sanctionedSet(family);
    if (!set.size) { res.status(200).json({ available: false, note: "OFAC list unavailable." }); return; }
    // Solana addresses are case-sensitive; EVM aren't. Match accordingly.
    const sanctioned = addresses.filter((a: string) => (family === "solana" ? set.has(a) : set.has(a.toLowerCase())));
    res.status(200).json({ available: true, checked: addresses.length, listSize: set.size, sanctioned });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Sanctions screen failed." });
  }
}
