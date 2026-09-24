import { collectHolderIdentities } from "../api/_holder-enrichment.js";
import { auditToken as collectToken } from "../src/token/audit";
import { getCost, withCostLedger } from "./cost";

/** Each server token run owns its paid-provider accounting context. */
export async function auditToken(...args: Parameters<typeof collectToken>) {
  return withCostLedger(async () => {
    const dossier = await collectToken(args[0], args[1], { ...args[2], enrichHolders: args[2]?.enrichHolders ?? collectHolderIdentities });
    return dossier ? { ...dossier, cost: getCost() } : null;
  });
}
