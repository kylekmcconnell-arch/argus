// Sector peer sets for the shipping assessment. A project's commit cadence
// means little on its own: forty commits a quarter is a sprint for a two-person
// launchpad token and a coma for an L2. So every sector carries three
// well-known public repositories that define what "shipping" looks like there,
// and the assessment positions the subject against their median.
//
// Repositories were verified to exist and be public on 2026-09-15. Renamed
// upstreams are recorded under their current owner so the read does not chase
// redirects. The lists are deliberately short: a baseline, not a leaderboard.

export interface PeerSector {
  id: string;
  label: string;
  /** Matched against the project's description, bio, narrative and site copy. */
  keywords: RegExp;
  repos: string[];
}

export const PEER_SECTORS: readonly PeerSector[] = [
  {
    id: "dex",
    label: "leading decentralized exchanges",
    keywords: /\b(dex|decentrali[sz]ed exchange|swap|amm|liquidity pool|router|aggregator|concentrated liquidity)\b/i,
    repos: ["Uniswap/v4-core", "Uniswap/interface", "aerodrome-finance/contracts"],
  },
  {
    id: "perps",
    label: "leading perpetuals and derivatives venues",
    keywords: /\b(perp(etual)?s?|derivatives?|leverage|futures|options?|margin trading)\b/i,
    repos: ["gmx-io/gmx-synthetics", "dydxprotocol/v4-chain", "velocity-exchange/protocol-v2"],
  },
  {
    id: "lending",
    label: "leading lending protocols",
    keywords: /\b(lend(ing)?|borrow(ing)?|money market|collateral|cdp|vault(s)? yield)\b/i,
    repos: ["aave-dao/aave-v3-origin", "morpho-org/morpho-blue", "compound-finance/comet"],
  },
  {
    id: "ai-agents",
    label: "leading crypto AI-agent frameworks",
    keywords: /\b(ai agents?|agentic|autonomous agents?|llm|virtuals|eliza|agent framework|ai[- ]powered)\b/i,
    repos: ["elizaOS/eliza", "coinbase/agentkit", "Virtual-Protocol/protocol-contracts"],
  },
  {
    id: "analytics",
    label: "leading crypto analytics and research tooling",
    keywords: /\b(analytics|research|intelligence|dashboard|screener|scanner|discovery|data platform|on-?chain data|builder[- ]intelligence)\b/i,
    repos: ["santiment/sanbase2", "electric-capital/open-dev-data", "DefiLlama/defillama-server"],
  },
  {
    id: "trading-tools",
    label: "leading open trading bots and exchange libraries",
    keywords: /\b(trading bot|market[- ]mak(er|ing)|sniper|copy[- ]trad(e|ing)|signals?|backtest|algo(rithmic)? trading|terminal)\b/i,
    repos: ["hummingbot/hummingbot", "freqtrade/freqtrade", "ccxt/ccxt"],
  },
  {
    id: "nft",
    label: "leading NFT infrastructure",
    keywords: /\b(nfts?|collectibles?|erc-?721|erc-?1155|marketplace|mint(ing)? pass|pfp)\b/i,
    repos: ["ProjectOpenSea/seaport", "manifoldxyz/creator-core-solidity", "immutable/ts-immutable-sdk"],
  },
  {
    id: "infra",
    label: "leading chain and rollup infrastructure",
    keywords: /\b(rollup|l2|layer[- ]?2|sequencer|node client|rpc|bridge|interop|infrastructure|chain)\b/i,
    repos: ["OffchainLabs/nitro", "ethereum-optimism/optimism", "paradigmxyz/reth"],
  },
  {
    id: "wallet",
    label: "leading self-custody wallets",
    keywords: /\b(wallets?|self[- ]custody|smart account|account abstraction|passkeys?)\b/i,
    repos: ["rainbow-me/rainbow", "MetaMask/metamask-extension", "RabbyHub/Rabby"],
  },
  {
    id: "stablecoin",
    label: "leading stablecoin and payments issuers",
    keywords: /\b(stablecoins?|payments?|remittance|usd-?pegged|fiat on-?ramp|synthetic dollar)\b/i,
    repos: ["circlefin/stablecoin-evm", "sky-ecosystem/dss", "paxosglobal/pyusd-contract"],
  },
  {
    id: "prediction",
    label: "leading prediction-market protocols",
    keywords: /\b(prediction markets?|binary options|outcome tokens?|betting|wager)\b/i,
    repos: ["Polymarket/ctf-exchange", "gnosis/conditional-tokens-contracts", "Azuro-protocol/Azuro-v2-public"],
  },
];

/** Pick the sector whose keywords hit the project's own description most often. */
export function detectPeerSector(text: string | null | undefined): PeerSector | null {
  const hay = (text ?? "").slice(0, 4000);
  if (!hay.trim()) return null;
  let best: { sector: PeerSector; hits: number } | null = null;
  for (const sector of PEER_SECTORS) {
    const re = new RegExp(sector.keywords.source, "gi");
    const hits = hay.match(re)?.length ?? 0;
    if (hits > 0 && (!best || hits > best.hits)) best = { sector, hits };
  }
  return best?.sector ?? null;
}

export function peerSectorById(id: string | null | undefined): PeerSector | null {
  if (!id) return null;
  return PEER_SECTORS.find((s) => s.id === id.trim().toLowerCase()) ?? null;
}
