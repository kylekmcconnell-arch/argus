import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import { tokenSubjectIdentity } from "../src/lib/tokenIdentity.js";
import { holderObservationAlerts, type SavedHolderSnapshot } from "../src/lib/holderAlerts.js";
export const config={maxDuration:15};
export default async function handler(req:VercelRequest,res:VercelResponse){
  const auth=await requireArgusAuth(req,res,"viewer");if(!auth)return;
  res.setHeader("cache-control","private, no-store");
  if(req.method!=="GET"){res.status(405).json({error:"method_not_allowed"});return;}
  const identity=tokenSubjectIdentity(req.query.chain,req.query.token);
  if(!identity){res.status(400).json({error:"valid_chain_and_token_required"});return;}
  const credentials=serviceCredentials();if(!credentials){res.status(200).json({available:false,note:"Saved observation storage is not configured."});return;}
  const query=new URLSearchParams({select:"report_version_id,captured_at,attestation_state,snapshot",organization_id:`eq.${auth.organizationId}`,
    chain:`eq.${identity.chain}`,token_address:`eq.${identity.address}`,order:"captured_at.desc,report_version_id.desc",limit:"21"});
  try{
    const r=await fetch(`${credentials.url}/rest/v1/holder_snapshot_history?${query}`,{headers:serviceHeaders(credentials.key),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error("Storage unavailable");const data:unknown=await r.json();if(!Array.isArray(data))throw new Error("Invalid storage response");
    const records=(data as SavedHolderSnapshot[]).filter(row=>tokenSubjectIdentity(row?.snapshot?.chain,row?.snapshot?.tokenAddress)?.ref===identity.ref);
    const alerts=holderObservationAlerts(records).slice(0,100);
    res.status(200).json({available:true,alerts,snapshotsRead:records.length,historyTruncated:data.length===21,
      note:"Saved-report observation alerts only. Partial, unordered or incompatible snapshots cannot establish movement. No alert does not mean no activity. These are not validated trading signals."});
  }catch{res.status(200).json({available:false,note:"Saved observation alerts could not be read. This is not an empty alert history."});}
}
