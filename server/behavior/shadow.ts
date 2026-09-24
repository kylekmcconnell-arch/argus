import { createHash } from "node:crypto";
import { compareHolderObservations, type HolderChange } from "../../src/lib/holderChanges.js";
import { tokenSubjectIdentity } from "../../src/lib/tokenIdentity.js";
import type { SavedHolderSnapshot } from "../../src/lib/holderAlerts.js";
export type ShadowPattern = "share-increased" | "share-decreased" | "indexed-appeared" | "indexed-disappeared";
const PATTERNS: ShadowPattern[] = ["share-increased", "share-decreased", "indexed-appeared", "indexed-disappeared"];
export interface ShadowPolicy {
  version: 1;
  name: string;
  patterns: ShadowPattern[];
  windowStart: string;
  windowEnd: string;
  entryDelayMs: number;
  horizonMs: number;
  quoteToleranceMs: number;
  minimumLiquidityUsd: number;
  assumedRoundTripCostBps: number;
}
export interface ShadowSnapshot extends SavedHolderSnapshot { saved_at: string }
export interface ShadowCandidate {
  id: string; chain: string; token: string; availableAt: string;
  beforeVersion: string; afterVersion: string;
  beforeHash: string; afterHash: string;
  changes: HolderChange[];
}
export interface ShadowCohort {
  version: 1; registeredAt: string; policy: ShadowPolicy;
  inputHash: string; candidates: ShadowCandidate[]; snapshotsSupplied: number;
  populationCoverage: "workspace-sample"; hash: string;
}
export interface ShadowMarketPoint {
  chain: string; token: string; pool: string;
  observedAt: string; availableAt: string;
  priceUsd: number; liquidityUsd: number;
  quality: "corroborated" | "unreviewed" | "suspected-artificial";
  sourceUrl: string; receiptHash: string;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const time = (value: string) => {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("A valid evidence timestamp is required");
  return result;
};
function validatePolicy(policy: ShadowPolicy) {
  if (policy?.version !== 1 || !policy.name?.trim() || !Array.isArray(policy.patterns) || !policy.patterns.length || policy.patterns.some(pattern=>!PATTERNS.includes(pattern)) || time(policy.windowEnd) < time(policy.windowStart)
    || !Number.isSafeInteger(policy.entryDelayMs) || policy.entryDelayMs < 0
    || !Number.isSafeInteger(policy.horizonMs) || policy.horizonMs <= 0
    || !Number.isSafeInteger(policy.quoteToleranceMs) || policy.quoteToleranceMs < 0 || policy.quoteToleranceMs >= policy.horizonMs
    || !Number.isFinite(policy.minimumLiquidityUsd) || policy.minimumLiquidityUsd < 0
    || !Number.isFinite(policy.assumedRoundTripCostBps) || policy.assumedRoundTripCostBps < 0 || policy.assumedRoundTripCostBps >= 10000) throw new Error("Invalid predeclared shadow policy");
}
/** Register the complete candidate set before evaluation. No outcome or price input is accepted. */
export function registerShadowCohort(records: ShadowSnapshot[], policy: ShadowPolicy, registeredAt = new Date().toISOString()): ShadowCohort {
  validatePolicy(policy);
  const registration = time(registeredAt);
  if (time(policy.windowEnd) > registration || !Array.isArray(records) || records.length > 100000) throw new Error("Unclosed or oversized observation window");
  const groups = new Map<string, ShadowSnapshot[]>();
  const seen = new Set<string>();
  for (const record of records) {
    const snapshot = record?.snapshot;
    const identity = tokenSubjectIdentity(snapshot?.chain, snapshot?.tokenAddress);
    if (!identity || !record.report_version_id || record.attestation_state !== "server_attested"
      || time(record.saved_at) < time(snapshot.capturedAt) || time(record.saved_at) > registration
      || time(record.captured_at) !== time(snapshot.capturedAt)) throw new Error("Shadow inputs require dated, server-attested snapshots available at registration");
    const key = `${identity.ref}:${time(snapshot.capturedAt)}`;
    if (seen.has(key)) throw new Error("Duplicate observation times need reconciliation before evaluation");
    seen.add(key);
    groups.set(identity.ref, [...(groups.get(identity.ref) ?? []), record]);
  }
  const candidates: ShadowCandidate[] = [];
  for (const recordsForToken of groups.values()) {
    const ordered = [...recordsForToken].sort((a,b)=>time(a.snapshot.capturedAt)-time(b.snapshot.capturedAt));
    for (let i=1;i<ordered.length;i++) {
      const before=ordered[i-1], after=ordered[i];
      // Incomplete intervening snapshots stay in the sequence; never bridge over them.
      const changes=compareHolderObservations(before.snapshot,after.snapshot).filter(change=>policy.patterns.includes(
        change.kind==="newly-observed-indexed-wallet"?"indexed-appeared":change.kind==="no-longer-observed-indexed-wallet"?"indexed-disappeared":change.after!>change.before!?"share-increased":"share-decreased"));
      const availableAt=new Date(Math.max(time(before.saved_at),time(after.saved_at))).toISOString();
      if (!changes.length || time(availableAt)<time(policy.windowStart) || time(availableAt)>time(policy.windowEnd)) continue;
      const identity=tokenSubjectIdentity(after.snapshot.chain,after.snapshot.tokenAddress)!;
      const beforeHash=hash(before),afterHash=hash(after);
      candidates.push({id:hash([identity.ref,beforeHash,afterHash]),chain:identity.chain,token:identity.address,availableAt,
        beforeVersion:before.report_version_id,afterVersion:after.report_version_id,beforeHash,afterHash,changes});
    }
  }
  candidates.sort((a,b)=>time(a.availableAt)-time(b.availableAt)||a.id.localeCompare(b.id));
  const payload={version:1 as const,registeredAt,policy:structuredClone(policy),inputHash:hash(records),candidates,
    snapshotsSupplied:records.length,populationCoverage:"workspace-sample" as const};
  return {...payload,hash:hash(payload)};
}
export function readShadowCohort(input: unknown): ShadowCohort {
  const cohort=input as ShadowCohort;
  if (!cohort || cohort.version!==1 || !Array.isArray(cohort.candidates)) throw new Error("Invalid shadow cohort");
  const {hash:receipt,...payload}=cohort;
  if (hash(payload)!==receipt) throw new Error("Shadow cohort receipt changed");
  validatePolicy(cohort.policy); time(cohort.registeredAt);
  return cohort;
}
function validPoint(point: ShadowMarketPoint, evaluationAt: number) {
  const identity=tokenSubjectIdentity(point?.chain,point?.token);
  if (!identity || !tokenSubjectIdentity(point.chain,point.pool) || point.chain!==identity.chain
    || !Number.isFinite(point.priceUsd) || point.priceUsd<=0 || !Number.isFinite(point.liquidityUsd) || point.liquidityUsd<0
    || !["corroborated","unreviewed","suspected-artificial"].includes(point.quality) || !/^[a-f0-9]{64}$/.test(point.receiptHash)
    || time(point.availableAt)<time(point.observedAt) || time(point.availableAt)>evaluationAt) return false;
  try { const url=new URL(point.sourceUrl); return url.protocol==="https:" && !url.username && !url.password; } catch { return false; }
}
export function evaluateShadowCohort(input: ShadowCohort, points: ShadowMarketPoint[], evaluatedAt = new Date().toISOString()) {
  const cohort=readShadowCohort(input), evaluation=time(evaluatedAt), policy=cohort.policy;
  if (evaluation<time(cohort.registeredAt) || !Array.isArray(points) || points.length>1000000 || points.some(point=>!validPoint(point,evaluation))) throw new Error("Invalid market evidence or evaluation time");
  const seen=new Set<string>();
  for(const point of points) {
    const key=JSON.stringify([tokenSubjectIdentity(point.chain,point.token)!.ref,tokenSubjectIdentity(point.chain,point.pool)!.ref,point.sourceUrl,time(point.observedAt)]);
    if(seen.has(key)) throw new Error("Duplicate market observations need reconciliation");
    seen.add(key);
  }
  const outcomes=cohort.candidates.map(candidate=>{
    const entryTarget=time(candidate.availableAt)+policy.entryDelayMs, exitTarget=entryTarget+policy.horizonMs;
    const prospective=time(cohort.registeredAt)<=entryTarget;
    const base={candidateId:candidate.id,chain:candidate.chain,token:candidate.token,prospective,
      grossReturnPct:null as number|null,assumptionAdjustedReturnPct:null as number|null,entryReceipt:null as string|null,exitReceipt:null as string|null};
    if(evaluation<exitTarget+policy.quoteToleranceMs) return {...base,status:"pending" as const};
    const rows=points.filter(point=>tokenSubjectIdentity(point.chain,point.token)?.ref===`${candidate.chain}:${candidate.token}`)
      .sort((a,b)=>time(a.observedAt)-time(b.observedAt)||a.sourceUrl.localeCompare(b.sourceUrl)||a.pool.localeCompare(b.pool));
    // First observed quote wins before quality inspection. Never skip a bad early quote to select a profitable one.
    const entry=rows.find(point=>time(point.observedAt)>=entryTarget && time(point.observedAt)<=entryTarget+policy.quoteToleranceMs);
    if(!entry) return {...base,status:"missing-entry" as const};
    const exit=rows.find(point=>tokenSubjectIdentity(point.chain,point.pool)?.ref===tokenSubjectIdentity(entry.chain,entry.pool)?.ref && point.sourceUrl===entry.sourceUrl && time(point.observedAt)>=exitTarget && time(point.observedAt)<=exitTarget+policy.quoteToleranceMs);
    const receipts={...base,entryReceipt:entry.receiptHash,exitReceipt:exit?.receiptHash??null};
    if(entry.quality!=="corroborated" || entry.liquidityUsd<policy.minimumLiquidityUsd) return {...receipts,status:"unusable-entry" as const};
    if(!exit) return {...receipts,status:"missing-exit" as const};
    if(exit.quality!=="corroborated" || exit.liquidityUsd<policy.minimumLiquidityUsd) return {...receipts,status:"unusable-exit" as const};
    const ratio=exit.priceUsd/entry.priceUsd;
    const grossReturnPct=(ratio-1)*100, assumptionAdjustedReturnPct=(ratio*(1-policy.assumedRoundTripCostBps/10000)-1)*100;
    if(!Number.isFinite(grossReturnPct) || !Number.isFinite(assumptionAdjustedReturnPct)) return {...receipts,status:"unusable-exit" as const};
    return {...receipts,status:"measured" as const,grossReturnPct,assumptionAdjustedReturnPct};
  });
  const measured=outcomes.filter(row=>row.status==="measured");
  const matured=outcomes.filter(row=>row.status!=="pending");
  const prospectiveMeasured=measured.filter(row=>row.prospective);
  const mean=(rows:typeof measured)=>{
    if(!rows.length) return null;
    const value=rows.reduce((sum,row)=>sum+row.grossReturnPct!/rows.length,0);
    return Number.isFinite(value)?value:null;
  };
  return {version:1,cohortHash:cohort.hash,marketInputHash:hash(points),evaluatedAt,status:"research-only" as const,
    totalCandidates:outcomes.length,uniqueTokens:new Set(cohort.candidates.map(row=>`${row.chain}:${row.token}`)).size,
    prospectiveCandidates:outcomes.filter(row=>row.prospective).length,matured:matured.length,measured:measured.length,
    missingOrUnusable:matured.length-measured.length,
    coveragePct:matured.length?100*measured.length/matured.length:null,
    measuredProspective:prospectiveMeasured.length,
    meanMeasuredProspectiveGrossReturnPct:mean(prospectiveMeasured),
    meanMeasuredGrossReturnPct:mean(measured),
    outcomes,limitations:["Workspace-selected observations, not the complete launch population or an independent control cohort.",
      "Retrospectively registered candidates are marked and cannot establish prospective performance.",
      "Missing and unusable outcomes remain in coverage; measured-only returns can suffer survivorship bias.",
      "Multiple episodes from the same token are correlated, not independent successes.",
      "Quoted-price changes and assumed costs do not establish executable fills, realized returns or a profitable strategy.",
      "This evaluator never authorizes predictive alerts or changes report scores."]};
}
