import { createHash } from "node:crypto";
import { tokenSubjectIdentity } from "../../src/lib/tokenIdentity.js";
import { PLATFORMS, type Platform, type StudyPage } from "./study.js";

export const BANKR_LAUNCH_FEED = "https://api.bankr.bot/token-launches";
export const REVENUE_TYPES = ["dailyFees", "dailyRevenue", "dailySupplySideRevenue"] as const;
const sources: Record<Platform, { slug: string; domains: string[] }> = {
  bankr: {slug:"bankr",domains:["bankr.bot"]}, pumpfun:{slug:"pump",domains:["pump.fun"]},
  long:{slug:"long",domains:["long.xyz"]}, pons:{slug:"pons",domains:["ponsfamily.com"]},
  stonkbrokers:{slug:"stonkbrokers",domains:["stonkbrokers.cash"]}, letsbonk:{slug:"bonk.fun",domains:["letsbonk.fun","bonk.fun"]},
  stonkfun:{slug:"stonkfun",domains:["stonkfun.xyz"]}, bags:{slug:"bags",domains:["bags.fun","bags.fm"]},
};
export interface RawReceipt { url: string; capturedAt: string; status: number; sha256: string; body: string }
export const rawHash = (body: string) => createHash("sha256").update(body).digest("hex");
export function verifyRawReceipt(receipt: RawReceipt): void {
  if (!receipt || rawHash(receipt.body) !== receipt.sha256 || !Number.isFinite(Date.parse(receipt.capturedAt))) throw new Error("Invalid raw receipt");
}
/** Fixed public GET endpoints only. No credentials, paid calls, redirects or provider-supplied URLs. */
export function publicCollector(fetchImpl: typeof fetch = fetch, maxCalls = 25) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 25) throw new Error("Request budget must be 1..25");
  let calls = 0;
  return async (url: string): Promise<RawReceipt> => {
    const allowed = url === BANKR_LAUNCH_FEED || PLATFORMS.some(p => REVENUE_TYPES.some(t => url === revenueUrl(p,t)));
    if (!allowed || calls >= maxCalls) throw new Error("Source not allowed or request budget exhausted");
    calls++;
    const response = await fetchImpl(url, { redirect:"error",signal:AbortSignal.timeout(15000),headers:{accept:"application/json"} });
    const reader=response.body?.getReader(); let body="", size=0; const decoder=new TextDecoder();
    if (reader) while(true) { const chunk=await reader.read(); if(chunk.done) break; size+=chunk.value.byteLength;
      if(size>8_000_000){await reader.cancel();throw new Error("Provider response exceeded receipt limit");} body+=decoder.decode(chunk.value,{stream:true}); }
    body+=decoder.decode();
    return {url,capturedAt:new Date().toISOString(),status:response.status,sha256:rawHash(body),body};
  };
}
export function revenueUrl(platform: Platform, type: typeof REVENUE_TYPES[number]): string {
  return `https://api.llama.fi/summary/fees/${encodeURIComponent(sources[platform].slug)}?dataType=${type}&excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true`;
}
export function bankrStudyPages(receipt: RawReceipt): StudyPage[] {
  verifyRawReceipt(receipt);
  if(receipt.url!==BANKR_LAUNCH_FEED || receipt.status!==200) throw new Error("Bankr launch source unavailable");
  const data=JSON.parse(receipt.body);
  if(!Array.isArray(data?.launches) || data.launches.length>50) throw new Error("Unexpected Bankr launch response");
  const groups=new Map<string,StudyPage>();
  for(const row of data.launches){
    if(row.status!=="deployed") continue;
    if(typeof row.chain === "string" && !["base","robinhood"].includes(row.chain)) continue;
    const identity=tokenSubjectIdentity(row.chain,row.tokenAddress);
    if(!identity || !["base","robinhood"].includes(identity.chain) || !Number.isFinite(row.timestamp)
      || row.timestamp>Date.parse(receipt.capturedAt)) throw new Error("Launch identity or time is not established");
    let page=groups.get(identity.chain);
    if(!page){page={platform:"bankr",chain:identity.chain,asOf:receipt.capturedAt,collectedAt:receipt.capturedAt,sourceUrl:BANKR_LAUNCH_FEED,
      cursor:null,nextCursor:null,scope:"provider-sample",rows:[]};groups.set(identity.chain,page);}
    if(page.rows.some(r=>r.address===identity.address)) throw new Error("Duplicate Bankr identity");
    page.rows.push({address:identity.address,attribution:{status:"confirmed",method:"protocol-record",evidenceUrl:BANKR_LAUNCH_FEED},
      metrics:{},liquidityBasis:"unverified",marketCapBasis:"unknown",volumeQuality:"unreviewed",listings:[]});
  }
  return [...groups.values()];
}
export interface RevenueHistory {
  platform: Platform; category: typeof REVENUE_TYPES[number]; state:"reported"|"unavailable"|"identity-unbound";
  sourceUrl:string; capturedAt:string; receipt:string; unit:"USD"; scope:"provider-protocol-all-chains";
  points:Array<{day:string;value:number}>; note:string;
}
/** A slug is a lookup hint only. The returned protocol website must bind to the requested platform. */
export function revenueHistory(platform:Platform,category:typeof REVENUE_TYPES[number],receipt:RawReceipt):RevenueHistory {
  verifyRawReceipt(receipt);
  const base:RevenueHistory={platform,category,state:"unavailable",sourceUrl:receipt.url,capturedAt:receipt.capturedAt,receipt:receipt.sha256,
    unit:"USD",scope:"provider-protocol-all-chains",points:[],note:"Provider history unavailable; this is not zero revenue."};
  if(receipt.url!==revenueUrl(platform,category)||receipt.status!==200)return base;
  let data:Record<string,unknown>;try{data=JSON.parse(receipt.body);}catch{return base;}
  let host="";try{host=new URL(String(data.url)).hostname.replace(/^www\./,"");}catch{/* unbound */}
  if(!sources[platform].domains.includes(host))return {...base,state:"identity-unbound",note:"Returned protocol website did not bind this history to the requested platform."};
  if(!Array.isArray(data.totalDataChart))return base;
  const points:RevenueHistory["points"]=[],days=new Set<string>();
  for(const point of data.totalDataChart){
    if(!Array.isArray(point)||point.length!==2||typeof point[0]!=="number"||!Number.isFinite(point[0])||point[0]<0
      ||typeof point[1]!=="number"||!Number.isFinite(point[1])||point[1]<0)return base;
    const time=point[0]*1000;if(!Number.isFinite(time)||time>Date.parse(receipt.capturedAt))return base;
    const day=new Date(time).toISOString().slice(0,10);if(days.has(day))return base;days.add(day);points.push({day,value:point[1]});
  }
  if(!points.length)return base;
  return {...base,state:"reported",points:points.sort((a,b)=>a.day.localeCompare(b.day)),
    note:"DeFiLlama-reported protocol history across its tracked chains, not audited cash receipts. Missing days are unknown. Supply-side revenue is not automatically creator payouts; attribution and shared-wallet contamination need review."};
}
