import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),collect:vi.fn()}));
vi.mock("./_auth.js",()=>({requireArgusAuth:mocks.auth}));
vi.mock("./_holder-enrichment.js",()=>({collectHolderIdentities:mocks.collect}));
import handler from "./holder-enrichment";
const addresses=Array.from({length:25},(_,i)=>`0x${(i+1).toString(16).padStart(40,"0")}`);
beforeEach(()=>{mocks.auth.mockReset().mockResolvedValue({organizationId:"one"});mocks.collect.mockReset().mockResolvedValue({state:"partial"});});
async function run(body:unknown={chain:"base",addresses},method="POST"){const out={status:0,body:{} as unknown};const res={setHeader:vi.fn(),status(n:number){out.status=n;return this;},json(b:unknown){out.body=b;return this;}};await handler({method,body} as never,res as never);return out;}
it("requires authenticated analyst access before contacting the provider",async()=>{mocks.auth.mockResolvedValue(null);await run();expect(mocks.collect).not.toHaveBeenCalled();});
it("accepts all 25 and rejects more, invalid addresses and non-collection methods",async()=>{expect((await run()).status).toBe(200);expect(mocks.collect).toHaveBeenCalledWith("base",addresses,"one");mocks.collect.mockClear();expect((await run({chain:"base",addresses:[...addresses,addresses[0]]})).status).toBe(400);expect((await run({chain:"base",addresses:["bad"]})).status).toBe(400);expect((await run(undefined,"GET")).status).toBe(405);expect(mocks.collect).not.toHaveBeenCalled();});
it("provider errors do not create a successful empty result",async()=>{mocks.collect.mockRejectedValue(new Error("offline"));expect((await run()).status).toBe(503);});
