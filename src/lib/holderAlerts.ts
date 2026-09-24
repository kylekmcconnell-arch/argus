import { compareHolderObservations } from "./holderChanges.js";
import type { HolderIntelligence } from "./holderIntelligence.js";
export interface SavedHolderSnapshot { report_version_id: string; captured_at: string; attestation_state: string; snapshot: HolderIntelligence }
export interface HolderObservationAlert { id:string; fromVersion:string; toVersion:string; capturedAt:string; address:string; kind:string; detail:string; registryNames:string[]; basis:"saved-report-observations" }
/** Historical observation alerts, not inferred trades, controller attribution or investment signals. */
export function holderObservationAlerts(records:SavedHolderSnapshot[]):HolderObservationAlert[]{
  const seen=new Set<string>();
  const ordered=records.filter(r=>r && typeof r.report_version_id==="string" && r.snapshot && Number.isFinite(Date.parse(r.snapshot.capturedAt)))
    .filter(r=>{const key=`${r.report_version_id}:${r.snapshot.chain}:${r.snapshot.tokenAddress}:${r.snapshot.capturedAt}`;if(seen.has(key))return false;seen.add(key);return true;})
    .sort((a,b)=>Date.parse(a.snapshot.capturedAt)-Date.parse(b.snapshot.capturedAt)||a.report_version_id.localeCompare(b.report_version_id));
  const alerts:HolderObservationAlert[]=[];
  for(let i=1;i<ordered.length;i++){
    const before=ordered[i-1],after=ordered[i];
    for(const change of compareHolderObservations(before.snapshot,after.snapshot)){
      const detail=change.kind==="share-change" ? `Observed supply share changed from ${change.before!.toFixed(2)}% to ${change.after!.toFixed(2)}%. Supply changes and transfers can affect this; it does not establish a buy or sale.`
        : change.kind==="newly-observed-indexed-wallet" ? "A registry-linked wallet is newly visible in the captured top 25. This does not establish a new purchase or control of the project."
        : "A registry-linked wallet is no longer visible in the captured top 25. It may have moved below the cutoff; this is not proof of an exit.";
      alerts.push({id:`${before.report_version_id}:${after.report_version_id}:${change.kind}:${change.address}`,fromVersion:before.report_version_id,toVersion:after.report_version_id,
        capturedAt:after.snapshot.capturedAt,address:change.address,kind:change.kind,detail,registryNames:change.registryNames,basis:"saved-report-observations"});
    }
  }
  return alerts.reverse();
}
