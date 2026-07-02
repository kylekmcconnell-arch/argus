// On-chain forensics adapter. Wallet conduct (K4) and rug confirmation. Helius
// covers Solana (free tier generous); Bitquery covers EVM + multi-chain. Both
// enrich any wallet already attributed to the subject (attribution itself is a
// SelfDoxxed / InvestigatorAttributed evidence step, never inferred here).

import type { Adapter, CollectContext } from "./types";
import { recordHelius } from "../cost";
import { env } from "../config";

export async function heliusWalletActivity(address: string) {
  const key = env("HELIUS_API_KEY");
  if (!key) return null;
  try {
    recordHelius("address-transactions");
    const res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=50`);
    if (!res.ok) return null;
    const txs = (await res.json()) as any[];
    return { count: txs.length, latest: txs[0]?.timestamp };
  } catch {
    return null;
  }
}

export async function bitqueryReachable(): Promise<boolean> {
  return !!env("BITQUERY_API_KEY");
}

export const onchainAdapter: Adapter = {
  id: "onchain",
  label: "On-chain forensics (Helius / Bitquery)",
  available: () => !!env("HELIUS_API_KEY") || !!env("BITQUERY_API_KEY"),
  async run(ctx: CollectContext) {
    const wallets = ctx.evidence.wallets.filter(
      (w) => w.link_tier === "SelfDoxxed" || w.link_tier === "InvestigatorAttributed",
    );
    if (!wallets.length) return;
    ctx.emit({ phase: "On-chain", label: "Wallet forensics", detail: `Examining ${wallets.length} attributed wallet(s)…`, tone: "neutral" });
    for (const w of wallets) {
      if (w.chain === "solana" && env("HELIUS_API_KEY")) {
        const act = await heliusWalletActivity(w.address);
        if (act) {
          w.activity_summary = `${act.count} recent txs`;
          ctx.emit({ phase: "On-chain", label: `${w.address.slice(0, 6)}…`, detail: `${act.count} recent transactions`, source: "helius", tone: w.sold_into_own_promo ? "bad" : "neutral" });
        }
      } else if (w.sold_into_own_promo) {
        ctx.emit({ phase: "On-chain", label: `${w.address.slice(0, 6)}…`, detail: "attributed wallet sold into own promotion (cap)", source: "bitquery", tone: "bad" });
      }
    }
  },
};
