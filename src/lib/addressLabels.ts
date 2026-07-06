// Turn a bare holder address into something a human can read. "wallet 29.1%" tells
// you nothing; "Venice staking (contract)" or "Coinbase" or "burn address" is the
// whole point of holder forensics. Order of resolution: burn/null pattern → curated
// known-entity map (exchanges/bridges a rug can't be) → the provider's own tag →
// contract flag → the short address itself (a real EOA — show it, don't call it
// "wallet"). Curated addresses are high-confidence only (famous, stable); anything
// unknown falls through to the address, never a wrong label.
const lc = (a: string) => a.toLowerCase();
export const shortAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—");

// Burn / null sinks — supply here is effectively destroyed, a GOOD sign, not a whale.
const BURN = new Set<string>([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000001",
  // Solana
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
]);

// Well-known entity addresses (exchanges / bridges). High-confidence, stable set —
// these are the ones that actually recur as top holders and that a scam can't be.
const KNOWN: Record<string, { name: string; market: true }> = {
  // Binance (EVM hot/cold)
  "0x28c6c06298d514db089934071355e5743bf21d60": { name: "Binance", market: true },
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": { name: "Binance", market: true },
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": { name: "Binance", market: true },
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": { name: "Binance", market: true },
  "0xf977814e90da44bfa03b6295a0616a897441acec": { name: "Binance", market: true },
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be": { name: "Binance", market: true },
  "0xd551234ae421e3bcba99a0da6d736074f22192ff": { name: "Binance", market: true },
  // Coinbase
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": { name: "Coinbase", market: true },
  "0x503828976d22510aad0201ac7ec88293211d23da": { name: "Coinbase", market: true },
  "0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0": { name: "Coinbase", market: true },
  "0x3cd751e6b0078be393132286c442345e5dc49699": { name: "Coinbase", market: true },
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": { name: "Coinbase", market: true },
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": { name: "Coinbase", market: true },
  // Kraken / OKX / Bybit / others
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": { name: "Kraken", market: true },
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": { name: "Kraken", market: true },
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": { name: "OKX", market: true },
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": { name: "OKX", market: true },
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": { name: "Bybit", market: true },
  "0x1522900b6dafac587d499a862861c0869be6e428": { name: "Bitfinex", market: true },
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": { name: "Gate.io", market: true },
  // Common bridges / infra
  "0x4200000000000000000000000000000000000010": { name: "Base bridge", market: true },
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": { name: "Base bridge", market: true },
  "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf": { name: "Polygon bridge", market: true },
};

export interface AddressLabel { text: string; kind: "burn" | "market" | "contract" | "wallet"; market: boolean }

export function labelAddress(address: string | undefined, opts?: { tag?: string; isContract?: boolean }): AddressLabel {
  const a = lc(address ?? "");
  if (a && BURN.has(a)) return { text: "burn / null address", kind: "burn", market: true };
  const known = a && KNOWN[a];
  if (known) return { text: known.name, kind: "market", market: true };
  const tag = (opts?.tag ?? "").trim();
  if (tag && !/^(unknown|null address)$/i.test(tag)) {
    const market = /amm|dex|pool|cex|exchange|bridge|lp|market|router|vault|locker|staking|treasury|raydium|meteora|orca|pump|uniswap|aerodrome|pancake/i.test(tag);
    return { text: tag, kind: market ? "market" : "contract", market };
  }
  if (opts?.isContract) return { text: address ? `${shortAddr(address)} · contract` : "contract", kind: "contract", market: false };
  return { text: address ? shortAddr(address) : "wallet", kind: "wallet", market: false };
}

const EXPLORER: Record<string, string> = {
  ethereum: "etherscan.io", base: "basescan.org", bsc: "bscscan.com", polygon: "polygonscan.com",
  arbitrum: "arbiscan.io", optimism: "optimistic.etherscan.io", avalanche: "snowtrace.io",
  fantom: "ftmscan.com", linea: "lineascan.build", scroll: "scrollscan.com",
};
export function explorerAddr(address: string, chain: string): string {
  return chain === "solana" ? `https://solscan.io/account/${address}` : `https://${EXPLORER[chain] ?? "etherscan.io"}/address/${address}`;
}
