import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 10 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res);
  if (!auth) return;
  res.status(200).json({
    user: { id: auth.userId, email: auth.email, displayName: auth.displayName },
    organizationId: auth.organizationId,
    role: auth.role,
  });
}
