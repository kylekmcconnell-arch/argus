// Every audit that runs is logged locally — the analyst's own record, for
// self-verification ("what did we actually return for that query?") and the
// beginnings of the data asset. Persisted to localStorage until there is a
// backend; capped so it cannot grow unbounded.

export type AuditKind = "site" | "token" | "person";

export interface LogEntry {
  id: string;
  ts: number;
  kind: AuditKind;
  query: string;          // display label (e.g. $SYMBOL, @handle, a site URL)
  ref?: string;           // the re-runnable identifier (contract / handle / url)
  image?: string;         // logo/photo URL captured at audit time (e.g. token logo)
  verdict?: string;       // PASS/CAUTION/FAIL/AVOID, or site coverage status
  score?: number | null;
  summary: string;        // one-line takeaway (identity line / headline)
  coverage?: string;      // decision readiness, or rendered/recovered/gap for site recon
  flags?: string[];       // caps, coverage gaps, contradictions worth surfacing
  contributor?: string;   // analyst who ran it (shared-log rows only; local rows omit it)
}

const COMPLETE_COVERAGE = new Set(["ready", "complete", "rendered", "recovered"]);

/**
 * Positive scores stay available for auditability, but never present as final
 * clearance when their evidence coverage is partial, unknown, or missing.
 * Negative verdicts are preserved because incomplete coverage cannot erase a
 * risk already found.
 */
export function presentedAuditVerdict(entry: Pick<LogEntry, "verdict" | "coverage">): string | undefined {
  if (!entry.verdict || entry.verdict !== "PASS") return entry.verdict;
  return COMPLETE_COVERAGE.has((entry.coverage ?? "").toLowerCase()) ? entry.verdict : "INCOMPLETE";
}

export function auditReadinessLabel(entry: Pick<LogEntry, "verdict" | "coverage">): string | undefined {
  const presented = presentedAuditVerdict(entry);
  if (presented !== "INCOMPLETE") return presented;
  return entry.coverage?.toLowerCase() === "provisional" ? "PROVISIONAL" : "INCOMPLETE";
}

export function hasCoverageGap(entry: Pick<LogEntry, "kind" | "verdict" | "coverage" | "flags">): boolean {
  if (entry.coverage?.toLowerCase() === "gap" || entry.flags?.some((flag) => /gap/i.test(flag))) return true;
  if (entry.kind === "site" || !entry.verdict) return false;
  return !COMPLETE_COVERAGE.has((entry.coverage ?? "").toLowerCase());
}

const KEY = "argus:auditlog";
const CAP = 250;
const SYNC_URL = "/api/auditlog";

export function getLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

let counter = 0;
function makeId(ts: number): string {
  // deterministic-enough id without Math.random; ts + a per-session counter
  counter += 1;
  return `${ts.toString(36)}-${counter.toString(36)}`;
}

export function logAudit(e: Omit<LogEntry, "id" | "ts">): LogEntry {
  const ts = Date.now();
  const entry: LogEntry = { ...e, id: makeId(ts), ts };
  let isNew = true;
  try {
    const log = getLog();
    // de-dupe an immediate repeat of the same query+kind within 5s
    const recent = log[0];
    if (!(recent && recent.kind === e.kind && recent.query === e.query && ts - recent.ts < 5000)) {
      log.unshift(entry);
      localStorage.setItem(KEY, JSON.stringify(log.slice(0, CAP)));
    } else {
      isNew = false;
    }
  } catch {
    /* storage unavailable — non-fatal */
  }
  if (isNew) { void syncEntry(entry); emitLogChange(); }
  return entry;
}

export function clearLog(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  emitLogChange();
}

// ── shared audit log: push up on write, hydrate down on load ────────────────
type LogListener = () => void;
const listeners = new Set<LogListener>();
export function subscribeLog(cb: LogListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function emitLogChange(): void {
  for (const cb of [...listeners]) { try { cb(); } catch { /* */ } }
}

async function syncEntry(entry: LogEntry): Promise<void> {
  try {
    const { getAnalyst } = await import("./analyst");
    await fetch(SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...entry, contributor: getAnalyst() }),
    });
  } catch {
    /* offline or no backend — the local log still holds it */
  }
}

// Push an UPDATED entry up (merge-upsert). Shared rows carry client_id as their
// id and keep their original contributor; local rows re-derive both.
async function syncEntryUpdate(entry: LogEntry, sharedRow: boolean): Promise<void> {
  try {
    const { getAnalyst } = await import("./analyst");
    const body = sharedRow
      ? { ...entry, client_id: entry.id, contributor: entry.contributor ?? "anonymous", mode: "update" }
      : { ...entry, contributor: getAnalyst(), mode: "update" };
    await fetch(SYNC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    /* offline — local view is still updated */
  }
}

// Rewrite the role: flags on every stored row for one subject — local rows and
// shared (other analysts') rows — and push the updates up. This is how
// re-categorization re-files old audits WITHOUT rerunning them: scores and
// verdicts stay, only the taxonomy flags change.
export function applyRoles(ref: string, roles: string[]): void {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^[@$]/, "");
  const target = norm(ref);
  if (!target) return;
  const rewrite = (e: LogEntry): LogEntry => ({
    ...e,
    flags: [...(e.flags ?? []).filter((f) => !/^role:/i.test(f)), ...roles.map((r) => `role:${r}`)],
  });
  try {
    const log = getLog();
    let changed = false;
    const next = log.map((e) => {
      if (e.kind !== "person" || norm(e.ref ?? e.query) !== target) return e;
      changed = true;
      const ne = rewrite(e);
      void syncEntryUpdate(ne, false);
      return ne;
    });
    if (changed) localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
  sharedCache = sharedCache.map((e) => {
    if (e.kind !== "person" || norm(e.ref ?? e.query) !== target) return e;
    const ne = rewrite(e);
    void syncEntryUpdate(ne, true);
    return ne;
  });
  emitLogChange();
}

// Reconcile the NEWEST logged row for a subject with the ACTIVE stored outcome.
// The sidebar chip reads the newest row -- i.e. "the last RUN this browser saw"
// -- while the case page shows the server's active (best-qualified) version.
// When a run's version does not become the active projection, the chip goes
// stale-wrong (observed: chip "80 · provisional" while the opened case shows
// "82 · DECISION-READY"). Opening the case is the moment the client learns the
// server truth, so fold it back into the newest row. Only the newest matching
// row is touched (older rows are the historical record), and only when a value
// actually differs.
export function reconcileAuditOutcome(
  ref: string,
  kind: AuditKind,
  outcome: { verdict?: string; score?: number | null; coverage?: string; summary?: string },
): void {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^[@$]/, "");
  const target = norm(ref);
  if (!target) return;
  const differs = (e: LogEntry): boolean =>
    (outcome.verdict !== undefined && e.verdict !== outcome.verdict)
    || (outcome.score !== undefined && e.score !== outcome.score)
    || (outcome.coverage !== undefined && e.coverage !== outcome.coverage);
  const rewrite = (e: LogEntry): LogEntry => ({
    ...e,
    ...(outcome.verdict !== undefined ? { verdict: outcome.verdict } : {}),
    ...(outcome.score !== undefined ? { score: outcome.score } : {}),
    ...(outcome.coverage !== undefined ? { coverage: outcome.coverage } : {}),
    ...(outcome.summary ? { summary: outcome.summary } : {}),
  });
  const reconcileNewest = (rows: LogEntry[], sharedRow: boolean): { rows: LogEntry[]; changed: boolean } => {
    const index = rows.findIndex((e) => e.kind === kind && norm(e.ref ?? e.query) === target);
    if (index < 0 || !differs(rows[index])) return { rows, changed: false };
    const next = [...rows];
    next[index] = rewrite(rows[index]);
    void syncEntryUpdate(next[index], sharedRow);
    return { rows: next, changed: true };
  };
  let changed = false;
  try {
    const local = reconcileNewest(getLog(), false);
    if (local.changed) {
      localStorage.setItem(KEY, JSON.stringify(local.rows));
      changed = true;
    }
  } catch { /* storage unavailable */ }
  const shared = reconcileNewest(sharedCache, true);
  if (shared.changed) {
    sharedCache = shared.rows;
    changed = true;
  }
  if (changed) emitLogChange();
}

let sharedCache: LogEntry[] = [];
let hydrated = false;
// The community feed (all analysts), fetched once per session. Kept SEPARATE
// from the local log so "mine" and "community" stay distinguishable; callers
// merge them via mergedLog(). No-op when no backend is configured.
export async function hydrateSharedLog(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const r = await fetch(SYNC_URL, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return;
    const d = await r.json() as { available?: boolean; entries?: LogEntry[] };
    if (d?.available === false || !Array.isArray(d?.entries)) return;
    sharedCache = d.entries as LogEntry[];
    emitLogChange();
    // Backfill: any LOCAL row the shared log has never seen (audits run before
    // sync existed, or that failed to sync) gets pushed up now — so server-side
    // maintenance (re-categorization, cleanups) can reach every audit, not just
    // the ones that happened to sync.
    const sharedIds = new Set(sharedCache.map((e) => (e.id.includes(":") ? e.id.slice(e.id.lastIndexOf(":") + 1) : e.id)));
    const missing = getLog().filter((e) => !sharedIds.has(e.id)).slice(0, 40);
    for (const e of missing) void syncEntry(e);
  } catch {
    /* stay local-only */
  }
}

// Re-pull the community feed (bypasses the once-per-session guard). Used by the
// Trending page to keep the live ranking fresh as other analysts' scans land.
export async function refreshSharedLog(): Promise<void> {
  try {
    const r = await fetch(SYNC_URL, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return;
    const d = await r.json() as { available?: boolean; entries?: LogEntry[] };
    if (d?.available === false || !Array.isArray(d?.entries)) return;
    sharedCache = d.entries as LogEntry[];
    emitLogChange();
  } catch {
    /* keep the last snapshot */
  }
}

export function getSharedLog(): LogEntry[] {
  return sharedCache;
}

// Local + community, de-duped by id, newest first. Local entries win (they carry
// the freshest "mine" view) — EXCEPT role flags, where the shared log is the
// reconciled truth: a re-categorization (run by any analyst, or server-side)
// updates the shared rows, and every browser adopts the corrected roles on the
// next hydrate without anyone re-clicking anything. Shared row ids are
// "<contributor>:<localId>", so we match on the id suffix.
export function mergedLog(): LogEntry[] {
  const local = getLog();
  const byId = new Map(local.map((e) => [e.id, e]));
  const out: LogEntry[] = local.map((e) => ({ ...e }));
  const outById = new Map(out.map((e) => [e.id, e]));
  for (const e of sharedCache) {
    const suffix = e.id.includes(":") ? e.id.slice(e.id.lastIndexOf(":") + 1) : e.id;
    const localMatch = byId.get(e.id) ?? byId.get(suffix);
    if (localMatch) {
      const sharedRoles = (e.flags ?? []).filter((f) => /^role:/i.test(f));
      const localRoles = (localMatch.flags ?? []).filter((f) => /^role:/i.test(f));
      if (sharedRoles.length && sharedRoles.join("|") !== localRoles.join("|")) {
        const target = outById.get(localMatch.id)!;
        target.flags = [...(target.flags ?? []).filter((f) => !/^role:/i.test(f)), ...sharedRoles];
      }
      continue;
    }
    out.push(e);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

export function logStats(log: LogEntry[]): { total: number; gaps: number; byKind: Record<AuditKind, number> } {
  const byKind: Record<AuditKind, number> = { site: 0, token: 0, person: 0 };
  let gaps = 0;
  for (const e of log) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (hasCoverageGap(e)) gaps += 1;
  }
  return { total: log.length, gaps, byKind };
}
