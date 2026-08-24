export type ClientScanReceiptStatus = "complete" | "degraded" | "failed";

export interface FinishScanReceiptInput {
  runKey: string;
  kind: "token" | "investigation";
  canonicalRef: string;
  displayQuery: string;
  privateRun: boolean;
  startedAt: number;
  status: ClientScanReceiptStatus;
  reportVersionId?: string;
  providerCostUsd?: number | null;
  costBasis?: "exact" | "estimated" | "unknown";
  failureCode?: string;
  failureDetail?: string;
}

/** Best-effort operations receipt. It never replaces the scan result. */
export async function finishScanReceipt(input: FinishScanReceiptInput): Promise<boolean> {
  try {
    const finishedAt = Date.now();
    const response = await fetch("/api/scan-receipt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...input,
        route: "/app/scan",
        startedAt: new Date(input.startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: Math.max(0, finishedAt - input.startedAt),
        creditsCharged: 1,
        costBasis: input.costBasis ?? "unknown",
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
