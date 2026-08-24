// Wallet holdings enumeration for the threat scanner's wallet mode.
// GET /api/wallet-holdings?address=<0x… | Solana>&chain=<evm|solana>
//
// Returns the token positions in a wallet so the client can triage them against
// the scanner's verdicts (portfolio triage + an at-risk-USD figure — nlyra's
// stickiest retention feature). Two keyless-ish paths:
//   - EVM: Ethplorer getAddressInfo (apiKey=freekey) — balances + token meta +
//     a price hint. Keyless. Ethereum mainnet only via freekey.
//   - Solana: Helius DAS getAssetsByOwner (fungible) when HELIUS_API_KEY is set.
// Prices/liquidity are refined client-side via DexScreener; this endpoint just
// enumerates positions + rough value so the client can rank what to scan first.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface Position {
  address: string;
  chain: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

async function evmHoldings(address: string): Promise<Position[]> {
  try {
    const r = await fetch(`https://api.ethplorer.io/getAddressInfo/${address}?apiKey=freekey`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const d = (await r.json()) as any;
    const out: Position[] = [];
    for (const t of d.tokens ?? []) {
      const ti = t.tokenInfo ?? {};
      const decimals = Number(ti.decimals ?? 18);
      const balance = Number(t.balance ?? 0) / 10 ** decimals;
      if (!Number.isFinite(balance) || balance <= 0) continue;
      const priceUsd = ti.price && ti.price.rate ? Number(ti.price.rate) : null;
      out.push({
        address: String(ti.address ?? "").toLowerCase(),
        chain: "ethereum",
        symbol: String(ti.symbol ?? "?").slice(0, 12),
        name: String(ti.name ?? "").slice(0, 40),
        decimals,
        balance,
        priceUsd,
        valueUsd: priceUsd != null ? balance * priceUsd : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function solHoldings(address: string): Promise<Position[]> {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "holdings", method: "getAssetsByOwner",
        params: { ownerAddress: address, page: 1, limit: 200, displayOptions: { showFungible: true } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as any;
    const items: any[] = d.result?.items ?? [];
    const out: Position[] = [];
    for (const it of items) {
      if (it.interface !== "FungibleToken" && it.interface !== "FungibleAsset") continue;
      const info = it.token_info ?? {};
      const decimals = Number(info.decimals ?? 0);
      const balance = Number(info.balance ?? 0) / 10 ** decimals;
      if (!Number.isFinite(balance) || balance <= 0) continue;
      const priceUsd = info.price_info?.price_per_token ?? null;
      out.push({
        address: String(it.id ?? ""),
        chain: "solana",
        symbol: String(info.symbol ?? it.content?.metadata?.symbol ?? "?").slice(0, 12),
        name: String(it.content?.metadata?.name ?? "").slice(0, 40),
        decimals,
        balance,
        priceUsd: priceUsd != null ? Number(priceUsd) : null,
        valueUsd: priceUsd != null ? balance * Number(priceUsd) : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = s(req.query.address);
  const isEvm = EVM.test(address);
  const isSol = !isEvm && SOL.test(address) && address.length >= 32;
  if (!isEvm && !isSol) { res.status(400).json({ error: "valid EVM or Solana address required" }); return; }

  const positions = isEvm ? await evmHoldings(address) : await solHoldings(address);
  const supported = isEvm || !!process.env.HELIUS_API_KEY;
  positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  res.status(200).json({
    available: supported,
    address,
    chain: isEvm ? "ethereum" : "solana",
    note: !supported ? "Solana wallet holdings need HELIUS_API_KEY." : undefined,
    positions: positions.slice(0, 100),
  });
}
