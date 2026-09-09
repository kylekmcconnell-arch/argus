import { auditToken as collectToken } from "../src/token/audit";
import { getCost, withCostLedger } from "./cost";

/** Each server token run owns its paid-provider accounting context. */
export async function auditToken(...args: Parameters<typeof collectToken>) {
  return withCostLedger(async () => {
    const dossier = await collectToken(...args);
    return dossier ? { ...dossier, cost: getCost() } : null;
  });
}
