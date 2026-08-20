import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type SubjectCachePolicy = "reuse" | "refresh";

export interface AuditRunContextOptions {
  fresh?: boolean;
  scanId?: string;
}

interface AuditRunStore {
  scanId: string;
  subjectCachePolicy: SubjectCachePolicy;
  memos: Map<string, Map<string, unknown>>;
}

const storage = new AsyncLocalStorage<AuditRunStore>();
const fallbackMemos = new Map<string, Map<string, unknown>>();

function memoFor<T>(
  registry: Map<string, Map<string, unknown>>,
  namespace: string,
): Map<string, T> {
  const existing = registry.get(namespace);
  if (existing) return existing as Map<string, T>;
  const created = new Map<string, T>();
  registry.set(namespace, created as Map<string, unknown>);
  return created;
}

/**
 * Establishes one audit's cache policy and memo registry. AsyncLocalStorage
 * keeps overlapping server requests isolated without changing adapter APIs.
 */
export function withAuditRunContext<T>(
  options: AuditRunContextOptions,
  work: () => T,
): T {
  return storage.run({
    scanId: options.scanId ?? randomUUID(),
    subjectCachePolicy: options.fresh === true ? "refresh" : "reuse",
    memos: new Map(),
  }, work);
}

export function currentAuditScanId(): string | undefined {
  return storage.getStore()?.scanId;
}

export function currentSubjectCachePolicy(): SubjectCachePolicy {
  return storage.getStore()?.subjectCachePolicy ?? "reuse";
}

/**
 * Subject caches normally read through and write through. A full rescan skips
 * old subject values but writes successful live results for later standard
 * scans. Explicit provider canaries remain a stricter no-read/no-write mode.
 */
export function subjectCacheAccess(explicitBypass = false): { read: boolean; write: boolean } {
  if (explicitBypass) return { read: false, write: false };
  return currentSubjectCachePolicy() === "refresh"
    ? { read: false, write: true }
    : { read: true, write: true };
}

/**
 * Returns a memo scoped to the current audit. The fallback preserves direct
 * adapter/test callers that do not establish a run context.
 */
export function auditMemo<T>(namespace: string): Map<string, T> {
  const store = storage.getStore();
  return memoFor<T>(store?.memos ?? fallbackMemos, namespace);
}
