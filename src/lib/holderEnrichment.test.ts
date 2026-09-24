import { expect, it } from "vitest";
import { buildHolderIntelligence } from "./holderIntelligence";
import { attachHolderIdentities, enrichHolderSnapshot, type HolderIdentityBatch } from "./holderEnrichment";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const snapshot = () => buildHolderIntelligence({ chain: "base", tokenAddress: addr(99), capturedAt: "2026-09-24T00:00:00Z", source: "fixture", ranked: true,
  rows: Array.from({length:25}, (_,i)=>({ address:addr(i+1),percent:1 })) });
const batch = (): HolderIdentityBatch => ({chain:"base",provider:"arkham",state:"complete",capturedAt:"2026-09-24T01:00:00Z",sourceUrl:"https://api.arkm.com/intelligence/address_enriched/batch/all",scope:"provider-address-label",rows:[{address:addr(25),state:"reported",label:"Provider label"}]});
it("joins rank 25, preserves the frozen input and does not mistake missing provider rows for completed checks", () => {
  const input=snapshot(), result=attachHolderIdentities(input,batch());
  expect(result.enrichment.arkham).toBe("partial");
  expect(result.rows[24].identities?.[0].label).toBe("Provider label");
  expect(result.rows[0].identities?.[0].state).toBe("unavailable");
  expect(input.rows[24].identities).toBeUndefined();
  expect(result.rows[24].matches).toEqual(input.rows[24].matches);
  expect(result.status).toBe(input.status);
});
it("rejects unrelated identities and chains without attaching someone else's provider labels", () => {
  const input=snapshot();
  expect(attachHolderIdentities(input,{...batch(),chain:"ethereum"})).toBe(input);
  expect(attachHolderIdentities(input,{...batch(),rows:[{address:addr(26),state:"reported",label:"Wrong"}]})).toBe(input);
});
it("provider failure stays unavailable rather than a clean identity screen", async () => {
  const result=await enrichHolderSnapshot(snapshot(),async()=>{throw new Error("429");});
  expect(result.enrichment.arkham).toBe("unavailable");
});
it("never folds case-sensitive Solana identities together", () => {
  const mint="So11111111111111111111111111111111111111112";
  const input=buildHolderIntelligence({chain:"solana",tokenAddress:mint,capturedAt:"2026-09-24T00:00:00Z",source:"fixture",ranked:false,rows:[{address:mint,percent:1}]});
  expect(attachHolderIdentities(input,{...batch(),chain:"solana",rows:[{address:mint.toLowerCase(),state:"reported",label:"Wrong case"}]})).toBe(input);
});

it("invalid or empty provider labels cannot imply completed enrichment", async () => {
  const result = await enrichHolderSnapshot(snapshot(), async () => ({...batch(), chain:"ethereum"}));
  expect(result.enrichment.arkham).toBe("unavailable");
  const empty = attachHolderIdentities(snapshot(), {...batch(), rows:[{address:addr(25),state:"reported",label:" "}]});
  expect(empty.enrichment.arkham).toBe("unavailable");
});

it("carries stored Fomo evidence through collection even when Arkham is unconfigured",async()=>{
  const input=snapshot();
  const result=await enrichHolderSnapshot(input,async()=>({...batch(),state:"not-configured",rows:[],storedFomo:{state:"available",rows:[{chain:"base",address:addr(25),capturedAt:"2026-09-23T00:00:00Z",sourceUrl:`https://api.fomoscan.sh/v2/user/wallet/${addr(25)}`,receiptHash:"a".repeat(64),state:"reported",label:"Stored trader"}]}}));
  expect(result.enrichment).toEqual({arkham:"not-configured",fomo:"partial"});
  expect(result.rows[24].identities?.find(row=>row.provider==="fomo")?.label).toBe("Stored trader");
});
