import type { ThreatScan } from "./types";

// The token's own launch moment, derived from the pair age the market audit
// recorded. Kept out of the report component so a panel can set a dated
// finding (a handle rename, a deployer's first transaction) against the launch
// it fronts, and so the arithmetic is testable on its own.
//
// Null when the age is unknown, which is normal for a token no index has dated
// - the caller must then say nothing about proximity rather than guess at it.
export function launchMs(scan: Pick<ThreatScan, "scannedAt" | "dossier">): number | null {
  const age = scan.dossier?.ageDays;
  return typeof age === "number" && Number.isFinite(age) ? scan.scannedAt - age * 86400000 : null;
}
