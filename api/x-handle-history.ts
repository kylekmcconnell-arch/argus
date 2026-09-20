// Prior X screen names for an account. GET /api/x-handle-history?handle=
//
// A project account that answered to a different name last month is the classic
// recycled-handle setup: buy or repurpose an aged account, rename it, and front
// a new launch on borrowed account age and followers. X publishes a JOIN date,
// not a handle history, so the rename is invisible on the profile - the account
// reads as "since 2013" while the identity it is wearing is weeks old.
//
// memory.lol indexes historical screen names per account id (Wayback Machine +
// the Twitter stream grab). Keyless and free, so this runs on every scan.
//
// Two distinct signals come out of it, and they are NOT the same thing:
//   - the ACCOUNT was renamed        -> one id, several screen names over time
//   - the HANDLE changed hands       -> several ids have worn this screen name
// The second is the more dangerous one: the @name a project links today may
// have belonged to someone else entirely, so its history and its reputation
// are not the account's own.
//
// Coverage is partial by construction (it is an archive, not a registry), so a
// miss is reported as "unknown" and never as "clean". Dates are OBSERVATION
// dates - when the archive saw the name in use - not exact rename timestamps,
// and the response says so rather than implying a precision it does not have.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const HANDLE = /^[A-Za-z0-9_]{1,20}$/;
const UPSTREAM = "https://api.memory.lol/v1/tw/";
// An account with a long rename history is interesting, but the response has to
// stay bounded - a report panel cannot render hundreds of rows, and an
// unbounded upstream list should never become an unbounded response body.
const MAX_NAMES = 40;
const MAX_ACCOUNTS = 10;

export type HandleHistoryStatus = "renamed" | "single" | "unknown";

export interface HandleObservation {
  handle: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface HandleHistoryAccount {
  id: string;
  names: HandleObservation[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

// memory.lol dates arrive as ["YYYY-MM-DD"] or ["YYYY-MM-DD","YYYY-MM-DD"], and
// may be null when the archive has the name but no dated sighting.
function dates(value: unknown): { firstSeen: string | null; lastSeen: string | null } {
  if (!Array.isArray(value)) return { firstSeen: null, lastSeen: null };
  const seen = value.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { firstSeen: seen[0] ?? null, lastSeen: seen[seen.length - 1] ?? null };
}

function parseAccounts(payload: unknown): HandleHistoryAccount[] {
  if (!isRecord(payload) || !Array.isArray(payload.accounts)) return [];
  return payload.accounts.slice(0, MAX_ACCOUNTS).flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id_str === "string" ? raw.id_str
      : typeof raw.id === "number" || typeof raw.id === "string" ? String(raw.id)
        : "";
    if (!isRecord(raw.screen_names)) return [];
    const names = Object.entries(raw.screen_names)
      .slice(0, MAX_NAMES)
      .map(([handle, seen]) => ({ handle, ...dates(seen) }))
      // Oldest first, undated last, so the timeline reads in order.
      .sort((a, b) => (a.firstSeen ?? "9999").localeCompare(b.firstSeen ?? "9999"));
    return names.length ? [{ id, names }] : [];
  });
}

async function fetchHistory(handle: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${UPSTREAM}${encodeURIComponent(handle)}`, {
      headers: { accept: "application/json", "user-agent": "ARGUS-handle-history" },
      signal: AbortSignal.timeout(8000),
    });
    // 404 is memory.lol's "no record", which is a real answer (unknown), not an
    // error - but it is still not evidence the account was never renamed.
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function describe(
  handle: string,
  current: HandleObservation | null,
  priors: HandleObservation[],
  accountCount: number,
): string {
  if (!priors.length && accountCount <= 1) {
    return `memory.lol has no prior screen name for @${handle} - no rename observed. Its archive coverage is partial, so this is weak evidence rather than proof the handle was never changed.`;
  }
  const reused = accountCount > 1
    ? ` The name @${handle} appears on ${accountCount} different account ids, so the handle itself has changed hands - the followers and history you see may not belong to the account wearing it now.`
    : "";
  if (!priors.length) return `No prior name is recorded for this account.${reused}`;
  const list = priors.slice(0, 5).map((p) => `@${p.handle}`).join(", ");
  const since = current?.firstSeen
    ? ` It has been seen as @${handle} since ${current.firstSeen}`
    : ` No dated sighting of @${handle} itself is recorded`;
  return `This account previously went by ${list}${priors.length > 5 ? ` and ${priors.length - 5} more` : ""}.${since}, so the account is older than the identity it is presenting. Dates are archive sightings, not exact rename timestamps.${reused}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = String(req.query.handle ?? "").replace(/^@/, "").trim();
  if (!HANDLE.test(handle)) { res.status(400).json({ error: "handle required" }); return; }
  // Handle history is near-static: a day of edge cache costs nothing and keeps
  // a free public archive from being hammered once per scan.
  res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");

  const payload = await fetchHistory(handle);
  const accounts = parseAccounts(payload);
  if (!accounts.length) {
    res.status(200).json({
      available: true,
      handle,
      status: "unknown" satisfies HandleHistoryStatus,
      priorHandles: [],
      renameCount: 0,
      accountCount: 0,
      handleReused: false,
      currentSince: null,
      lastRenameSeen: null,
      accounts: [],
      note: `memory.lol has no record for @${handle}. That is an archive gap, not a clean bill - it does not mean the handle was never changed.`,
    });
    return;
  }

  const wanted = handle.toLowerCase();
  const names = accounts.flatMap((a) => a.names);
  const current = names.find((n) => n.handle.toLowerCase() === wanted) ?? null;
  const priors = names.filter((n) => n.handle.toLowerCase() !== wanted);
  // The most recent sighting of an OLD name bounds when the rename happened:
  // the account still answered to that name on that date.
  const lastRenameSeen = priors
    .map((p) => p.lastSeen)
    .filter((d): d is string => !!d)
    .sort()
    .pop() ?? null;

  res.status(200).json({
    available: true,
    handle,
    status: (priors.length ? "renamed" : "single") satisfies HandleHistoryStatus,
    priorHandles: priors.map((p) => p.handle),
    renameCount: priors.length,
    accountCount: accounts.length,
    handleReused: accounts.length > 1,
    currentSince: current?.firstSeen ?? null,
    lastRenameSeen,
    accounts,
    note: describe(handle, current, priors, accounts.length),
  });
}
