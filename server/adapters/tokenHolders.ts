// Float control and contract control for a PROJECT's verified canonical token:
// who holds the supply, whether the DEX liquidity can walk away, and what the
// contract's controller can still do to holders. The token-scan pipeline already
// computes this from GoPlus (free, keyless); project reports never did, leaving
// the reader's "is the float insider-controlled / can the LP be pulled / who can
// still mint or pause this?" question unanswered. This mirrors src/token/audit.ts
// semantics exactly (percent strings are fractions of supply; LP burned-or-locked
// classification; the same claim sentences for the same GoPlus flags) so both
// report surfaces agree. Disclosure data only: it mints checkable tokenomics
// facts and never a score floor or a rug verdict on its own.
import {
  GOPLUS_CHAIN,
  GOPLUS_UNSORTED_HOLDER_CHAINS,
  blockscoutHolderSourceUrl,
  blockscoutHolders,
  goplus,
  type GoPlusSecurity,
} from "../../src/token/sources";
import { recordCall } from "../cost";
import { captureTimestamp } from "../captureTime";

/**
 * One GoPlus contract-control or deployer-history flag, already worded. The
 * sentence lives here rather than downstream so the projection and the report
 * cannot reword a provider flag into something the provider did not say.
 */
export interface ContractControlFlag {
  /** stable id for downstream grouping; never shown to the reader */
  key: string;
  claim: string;
  tone: "warn" | "bad";
  source: "goplus";
}

export interface HolderProfile {
  /** Exact canonical token identity passed into this collector. */
  binding: {
    canonicalAddress: string;
    chain: string;
    method: "canonical_token_address_chain";
  };
  /** largest single WALLET, percent of supply; null when the distribution is unusable. Pools, contracts and locked addresses are excluded, so this is not the largest address on the register. */
  topHolderPct: number | null;
  /** Combined share for up to ten usable wallets, percent of supply. Read the count and floor fields before naming it a top-ten total. */
  top10Pct: number | null;
  /** Number of usable wallet rows included in top10Pct. At most ten. */
  assessedWalletCount: number | null;
  /** True when top10Pct covers fewer than ten usable wallet rows. */
  top10PctIsFloor: boolean;
  holderCount: number | null;
  /** DEX liquidity burned or verifiably locked, percent; null when GoPlus reports no usable LP register */
  lpLockedOrBurnedPct: number | null;
  /**
   * Whether the holder distribution was usable at all. False means topHolderPct
   * and top10Pct are suppressed, NOT that concentration is low: the register was
   * unordered on this chain, self-inconsistent, or absent. Same meaning as
   * TokenDossier.holdersAssessed in the token lane.
   */
  holdersAssessed: boolean;
  /** where the ordered distribution came from; null while it is suppressed */
  distributionSource: "goplus" | "explorer" | null;
  /**
   * What the reader has to be told about the distribution: why it is suppressed,
   * or which register it came from when that is not the GoPlus one this profile
   * is otherwise cited to. Null when GoPlus's own register answered it.
   */
  distributionNote: string | null;
  /** Exact Blockscout holder endpoint when the distribution came from it. */
  distributionSourceUrl?: string;
  /** Capture time of the Blockscout holder response. */
  distributionCapturedAt?: string;
  /** GoPlus contract-control and deployer-history flags that fired; empty means none fired, never "clean" */
  contractFlags: ContractControlFlag[];
  /** creator/deployer share of supply, percent; null when GoPlus did not report one (never 0) */
  creatorPct: number | null;
  sourceUrl: string;
  /** Capture time of the GoPlus token-security response. */
  sourceCapturedAt: string;
}

export type HolderProfileOutcome =
  | { available: true; value: HolderProfile }
  | { available: false; note: string };

const FETCH_TIMEOUT_MS = 8_000;

const isBurnAddr = (a?: string) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
const isBurnTag = (t?: string) => /null|burn|dead|0x0{4,}/i.test(t ?? "");
const t1 = (v?: string) => v === "1";

// The token lane's govNote, which it appends only after proving real listings on
// centralized exchanges. This lane has no market corroboration to prove that
// with, and a live authority is a capability rather than proof of intent, so the
// caveat is stated unconditionally: the sentence is conditional either way, and
// omitting it would let a governed emissions mechanism read as a rug setup.
const AUTHORITY_NOTE = " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup. Confirm the controller.";
// The token lane relaxes an owner-power flag on a broadly traded token as a
// "governance/upgrade artifact"; without market corroboration this lane states
// the same caveat instead of resolving it.
const OWNER_ACTIVE_NOTE = " This is a capability the owner still holds, not proof of intent; on a broadly traded token it is usually a governance or upgrade artifact. Confirm the controller.";
// An owner-power flag with no owner address reported is a capability whose
// holder was never measured. Saying nothing would hide it; saying "the owner
// can" would name a controller GoPlus never returned.
const OWNER_UNREPORTED_NOTE = " GoPlus reported no owner address for this contract, so whether that control is still held was not measured.";

/** Never throws; a missing chain map, timeout, or empty register is a completed no-data outcome. */
export async function collectHolderProfile(chain: string, address: string): Promise<HolderProfileOutcome> {
  const chainKey = chain.trim().toLowerCase();
  const chainId = GOPLUS_CHAIN[chainKey];
  if (!chainId || !address) {
    return { available: false, note: `No GoPlus holder register for chain "${chain}".` };
  }
  // sources.goplus carries no abort signal; box it so one slow origin cannot
  // eat the collection budget (same pattern as grounded-search page fetches).
  const boxed = <T>(work: Promise<T | null>): Promise<T | null> => Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
  ]);
  // Where GoPlus cannot order holders, the chain's own explorer is the only
  // correct distribution source (same rule as the token lane). Runs in
  // parallel: no added latency, and it is keyless and free.
  const unordered = GOPLUS_UNSORTED_HOLDER_CHAINS.has(chainKey);
  const [gp, explorerHolders] = await Promise.all([
    boxed<GoPlusSecurity>(goplus(chainId, address)),
    unordered ? boxed(blockscoutHolders(chainKey, address)) : Promise.resolve(null),
  ]);
  const sourceCapturedAt = captureTimestamp();
  if (!gp) {
    recordCall("goplus", "holder-profile", 0, `${chain}:${address.slice(0, 10)} · no_data`, "partial");
    return { available: false, note: "GoPlus returned no token security record." };
  }

  const holders = Array.isArray(gp.holders) ? gp.holders : [];
  // GoPlus percent strings are fractions of supply. A share of supply cannot
  // exceed supply: the free tier occasionally returns a raw balance where a
  // ratio belongs, and clamping that to 100 would publish a fabricated total in
  // an immutable report.
  const shareOfSupply = (raw?: string): number | null => {
    const value = Number(raw) * 100;
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  };

  // Concentration is a question about WALLETS. The largest row in a GoPlus
  // register is nearly always the DEX pool the token trades in, and calling
  // that "the largest holder" both misreads the float and puts a different
  // number in the project report than the token report shows for the same
  // token from the same provider (src/token/audit.ts measures over the same
  // non-contract rows). The excluded rows are named in the note, so a reader
  // comparing against a block explorer can see what was left out and why.
  const isMarketRow = (holder: { is_contract?: number; is_locked?: number; tag?: string }): boolean =>
    holder.is_contract === 1
    || holder.is_locked === 1
    || /lock|burn|null|dead|pool|\blp\b|amm|cex|exchange/i.test(holder.tag ?? "");
  const goplusWallets = holders.filter((holder) => !isMarketRow(holder));
  const goplusExcluded = holders.length - goplusWallets.length;
  // GoPlus is not trusted to have ORDERED its own register, so the largest
  // holder is whichever row is largest, never whichever row came first.
  const goplusShares = goplusWallets
    .map((holder) => shareOfSupply(holder.percent))
    .filter((share): share is number => share !== null)
    .sort((a, b) => b - a);
  // Blockscout returns no tag, so a contract flag is all it can be filtered on.
  const explorerWallets = (explorerHolders ?? []).filter((holder) => holder.isContract !== true);
  const explorerExcluded = (explorerHolders?.length ?? 0) - explorerWallets.length;
  const explorerShares = explorerWallets
    .map((holder) => holder.percent)
    .filter((share) => Number.isFinite(share) && share >= 0 && share <= 100)
    .sort((a, b) => b - a);

  const excludedNote = (count: number, register: string): string =>
    count
      ? ` ${count} ${register} row${count === 1 ? " was" : "s were"} excluded as a pool, contract, or locked address, so this is wallet concentration and not every address holding supply.`
      : "";

  let distributionSource: HolderProfile["distributionSource"] = null;
  let distributionNote: string | null = null;
  let shares: number[] = [];
  if (unordered && explorerShares.length) {
    shares = explorerShares;
    distributionSource = "explorer";
    // The concentration figures now come from a different register than the
    // rest of this profile, so the note carries that attribution downstream.
    distributionNote = `Holder concentration is the chain explorer's ordered register, since GoPlus does not order its holder rows on this chain.${excludedNote(explorerExcluded, "explorer")}`;
  } else if (unordered) {
    // Silence, not a fallback: the unordered sample understated the real top
    // holder by 12x on the chain this rule was written for.
    distributionNote = holders.length
      ? "GoPlus does not order its holder register on this chain and the chain explorer returned no distribution, so holder concentration is not reported."
      : "No holder register was returned for this token, so holder concentration is not reported.";
  } else if (goplusShares.length) {
    shares = goplusShares;
    distributionSource = "goplus";
    distributionNote = excludedNote(goplusExcluded, "GoPlus holder").trim() || null;
  } else {
    // Every row was a pool, a contract or a locked address. That is not a low
    // concentration reading; it is no wallet reading at all.
    distributionNote = goplusExcluded
      ? `Every holder row GoPlus returned was a pool, contract, or locked address, so no wallet concentration figure is reported.`
      : holders.length
        ? "The GoPlus holder rows carried no usable share of supply, so holder concentration is not reported."
        : "No holder register was returned for this token, so holder concentration is not reported.";
  }

  // Free-tier GoPlus sometimes returns a short, self-inconsistent holder list
  // whose percentages sum past 100%. When that happens the distribution is
  // untrustworthy, so we suppress the concentration figures rather than report
  // nonsense (the token lane suppresses the same way, at the same threshold).
  const consistencySum = shares.slice(0, 15).reduce((total, share) => total + share, 0);
  if (shares.length && consistencySum > 101) {
    const register = distributionSource === "explorer" ? "explorer" : "GoPlus";
    shares = [];
    distributionSource = null;
    distributionNote = `The ${register} holder rows sum past 100% of supply, so the register is self-inconsistent and holder concentration is not reported.`;
  }

  const holdersAssessed = shares.length > 0;
  const topHolderPct = holdersAssessed ? shares[0] : null;
  const assessedWalletCount = holdersAssessed ? Math.min(10, shares.length) : null;
  const top10PctIsFloor = holdersAssessed && shares.length < 10;
  const top10Pct = holdersAssessed
    ? Math.min(100, shares.slice(0, 10).reduce((total, share) => total + share, 0))
    : null;
  // The free tier returns a short register, and the exclusions above shorten it
  // further. Summing 4 wallet rows and calling the result a top-ten share would
  // publish a floor as a total, so the shortfall is stated where the figure is.
  if (top10PctIsFloor && assessedWalletCount !== null) {
    const shortfall = `The register carried ${assessedWalletCount} usable wallet row${assessedWalletCount === 1 ? "" : "s"}, so the combined share is a floor across those assessed wallets and not a top-10 total.`;
    distributionNote = distributionNote ? `${distributionNote} ${shortfall}` : shortfall;
  }
  const holderCountRaw = Number(gp.holder_count);
  const holderCount = Number.isFinite(holderCountRaw) && holderCountRaw > 0 ? Math.round(holderCountRaw) : null;

  const lpHolders = Array.isArray(gp.lp_holders) ? gp.lp_holders : [];
  let lpLockedOrBurned = 0;
  let lpRowsSeen = 0;
  for (const holder of lpHolders) {
    const share = shareOfSupply(holder.percent);
    if (share === null) continue;
    lpRowsSeen += 1;
    if (isBurnAddr(holder.address) || isBurnTag(holder.tag) || holder.is_locked === 1) lpLockedOrBurned += share;
  }
  // No usable LP row is not the same fact as an unlocked pool.
  const lpLockedOrBurnedPct = lpRowsSeen > 0 ? Math.min(100, lpLockedOrBurned) : null;

  const contractFlags = readContractFlags(gp);
  const creatorShare = shareOfSupply(gp.creator_percent);
  // The token lane pushes this finding at 5% and hardens the tone at 15%.
  if (creatorShare !== null && creatorShare >= 5) {
    // The token lane says "Creator" only where an independent deployer
    // attribution proved that wallet deployed the contract. This lane runs no
    // such attribution, and a provider calling an address the creator is that
    // provider's label, not a proven role: RugCheck names GRASS's MINT
    // AUTHORITY as its creator, and that account holds 25.9% of supply. Having
    // an address back is not having a role proved, so the wording never
    // hardens on it. The holding is the finding.
    contractFlags.push({
      key: "creator_holds_supply",
      claim: `The creator or authority wallet GoPlus names still holds ~${creatorShare.toFixed(0)}% of supply.`,
      tone: creatorShare >= 15 ? "bad" : "warn",
      source: "goplus",
    });
  }

  if (
    topHolderPct === null && holderCount === null && lpLockedOrBurnedPct === null
    && contractFlags.length === 0 && creatorShare === null
  ) {
    recordCall("goplus", "holder-profile", 0, `${chain}:${address.slice(0, 10)} · empty_register`, "succeeded");
    return { available: false, note: "GoPlus reported no holder, liquidity, or contract-control record for this token." };
  }
  const meta = `${chain}:${address.slice(0, 10)} · top_${topHolderPct === null ? "na" : Math.round(topHolderPct)}pct · flags_${contractFlags.length}`;
  const distributionSourceUrl = distributionSource === "explorer"
    ? blockscoutHolderSourceUrl(chainKey, address)
    : null;
  recordCall("goplus", "holder-profile", 0, meta, "succeeded");
  return {
    available: true,
    value: {
      binding: {
        canonicalAddress: address,
        chain: chainKey,
        method: "canonical_token_address_chain",
      },
      topHolderPct,
      top10Pct,
      assessedWalletCount,
      top10PctIsFloor,
      holderCount,
      lpLockedOrBurnedPct,
      holdersAssessed,
      distributionSource,
      distributionNote,
      ...(distributionSourceUrl
        ? {
            distributionSourceUrl,
            distributionCapturedAt: sourceCapturedAt,
          }
        : {}),
      contractFlags,
      creatorPct: creatorShare,
      sourceUrl: `https://gopluslabs.io/token-security/${chainId}/${address}`,
      sourceCapturedAt,
    },
  };
}

/**
 * Contract-control and deployer-history flags GoPlus already returned with the
 * holder register. Wording is the token lane's own, verbatim where that lane has
 * a sentence for the flag, so the two lanes cannot describe the same fact
 * differently. Only flags that FIRED are returned: GoPlus omitting a field is an
 * absent record, never a clean one.
 */
function readContractFlags(gp: GoPlusSecurity): ContractControlFlag[] {
  const flags: ContractControlFlag[] = [];
  const flag = (key: string, claim: string, tone: "warn" | "bad") =>
    flags.push({ key, claim, tone, source: "goplus" });

  // Independent of this token's own flags: the deployer's OTHER tokens include
  // honeypots, which a clean-looking contract cannot wash off.
  if (t1(gp.honeypot_with_same_creator)) {
    flag("serial_scammer_creator", "The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.", "bad");
  }
  if (t1(gp.is_mintable)) {
    flag("mint_authority_active", `Mint authority is live: supply can be minted.${AUTHORITY_NOTE}`, "warn");
  }
  // A hidden owner is a deception; reclaimable-after-renounce is an authority
  // flag. The token lane reports the deception alone when both fire.
  if (t1(gp.hidden_owner)) {
    flag("hidden_owner", "Hidden owner detected.", "bad");
  } else if (t1(gp.can_take_back_ownership)) {
    flag("reclaimable_ownership", `Ownership can be reclaimed after renouncement.${AUTHORITY_NOTE}`, "warn");
  }
  if (t1(gp.selfdestruct)) {
    flag("selfdestruct", "Contract can self-destruct / be closed.", "bad");
  }

  // Owner-power vectors are dangerous only while a controller can exercise them.
  // A provably renounced owner cannot, so those flags drop (the token lane drops
  // them the same way); an owner GoPlus never reported is unmeasured, not gone.
  const owner = gp.owner_address?.trim();
  const ownerRenounced = !!owner && /^0x0+$/.test(owner);
  const ownerNote = owner ? OWNER_ACTIVE_NOTE : OWNER_UNREPORTED_NOTE;
  if (!ownerRenounced) {
    if (t1(gp.owner_change_balance)) {
      flag("owner_can_modify_balance", `Owner can modify holder balances directly; they can zero your wallet.${ownerNote}`, "warn");
    }
    if (t1(gp.transfer_pausable)) {
      flag("transfer_pausable", `Transfers can be paused.${ownerNote}`, "warn");
    }
  }
  return flags;
}
