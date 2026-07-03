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
  coverage?: string;      // 'rendered' | 'recovered' | 'gap' for site recon
  flags?: string[];       // caps, coverage gaps, contradictions worth surfacing
  contributor?: string;   // analyst who ran it (shared-log rows only; local rows omit it)
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

// Remove EVERY log row for one subject — local rows, the shared cache, and the
// shared backend (all contributors). Part of the start-from-scratch purge.
export function removeSubjectRows(ref: string): void {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/^[@$]/, "");
  // Also reduce a full URL to its bare host, so purging "enigma-fund.com" removes
  // legacy site rows logged under "https://www.enigma-fund.com/" (they key on
  // host now, but older rows stored the raw URL and would otherwise be orphaned).
  const host = (s?: string) => {
    const v = norm(s);
    try { return new URL(v.includes("://") ? v : `https://${v}`).hostname.replace(/^www\./, ""); } catch { return v; }
  };
  const target = norm(ref);
  const targetHost = host(ref);
  if (!target) return;
  const keep = (e: LogEntry) => {
    const k = norm(e.ref ?? e.query);
    return k !== target && host(e.ref ?? e.query) !== targetHost;
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(getLog().filter(keep)));
  } catch { /* storage unavailable */ }
  sharedCache = sharedCache.filter(keep);
  void fetch(`${SYNC_URL}?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => { /* offline */ });
  emitLogChange();
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
    const d = await r.json();
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
    const d = await r.json();
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
    if (e.coverage === "gap" || e.flags?.some((f) => /gap/i.test(f))) gaps += 1;
  }
  return { total: log.length, gaps, byKind };
}
