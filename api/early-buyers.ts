// Scan-time early-buyer funding trace. GET /api/early-buyers?mint=<solana mint>
//
// GMGN can say "24.9% of volume came from wallets we call bundlers", and ARGUS
// carries that as GMGN's claim. This route is the half ARGUS can check itself:
// it walks the token's FIRST transactions, lists the wallets that took supply
// in them, traces where each of those wallets got its first SOL, and reports
// the shape it finds: N of M early buyers share a funding source, K took supply
// in one block, and what the shared-funder group still holds. Every figure is
// derived from named transactions on the chain, so a reader can verify it.
//
// What it never does is conclude. "17 of 36 early buyers share a funder" is a
// measurement; "this launch was bundled" is a verdict this route does not emit
// and its numbers set no score floors. Three honesty rules are structural:
//   1. A shared EXCHANGE hot wallet is not a shared funder. Thousands of
//      unrelated people withdraw from the same Binance address, so a funder
//      matching src/lib/marketAddresses.ts custody is reported as CEX-funded
//      and never clusters wallets together.
//   2. A wallet whose history was too deep to page is UNRESOLVED, not
//      independent: reading a funder off the oldest page reached would
//      describe the wrong era of the wallet.
//   3. Bounded reads publish floors: a capped buyer list, a partial trace and
//      an unreadable balance all say so instead of posing as totals.
//
// Scan-time and therefore ungated, on the api/deployer-origin.ts pattern:
// Helius is a keyed subscription with no per-call marginal cost, middleware's
// analyst budget is the abuse guard, and a live scan has no persisted report
// version to bill a panel token against. Deliberately no server cache: the
// "still holds" figures are live balances, and a day-old copy would misstate
// the one thing that moves.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { classifyMarketAddress } from "../src/lib/marketAddresses";
import {
  currentTokenBalance,
  heliusRpc,
  inChunks,
  oldestWalletSigs,
  seedFundingSource,
  type ProviderUsage,
} from "./_funding-core.js";

export const config = { maxDuration: 60 };

const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Earliest mint transactions parsed for recipients. One enhanced-API batch. */
const EARLY_TX_WINDOW = 100;
/** Distinct recipients analyzed. When the window held more, the count is a floor. */
const BUYER_CAP = 40;
// 1000 sigs/page of mint history walked back to reach the launch. Failed
// sniper spam inflates a hot launch past 10k signatures within hours, so the
// budget is generous; a token beyond it gets the honest refusal, not a window
// that silently starts mid-life.
const MAX_LAUNCH_PAGES = 30;
const TRACE_CHUNK = 6;

// Program authorities and system accounts that can never be a buyer or a
// funder. Kept to EXACT addresses: a name heuristic mislabelling a dev wallet
// as infrastructure would be a false clean, the one failure direction this
// product must never take.
const SYSTEM = new Set<string>([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium V4 pool authority
]);

export interface EnhancedTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
  tokenAmount?: number;
}

export interface EnhancedTx {
  signature?: string;
  slot?: number;
  timestamp?: number;
  feePayer?: string;
  tokenTransfers?: EnhancedTransfer[];
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
}

export interface EarlyRecipient {
  address: string;
  /** The first transaction in which this wallet received the token. */
  firstSig: string;
  slot: number;
  /** Token received across the early window, in UI units. */
  receivedUi: number;
  /** True when the wallet spent SOL (or paid the fee) in its first receiving
   * transaction: a buy. False means it was handed the tokens: a transfer. */
  paidInFirstTx: boolean;
}

export interface EarlyWindowRead {
  recipients: EarlyRecipient[];
  /** What the creator wallet itself took in the window, when it appears. */
  creatorReceivedUi: number | null;
  /** Transactions that delivered the token to 2+ analyzed wallets at once. */
  sameTx: Array<{ signature: string; count: number }>;
  /** True when distinct recipients exceeded BUYER_CAP: the list is a floor. */
  capped: boolean;
  windowTxCount: number;
}

/**
 * The wallets that took supply in the token's earliest transactions.
 *
 * Market infrastructure is excluded only on grounds a provider stated (a
 * RugCheck-labelled AMM/pool/exchange account, a known CEX custody address) or
 * an exact system-program match, never on a name or shape heuristic. The
 * creator is tracked separately rather than listed as a buyer of its own token.
 */
export function readEarlyWindow(
  txs: EnhancedTx[],
  opts: {
    mint: string;
    creator: string | null;
    knownAccounts?: Record<string, { name?: string; type?: string } | undefined>;
    poolAddresses?: readonly string[];
    cap?: number;
  },
): EarlyWindowRead {
  const cap = opts.cap ?? BUYER_CAP;
  const ordered = [...txs].filter((tx) => typeof tx?.signature === "string").sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const byAddress = new Map<string, EarlyRecipient>();
  let creatorReceivedUi: number | null = null;
  const sameTx: Array<{ signature: string; count: number }> = [];
  let capped = false;

  for (const tx of ordered) {
    const signature = tx.signature as string;
    const slot = typeof tx.slot === "number" ? tx.slot : 0;
    const paidHere = new Set<string>();
    if (typeof tx.feePayer === "string") paidHere.add(tx.feePayer);
    for (const native of tx.nativeTransfers ?? []) {
      if (typeof native.fromUserAccount === "string" && (native.amount ?? 0) > 0) paidHere.add(native.fromUserAccount);
    }

    const receiversHere = new Set<string>();
    for (const transfer of tx.tokenTransfers ?? []) {
      if (transfer.mint !== opts.mint) continue;
      const to = typeof transfer.toUserAccount === "string" ? transfer.toUserAccount.trim() : "";
      const amount = typeof transfer.tokenAmount === "number" && Number.isFinite(transfer.tokenAmount) ? transfer.tokenAmount : 0;
      if (!SOLADDR.test(to) || amount <= 0) continue;
      if (SYSTEM.has(to)) continue;
      if (classifyMarketAddress(to, { knownAccounts: opts.knownAccounts, poolAddresses: opts.poolAddresses })) continue;
      if (opts.creator && to === opts.creator) {
        creatorReceivedUi = (creatorReceivedUi ?? 0) + amount;
        continue;
      }

      const existing = byAddress.get(to);
      if (existing) {
        existing.receivedUi += amount;
        receiversHere.add(to);
        continue;
      }
      if (byAddress.size >= cap) {
        capped = true;
        continue;
      }
      byAddress.set(to, {
        address: to,
        firstSig: signature,
        slot,
        receivedUi: amount,
        paidInFirstTx: paidHere.has(to),
      });
      receiversHere.add(to);
    }
    if (receiversHere.size >= 2) sameTx.push({ signature, count: receiversHere.size });
  }

  return {
    recipients: [...byAddress.values()],
    creatorReceivedUi,
    sameTx,
    capped,
    windowTxCount: ordered.length,
  };
}

export interface TracedRecipient extends EarlyRecipient {
  /** Seed funder address, when one was resolved from the wallet's first txs. */
  funder: string | null;
  /** Exchange label when the funder is known CEX custody. */
  funderExchange: string | null;
  /** True when the wallet's history was too deep to page: unresolved, never independent. */
  historyTruncated: boolean;
}

export interface FunderCluster {
  funder: string;
  funderIsCreator: boolean;
  size: number;
  members: Array<{ address: string; receivedUi: number; paidInFirstTx: boolean; remainingUi: number | null }>;
  receivedTotalUi: number;
  /** Sum of live balances, only when EVERY member's balance was readable. */
  remainingTotalUi: number | null;
  /** remaining/received as 0-100, capped at 100 (later buys can exceed the early take). */
  stillHeldPct: number | null;
}

/**
 * Group traced recipients by shared seed funder. A CEX-custody funder never
 * forms a cluster (rule 1 above), an unresolved funder never joins one, and a
 * single-member group is not a cluster.
 */
export function clusterByFunder(traced: TracedRecipient[]): Array<{ funder: string; members: TracedRecipient[] }> {
  const byFunder = new Map<string, TracedRecipient[]>();
  for (const recipient of traced) {
    if (!recipient.funder || recipient.funderExchange || recipient.historyTruncated) continue;
    if (SYSTEM.has(recipient.funder)) continue;
    const group = byFunder.get(recipient.funder) ?? [];
    group.push(recipient);
    byFunder.set(recipient.funder, group);
  }
  return [...byFunder.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([funder, members]) => ({ funder, members }))
    .sort((a, b) => b.members.length - a.members.length);
}

const short = (address: string): string => `${address.slice(0, 4)}..${address.slice(-4)}`;

/** The shape sentences the panel leads with. Counts and floors, no verdicts. */
export function earlyBuyerNote(input: {
  buyersFound: number;
  buyersCapped: boolean;
  windowSigCount: number;
  windowTxCount: number;
  tracedCount: number;
  clusters: FunderCluster[];
  cexFundedCount: number;
  /** Wallets whose history was too deep to page back to their funding. */
  busyWalletCount: number;
  sameBlock: Array<{ slot: number; count: number }>;
}): string {
  const parts: string[] = [];
  const found = `${input.buyersFound}${input.buyersCapped ? " (a capped list, so a floor)" : ""}`;
  // The window is stated as the signatures examined; when fewer parsed than
  // were submitted, that shortfall is coverage lost and it says so.
  const shortfall = input.windowTxCount < input.windowSigCount
    ? ` (${input.windowTxCount} of those ${input.windowSigCount} were parseable)`
    : "";
  parts.push(`${found} wallets took supply in the token's first ${input.windowSigCount} successful transactions${shortfall}.`);
  const top = input.clusters[0];
  if (top) {
    const held = top.stillHeldPct === null
      ? ""
      : top.stillHeldPct >= 99.5
        ? "; the group still holds its early take"
        : `; together the group still holds ${top.stillHeldPct.toFixed(0)}% of its early take, the rest sold or moved on`;
    parts.push(
      `${top.size} of the ${input.tracedCount} traced received their first SOL from the same wallet`
      + `${top.funderIsCreator ? ", the token's own creator" : ` (${short(top.funder)})`}${held}.`,
    );
    if (input.clusters.length > 1) {
      parts.push(`${input.clusters.length - 1} further shared-funder group${input.clusters.length > 2 ? "s" : ""} appear among the rest.`);
    }
  } else if (input.tracedCount > 0) {
    parts.push(`No two of the ${input.tracedCount} traced wallets share a funding source.`);
  }
  const biggestBlock = [...input.sameBlock].sort((a, b) => b.count - a.count)[0];
  if (biggestBlock) {
    parts.push(`${biggestBlock.count} of them took supply in a single block (slot ${biggestBlock.slot}).`);
  }
  if (input.busyWalletCount > 0) {
    parts.push(
      `${input.busyWalletCount} of the traced are high-activity wallets whose first funding lies deeper than this trace pages, so their funding stays unresolved; unresolved is never counted as independent.`,
    );
  }
  if (input.cexFundedCount > 0) {
    parts.push(
      `${input.cexFundedCount} ${input.cexFundedCount === 1 ? "was" : "were"} funded straight from exchange custody wallets; thousands of unrelated people withdraw from those, so a shared exchange is never counted as a shared funder.`,
    );
  }
  return parts.join(" ");
}

/**
 * The mint's first successful transactions, oldest first, or the honest
 * failure. A hot launch's oldest page can be almost entirely FAILED sniper
 * spam, so the window is collected across the last few pages walked rather
 * than one page's tail: without that, a launch whose first 900 rows are
 * reverted snipes would report a seven-transaction "early window" and miss
 * the buys that actually landed.
 */
async function launchWindowSigs(
  url: string,
  mint: string,
  usage: ProviderUsage,
  pageDeadline: number,
): Promise<{ sigs: string[]; reachedLaunch: boolean }> {
  let before: string | undefined;
  const pages: any[][] = []; // fetch order: each entry OLDER than the one before
  for (let page = 0; page < MAX_LAUNCH_PAGES; page++) {
    if (Date.now() > pageDeadline) break;
    const batch: any[] = await heliusRpc(url, "getSignaturesForAddress", [mint, { limit: 1000, ...(before ? { before } : {}) }], usage);
    if (!batch?.length) break;
    pages.push(batch);
    if (pages.length > 3) pages.shift();
    if (batch.length < 1000) {
      const sigs: string[] = [];
      for (let i = pages.length - 1; i >= 0 && sigs.length < EARLY_TX_WINDOW; i--) {
        for (let j = pages[i].length - 1; j >= 0 && sigs.length < EARLY_TX_WINDOW; j--) {
          const row = pages[i][j];
          if (!row.err) sigs.push(row.signature);
        }
      }
      return { sigs, reachedLaunch: true };
    }
    before = batch[batch.length - 1].signature;
  }
  return { sigs: [], reachedLaunch: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.HELIUS_API_KEY;
  const mint = typeof req.query.mint === "string" ? req.query.mint.trim() : "";
  if (!mint || !SOLADDR.test(mint)) {
    res.status(400).json({ error: "valid Solana mint required" });
    return;
  }
  if (!key) {
    res.status(200).json({ mint, available: false, note: "Helius not configured; the early-buyer trace is unavailable." });
    return;
  }

  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  const usage: ProviderUsage = { calls: 0, succeeded: 0 };
  const deadline = Date.now() + 50_000; // margin under the 60s function cap
  try {
    // Market-infrastructure labels and the creator, from the one RugCheck report
    // the Solana lane already leans on elsewhere. Best-effort: without it the
    // trace still runs, and the response says the labels were missing rather
    // than silently analyzing pool vaults as people.
    const rugcheck = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, {
      signal: AbortSignal.timeout(12000),
      headers: { accept: "application/json" },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as any;
    const knownAccounts: Record<string, { name?: string; type?: string }> = rugcheck?.knownAccounts ?? {};
    const creator = typeof rugcheck?.creator === "string" && SOLADDR.test(rugcheck.creator) ? rugcheck.creator : null;
    const poolAddresses: string[] = (Array.isArray(rugcheck?.markets) ? rugcheck.markets : [])
      .map((m: any) => (typeof m?.pubkey === "string" ? m.pubkey : null))
      .filter(Boolean);

    // 1. Reach the token's first transactions. A token with more history than
    //    the page budget gets the honest refusal, not a window that silently
    //    starts mid-life and calls month-two traders "early buyers".
    // Paging gets the first ~25s; the per-wallet tracing needs the rest.
    const { sigs, reachedLaunch } = await launchWindowSigs(url, mint, usage, Date.now() + 25_000);
    if (!reachedLaunch || sigs.length === 0) {
      res.status(200).json({
        mint,
        available: true,
        reachedLaunch: false,
        note: reachedLaunch
          ? "The token's earliest transactions could not be read."
          : "This token carries more transaction history than this trace can page back through, so its launch window was not reachable and no early-buyer reading was taken.",
      });
      return;
    }

    // 2. Parse the early window in one enhanced-API batch.
    usage.calls += 1;
    const parsedRes = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactions: sigs }),
      signal: AbortSignal.timeout(20000),
    });
    if (!parsedRes.ok) throw new Error(`enhanced parse ${parsedRes.status}`);
    const txs = (await parsedRes.json()) as EnhancedTx[];
    usage.succeeded += 1;

    const windowRead = readEarlyWindow(Array.isArray(txs) ? txs : [], { mint, creator, knownAccounts, poolAddresses });

    // 3. Trace each recipient's seed funding, oldest transactions first. Early
    //    wallets are usually young, so this is a shallow read per wallet.
    const traced: TracedRecipient[] = (await inChunks(windowRead.recipients, TRACE_CHUNK, async (recipient) => {
      if (Date.now() > deadline) return null;
      const { sigs: walletSigs, truncated } = await oldestWalletSigs(url, recipient.address, usage, 2);
      const funder = !truncated && walletSigs.length
        ? await seedFundingSource(url, recipient.address, walletSigs.slice(0, 4), usage)
        : null;
      const exchange = funder ? classifyMarketAddress(funder) : null;
      return {
        ...recipient,
        funder,
        funderExchange: exchange?.kind === "exchange" ? exchange.label : null,
        historyTruncated: truncated,
      };
    })).filter((r): r is TracedRecipient => r !== null);
    const tracedIsPartial = traced.length < windowRead.recipients.length;

    // 4. Shared-funder groups, with what each still holds. Balances are read
    //    only for cluster members, and a group total is published only when
    //    every member's balance was readable.
    const groups = clusterByFunder(traced);
    const clusters: FunderCluster[] = await inChunks(groups, 2, async (group) => {
      const members = await Promise.all(group.members.map(async (member) => ({
        address: member.address,
        receivedUi: member.receivedUi,
        paidInFirstTx: member.paidInFirstTx,
        remainingUi: Date.now() > deadline ? null : await currentTokenBalance(url, member.address, mint, usage),
      })));
      const receivedTotalUi = members.reduce((sum, m) => sum + m.receivedUi, 0);
      const allMeasured = members.every((m) => m.remainingUi !== null);
      const remainingTotalUi = allMeasured ? members.reduce((sum, m) => sum + (m.remainingUi ?? 0), 0) : null;
      return {
        funder: group.funder,
        funderIsCreator: creator !== null && group.funder === creator,
        size: members.length,
        members,
        receivedTotalUi,
        remainingTotalUi,
        stillHeldPct: remainingTotalUi !== null && receivedTotalUi > 0
          ? Math.min(100, (remainingTotalUi / receivedTotalUi) * 100)
          : null,
      };
    });

    // 5. Same-block groups among the analyzed recipients.
    const bySlot = new Map<number, number>();
    for (const recipient of windowRead.recipients) bySlot.set(recipient.slot, (bySlot.get(recipient.slot) ?? 0) + 1);
    const sameBlock = [...bySlot.entries()]
      .filter(([, n]) => n >= 2)
      .map(([slot, n]) => ({ slot, count: n }))
      .sort((a, b) => b.count - a.count);

    const cexFunded = traced
      .filter((r) => r.funderExchange)
      .map((r) => ({ address: r.address, exchange: r.funderExchange as string }));
    // Two different kinds of "no funder": a deep-history wallet the trace could
    // not page back through (a professional sniper looks like this), and a
    // wallet whose oldest transactions simply showed no readable funding.
    const busyWallets = traced.filter((r) => r.historyTruncated).length;
    const unresolvedFunding = traced.filter((r) => !r.funder && !r.funderExchange && !r.historyTruncated).length;

    res.status(200).json({
      mint,
      available: true,
      reachedLaunch: true,
      windowSigCount: sigs.length,
      windowTxCount: windowRead.windowTxCount,
      buyersFound: windowRead.recipients.length,
      buyersCapped: windowRead.capped,
      buyersTraced: traced.length,
      tracedIsPartial,
      labelsAvailable: rugcheck !== null,
      creator: creator ? { address: creator, receivedUi: windowRead.creatorReceivedUi } : null,
      sameBlock,
      sameTx: windowRead.sameTx,
      clusters,
      cexFunded,
      busyWallets,
      unresolvedFunding,
      note: earlyBuyerNote({
        buyersFound: windowRead.recipients.length,
        buyersCapped: windowRead.capped,
        windowSigCount: sigs.length,
        windowTxCount: windowRead.windowTxCount,
        tracedCount: traced.length,
        clusters,
        cexFundedCount: cexFunded.length,
        busyWalletCount: busyWallets,
        sameBlock,
      }),
    });
  } catch (e) {
    // A failed walk is never an empty result: the caller must be able to tell
    // "no shared funders found" from "the trace never completed".
    res.status(200).json({ mint, available: false, error: String(e), note: "The early-buyer funding trace did not complete." });
  }
}
