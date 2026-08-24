import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consumeInvestigationQuota, requireArgusAuth } from "./_auth.js";
import { recordScanReceipt } from "./_scanReceipts.js";

const KEY = /^[A-Za-z0-9:_-]{8,180}$/;
const KINDS = new Set(["token", "investigation"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "method_not_allowed" });
    return;
  }
  res.setHeader("cache-control", "private, no-store");
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const canonicalRef = typeof body.canonicalRef === "string" ? body.canonicalRef.trim() : "";
  const displayQuery = typeof body.displayQuery === "string" ? body.displayQuery.trim() : canonicalRef;
  const startedAt = typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString();
  if (!KEY.test(idempotencyKey) || !KINDS.has(kind) || !canonicalRef || !displayQuery) {
    res.status(400).json({
      error: "invalid_credit_reservation",
      message: "ARGUS could not identify this scan. Start it again from New investigation.",
    });
    return;
  }

  const quota = await consumeInvestigationQuota(
    auth,
    "/api/investigation-credit",
    { kind },
    idempotencyKey,
  );
  if (quota.error) {
    res.status(503).json({
      error: quota.error,
      message: "ARGUS could not check your credit balance. No providers were started and no credit was taken. Try again.",
    });
    return;
  }
  if (!quota.allowed) {
    res.status(429).json({
      error: "credit_budget_exhausted",
      remainingCredits: quota.creditRemaining ?? quota.remaining,
      message: "You have no investigation credits left. Ask a workspace owner to add credits before starting another scan.",
    });
    return;
  }
  const receiptRecorded = await recordScanReceipt(auth, {
    runKey: idempotencyKey,
    route: "/app/scan",
    kind: kind as "token" | "investigation",
    canonicalRef,
    displayQuery,
    privateRun: body.privateRun === true,
    status: "running",
    creditsCharged: quota.used,
    startedAt,
  });
  res.status(200).json({
    allowed: true,
    chargedCredits: quota.used,
    remainingCredits: quota.remaining,
    receiptRecorded,
  });
}
