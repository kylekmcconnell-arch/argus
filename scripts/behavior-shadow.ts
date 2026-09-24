// Offline only. Registration and evaluation write new immutable artifacts, never overwrite.
import { readFileSync, writeFileSync } from "node:fs";
import { registerShadowCohort, evaluateShadowCohort, readShadowCohort } from "../server/behavior/shadow.js";
const [command, first, second, output, ...extra]=process.argv.slice(2);
if(!["register","evaluate"].includes(command)||!first||!second||!output||extra.length) throw new Error("Usage: tsx scripts/behavior-shadow.ts register <snapshots.json> <policy.json> <new-cohort.json> | evaluate <cohort.json> <market-points.json> <new-evaluation.json>");
const a=JSON.parse(readFileSync(first,"utf8")),b=JSON.parse(readFileSync(second,"utf8"));
const result=command==="register"?registerShadowCohort(a,b):evaluateShadowCohort(readShadowCohort(a),b);
writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({command,output,providerCalls:0,status:"research-only",note:"No predictive alert or trading action was enabled. Input file hashes are integrity receipts, not provider authentication."}));
