import { expect, it } from "vitest";
import { attachStoredFomo, validFomoObservation, type FomoWalletObservation } from "./fomoHolderEvidence";
import { buildHolderIntelligence } from "./holderIntelligence";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const now = "2026-09-24T12:00:00Z";
const snapshot = () => buildHolderIntelligence({ chain:"base", tokenAddress:addr(99), capturedAt:now, source:"fixture", ranked:true, rows:Array.from({length:25},(_,i)=>({address:addr(i+1),percent:1})) });
const observation = (): FomoWalletObservation => ({chain:"base",address:addr(25),capturedAt:"2026-09-20T00:00:00Z",sourceUrl:`https://api.fomoscan.sh/v2/user/wallet/${addr(25)}`,receiptHash:"a".repeat(64),state:"reported",label:"FOMO account"});
it("freezes a rank-25 provider attribution without changing registry matches or concentration",()=>{
  const input = snapshot();
  const result = attachStoredFomo(input,{state:"available",rows:[observation()]},now);
  expect(result.enrichment.fomo).toBe("partial");
  expect(result.rows[24].identities?.[0]).toMatchObject({provider:"fomo",capturedAt:"2026-09-20T00:00:00Z",label:"FOMO account"});
  expect(result.matched).toBe(input.matched); expect(result.supplyCoveredPct).toBe(input.supplyCoveredPct);
  expect(input.rows[24].identities).toBeUndefined();
});
it("withholds stale and future observations and distinguishes storage failure from no evidence",()=>{
  for(const capturedAt of ["2026-07-01T00:00:00Z","2026-09-25T00:00:00Z"]) expect(attachStoredFomo(snapshot(),{state:"available",rows:[{...observation(),capturedAt}]},now).enrichment.fomo).toBe("no-stored-evidence");
  expect(attachStoredFomo(snapshot(),{state:"unavailable",rows:[]},now).enrichment.fomo).toBe("unavailable");
});
it("rejects other chains, unrelated wallets, forged source paths and duplicate receipts",()=>{
  for(const rows of [[{...observation(),chain:"ethereum"}],[{...observation(),address:addr(26)}],[{...observation(),sourceUrl:"https://example.com"}],[observation(),observation()]]) expect(attachStoredFomo(snapshot(),{state:"available",rows},now).enrichment.fomo).toBe("unavailable");
});
it("a stored miss remains a dated provider miss and preserves Arkham evidence",()=>{
  const input=snapshot(); input.rows[24].identities=[{provider:"arkham",state:"reported",label:"Service",capturedAt:now,sourceUrl:"https://api.arkm.com",scope:"provider-address-label"}];
  const result=attachStoredFomo(input,{state:"available",rows:[{...observation(),state:"unlabelled",label:undefined}]},now);
  expect(result.rows[24].identities?.map(row=>row.provider)).toEqual(["arkham","fomo"]);
});

it("requires an EVM address on custom non-Solana chains",()=>{
  const address="not-an-evm-wallet";
  expect(validFomoObservation({...observation(),chain:"robinhood",address,sourceUrl:`https://api.fomoscan.sh/v2/user/wallet/${address}`})).toBe(false);
});
