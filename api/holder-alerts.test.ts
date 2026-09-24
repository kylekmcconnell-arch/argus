import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth=vi.hoisted(()=>({requireArgusAuth:vi.fn(),serviceCredentials:vi.fn(),serviceHeaders:vi.fn(()=>({apikey:"fixture"}))}));
vi.mock("./_auth.js",()=>auth);
import handler from "./holder-alerts";
const token="0x1111111111111111111111111111111111111111";
const fetcher=vi.fn();
beforeEach(()=>{auth.requireArgusAuth.mockReset().mockResolvedValue({organizationId:"tenant-a"});auth.serviceCredentials.mockReturnValue({url:"https://db.example",key:"fixture"});fetcher.mockReset().mockResolvedValue(Response.json([]));vi.stubGlobal("fetch",fetcher);});afterEach(()=>vi.unstubAllGlobals());
async function run(method="GET",query={chain:"base",token}){const out={status:0,body:{} as Record<string,unknown>};const res={setHeader:vi.fn(),status(n:number){out.status=n;return this;},json(body:Record<string,unknown>){out.body=body;return this;}};await handler({method,query} as never,res as never);return out;}
it("binds history to the authenticated workspace and exact token",async()=>{expect((await run()).body).toMatchObject({available:true,alerts:[]});const q=new URL(fetcher.mock.calls[0][0]).searchParams;expect(q.get("organization_id")).toBe("eq.tenant-a");expect(q.get("token_address")).toBe(`eq.${token}`);expect(q.get("limit")).toBe("21");});
it("does not contact storage for unauthorized or invalid requests",async()=>{auth.requireArgusAuth.mockResolvedValue(null);await run();expect(fetcher).not.toHaveBeenCalled();auth.requireArgusAuth.mockResolvedValue({organizationId:"tenant-a"});expect((await run("POST")).status).toBe(405);expect((await run("GET",{chain:"base",token:"bad"})).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
it("storage failure is not an empty successful alert history",async()=>{fetcher.mockResolvedValue(new Response("offline",{status:503}));const r=await run();expect(r.body.available).toBe(false);expect(r.body).not.toHaveProperty("alerts");});
