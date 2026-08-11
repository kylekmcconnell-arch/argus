// Launch provenance: HOW the token came to market. Fair launch (DIY on a DEX)
// vs a launchpad - and if a launchpad, whether the bonding curve completed,
// what the curve/pool is bonded to, what the venue does with LP on graduation
// (the rug crux: a pump.fun graduate's pool is protocol-owned - "lock
// unconfirmed" is a false alarm there), and whether the platform pays the
// creator ongoing fees (in which case what the creator DOES with them is a
// first-class signal - LP adds / buyback-burns are bullish, dumping is not).
//
// Detection is layered: mint-address vanity suffix -> DexScreener dexId/labels
// -> venue API state (via /api/launch, server-proxied). Every layer degrades
// to null rather than guessing.

import type { TokenDossier } from "../token/audit";
import { dexByToken, pickPair } from "../token/sources";
import type { LaunchProvenance } from "./types";
import { apiFetch } from "./net";

interface Venue {
  name: string;
  chain: "solana" | "evm" | "any";
  chains?: string[]; // restrict to specific EVM chains (dossier.chain values)
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
}

// The venue table. lpOnGraduation/lpNote describe the PLATFORM MECHANISM for a
// completed launch - they are only asserted once we know the token graduated
// (or the venue has no curve phase). Sources: venue docs + live API probes; see
// src/threat/RESEARCH.md.
const VENUES: Venue[] = [
  {
    name: "pump.fun",
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
  },
  {
    // bonk.fun / LetsBonk. The bonk suffix is the brand's default but NOT
    // guaranteed; the on-curve dexId is Raydium LaunchLab's shared "launchlab"
    // (also Bankr and Raydium-native launches - see the generic entry below).
    // Suffix match only here.
    name: "bonk.fun",
    chain: "solana",
    mintSuffix: /bonk$/i,
    lpOnGraduation: "burned",
    lpNote: "graduates to Raydium CPMM at 85 SOL raised with ~100% of the migration LP burned (current LetsBonk config)",
    platformPaysCreator: true,
    feeNote: "current LetsBonk config sets the creator fee to 0 - platform fees partly buy BONK; older launches had a creator share",
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
  },
  {
    name: "boop",
    chain: "solana",
    mintSuffix: /boop$/,
    lpOnGraduation: "locked",
    lpNote: "Boop graduates (~400 SOL mcap) into a platform-managed Raydium pool; the platform is largely dormant in 2026",
    platformPaysCreator: true,
    feeNote: "post-graduation fees distributed to BOOP stakers with a creator cut",
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
    quoteNoteFor: (q) => q === "VIRTUAL" ? "bonded to VIRTUAL - the floor is denominated in the Virtuals protocol token, so this token carries VIRTUAL's beta on top of its own" : null,
    lpOnGraduation: "locked",
    lpNote: "Virtuals auto-stakes graduated LP under a 10-year lock (the pool's LP majority sits in a 'Staked ... by Virtuals' contract) - not creator-pullable",
    platformPaysCreator: true,
    feeNote: "1% trading fee routed to fund the agent/creator (inference budget), not a claimable LP-fee stream",
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
  },
  {
    name: "clanker",
    chain: "evm",
    chains: ["base", "robinhood"],
    // Clanker v4 deployments carry a vanity address suffix ...b07 (verified).
    // Bankr(bot) launches are Clanker deployments under the hood.
    mintSuffix: /b07$/i,
    lpOnGraduation: "locked",
    lpNote: "full supply is pooled at deploy and the LP position is held by Clanker's locker; trading fees stream to the configured recipients",
    platformPaysCreator: true,
    feeNote: "1% pool fee split to configured recipients (deployer/interface e.g. Bankr) - claimable by the fee admin",
  },
  {
    // Bankr on Base/Robinhood runs on Doppler protocol (post-Clanker era). No
    // client fingerprint (no suffix, per-user 4337 deployer wallets) - resolved
    // server-side via Bankr's public per-token API. Custody verified on-chain
    // ($KUPO): the entire supply pools into a Uniswap V4 multicurve position
    // held book-entry INSIDE the Doppler initializer/hook - no position NFT
    // exists, exitLiquidity() is structurally unreachable (pool locked at
    // creation), and neither creator nor Bankr can pull liquidity or change
    // the fee schedule.
    name: "bankr",
    chain: "evm",
    chains: ["base", "robinhood"],
    lpOnGraduation: "locked",
    lpNote: "liquidity is locked book-entry inside Doppler's V4 multicurve initializer - no position NFT, no unlock path; creator and platform can only collect fees, never principal",
    platformPaysCreator: true,
    feeNote: "0.7% pool fee split 95% creator / 5% Doppler, streamed forever; watch the creator's fee-claim wallet for dumping, and the optional premint (up to 15%, 1yr vest, 30-day cliff)",
  },
  {
    name: "pons",
    chain: "evm",
    chains: ["robinhood"],
    // Pons pools read as plain uniswap v3/WETH on DexScreener - detection is
    // the token's CREATOR contract (PonsLaunchFactory), checked server-side in
    // /api/launch via Blockscout. No client-side fingerprint exists.
    dexIds: [],
    lpOnGraduation: "locked",
    lpNote: "the liquidity position is transferred to the Pons launch locker at launch (PonsLaunchLocker on v1, PonsV2LaunchLocker on v2) - permanent custody, no unlock path for principal",
    platformPaysCreator: true,
    feeNote: "1% pool fee split ~70% creator / 30% protocol, accruing inside the locked position; the creator claims through the locker",
  },
  {
    name: "four.meme",
    chain: "evm",
    chains: ["bsc"],
    dexIds: ["fourmeme"],
    onCurveDexIds: ["fourmeme"],
    lpOnGraduation: "burned",
    lpNote: "graduates to PancakeSwap V2 with the LP tokens burned by the platform",
    platformPaysCreator: false,
    feeNote: "no ongoing creator fee stream",
  },
  {
    name: "flap.sh",
    chain: "evm",
    chains: ["bsc", "robinhood"],
    dexIds: ["flapsh"],
    onCurveDexIds: ["flapsh"],
    lpOnGraduation: "protocol-owned",
    lpNote: "bonding curve migrates into a platform-created pool on fill; supports tax tokens and tokenized-stock dividend vaults by design",
    platformPaysCreator: true,
    feeNote: "platform fee model; tax-token launches are expected here - a token-level tax is not automatically a rug signal on flap.sh",
  },
];

async function fromApi(chain: string, address: string): Promise<any | null> {
  try {
    const r = await apiFetch(`/api/launch?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return (await r.json()) as any;
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

// Quote-asset ramifications that hold regardless of venue.
export function genericQuoteNote(quote: string, sol: boolean): string | null {
  const q = quote.toUpperCase();
  if (["USDC", "USDT", "USDG", "USD1", "DAI"].includes(q)) {
    return `bonded to ${q} - a stable quote: the pool's floor is dollar-denominated rather than riding ${sol ? "SOL" : "the gas token"}`;
  }
  if (["SOL", "WSOL", "WETH", "ETH", "WBNB", "BNB"].includes(q)) return null; // the default; nothing remarkable
  return `bonded to ${quote} - the floor is denominated in another volatile token, so this token carries ${quote}'s risk on top of its own`;
}

export async function launchProvenance(d: TokenDossier): Promise<LaunchProvenance | null> {
  const sol = d.chain === "solana";
  try {
    // The pair we audited: dexId is on the dossier; the quote symbol needs a
    // (cheap, keyless) DexScreener re-read.
    const pair = pickPair(await dexByToken(d.address).catch(() => []), d.address);
    const quote = pair?.quoteToken?.symbol ?? null;
    const dexId = (d.dexId || pair?.dexId || "").toLowerCase();

    const api = await fromApi(d.chain, d.address);
    // Client fingerprints first; the server's creator-contract check (Blockscout)
    // catches the venues that leave no client-visible trace (Pons reads as plain
    // uniswap/WETH - only the token's creator address gives it away).
    let venue = matchVenue(d.chain, d.address, dexId, quote);
    if (!venue && api?.creatorVenue) venue = VENUES.find((v) => v.name === api.creatorVenue) ?? null;

    const out: LaunchProvenance = {
      kind: venue ? "launchpad" : dexId ? "fair-launch" : "unknown",
      venue: venue?.name ?? null,
      onCurve: null,
      graduated: null,
      curveProgressPct: null,
      quote,
      quoteNote: null,
      lpDisposition: "unknown",
      lpNote: null,
      creatorFees: null,
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
        out.lpDisposition = venue.lpOnGraduation;
        out.lpNote = venue.lpNote;
      }
      out.creatorFees = {
        platformPays: venue.platformPaysCreator,
        claimCount: null,
        claimedUsd: null,
        usage: "unknown",
        note: venue.feeNote,
      };
      out.quoteNote = (quote && venue.quoteNoteFor?.(quote)) || (quote ? genericQuoteNote(quote, sol) : null);
    } else if (out.kind === "fair-launch") {
      out.quoteNote = quote ? genericQuoteNote(quote, sol) : null;
      out.notes.push("No launchpad signature (mint suffix, dexId, quote) - launched directly on the DEX.");
    }
    // Exchange-era debut: a token trading on several CEXs may not have "launched"
    // on a DEX at all - it may have debuted via an exchange listing or a sale
    // round (CoinList/Binance Launchpad-style). Those launches carry investor
    // vesting and supply-unlock schedules that no on-chain pool read will show.
    const cex = d.cg?.cexCount ?? 0;
    if (cex >= 3 && out.kind !== "launchpad") {
      out.notes.push(`Trades on ${cex} centralized exchanges - if the market debut was an exchange listing or a sale round (CoinList / Binance Launchpad style), early-investor vesting and supply unlocks apply; cross-check the sale rounds and unlock schedule on cryptorank.io (also CoinGecko/CoinMarketCap token pages).`);
    }

    return out;
  } catch {
    return null;
  }
}
