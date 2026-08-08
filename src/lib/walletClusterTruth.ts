export type WalletClusterOutcome = "links_observed" | "no_links_observed" | "insufficient_coverage";

export interface WalletClusterCoverage {
  /** Eligible holder wallets included in the bounded trace. */
  sampled: number;
  /** Wallets whose funding origin and transfer reads both completed. */
  fullyTraced: number;
  /** Wallet histories too deep to reach their first transactions. */
  historyTruncated: number;
  /** Wallets skipped after the route's time budget was reached. */
  deadlineSkipped: number;
  /** Wallets with at least one provider read that failed. */
  providerFailed: number;
}

export interface WalletClusterSummary {
  size: number;
  combinedPct: number;
  sharedFunders: readonly string[];
  includesCreator: boolean;
}

export interface WalletClusterDescription {
  outcome: WalletClusterOutcome;
  note: string;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  count === 1 ? singular : pluralForm;

/**
 * The only user-facing interpretation of a wallet-link trace.
 *
 * A shared seed funder or a direct transfer establishes a relationship. It does
 * not establish common ownership, identity, intent, or control. Likewise, a
 * bounded trace that observes no link does not establish independence. Keeping
 * this copy shared prevents the Solana and EVM routes from drifting back into
 * stronger conclusions than their evidence supports.
 */
export function describeWalletClusterTrace(input: {
  clusters: readonly WalletClusterSummary[];
  coverage: WalletClusterCoverage;
  directLinkLabel: string;
}): WalletClusterDescription {
  const { clusters, coverage } = input;
  const incomplete = Math.max(0, coverage.sampled - coverage.fullyTraced);
  const coverageSentence = incomplete > 0
    ? ` Complete funding-origin and transfer coverage was available for ${coverage.fullyTraced} of ${coverage.sampled} sampled wallets.`
      + (coverage.historyTruncated > 0
        ? ` ${coverage.historyTruncated} ${plural(coverage.historyTruncated, "history was", "histories were")} too deep to reach the first transaction.`
        : "")
      + (coverage.deadlineSkipped > 0
        ? ` ${coverage.deadlineSkipped} ${plural(coverage.deadlineSkipped, "wallet was", "wallets were")} skipped when the time budget ended.`
        : "")
      + (coverage.providerFailed > 0
        ? ` ${coverage.providerFailed} ${plural(coverage.providerFailed, "wallet had", "wallets had")} an unreadable provider response.`
        : "")
    : "";

  if (clusters.length > 0) {
    const top = clusters[0];
    const link = top.sharedFunders.length > 0
      ? `a shared seed funder (${top.sharedFunders[0].slice(0, 8)}...)`
      : input.directLinkLabel;
    return {
      outcome: "links_observed",
      note: `Observed ${clusters.length} linked wallet ${plural(clusters.length, "group")} among ${coverage.sampled} sampled holders. `
        + `The largest links ${top.size} wallets whose reported balances sum to ${top.combinedPct.toFixed(1)}% of supply via ${link}`
        + `${top.includesCreator ? ", including the token creator's wallet" : ""}. `
        + "This establishes an on-chain relationship, not that one person owns or controls every wallet."
        + coverageSentence,
    };
  }

  if (coverage.sampled < 2) {
    return {
      outcome: "insufficient_coverage",
      note: `Only ${coverage.sampled} eligible holder ${plural(coverage.sampled, "wallet")} ${coverage.sampled === 1 ? "was" : "were"} available, so wallet-link concentration was not measured.`,
    };
  }

  if (incomplete > 0) {
    return {
      outcome: "insufficient_coverage",
      note: "No shared seed funder or direct transfer was established in this partial trace."
        + coverageSentence
        + " The missing coverage cannot be published as independent ownership or as proof that common control is absent.",
    };
  }

  return {
    outcome: "no_links_observed",
    note: `No shared seed funder or ${input.directLinkLabel} was observed among ${coverage.sampled} sampled holders in this bounded trace. `
      + "That is not proof the wallets are independently owned.",
  };
}
