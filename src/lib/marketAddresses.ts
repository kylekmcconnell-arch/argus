// Addresses that are MARKET INFRASTRUCTURE, not holders.
//
// A concentration figure answers "how much of the supply sits with people who
// could dump it." An AMM pool holds the float precisely so it can be traded,
// and an exchange hot wallet holds it on behalf of thousands of customers.
// Counting either as a wallet inverts the meaning of the number: on a fresh
// pump.fun launch the pool IS the top holder, so every such token reads as
// dangerously concentrated, and the honest reading (what the actual wallets
// hold between them) never reaches the reader.
//
// ARGUS already knew several of these addresses by name in the deployer trail
// while calling them anonymous insider wallets in the token report. This module
// is the one place that knowledge lives.

/** Solana CEX hot wallets. Custody addresses: customer float, not one holder. */
export const SOLANA_CEX_WALLETS: Record<string, string> = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance",
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: "Coinbase",
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: "Coinbase",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase",
  FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5: "Kraken",
  AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS: "OKX",
  "5VVBHtk2QQBy5rZ2pBdgcb4yj9DBYy8tDksBs2pWnUKr": "Bybit",
  "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo": "Gate.io",
  "6gnCPhXtLnUD76HjQuSYPENLSZdG8RvDB1pTLM5aLSss": "MEXC",
};

/** EVM exchange custody wallets seen holding large float on token holder lists. */
export const EVM_CEX_WALLETS: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x3cc936b795a188f0e246cbb2d74c5bd190aecf18": "OKX",
  "0x2b5634c42055806a59e9107ed44d43c426e58258": "Kucoin",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
  "0xf89d7b9c864f589bbF53a82105107622B35EaA40": "Bybit",
  // Merged from the EVM deployer route, which had been carrying a longer list of
  // its own. Every one of these is exchange custody, so holder concentration was
  // counting them as insider wallets on any token they hold float in.
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance",
  "0x0681d8db095565fe8a346fa0277bffde9c0edbbf": "Binance",
  "0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0": "Coinbase",
  "0x3cd751e6b0078be393132286c442345e5dc49699": "Coinbase",
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
  "0x1522900b6dafac587d499a862861c0869be6e428": "Bitfinex",
};

export interface MarketAddressMatch {
  /** Short label for the UI: the exchange name, or the market venue. */
  label: string;
  kind: "pool" | "exchange" | "locker";
}

const normalize = (address: string): string => {
  const value = String(address ?? "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : value;
};

const lookup = (map: Record<string, string>, address: string): string | undefined => {
  const direct = map[address];
  if (direct) return direct;
  const lowered = normalize(address);
  for (const [candidate, name] of Object.entries(map)) {
    if (normalize(candidate) === lowered) return name;
  }
  return undefined;
};

/**
 * Classify an address as market infrastructure, or null when it is a wallet.
 *
 * Matching is EXACT (case-normalized for EVM). Never widen this with name or
 * shape heuristics: a real dev wallet mislabelled "pool" is a false clean, the
 * one direction ARGUS must never fail in.
 */
export function classifyMarketAddress(
  address: string | undefined,
  context: {
    /** Pool addresses for this token, from the DEX pair records themselves. */
    poolAddresses?: readonly string[];
    /** Explicit venue labels from a provider that names accounts (rugcheck). */
    knownAccounts?: Record<string, { name?: string; type?: string } | undefined>;
  } = {},
): MarketAddressMatch | null {
  const value = String(address ?? "").trim();
  if (!value) return null;

  const pool = (context.poolAddresses ?? []).some((candidate) => normalize(candidate) === normalize(value));
  if (pool) return { label: "liquidity pool", kind: "pool" };

  const exchange = lookup(SOLANA_CEX_WALLETS, value) ?? lookup(EVM_CEX_WALLETS, value);
  if (exchange) return { label: exchange, kind: "exchange" };

  // Only a provider's own structured type is trusted here, never a name
  // substring: "Locker" inside an attacker-chosen contract name proves nothing.
  const known = context.knownAccounts?.[value];
  const type = String(known?.type ?? "").toUpperCase();
  if (type === "AMM" || type === "MARKET" || type === "POOL") {
    return { label: known?.name?.trim() || "liquidity pool", kind: "pool" };
  }
  if (type === "LOCKER" || type === "VAULT") {
    return { label: known?.name?.trim() || "locked vault", kind: "locker" };
  }
  if (type === "EXCHANGE" || type === "CEX") {
    return { label: known?.name?.trim() || "exchange", kind: "exchange" };
  }
  return null;
}
