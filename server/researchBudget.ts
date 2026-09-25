/** Explicit research-job authorization; customer scan quotas are independent. */
export function researchBudget(cap: number, noSpendCap: boolean, dryRun: boolean): number {
  if (!Number.isSafeInteger(cap) || cap < 0) throw new Error("Budget must be a finite non-negative integer CU amount");
  if (noSpendCap && cap > 0) throw new Error("Choose --no-spend-cap or --budget-cu, not both");
  if (!dryRun && !noSpendCap && cap === 0) throw new Error("Live collection requires --budget-cu N or --no-spend-cap");
  return noSpendCap ? Number.POSITIVE_INFINITY : cap;
}
