import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
export const config = { maxDuration: 30 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "GET") { res.setHeader("allow", "GET"); res.status(405).json({ error: "method_not_allowed" }); return; }
  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) { res.status(503).json({ available: false, message: "Database inventory is unavailable." }); return; }
  try {
    const response = await fetch(`${credentials.url}/rest/v1/rpc/get_data_program_inventory`, {
      method: "POST", headers: serviceHeaders(credentials.key),
      body: JSON.stringify({ p_organization_id: auth.organizationId }), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error("inventory read failed");
    const inventory = await response.json();
    if (inventory?.version !== 1 || !Array.isArray(inventory.datasets) || !inventory.dailySpend) throw new Error("invalid inventory");
    res.status(200).json({ available: true, ...inventory });
  } catch {
    res.status(503).json({ available: false, message: "Database inventory could not be read. This is not an empty database." });
  }
}
