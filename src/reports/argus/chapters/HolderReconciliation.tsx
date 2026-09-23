import { ExtLink } from "../primitives";
import { floorTo, providerLabel, shortAddress } from "../model";
import type { HolderProfileSnapshot } from "../../../data/evidence";

/** Why two saved holder views disagree. States each population; infers nothing about control. */
export function HolderReconciliation({
  holder,
  largestPct,
  largestAddress,
  riskVerdict,
}: {
  holder: HolderProfileSnapshot | null | undefined;
  largestPct: number | null;
  largestAddress: string | null;
  riskVerdict?: string | null;
}) {
  const assessed = holder && holder.holdersAssessed !== false ? holder : null;
  const top = assessed?.topHolderPct ?? null;
  const combined = assessed?.top10Pct ?? null;
  const count = assessed?.assessedWalletCount ?? null;
  const provider = providerLabel(assessed?.distributionSource ?? "goplus");
  return (
    <>
      <div className="eyebrow">Concentration reconciliation</div>
      <h2 className="dialog-title">
        {top != null && largestPct != null
          ? `${top.toFixed(2)}% and ${largestPct.toFixed(2)}% describe different populations.`
          : "The saved holder views describe different populations."}
      </h2>
      <div className="dialog-section">
        <h3>Assessed-wallet view</h3>
        <p>
          {assessed
            ? `${provider} retained ${count ?? "an unrecorded number of"} usable wallet row${count === 1 ? "" : "s"} after pool, contract and locked-address exclusions.${top != null ? ` The largest assessed wallet is ${top.toFixed(2)}%` : ""}${combined != null ? `, and the combined share is at least ${floorTo(combined, 2).toFixed(2)}%` : ""}. This bounded sample is not a complete distribution.`
            : "No assessed-wallet distribution is saved with this report."}
        </p>
        {assessed?.distributionNote && <p style={{ marginTop: 8 }}>{assessed.distributionNote}</p>}
      </div>
      <div className="dialog-section">
        <h3>Market-risk view</h3>
        <p>
          {largestPct != null
            ? `The token scan labels ${largestAddress ? shortAddress(largestAddress) : "one address"} as the largest non-pool holder at ${largestPct.toFixed(2)}% of supply${riskVerdict ? ` and uses it in the ${String(riskVerdict).toUpperCase()} market-mechanics assessment` : ""}. The saved report does not reconcile that label with the exclusions used for the holder score.`
            : "No largest non-pool holder is recorded by the token scan."}
        </p>
      </div>
      <div className="status-box">
        Neither a low partial-sample share nor a large contract balance settles beneficial control. Classify the address, beneficiary, lock terms and executable authority at a common block before publishing a concentration conclusion.
      </div>
      {assessed?.sourceUrl && <div className="dialog-section"><ExtLink href={assessed.sourceUrl}>Read the {provider} scope</ExtLink></div>}
    </>
  );
}
