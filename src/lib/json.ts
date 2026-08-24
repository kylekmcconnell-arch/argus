/**
 * Narrowing helpers for provider JSON.
 *
 * Provider payloads are untrusted shapes. Reading them through `any` disables
 * the compiler exactly where the product is least able to afford a silent
 * mistake: the code that decides what counts as evidence. These accessors let a
 * payload enter as `unknown` and be read explicitly instead.
 *
 * Each helper reproduces the coercion the call sites already relied on when
 * they used `any` (`String(x ?? "")`, `Number(x ?? 0)`, `!!x`, optional
 * chaining into a missing object). Narrowing a file onto them is therefore a
 * type-level change, not a behavioural one.
 */

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Record view. A non-object reads as empty, so `rec(x).y` mirrors `x?.y`. */
export function rec(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

/** Array view. A non-array reads as empty, mirroring `Array.isArray(x) ? x : []`. */
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Mirrors `String(x ?? "")`: absent values read as the empty string. */
export function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * Mirrors `Number(x ?? 0)`. A present but non-numeric value still yields NaN,
 * as it did before; callers that cared already guarded with Number.isFinite.
 */
export function num(value: unknown): number {
  return value == null ? 0 : Number(value);
}

/** Mirrors `!!x`. */
export function bool(value: unknown): boolean {
  return Boolean(value);
}
