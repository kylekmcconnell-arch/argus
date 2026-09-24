import { afterEach, expect, it, vi } from "vitest";
const mocked=vi.hoisted(()=>({labels:vi.fn()}));
vi.mock("./_arkham-core.js",()=>({fetchAddressLabelsBatch:mocked.labels,ARKHAM_INTEL_BATCH:"https://api.arkm.com/intelligence/address_enriched/batch/all"}));
import { collectHolderIdentities } from "./_holder-enrichment";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("does not spend a call without a key",async()=>{vi.stubEnv("ARKHAM_API_KEY","");expect((await collectHolderIdentities("base",["0x1111111111111111111111111111111111111111"])).state).toBe("not-configured");expect(mocked.labels).not.toHaveBeenCalled();});
it("retains a Solana label by its exact address and keeps sparse responses partial",async()=>{vi.stubEnv("ARKHAM_API_KEY","fixture");const sol="So11111111111111111111111111111111111111112",other="So11111111111111111111111111111111111111111";mocked.labels.mockResolvedValue({outcome:"answered",rows:new Map([[sol,{name:"Known service"}]]),calls:1,succeeded:1});const result=await collectHolderIdentities("solana",[sol,other]);expect(result.state).toBe("partial");expect(result.rows[0]).toMatchObject({address:sol,label:"Known service"});expect(result.rows[1].state).toBe("unavailable");});
