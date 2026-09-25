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
// It is indexed BY ACCOUNT ID, and the by-name route only answers for names the
// archive has actually seen. That inverts against us on the exact accounts we
// care most about: rename an account this month and the archive still files it
// under the OLD names, so a lookup by the new handle returns nothing while the
// rename history sits one id away. So when the name lookup comes back empty we
// resolve the numeric account id - passed in by the caller, or looked up from a
// keyed X provider when one is configured - and ask again by id. The id is
// stable across renames, which is the whole reason this signal exists.
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
// X account ids are numeric and monotonically growing; 25 digits is far past
// anything X has issued and keeps an untrusted query param out of the path.
const USER_ID = /^[0-9]{1,25}$/;
const UPSTREAM = "https://api.memory.lol/v1/tw/";
// An account with a long rename history is interesting, but the response has to
// stay bounded - a report panel cannot render hundreds of rows, and an
// unbounded upstream list should never become an unbounded response body.
const MAX_NAMES = 40;
const MAX_ACCOUNTS = 10;

export type HandleHistoryStatus = "renamed" | "single" | "unknown";
/** Which memory.lol route answered: the screen name, or the account id behind it. */
export type HandleHistoryResolvedBy = "handle" | "id" | null;

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

// The two routes answer in two shapes: the name route wraps matches in
// `accounts`, the id route returns the one account bare. Normalise both here so
// everything downstream sees the same list.
function accountList(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.accounts)) return payload.accounts;
  if (isRecord(payload.screen_names)) return [payload];
  return [];
}

function parseAccounts(payload: unknown): HandleHistoryAccount[] {
  return accountList(payload).slice(0, MAX_ACCOUNTS).flatMap((raw) => {
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

async function fetchHistory(path: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${UPSTREAM}${path}`, {
      headers: { accept: "application/json", "user-agent": "ARGUS-handle-history" },
      signal: AbortSignal.timeout(8000),
    });
    // 404 is memory.lol's "no record", which is a real answer (unknown), not an
    // error - but it is still not evidence the account was never renamed.
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Both providers nest the user under `data` and spell the id either way. Only a
// numeric id is usable: anything else is a failure envelope, not an account.
function idOf(payload: unknown): string | null {
  const data = isRecord(payload) ? payload.data : null;
  if (!isRecord(data)) return null;
  const raw = data.id ?? data.id_str;
  const id = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  return USER_ID.test(id) ? id : null;
}

// The numeric account id behind a handle. Only needed when the archive has no
// record under the CURRENT name, which is the recent-rename case. Keyed, and
// both keys are optional: without either, this endpoint behaves exactly as it
// did before - keyless, free, and running on every scan.
async function resolveUserId(handle: string): Promise<string | null> {
  const twitterapi = process.env.TWITTERAPI_KEY;
  if (twitterapi) {
    try {
      const r = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(handle)}`, {
        headers: { "x-api-key": twitterapi }, signal: AbortSignal.timeout(6000),
      });
      // twitterapi.io answers HTTP 200 on failure too ({status:"error"}).
      if (r.ok) {
        const id = idOf(await r.json());
        if (id) return id;
      }
    } catch { /* fall through to the bearer, then to no id */ }
  }
  const bearer = process.env.X_API_BEARER;
  if (bearer) {
    try {
      const r = await fetch(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}`, {
        headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const id = idOf(await r.json());
        if (id) return id;
      }
    } catch { /* no id: the caller reports unknown, never clean */ }
  }
  return null;
}

function describe(
  handle: string,
  current: HandleObservation | null,
  priors: HandleObservation[],
  accountCount: number,
  resolvedBy: HandleHistoryResolvedBy,
  lastRenameSeen: string | null,
): string {
  if (!priors.length && accountCount <= 1) {
    return `memory.lol has no prior screen name for @${handle} - no rename observed. Its archive coverage is partial, so this is weak evidence rather than proof the handle was never changed.`;
  }
  const reused = accountCount > 1
    ? ` The name @${handle} appears on ${accountCount} different account ids, so the handle itself has changed hands - the followers and history you see may not belong to the account wearing it now.`
    : "";
  if (!priors.length) return `No prior name is recorded for this account.${reused}`;
  const list = priors.slice(0, 5).map((p) => `@${p.handle}`).join(", ");
  const more = priors.length > 5 ? ` and ${priors.length - 5} more` : "";
  // The archive knows the account id but has never seen it under the name it
  // uses today. That is the recent-rename case, and it is a stronger statement
  // than the ordinary one: the rename postdates every sighting on record.
  if (resolvedBy === "id" && !current) {
    const bound = lastRenameSeen
      ? ` It was still answering to a prior name on ${lastRenameSeen}, so the rename to @${handle} is more recent than that.`
      : " No dated sighting bounds when the rename happened.";
    return `The archive holds this account id only under ${list}${more}, and has no sighting of it as @${handle} at all.${bound} The account is older than the identity it is presenting. Dates are archive sightings, not exact rename timestamps.${reused}`;
  }
  const since = current?.firstSeen
    ? ` It has been seen as @${handle} since ${current.firstSeen}`
    : ` No dated sighting of @${handle} itself is recorded`;
  return `This account previously went by ${list}${more}.${since}, so the account is older than the identity it is presenting. Dates are archive sightings, not exact rename timestamps.${reused}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = String(req.query.handle ?? "").replace(/^@/, "").trim();
  if (!HANDLE.test(handle)) { res.status(400).json({ error: "handle required" }); return; }
  // Handle history is near-static: a day of edge cache costs nothing and keeps
  // a free public archive from being hammered once per scan.
  res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");

  // Callers that already resolved the account id (a scan has it from the X
  // profile) hand it over so the fallback costs no extra provider call.
  const givenId = String(req.query.id ?? "").trim();
  let resolvedBy: HandleHistoryResolvedBy = null;

  let accounts = parseAccounts(await fetchHistory(encodeURIComponent(handle)));
  if (accounts.length) {
    resolvedBy = "handle";
  } else {
    // Nothing under the current name. Ask by account id, which survives renames.
    const id = USER_ID.test(givenId) ? givenId : await resolveUserId(handle);
    if (id) {
      accounts = parseAccounts(await fetchHistory(`id/${encodeURIComponent(id)}`));
      if (accounts.length) resolvedBy = "id";
    }
  }

  if (!accounts.length) {
    res.status(200).json({
      available: true,
      handle,
      status: "unknown" satisfies HandleHistoryStatus,
      resolvedBy,
      priorHandles: [],
      renameCount: 0,
      accountCount: 0,
      handleReused: false,
      currentSince: null,
      currentNameInArchive: false,
      lastRenameSeen: null,
      accounts: [],
      note: `memory.lol has no record for @${handle}, by name or by account id. That is an archive gap, not a clean bill - it does not mean the handle was never changed.`,
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
    resolvedBy,
    priorHandles: priors.map((p) => p.handle),
    renameCount: priors.length,
    accountCount: accounts.length,
    handleReused: accounts.length > 1,
    currentSince: current?.firstSeen ?? null,
    // False with a record present means the archive has never seen this account
    // under the name it uses today - a rename newer than the archive itself.
    currentNameInArchive: !!current,
    lastRenameSeen,
    accounts,
    note: describe(handle, current, priors, accounts.length, resolvedBy, lastRenameSeen),
  });
}
