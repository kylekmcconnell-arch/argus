import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import {
  recordScanReceipt,
  type ScanCostBasis,
  type ScanReceiptKind,
  type ScanReceiptStatus,
} from "./_scanReceipts.js";

const KINDS = new Set<ScanReceiptKind>(["person", "token", "investigation", "site"]);
const TERMINAL = new Set<ScanReceiptStatus>(["complete", "degraded", "failed"]);
const COST_BASIS = new Set<ScanCostBasis>(["exact", "estimated", "unknown"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "method_not_allowed" });
    return;
  }
  res.setHeader("cache-control", "private, no-store");
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const kind = body.kind as ScanReceiptKind;
  const status = body.status as ScanReceiptStatus;
  const costBasis = (body.costBasis ?? "unknown") as ScanCostBasis;
  if (!KINDS.has(kind) || !TERMINAL.has(status) || !COST_BASIS.has(costBasis)) {
    res.status(400).json({ error: "invalid_scan_receipt" });
    return;
  }
  const ok = await recordScanReceipt(auth, {
    runKey: typeof body.runKey === "string" ? body.runKey : "",
    route: "/app/scan",
    kind,
    canonicalRef: typeof body.canonicalRef === "string" ? body.canonicalRef : "",
    displayQuery: typeof body.displayQuery === "string" ? body.displayQuery : "",
    privateRun: body.privateRun === true,
    status,
    creditsCharged: 1,
    reportVersionId: typeof body.reportVersionId === "string" ? body.reportVersionId : null,
    providerCostUsd: typeof body.providerCostUsd === "number" ? body.providerCostUsd : null,
    costBasis,
    startedAt: typeof body.startedAt === "string" ? body.startedAt : "",
    finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : new Date().toISOString(),
    durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
    failureCode: typeof body.failureCode === "string" ? body.failureCode : null,
    failureDetail: typeof body.failureDetail === "string" ? body.failureDetail : null,
  });
  if (!ok) {
    res.status(503).json({ error: "scan_receipt_unavailable", message: "The scan finished, but its operations receipt could not be saved." });
    return;
  }
  res.status(200).json({ ok: true });
}
