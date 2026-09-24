import { expect, it } from "vitest";
import { registerShadowCohort, evaluateShadowCohort, readShadowCohort, type ShadowPolicy, type ShadowSnapshot, type ShadowMarketPoint } from "./shadow";
import { buildHolderIntelligence } from "../../src/lib/holderIntelligence";
const addr=(n:number)=>`0x${n.toString(16).padStart(40,"0")}`;
const policy:ShadowPolicy={version:1,name:"fixture-v1",patterns:["share-increased"],windowStart:"2026-09-20T00:00:00Z",windowEnd:"2026-09-21T00:00:00Z",entryDelayMs:60000,horizonMs:86400000,quoteToleranceMs:60000,minimumLiquidityUsd:10000,assumedRoundTripCostBps:100};
function saved(day:number,changed=false):ShadowSnapshot {
  const capturedAt=`2026-09-${day}T00:00:00Z`;
  const snapshot=buildHolderIntelligence({chain:"base",tokenAddress:addr(99),capturedAt,source:"fixture",ranked:true,rows:Array.from({length:25},(_,i)=>({address:addr(i+1),percent:changed && i<2?4:1}))});
  return {report_version_id:`v${day}`,attestation_state:"server_attested",saved_at:capturedAt,captured_at:capturedAt,snapshot};
}
const register=(records=[saved(20),saved(21,true)],registeredAt=policy.windowEnd)=>registerShadowCohort(records,policy,registeredAt);
function point(day:number,priceUsd:number):ShadowMarketPoint {
  const observedAt=`2026-09-${day}T00:01:00Z`;
  return {chain:"base",token:addr(99),pool:addr(200),observedAt,availableAt:observedAt,priceUsd,liquidityUsd:20000,quality:"corroborated",sourceUrl:"https://provider.example/pool",receiptHash:String(day%10).repeat(64)};
}
const evaluatedAt="2026-09-23T00:00:00Z";
it("registers one candidate per token episode with both changes and frozen inputs",()=>{
  const records=[saved(20),saved(21,true)],cohort=register(records);
  expect(cohort.candidates).toHaveLength(1); expect(cohort.candidates[0].changes).toHaveLength(2);
  records[1].snapshot.rows[0].percent=9;
  expect(cohort.candidates[0].changes[0].after).toBe(4);
  expect(()=>readShadowCohort({...cohort,registeredAt:evaluatedAt})).toThrow("receipt changed");
});
it("will not bridge an incomplete intervening observation",()=>{
  const records=[saved(19),saved(20),saved(21,true)];records[1].snapshot.status="partial";
  expect(register(records).candidates).toEqual([]);
});
it("uses report availability time rather than pretending evidence was known at capture",()=>{
  const rows=[saved(20),saved(21,true)];rows[1].saved_at="2026-09-21T00:10:00Z";
  expect(registerShadowCohort(rows,{...policy,windowEnd:rows[1].saved_at},rows[1].saved_at).candidates[0].availableAt).toBe(new Date(rows[1].saved_at).toISOString());
});
it("rejects unattested, future or ambiguous duplicate snapshots",()=>{
  const rows=[saved(20),saved(21,true)];rows[1].attestation_state="client_submitted";
  expect(()=>register(rows)).toThrow();expect(()=>register([saved(20),saved(20)])).toThrow("Duplicate");
  expect(()=>register(undefined,"2026-09-20T00:00:00Z")).toThrow("Unclosed");
});
it("measures quoted-price outcomes and keeps modeled costs separate from realized returns",()=>{
  const result=evaluateShadowCohort(register(),[point(21,1),point(22,2)],evaluatedAt);
  expect(result.status).toBe("research-only");expect(result.totalCandidates).toBe(1);expect(result.uniqueTokens).toBe(1);
  expect(result.outcomes[0]).toMatchObject({status:"measured",prospective:true,grossReturnPct:100,assumptionAdjustedReturnPct:98});
  expect(result.coveragePct).toBe(100);
});
it("retains missing exits in the denominator instead of reporting surviving winners as complete",()=>{
  const result=evaluateShadowCohort(register(),[point(21,1)],evaluatedAt);
  expect(result).toMatchObject({matured:1,measured:0,missingOrUnusable:1,coveragePct:0,meanMeasuredGrossReturnPct:null});
  expect(result.outcomes[0].status).toBe("missing-exit");
});
it("does not substitute another pool or skip an unusable first quote",()=>{
  const otherPool={...point(22,2),pool:addr(201)};
  expect(evaluateShadowCohort(register(),[point(21,1),otherPool],evaluatedAt).outcomes[0].status).toBe("missing-exit");
  const bad={...point(21,1),quality:"suspected-artificial" as const};
  const later={...point(21,1),observedAt:"2026-09-21T00:01:30Z",availableAt:"2026-09-21T00:01:30Z"};
  expect(evaluateShadowCohort(register(),[bad,later,point(22,2)],evaluatedAt).outcomes[0].status).toBe("unusable-entry");
});
it("marks retrospective registrations, keeps immature outcomes pending and rejects future price evidence",()=>{
  expect(evaluateShadowCohort(register(undefined,evaluatedAt),[point(21,1),point(22,2)],evaluatedAt).outcomes[0].prospective).toBe(false);
  expect(evaluateShadowCohort(register(),[],"2026-09-21T00:05:00Z").outcomes[0].status).toBe("pending");
  expect(()=>evaluateShadowCohort(register(),[point(24,2)],evaluatedAt)).toThrow();
  expect(()=>evaluateShadowCohort(register(),[point(21,1),point(21,2)],evaluatedAt)).toThrow("Duplicate market");
});
it("does not publish an empty cohort as zero return or complete coverage",()=>{
  const result=evaluateShadowCohort(register([saved(20),saved(21)]),[],evaluatedAt);
  expect(result).toMatchObject({totalCandidates:0,coveragePct:null,meanMeasuredGrossReturnPct:null});
});

it("uses predeclared event patterns instead of selecting them from later outcomes",()=>{
  expect(registerShadowCohort([saved(20),saved(21,true)],{...policy,patterns:["share-decreased"]},policy.windowEnd).candidates).toEqual([]);
});
