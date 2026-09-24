// Fixed, free public sources. Raw provider responses remain local and never enter Git.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PLATFORMS, appendStudyPage, studyCoverage, type StudyLedger } from "../server/launchpads/study.js";
import { BANKR_LAUNCH_FEED, REVENUE_TYPES, publicCollector, bankrStudyPages, revenueHistory, revenueUrl, verifyRawReceipt, type RawReceipt } from "../server/launchpads/live.js";
const [directory,...flags]=process.argv.slice(2);
if(!directory||flags.some(f=>f!=="--resume"))throw new Error("Usage: tsx scripts/launchpad-live.ts <private-output-directory> [--resume]");
await mkdir(directory,{recursive:flags.includes("--resume")});
const lock=join(directory,".collection-lock");
const handle=await import("node:fs/promises").then(fs=>fs.open(lock,"wx"));
const collect=publicCollector();
const read=async(url:string):Promise<RawReceipt>=>{
  const key=await import("node:crypto").then(c=>c.createHash("sha256").update(url).digest("hex"));
  const path=join(directory,`${key}.receipt.json`);
  if(flags.includes("--resume"))try{const r=JSON.parse(await readFile(path,"utf8"));verifyRawReceipt(r);if(r.url!==url)throw new Error("Receipt source mismatch");return r;}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  const receipt=await collect(url);await writeFile(path,JSON.stringify(receipt),{flag:"wx",mode:0o600});return receipt;
};
try{
  const gaps:string[]=[];let ledger:StudyLedger={version:1,receipts:[]};
  try{const raw=await read(BANKR_LAUNCH_FEED);for(const page of bankrStudyPages(raw))ledger=appendStudyPage(ledger,page);const total=JSON.parse(raw.body).launches.length;const used=ledger.receipts.reduce((n,r)=>n+r.page.rows.length,0);if(used<total)gaps.push(`${total-used} Bankr rows outside the configured Base/Robinhood scope or not deployed; retained in the raw receipt.`);}catch(e){gaps.push(`Bankr recent launch feed: ${(e as Error).message}`);}
  const histories=[];
  for(const platform of PLATFORMS)for(const type of REVENUE_TYPES){
    try{histories.push(revenueHistory(platform,type,await read(revenueUrl(platform,type))));}catch(e){gaps.push(`${platform}/${type}: ${(e as Error).message}`);}
  }
  const output={generatedAt:new Date().toISOString(),ledger,coverage:studyCoverage(ledger),histories,gaps,
    limitations:["Bankr is the latest 50 launches only, not a launch-history backfill.","Other platform launch histories are not collected by these endpoints.","Revenue categories remain provider reports, not verified creator cash receipts.","Rankings, CEX histories, stock-pair outcomes and holder enrichment are separate collections."]};
  const result=join(directory,`collection-${Date.now()}.json`);await writeFile(result,JSON.stringify(output,null,2),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({result,launches:ledger.receipts.reduce((n,r)=>n+r.page.rows.length,0),histories:histories.map(h=>({platform:h.platform,category:h.category,state:h.state,days:h.points.length})),gaps},null,2));
}finally{await handle.close();await import("node:fs/promises").then(fs=>fs.unlink(lock));}
