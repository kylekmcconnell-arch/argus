// Launch provenance separates observed factory/protocol identity from copyable
// suffix, quote-symbol and venue-label leads. Neither identifies custody of the
// particular pool under review; pool protection requires its own evidence.

import type { TokenDossier } from "../token/audit";
import { dexByToken, pickPair } from "../token/sources";
import type { LaunchProvenance } from "./types";
import { apiFetch } from "./net";

interface Venue {
  name: string;
  chain: "solana" | "evm" | "any";
  chains?: string[]; // restrict to specific EVM chains (dossier.chain values)
  /**
   * The venue's own official web domains, for recognizing the VENUE ITSELF as
   * an audited subject (a launchpad scanned by its X account must never be
   * judged on a native token it does not have). Only domains the venue's docs
   * or a verified probe established; never guessed from the brand name.
   */
  domains?: string[];
  // matchers - ANY hit identifies the venue. NOTE (verified 2026-08-10):
  // DexScreener `labels` are AMM-type only ("v2"/"v3"/"CLMM"...), NEVER
  // launchpad names - launchpads surface via dexId (fourmeme, flapsh, pumpfun),
  // an address vanity suffix (pump / bonk / Clanker's ...b07), or the QUOTE
  // token identity (VIRTUAL, flETH). Pons/Clanker/Virtuals-graduated all read
  // as plain "uniswap", so those need quote/suffix/creator checks.
  mintSuffix?: RegExp;
  dexIds?: string[]; // DexScreener dexId values exclusive to the venue
  onCurveDexIds?: string[]; // dexIds that mean "still on the bonding curve"
  quoteIs?: string[]; // quote-token symbol fingerprint (with a DEX dexId)
  // semantics
  quoteNoteFor?: (quote: string) => string | null;
  lpOnGraduation: LaunchProvenance["lpDisposition"];
  lpNote: string;
  platformPaysCreator: boolean;
  feeNote: string;
  /**
   * What the creator is paid in. "quote" is the pool's quote asset (SOL, ETH,
   * USDG, a tokenized stock); "token" or "mixed" means fee claims hand the
   * creator fresh supply of the launched token, so every claim is a sell
   * decision. Disclosed as a note only; abuse is judged on observed claims.
   * Sources: docs/launchpads/ (read 2026-09-23).
   */
  creatorFeeAsset: NonNullable<LaunchProvenance["creatorFees"]>["asset"];
}

// The venue table. lpOnGraduation/lpNote describe the PLATFORM MECHANISM for a
// completed launch - they are only asserted once we know the token graduated
// (or the venue has no curve phase). Sources: venue docs + live API probes; see
// src/threat/RESEARCH.md.
const VENUES: Venue[] = [
  {
    name: "pump.fun",
    domains: ["pump.fun"],
    chain: "solana",
    mintSuffix: /pump$/,
    // Graduated tokens keep the old pumpfun pair ALONGSIDE the new pumpswap
    // one - graduation state comes from the coins API (.complete), never from
    // "the curve pair is gone".
    dexIds: ["pumpfun", "pumpswap"],
    onCurveDexIds: ["pumpfun"],
    lpOnGraduation: "burned",
    lpNote: "graduation moves liquidity into pump.fun's own AMM (PumpSwap) with the migration LP burned - the creator cannot pull it",
    platformPaysCreator: true,
    feeNote: "pump.fun pays creators a tiered share of trading fees (claimable on-chain), on the curve and after graduation",
    creatorFeeAsset: "quote",
  },
  {
    // bonk.fun / LetsBonk. The bonk suffix is the brand's default but NOT
    // guaranteed; the on-curve dexId is Raydium LaunchLab's shared "launchlab"
    // (also Bankr and Raydium-native launches - see the generic entry below).
    // Suffix match only here.
    name: "bonk.fun",
    domains: ["bonk.fun"],
    chain: "solana",
    mintSuffix: /bonk$/i,
    lpOnGraduation: "burned",
    lpNote: "graduates to Raydium CPMM at 85 SOL raised with ~100% of the migration LP burned (current LetsBonk config)",
    platformPaysCreator: true,
    feeNote: "current LetsBonk config sets the creator fee to 0 - platform fees partly buy BONK; older launches had a creator share",
    creatorFeeAsset: "quote",
  },
  {
    // Raydium LaunchLab family (shared curve program): LetsBonk without the
    // suffix, Bankr, and Raydium-native launches all present as "launchlab" on
    // the curve and plain Raydium CPMM after graduation.
    name: "raydium-launchlab",
    chain: "solana",
    dexIds: ["launchlab"],
    onCurveDexIds: ["launchlab"],
    lpOnGraduation: "locked",
    lpNote: "LaunchLab graduates into Raydium CPMM; migration LP is burned and/or locked per platform config (creator LP, where any, is a locked fee-rights NFT - principal can't be pulled)",
    platformPaysCreator: true,
    feeNote: "creator fee share is per-platform (Bankr pays 50% of the 1% trade fee; current LetsBonk pays 0)",
    creatorFeeAsset: "quote",
  },
  {
    name: "bags",
    chain: "solana",
    mintSuffix: /BAGS$/,
    dexIds: ["bags"],
    onCurveDexIds: ["bags"],
    lpOnGraduation: "locked",
    lpNote: "Bags curves on Meteora DBC and graduates into Meteora DAMM v2 with the LP locked - creators claim fees on the locked position, not principal",
    platformPaysCreator: true,
    feeNote: "~1% of trading volume routed to the creator (and any fee-shared X account) in perpetuity, via the Bags fee-share program",
    creatorFeeAsset: "quote",
  },
  {
    name: "moonit",
    chain: "solana",
    dexIds: ["moonit"],
    onCurveDexIds: ["moonit"],
    lpOnGraduation: "locked",
    lpNote: "Moonit (DexScreener's launchpad, ex-Moonshot) migrates graduated liquidity into platform-managed Meteora/Raydium pools",
    platformPaysCreator: false,
    feeNote: "no standing creator fee stream",
    creatorFeeAsset: "none",
  },
  {
    // Generic Meteora DBC curve dexId: Believe and other DBC launchpads (Bags
    // has its own dexId and matches above).
    name: "meteora-dbc launchpad",
    chain: "solana",
    dexIds: ["meteoradbc"],
    onCurveDexIds: ["meteoradbc"],
    lpOnGraduation: "locked",
    lpNote: "Meteora DBC curve; graduates into a locked DAMM v2 position (fee-claim-only, principal locked)",
    platformPaysCreator: true,
    feeNote: "DBC platforms typically split trading fees with the creator (Believe: 50/50), claimed via the DBC program",
    creatorFeeAsset: "quote",
  },
  {
    name: "boop",
    chain: "solana",
    mintSuffix: /boop$/,
    lpOnGraduation: "locked",
    lpNote: "Boop graduates (~400 SOL mcap) into a platform-managed Raydium pool; the platform is largely dormant in 2026",
    platformPaysCreator: true,
    feeNote: "post-graduation fees distributed to BOOP stakers with a creator cut",
    creatorFeeAsset: "quote",
  },
  {
    name: "virtuals",
    chain: "evm",
    chains: ["base", "robinhood"],
    // Bonding-phase Virtuals tokens are INVISIBLE on DexScreener (verified) -
    // if we can see a pair at all, it graduated. The graduated fingerprint is a
    // Uniswap v2 pool QUOTED IN VIRTUAL.
    dexIds: [],
    quoteIs: ["VIRTUAL"],
    quoteNoteFor: (q) => q === "VIRTUAL" ? "quoted in VIRTUAL - its dollar value depends on both the token/VIRTUAL exchange rate and VIRTUAL's price; this does not establish a price floor" : null,
    lpOnGraduation: "locked",
    lpNote: "Virtuals auto-stakes graduated LP under a 10-year lock (the pool's LP majority sits in a 'Staked ... by Virtuals' contract) - not creator-pullable",
    platformPaysCreator: true,
    feeNote: "1% trading fee routed to fund the agent/creator (inference budget), not a claimable LP-fee stream",
    creatorFeeAsset: "quote",
  },
  {
    name: "flaunch",
    chain: "evm",
    chains: ["base", "robinhood"],
    // flETH-quoted Uniswap v4 pool = Flaunch (verified on both chains).
    quoteIs: ["flETH"],
    lpOnGraduation: "protocol-owned",
    lpNote: "Flaunch LP is managed by the protocol's v4 hook and cannot be extracted; a fee share feeds an automated buyback wall",
    platformPaysCreator: true,
    feeNote: "creator revenue share is configurable 0-100% of trading fees (paid in flETH) - a high creator cut is by-design here, not a red flag",
    creatorFeeAsset: "quote",
  },
  {
    name: "clanker",
    domains: ["clanker.world"],
    chain: "evm",
    chains: ["base", "robinhood"],
    // Clanker v4 deployments carry a vanity address suffix ...b07 (verified).
    // Bankr(bot) launches are Clanker deployments under the hood.
    mintSuffix: /b07$/i,
    lpOnGraduation: "locked",
    lpNote: "full supply is pooled at deploy and the LP position is held by Clanker's locker; trading fees stream to the configured recipients",
    platformPaysCreator: true,
    feeNote: "1% pool fee split to configured recipients (deployer/interface e.g. Bankr) - claimable by the fee admin",
    creatorFeeAsset: "mixed",
  },
  {
    // Bankr on Base/Robinhood runs on Doppler protocol (post-Clanker era,
    // 2026-02-10 onward). Doppler-era Bankr tokens carry the vanity suffix
    // ...ba3 on both chains (verified on musebook, Agrippa, museic, Nautilo,
    // Euler and GME on Robinhood, 2026-09-23); tokens without it are resolved
    // server-side via Bankr's public per-token API. Custody verified on-chain
    // ($KUPO): the entire supply pools into a Uniswap V4 multicurve position
    // held book-entry INSIDE the Doppler initializer/hook - no position NFT
    // exists, exitLiquidity() is structurally unreachable (pool locked at
    // creation), and neither creator nor Bankr can pull liquidity or change
    // the fee schedule.
    name: "bankr",
    domains: ["bankr.bot"],
    chain: "evm",
    chains: ["base", "robinhood"],
    mintSuffix: /ba3$/i,
    lpOnGraduation: "locked",
    lpNote: "liquidity is locked book-entry inside Doppler's V4 multicurve initializer - no position NFT, no unlock path; creator and platform can only collect fees, never principal",
    platformPaysCreator: true,
    feeNote: "1.75% all-in swap fee: creator 0.665%, LP leg 0.285% compounding into the locked position, Bankr 0.475%, BNKR buyback 0.2375%, Doppler ~0.09%; the launch fee starts at 80% and decays to that over ~10 seconds. Creator fees arrive as a mix of the launched token and the quote unless the launch opted into quote-only, plus an optional 15% premint (1yr vest, 30-day cliff) - watch the creator's claim wallet (docs/launchpads/bankr.md)",
    creatorFeeAsset: "mixed",
  },
  {
    name: "pons",
    domains: ["ponsfamily.com"],
    chain: "evm",
    chains: ["robinhood"],
    // Pons v2 (the only generation still launching): bonding curve into a
    // Uniswap v4 pool under the Pons MemeHook, which reads as plain uniswap
    // on DexScreener - detection is the token's CREATOR contract (the v2
    // LaunchDeployer), checked server-side in /api/launch via Blockscout.
    dexIds: [],
    lpOnGraduation: "locked",
    lpNote: "the curve sells 71.4% of supply and graduation seeds a single full-range Uniswap v4 position with the reserved 28.6% plus everything the curve raised, minted straight into the Pons LaunchLocker - permanent custody with no withdraw function, and any leftover supply is locked there too (docs v2, read 2026-09-23)",
    platformPaysCreator: true,
    feeNote: "1% base fee on the curve and the pool split 30% protocol / 70% creator, plus an optional creator tax of up to 10% that goes entirely to the creator, all denominated in the quote asset (ETH, USDG or the paired stock) and claimed from the FeeEscrow. The anti-snipe is a buy-side tax that opens at 99% and decays to zero over the first five seconds, with the creator's own launch-and-buy exempt - so a creator can still be first in. Watch the claim cadence and where the claimed quote goes (docs/launchpads/pons.md)",
    creatorFeeAsset: "quote",
  },
  {
    // Pons v1 (2026-07-13 to 2026-09-10; launching now disabled). Fixed
    // supply straight into a locked Uniswap V3 pool, no curve. Its 1% pool
    // fee accrued in BOTH the token and WETH inside the locked position, and
    // the creator's share was paid out in kind - the origin of the in-token
    // creator fee farms indexed in cabals.ts (wire bot, LEMON, MOTION).
    // Server-only: resolved from the v1 factory addresses.
    name: "pons v1",
    chain: "evm",
    chains: ["robinhood"],
    dexIds: [],
    lpOnGraduation: "locked",
    lpNote: "the V3 position was transferred to the PonsLaunchLocker at launch - permanent custody, no unlock path for principal (verified on MOTION, position 232213)",
    platformPaysCreator: true,
    feeNote: "1% V3 pool fee split 70% creator / 30% protocol (90/10 on the legacy factory), accrued in both the token and WETH and paid to the creator in kind through the locker - MOTION's deployer received 85 such payments. A creator who forwards the token leg to fresh wallets that sell is the wire bot / LEMON pattern (docs/launchpads/pons.md)",
    creatorFeeAsset: "mixed",
  },
  {
    // LONG (app.long.xyz) on Robinhood Chain: an integrator on Whetstone's
    // Doppler protocol, launching straight into a Uniswap v4 pool quoted in a
    // Robinhood Stock Token, ETH, USDG or $AI. The trusted token factory mines
    // every address to end in ...1e18 (verified on AI, MEME, TAIWAN, MONITOR,
    // BONER; 56,242 such tokens by 2026-09-23). LongLauncher v1
    // 0x22e99278... (paused) and v2 0x1eEF016F....
    name: "long",
    domains: ["long.xyz", "app.long.xyz"],
    chain: "evm",
    chains: ["robinhood"],
    mintSuffix: /1e18$/i,
    lpOnGraduation: "locked",
    lpNote: "no curve phase: the full supply is pooled into a Uniswap v4 multicurve position held book-entry inside Doppler's initializer in the creation tx - no position NFT, no unlock path, no migration; the creator's rights are fee claims only",
    platformPaysCreator: true,
    feeNote: "the Rehype hook opens at an 80% swap fee decaying to 1.12% over ten seconds and routes 71-100% of that hook fee to LONG's own wallet; the creator is a 95% beneficiary of only the 0.1-0.2% Uniswap LP fee, paid in BOTH pool tokens through the initializer's collectFees - so every creator claim is part launched-token, and the observed pattern is to forward it to fresh wallets and sell (TAIWAN, MEME). Watch the claim cadence and the one-hop destinations (docs/launchpads/long.md)",
    creatorFeeAsset: "mixed",
  },
  {
    // Any other Doppler-protocol integrator on Base/Robinhood: same Airlock,
    // token factory and initializer as LONG and Bankr, no client fingerprint.
    // Server-only: resolved from the Doppler token factory as the creating
    // contract. Custody and fee-asset mechanics are the protocol's, not the
    // integrator's, so they hold here too.
    name: "doppler",
    chain: "evm",
    chains: ["base", "robinhood"],
    dexIds: [],
    lpOnGraduation: "locked",
    lpNote: "Doppler protocol launch: the full supply sits in a Uniswap v4 position held book-entry inside the DopplerHookInitializer - no position NFT, no unlock path, no migration",
    platformPaysCreator: true,
    feeNote: "Doppler pays the pool's fee beneficiaries (the creator, 95% by default) in both pool tokens via collectFees on the initializer; the integrator's own hook fee and split are set per launch",
    creatorFeeAsset: "mixed",
  },
  {
    // StonkBrokers (stonkbrokers.cash) on Robinhood Chain: one Smart Launch
    // V2 pad per quote asset (WETH, STONKBROKER, USDG, GME, NVDA, AAPL, SPCX,
    // USO, yBTC) with a virtual-reserve curve, bonding into a permanently
    // locked Uniswap V3 / Slipstream position in the Safety Deposit Box.
    // Server-only: resolved from the pad addresses as the creating contract.
    name: "stonkbrokers",
    domains: ["stonkbrokers.cash", "stonkbrokers.io", "stonkbrokers.wtf"],
    chain: "evm",
    chains: ["robinhood"],
    dexIds: [],
    lpOnGraduation: "locked",
    lpNote: "at bond the raise plus a 50% fee reserve mint a full-range position straight into the Safety Deposit Box as a permanent lock; the lock NFT only collects fees (80% to the creator) and principal is never withdrawable",
    platformPaysCreator: true,
    feeNote: "every curve tax splits 16.5% creator / 16.5% protocol / 16.5% StockBooster / 0.5% referral / 50% LP reserve, paid in the lane's quote asset; anti-snipe modes open at up to 99% tax decaying 1% per minute, which in the v1 era taxed launch buyers 85.8% on WALL. Creator keeps up to 50% of supply unlocked unless vested - read the team-overhang badge (docs/launchpads/stonkbrokers.md)",
    creatorFeeAsset: "quote",
  },
  {
    // o1 Launchpad (o1.exchange): one launchpad-v4-minimal suite on Base,
    // Robinhood Chain, Monad and Arc. No bonding curve - the creation tx pools
    // the full supply into a Uniswap v4 pool under the o1 launch hook, quoted
    // in ETH, USDC/USDG or a tokenized stock, so the pool reads as plain
    // uniswap on DexScreener. Robinhood tokens are resolved server-side from
    // the creating contract (/api/launch, current and historical o1 factories).
    // Base tokens are native B20 assets (system addresses 0xb20000..., no
    // creator on Blockscout); the 0xb2 prefix marks the B20 standard, not o1,
    // so there is no client fingerprint yet on Base. Verified on $WRESTLER
    // (Robinhood, 2026-09-14) and $BRAINARM (Base, 2026-09-16); see RESEARCH.md.
    name: "o1",
    domains: ["o1.exchange"],
    chain: "evm",
    chains: ["base", "robinhood"],
    dexIds: [],
    lpOnGraduation: "locked",
    lpNote: "no curve phase: the full supply is pooled into a Uniswap v4 pool under the o1 launch hook in the creation tx and o1 documents the liquidity as permanent - creator rights are fee claims only, so an LP-pull is not the exit path here; the deployer's optional atomic Dev Buy and the 20-second anti-snipe window are the launch-block variables to read",
    platformPaysCreator: true,
    feeNote: "1% per swap split creator 50 bps / platform 30 bps / referrer 20 bps, claimed from the suite's Fee Escrow (claimFor) as ETH or the quote asset; a creator who sets their own address as referrer takes 70 bps of every trade. Watch the claim cadence and where the claimed ETH goes - $BRAINARM's creator claimed 1.68 ETH in 10 claims over 26 hours and parked it as USDC in two fresh wallets (RESEARCH.md, o1 Launchpad)",
    creatorFeeAsset: "quote",
  },
  {
    name: "four.meme",
    domains: ["four.meme"],
    chain: "evm",
    chains: ["bsc"],
    dexIds: ["fourmeme"],
    onCurveDexIds: ["fourmeme"],
    lpOnGraduation: "burned",
    lpNote: "graduates to PancakeSwap V2 with the LP tokens burned by the platform",
    platformPaysCreator: false,
    feeNote: "no ongoing creator fee stream",
    creatorFeeAsset: "none",
  },
  {
    name: "flap.sh",
    domains: ["flap.sh"],
    chain: "evm",
    chains: ["bsc", "robinhood"],
    dexIds: ["flapsh"],
    onCurveDexIds: ["flapsh"],
    lpOnGraduation: "protocol-owned",
    lpNote: "bonding curve migrates into a platform-created pool on fill; supports tax tokens and tokenized-stock dividend vaults by design",
    platformPaysCreator: true,
    feeNote: "platform fee model; tax-token launches are expected here - a token-level tax is not automatically a rug signal on flap.sh",
    creatorFeeAsset: "unknown",
  },
];

interface LaunchApiResponse {
  creatorVenue?: string;
  description?: string | null;
  snipe?: LaunchProvenance["snipe"];
  pumpfun?: { complete?: boolean; curvePct?: number | null };
  // Server-side read of the creator's fee claims on venues that pay in the
  // launched token (Doppler integrators, Pons v1): how many claims, how much,
  // and what the claimer did with it. See api/launch.ts creatorFeeUsage.
  creatorFees?: {
    evidence?: "transfer-only" | "verified-events";
    claimer: string | null;
    claimCount: number;
    claimedTokens: number;
    soldTokens: number | null;
    burnedTokens: number;
    boughtBackTokens: number | null;
    heldTokens: number | null;
    usage: NonNullable<LaunchProvenance["creatorFees"]>["usage"];
    note: string;
    quoteClaims?: { count: number; eth: number; tokenPayouts: number } | null;
  } | null;
}

async function fromApi(chain: string, address: string, pairAddress?: string, symbol?: string): Promise<LaunchApiResponse | null> {
  try {
    // The audited pool's address lets the snipe trace identify the pool
    // directly instead of guessing it from transfer fan-out (a pre-pool
    // airdrop from the deployer otherwise reads as the pool).
    const pair = pairAddress && /^0x[0-9a-f]{40}$/i.test(pairAddress) ? `&pair=${encodeURIComponent(pairAddress.toLowerCase())}` : "";
    const sym = symbol && /^[A-Za-z0-9_$.-]{1,16}$/.test(symbol) ? `&symbol=${encodeURIComponent(symbol)}` : "";
    const r = await apiFetch(`/api/launch?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}${pair}${sym}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const value: unknown = await r.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as LaunchApiResponse
      : null;
  } catch {
    return null;
  }
}

// Exported for tests: pure venue matching over (chain, mint, dexId, quote).
export function matchVenue(chain: string, address: string, dexId: string, quote: string | null): Venue | null {
  const sol = chain === "solana";
  return VENUES.find((v) =>
    (v.chain === "any" || (v.chain === "solana") === sol)
    && (!v.chains || v.chains.includes(chain))
    && ((v.mintSuffix?.test(address) ?? false)
      || ((v.dexIds?.length ?? 0) > 0 && v.dexIds!.includes(dexId))
      || (quote != null && (v.quoteIs?.includes(quote) ?? false))),
  ) ?? null;
}

/** Vanity suffixes and quote symbols are copyable: keep them as leads, not provenance. */
export function resolveVenueEvidence(chain: string, address: string, dexId: string, quote: string | null, api: LaunchApiResponse | null) {
  const candidate = matchVenue(chain, address, dexId, quote);
  const factory = api?.creatorVenue ? VENUES.find(v => v.name === api.creatorVenue && (!v.chains || v.chains.includes(chain)) && (v.chain === "any" || (v.chain === "solana") === (chain === "solana"))) : null;
  const pump = chain === "solana" && typeof api?.pumpfun?.complete === "boolean" ? VENUES.find(v => v.name === "pump.fun") : null;
  const confirmed = factory ?? pump ?? null;
  const attribution: NonNullable<LaunchProvenance["attribution"]> = {
    state: confirmed ? "confirmed" : candidate ? "candidate" : "unresolved",
    basis: factory ? "Server-observed creator/factory or protocol announcement attribution." : pump ? "Token-specific pump.fun record." : candidate ? "Copyable address suffix, quote symbol or trading-venue label only; launch provenance is unconfirmed." : "No corroborated launch origin was collected. A DEX listing alone does not establish a fair launch.",
    candidate: candidate?.name ?? null,
  };
  return { venue: confirmed, attribution };
}

/**
 * The venue itself, as an auditable subject. A launchpad scanned by its own X
 * account must never be judged on a native token it does not have; what it CAN
 * be judged on is the launch mechanics it imposes on every token it releases
 * (who holds LP, who gets fees). This projection exposes exactly those fields.
 */
export interface LaunchVenueProfile {
  name: string;
  matchedDomain: string;
  chains: string[];
  lpDisposition: LaunchProvenance["lpDisposition"];
  lpNote: string;
  platformPaysCreator: boolean;
  feeNote: string;
}

/**
 * Recognize an audited subject as a launch venue by its verified official
 * domain. Only exact apex agreement with a venue's documented domain binds;
 * brand-name similarity never does.
 */
export function launchVenueForOfficialDomain(officialDomain: string): LaunchVenueProfile | null {
  const apex = officialDomain.trim().toLowerCase().replace(/^www\./, "");
  if (!apex) return null;
  for (const venue of VENUES) {
    const matched = venue.domains?.find((domain) => domain === apex);
    if (!matched) continue;
    return {
      name: venue.name,
      matchedDomain: matched,
      chains: venue.chain === "solana" ? ["solana"] : venue.chains ?? [],
      lpDisposition: venue.lpOnGraduation,
      lpNote: venue.lpNote,
      platformPaysCreator: venue.platformPaysCreator,
      feeNote: venue.feeNote,
    };
  }
  return null;
}

/** Venue names for backer classification: a backer named like a launch venue is a launchpad, not a fund. */
export function launchVenueNames(): string[] {
  return VENUES.map((venue) => venue.name);
}

/**
 * The fee-asset disclosure. A venue that pays its creators in the launched
 * token is a fact about the venue: every claim hands the creator fresh supply
 * and a sell decision. It is stated as a note and never scored; the scan
 * scores only what the claimer is observed doing with it.
 */
export function creatorFeeAssetNote(venue: string, asset: NonNullable<LaunchProvenance["creatorFees"]>["asset"], quote: string | null): string | null {
  if (asset === "token") return `Creator rewards on ${venue} are paid in the token itself - each claim is new supply in the creator's hands. That is how the venue works, not a finding; the finding is what the creator does with the claims.`;
  if (asset === "mixed") return `Creator rewards on ${venue} arrive as a mix of the token and ${quote ?? "the quote asset"} - each claim carries a token leg the creator can sell. That is how the venue works, not a finding; the finding is what the creator does with the claims.`;
  return null;
}

// Quote-asset ramifications that hold regardless of venue.
export function genericQuoteNote(quote: string, _sol: boolean): string | null {
  const q = quote.toUpperCase();
  if (["USDC", "USDT", "USDG", "USD1", "DAI"].includes(q)) {
    return `quoted in ${q} - a stable quote currency and a dollar-denominated quote, subject to the quote asset's peg risk. This is not a token price floor or redemption guarantee`;
  }
  if (["SOL", "WSOL", "WETH", "ETH", "WBNB", "BNB"].includes(q)) return null; // the default; nothing remarkable
  return `quoted in ${quote} - another volatile token; dollar value depends on both prices. The pairing does not establish a price floor`;
}

export async function launchProvenance(d: TokenDossier): Promise<LaunchProvenance | null> {
  const sol = d.chain === "solana";
  try {
    // The pair we audited: dexId is on the dossier; the quote symbol needs a
    // (cheap, keyless) DexScreener re-read.
    // Same-chain only: a token at one address on several chains must not have
    // its quote asset and venue read from another chain's deepest pool.
    const pair = pickPair((await dexByToken(d.address).catch(() => [])).filter((p) => p.chainId === d.chain), d.address);
    const quote = pair?.quoteToken?.symbol ?? null;
    const dexId = (d.dexId || pair?.dexId || "").toLowerCase();

    const api = await fromApi(d.chain, d.address, d.pairAddress, d.symbol);
    const { venue, attribution } = resolveVenueEvidence(d.chain, d.address, dexId, quote, api);

    const out: LaunchProvenance = {
      kind: venue ? "launchpad" : "unknown",
      attribution,
      venue: venue?.name ?? null,
      onCurve: null,
      graduated: null,
      curveProgressPct: null,
      quote,
      quoteNote: null,
      lpDisposition: "unknown",
      lpNote: null,
      creatorFees: null,
      description: api && typeof api.description === "string" && api.description.trim() ? api.description.trim().slice(0, 600) : null,
      snipe: api?.snipe ?? null,
      notes: [],
    };

    if (venue) {
      const onCurve = venue.onCurveDexIds?.includes(dexId) ?? false;
      // Venue API state beats the dexId inference when we have it.
      const pf = api?.pumpfun;
      out.onCurve = pf ? !pf.complete : onCurve;
      out.graduated = pf ? !!pf.complete : (venue.onCurveDexIds ? !onCurve : null);
      out.curveProgressPct = pf?.curvePct ?? null;
      if (out.onCurve) {
        out.lpDisposition = "curve";
        out.lpNote = "no LP yet - the bonding curve contract IS the market; the pool only exists after graduation";
      } else if (out.graduated !== false) {
        // Factory identity does not prove custody of the particular audited pool.
        out.lpDisposition = "unknown";
        out.lpNote = `Venue documentation describes: ${venue.lpNote}. Custody and withdrawal rights of this specific pool were not verified by this attribution check.`;
      }
      out.creatorFees = {
        platformPays: venue.platformPaysCreator,
        asset: venue.creatorFeeAsset,
        claimCount: null,
        claimedUsd: null,
        claimedTokens: null,
        usage: "unknown",
        note: venue.feeNote,
      };
      // The server's claim trace, when it ran: observed conduct beats the
      // venue's default. A venue that pays in the token is a note; a creator
      // who keeps claiming and selling it is the warning.
      const cf = api?.creatorFees;
      if (cf?.quoteClaims) {
        // Quote-asset venue (Pons v2): claims are ETH or the quote token, read
        // from the creator's own feeds; conduct is buyback / hold / moved on.
        out.creatorFees.quoteClaims = cf.quoteClaims;
        out.creatorFees.claimCount = cf.quoteClaims.count;
        out.creatorFees.usage = cf.usage;
        out.creatorFees.note = `${cf.note} ${venue.feeNote}`;
      } else if (cf?.evidence === "transfer-only") {
        out.creatorFees.note = `${cf.note} ${venue.feeNote}`;
      } else if (cf?.evidence === "verified-events" && cf.claimCount > 0) {
        out.creatorFees.claimCount = cf.claimCount;
        out.creatorFees.claimedTokens = cf.claimedTokens;
        out.creatorFees.claimedUsd = d.priceUsd != null && Number.isFinite(d.priceUsd) ? cf.claimedTokens * d.priceUsd : null;
        out.creatorFees.usage = cf.usage;
        out.creatorFees.note = `${cf.note} ${venue.feeNote}`;
      }
      out.quoteNote = (quote && venue.quoteNoteFor?.(quote)) || (quote ? genericQuoteNote(quote, sol) : null);
      const feeAssetNote = creatorFeeAssetNote(venue.name, venue.creatorFeeAsset, quote);
      if (feeAssetNote) out.notes.push(feeAssetNote);
    } else {
      out.quoteNote = quote ? genericQuoteNote(quote, sol) : null;
      out.notes.push(attribution.candidate ? `Possible ${attribution.candidate} origin. ${attribution.basis}` : attribution.basis);
    }
    // Exchange-era debut: a token trading on several CEXs may not have "launched"
    // on a DEX at all - it may have debuted via an exchange listing or a sale
    // round (CoinList/Binance Launchpad-style). Those launches carry investor
    // vesting and supply-unlock schedules that no on-chain pool read will show.
    const cex = d.cg?.cexCount ?? 0;
    if (cex >= 3 && out.kind !== "launchpad") {
      out.notes.push(`Trades on ${cex} centralized exchanges - if the market debut was an exchange listing or a sale round (CoinList / Binance Launchpad style), early-investor vesting and supply unlocks may apply; verify the sale rounds and unlock schedule in the project's official disclosures and reputable market records.`);
    }

    return out;
  } catch {
    return null;
  }
}
