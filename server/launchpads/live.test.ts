import { expect, it, vi } from "vitest";
import { BANKR_LAUNCH_FEED, bankrStudyPages, publicCollector, rawHash, revenueHistory, revenueUrl, type RawReceipt } from "./live";
import { appendStudyPage, studyCoverage } from "./study";
function receipt(url:string,data:unknown,status=200):RawReceipt{const body=JSON.stringify(data);return {url,status,body,sha256:rawHash(body),capturedAt:"2026-09-24T00:00:00Z"};}
it("retains exact chain identity and never presents the recent Bankr sample as full history",()=>{
 const r=receipt(BANKR_LAUNCH_FEED,{launches:[{status:"deployed",chain:"base",tokenAddress:"0x1111111111111111111111111111111111111111",timestamp:1}]});
 const [p]=bankrStudyPages(r);const [c]=studyCoverage(appendStudyPage({version:1,receipts:[]},p));
 expect(c).toMatchObject({observed:1,populationReportedComplete:false});expect(c.rankings.every(r=>r.measured===0)).toBe(true);
 expect(()=>bankrStudyPages({...r,body:r.body+" "})).toThrow("receipt");
});
it("requires a unique valid address and an explicit supported chain",()=>{
 const r={status:"deployed",tokenAddress:"0x1111111111111111111111111111111111111111",timestamp:1};
 expect(()=>bankrStudyPages(receipt(BANKR_LAUNCH_FEED,{launches:[r]}))).toThrow("identity");
 expect(()=>bankrStudyPages(receipt(BANKR_LAUNCH_FEED,{launches:[{...r,chain:"base"},{...r,chain:"base"}]}))).toThrow("Duplicate");
});
it("does not bind a namesake revenue history or treat missing days as zero",()=>{
 const url=revenueUrl("bankr","dailyRevenue");
 expect(revenueHistory("bankr","dailyRevenue",receipt(url,{url:"https://other.example",totalDataChart:[[1,100]]})).state).toBe("identity-unbound");
 const result=revenueHistory("bankr","dailyRevenue",receipt(url,{url:"https://bankr.bot",totalDataChart:[[1727136000,10],[1727308800,0]]}));
 expect(result.state).toBe("reported");expect(result.points).toHaveLength(2);expect(result.note).toContain("not automatically creator payouts");
 expect(revenueHistory("bankr","dailyRevenue",receipt(url,{url:"https://bankr.bot",totalDataChart:[[1,null]]})).state).toBe("unavailable");
});
it("rejects over-budget calls and provider-controlled redirect destinations",async()=>{
 const fetcher=vi.fn(async(_url: string | URL | Request, _options?: RequestInit)=>Response.json({launches:[]}));const read=publicCollector(fetcher,1);
 const r=await read(BANKR_LAUNCH_FEED);expect(r.sha256).toBe(rawHash(r.body));
 await expect(read(BANKR_LAUNCH_FEED)).rejects.toThrow("budget");
 await expect(publicCollector(fetcher)("https://attacker.example")).rejects.toThrow("allowed");
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:"error"});
});
