import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consumeInvestigationQuota, refundInvestigationCredit, requireArgusAuth } from "./_auth.js";
import { claimScanReceipt, readScanReceipt, scanReceiptClaimInputValid } from "./_scanReceipts.js";
import { issueScanPanelToken } from "./_cache.js";

const KEY = /^[A-Za-z0-9:_-]{8,180}$/;
const KINDS = new Set(["token", "investigation"]);

/**
 * Credit reservation contract (docs/audits/2026-09-14/implementation-api.md):
 * the debit is idempotent on the client's creditKey and the receipt claim is
 * insert-only on the same key, so the key is the whole unit of work. A retry
 * MUST reuse the key: a replayed own-run reservation answers 200 without a
 * second charge, and an own-run claim failure holds the credit on the key
 * instead of orphaning it. Only a ledger failure means no credit moved.
 */
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
  const receipt = {
    runKey: idempotencyKey,
    route: "/app/scan",
    kind: kind as "token" | "investigation",
    canonicalRef,
    displayQuery,
    privateRun: body.privateRun === true,
    status: "running" as const,
    startedAt,
  };
  // Everything the receipt write would refuse is refused here, before the
  // ledger moves: a malformed start time used to debit and then fail to claim.
  if (!KEY.test(idempotencyKey) || !KINDS.has(kind) || !scanReceiptClaimInputValid(receipt)) {
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
      creditState: "none",
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
  const claim = await claimScanReceipt(auth, { ...receipt, creditsCharged: quota.used });
  if (claim === "written") {
    res.status(200).json({
      allowed: true,
      chargedCredits: quota.used,
      remainingCredits: quota.remaining,
      receiptRecorded: true,
      // The panels this scan is about to open have no report version yet, so
      // the capability is bound to the run instead (#356).
      ...(() => {
        const panelToken = issueScanPanelToken(auth.organizationId, idempotencyKey);
        return panelToken ? { panelToken } : {};
      })(),
    });
    return;
  }
  if (claim === "duplicate") {
    const existing = await readScanReceipt(auth, idempotencyKey);
    if (existing && existing !== "unavailable" && existing.initiatedBy === auth.userId) {
      // Same analyst, same key: the earlier reservation committed and this is
      // its retry (a lost response, a browser reload). The debit replayed
      // without a second charge; hand back the run instead of refusing it.
      res.status(200).json({
        allowed: true,
        chargedCredits: quota.used,
        remainingCredits: quota.remaining,
        receiptRecorded: true,
        replayed: true,
        receiptStatus: existing.status,
        reportVersionId: existing.reportVersionId,
      });
      return;
    }
    if (existing && existing !== "unavailable") {
      // Another analyst's run owns this key. This user's debit can never be
      // spent under it, so it is reversed; the key stays unusable for them.
      const refunded = await refundInvestigationCredit(auth, idempotencyKey, "scan_run_already_claimed");
      res.status(409).json({
        error: "scan_run_already_claimed",
        creditState: refunded ? "refunded" : "held",
        message: "This scan identifier belongs to another run. Start a new scan.",
      });
      return;
    }
  }
  res.status(503).json({
    error: "scan_run_claim_unavailable",
    creditState: "held",
    message: "ARGUS could not register this scan. Your credit is held on this scan identifier and retrying it will not charge again.",
  });
}
