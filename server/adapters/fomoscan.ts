// FomoScan Identity API: FOMO (fomo.family) trader handle <-> verified wallet
// resolution, on-chain trading numbers per handle, and the "thesis" posts a
// trader makes about a token. https://api.fomoscan.sh/docs
//
// WHAT THIS IS FOR. ARGUS scores KOLs and promoters on what their wallets do
// (K4) and on whether their calls made or lost money for followers (K2). Both
// axes start from a wallet ARGUS can attribute to the handle, and that
// attribution has been the hard part: SelfDoxxed wallets are rare and
// investigator attributions are slow. FomoScan holds the wallet a FOMO account
// verified for itself, so a handle that trades on FOMO arrives with a wallet
// already attached. The same API answers the reverse question (which trader is
// behind a wallet that sold into a launch) and carries each trader's posted
// theses, which are calls with timestamps.
//
// WHAT IT IS NOT. A FomoScan match is FomoScan's claim, carried with that
// attribution: the wallet is recorded as InvestigatorAttributed, never as
// SelfDoxxed, and every field is reported as FomoScan's reading. FOMO handles
// are not X handles; the record carries the X username FOMO holds, and the
// adapter only adopts a wallet when that X username matches the audited
// subject or FomoScan resolved the exact handle. Their PnL numbers are cash
// flow (sold minus bought), not realized profit, and are described that way.
//
// COST. Every call is billed in compute units against the partner plan:
// 2,500 CU for a handle hit, 250 CU for a miss, 250 CU per thesis page, and
// 50,000 CU for a wallet-to-trader resolution. The audit path therefore only
// ever resolves the subject's own handle and its theses; wallet resolution is
// behind an explicit opt-in used by scripts/fomoscan-sweep.ts with a budget.
// A key with no plan answers 402 on every billable call, which this adapter
// reports as a configuration state rather than a provider failure. Rate limit
// is 60 requests a minute across all endpoints, so calls are serialized.

import { env } from "../config.js";
import { recordCall } from "../cost.js";
import { deadlineFetch } from "../providerDeadline.js";
import type { Adapter, CollectContext } from "./types.js";

export const FOMOSCAN_HOST = "https://api.fomoscan.sh";
export const FOMOSCAN_PROVIDER = "fomoscan";

/** Documented compute-unit prices, kept here so budgets can be reasoned about offline. */
export const FOMOSCAN_CU = {
  handleHit: 2_500,
  handleMiss: 250,
  walletHit: 50_000,
  walletMiss: 250,
  pnl: 2_500,
  pnlBatchPerHandle: 1_250,
  thesisPage: 250,
  me: 0,
} as const;

const CALL_TIMEOUT_MS = 10_000;
/** 60/min documented; a little over one second keeps a burst of audits under it. */
const MIN_CALL_SPACING_MS = 1_050;

export interface FomoUser {
  id: string;
  handle: string;
  name: string | null;
  bio: string | null;
  /** Bare X username FOMO holds for the account, when any. */
  twitter: string | null;
  solanaAddress: string | null;
  evmAddress: string | null;
}

export interface FomoPnlWindow {
  netUsd: number | null;
  returnPct: number | null;
  volumeUsd: number | null;
  trades: number | null;
  rank: number | null;
}

export interface FomoPnl {
  handle: string;
  twitter: string | null;
  wallet: string | null;
  evmWallet: string | null;
  updatedAt: string | null;
  windows: Partial<Record<"24h" | "7d" | "30d" | "all", FomoPnlWindow>>;
}

export interface FomoThesis {
  id: string;
  authorId: string | null;
  authorHandle: string | null;
  tokenAddress: string | null;
  tokenNetwork: string | null;
  symbol: string | null;
  text: string | null;
  postedAt: string | null;
}

export type FomoState =
  | "hit"
  | "miss"
  | "no_key"
  | "no_plan"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "skipped";

export type FomoFailState = Exclude<FomoState, "hit" | "miss">;

export interface FomoResult<T> {
  state: FomoState;
  value: T | null;
  /** Compute units this call cost per FomoScan's documented price list. */
  cu: number;
  /** One plain sentence for the trace and the report. */
  note: string;
}

export interface FomoMe {
  plan: string | null;
  unitsRemaining: number | null;
  additionalUnits: number | null;
  period: string | null;
  unmetered: boolean;
  rateLimitPerMinute: number | null;
}

interface FetchOptions {
  fetchImpl?: typeof fetch;
}

let lastCallAt = 0;
async function pace(): Promise<void> {
  const wait = lastCallAt + MIN_CALL_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
}

/** The key, or null. Never logged, never placed in a URL. */
function apiKey(): string | null {
  const key = env("FOMOSCAN_API_KEY")?.trim();
  return key ? key : null;
}

const normalizeHandle = (handle: string): string => handle.trim().replace(/^@/, "").toLowerCase();

/**
 * FOMO stores the X link either as a bare username or as a profile URL
 * ("https://x.com/lowcap_hunter"). Reduce both to the username.
 */
export function xUsernameFromFomo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  const m = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i.exec(v);
  if (m) v = m[1];
  v = v.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(v) ? v : null;
}

interface RawResponse {
  status: number;
  json: unknown;
}

async function call(path: string, opts: FetchOptions & { method?: "GET" | "POST"; body?: unknown } = {}): Promise<RawResponse | { error: FomoFailState }> {
  const key = apiKey();
  if (!key) return { error: "no_key" };
  const fetchImpl = opts.fetchImpl ?? deadlineFetch;
  // Real calls are spaced for the 60/min limit; an injected fetch is a test double.
  if (!opts.fetchImpl) await pace();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${FOMOSCAN_HOST}${path}`, {
        method: opts.method ?? "GET",
        headers: {
          authorization: `Bearer ${key}`,
          accept: "application/json",
          ...(opts.body ? { "content-type": "application/json" } : {}),
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
      });
      let json: unknown = null;
      try { json = await res.json(); } catch { json = null; }
      if (res.status === 401) return { error: "unauthorized" };
      if (res.status === 402) return { error: "no_plan" };
      if (res.status === 429) return { error: "rate_limited" };
      if (res.status >= 500) return { error: "unavailable" };
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { error: "unavailable" };
  }
}

const STATE_NOTES: Record<FomoFailState, string> = {
  no_key: "FomoScan is not configured (FOMOSCAN_API_KEY is missing), so no trader identity was read.",
  no_plan: "The FomoScan key has no compute units; every billable call returns 402 until a plan is active at partner.fomoscan.sh.",
  unauthorized: "FomoScan rejected the API key, so no trader identity was read.",
  rate_limited: "FomoScan rate-limited this call (60 a minute across all endpoints); nothing was read.",
  unavailable: "FomoScan did not answer, so no trader identity was read.",
  skipped: "FomoScan was not asked.",
};

function failure<T>(state: FomoFailState, cu = 0): FomoResult<T> {
  return { state, value: null, cu, note: STATE_NOTES[state] };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseUser(json: unknown): FomoUser | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const id = str(o.id); const handle = str(o.handle);
  if (!id || !handle) return null;
  return {
    id,
    handle,
    name: str(o.name),
    bio: str(o.bio),
    twitter: xUsernameFromFomo(str(o.twitter)),
    solanaAddress: str(o.solanaAddress),
    evmAddress: str(o.evmAddress)?.toLowerCase() ?? null,
  };
}

function parseWindow(v: unknown): FomoPnlWindow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    netUsd: num(o.netUsd),
    returnPct: num(o.returnPct ?? o.return),
    volumeUsd: num(o.volumeUsd),
    trades: num(o.trades ?? o.tradeCount),
    rank: num(o.rank),
  };
}

function parsePnl(json: unknown): FomoPnl | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const handle = str(o.handle);
  if (!handle) return null;
  const windows: FomoPnl["windows"] = {};
  const w = (o.windows && typeof o.windows === "object") ? o.windows as Record<string, unknown> : {};
  for (const k of ["24h", "7d", "30d", "all"] as const) {
    const parsed = parseWindow(w[k]);
    if (parsed) windows[k] = parsed;
  }
  return {
    handle,
    twitter: xUsernameFromFomo(str(o.twitter)),
    wallet: str(o.wallet),
    evmWallet: str(o.evmWallet)?.toLowerCase() ?? null,
    updatedAt: str(o.updatedAt) ?? (num(o.updatedAt) != null ? new Date(num(o.updatedAt)!).toISOString() : null),
    windows,
  };
}

function parseThesis(v: unknown): FomoThesis | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const author = (o.author && typeof o.author === "object") ? o.author as Record<string, unknown> : {};
  const postedRaw = o.postedAt ?? o.createdAt ?? o.timestamp;
  return {
    id,
    authorId: str(o.authorId) ?? str(author.id),
    authorHandle: str(o.authorHandle) ?? str(author.handle),
    tokenAddress: str(o.tokenAddress),
    tokenNetwork: str(o.tokenNetwork),
    symbol: str(o.symbol),
    text: str(o.text) ?? str(o.body) ?? str(o.content),
    postedAt: str(postedRaw) ?? (num(postedRaw) != null ? new Date(num(postedRaw)!).toISOString() : null),
  };
}

/** GET /v2/me. Costs nothing; the one call that is safe to make without a plan. */
export async function fetchFomoMe(opts: FetchOptions = {}): Promise<FomoResult<FomoMe>> {
  const res = await call("/v2/me", opts);
  if ("error" in res) return failure(res.error);
  if (res.status !== 200 || !res.json || typeof res.json !== "object") return failure("unavailable");
  const o = res.json as Record<string, unknown>;
  const plan = (o.plan && typeof o.plan === "object") ? o.plan as Record<string, unknown> : {};
  const usage = (o.usage && typeof o.usage === "object") ? o.usage as Record<string, unknown> : {};
  const ent = (o.entitlement && typeof o.entitlement === "object") ? o.entitlement as Record<string, unknown> : {};
  const value: FomoMe = {
    plan: str(plan.name) ?? str(plan.id) ?? str(o.plan),
    unitsRemaining: num(usage.unitsRemaining),
    additionalUnits: num(usage.additionalUnits),
    period: str(usage.period),
    unmetered: ent.unmetered === true,
    rateLimitPerMinute: num(ent.rateLimitPerMinute ?? o.rateLimitPerMinute),
  };
  recordCall(FOMOSCAN_PROVIDER, "me", 0, "0 CU");
  return { state: "hit", value, cu: 0, note: "FomoScan key introspected." };
}

/** GET /v2/user/handle/{handle}: 2,500 CU on a hit, 250 CU on a miss. */
export async function fetchFomoUserByHandle(handle: string, opts: FetchOptions = {}): Promise<FomoResult<FomoUser>> {
  const h = normalizeHandle(handle);
  if (!h) return failure("skipped");
  const res = await call(`/v2/user/handle/${encodeURIComponent(h)}`, opts);
  if ("error" in res) { recordCall(FOMOSCAN_PROVIDER, "user-by-handle", 0, res.error, "failed"); return failure(res.error); }
  if (res.status === 404) {
    recordCall(FOMOSCAN_PROVIDER, "user-by-handle", 0, `${FOMOSCAN_CU.handleMiss} CU miss`);
    return { state: "miss", value: null, cu: FOMOSCAN_CU.handleMiss, note: `FomoScan holds no FOMO account named ${h}.` };
  }
  const user = res.status === 200 ? parseUser(res.json) : null;
  if (!user) { recordCall(FOMOSCAN_PROVIDER, "user-by-handle", 0, `http ${res.status}`, "failed"); return failure("unavailable"); }
  recordCall(FOMOSCAN_PROVIDER, "user-by-handle", 0, `${FOMOSCAN_CU.handleHit} CU`);
  const wallets = [user.solanaAddress, user.evmAddress].filter(Boolean).length;
  return {
    state: "hit",
    value: user,
    cu: FOMOSCAN_CU.handleHit,
    note: wallets
      ? `FomoScan holds FOMO account ${user.handle} with ${wallets} verified wallet${wallets === 1 ? "" : "s"}.`
      : `FomoScan holds FOMO account ${user.handle} but no verified wallet for it; that is an absence of a record, not proof of no wallet.`,
  };
}

/**
 * GET /v2/user/wallet/{address}: 50,000 CU on a hit. Off unless the caller
 * says so, because one audit that resolved every top seller would spend a
 * Starter plan's month in five calls.
 */
export async function fetchFomoUserByWallet(address: string, opts: FetchOptions & { allowExpensive?: boolean } = {}): Promise<FomoResult<FomoUser>> {
  const a = address.trim();
  if (!a) return failure("skipped");
  if (!opts.allowExpensive) {
    return { state: "skipped", value: null, cu: 0, note: "Wallet-to-trader resolution costs 50,000 compute units and is off unless explicitly enabled." };
  }
  const res = await call(`/v2/user/wallet/${encodeURIComponent(a)}`, opts);
  if ("error" in res) { recordCall(FOMOSCAN_PROVIDER, "user-by-wallet", 0, res.error, "failed"); return failure(res.error); }
  if (res.status === 404) {
    recordCall(FOMOSCAN_PROVIDER, "user-by-wallet", 0, `${FOMOSCAN_CU.walletMiss} CU miss`);
    return { state: "miss", value: null, cu: FOMOSCAN_CU.walletMiss, note: `FomoScan holds no FOMO trader for wallet ${a}.` };
  }
  const user = res.status === 200 ? parseUser(res.json) : null;
  if (!user) { recordCall(FOMOSCAN_PROVIDER, "user-by-wallet", 0, `http ${res.status}`, "failed"); return failure("unavailable"); }
  recordCall(FOMOSCAN_PROVIDER, "user-by-wallet", 0, `${FOMOSCAN_CU.walletHit} CU`);
  return { state: "hit", value: user, cu: FOMOSCAN_CU.walletHit, note: `FomoScan resolves wallet ${a} to FOMO account ${user.handle}${user.twitter ? ` (X @${user.twitter})` : ""}.` };
}

/** GET /v2/user/handle/{handle}/pnl. Cash flow, not realized profit. */
export async function fetchFomoPnl(handle: string, opts: FetchOptions = {}): Promise<FomoResult<FomoPnl>> {
  const h = normalizeHandle(handle);
  if (!h) return failure("skipped");
  const res = await call(`/v2/user/handle/${encodeURIComponent(h)}/pnl`, opts);
  if ("error" in res) { recordCall(FOMOSCAN_PROVIDER, "pnl", 0, res.error, "failed"); return failure(res.error); }
  if (res.status === 404) {
    recordCall(FOMOSCAN_PROVIDER, "pnl", 0, "miss");
    return { state: "miss", value: null, cu: FOMOSCAN_CU.handleMiss, note: `FomoScan holds no trading numbers for ${h}.` };
  }
  const pnl = res.status === 200 ? parsePnl(res.json) : null;
  if (!pnl) { recordCall(FOMOSCAN_PROVIDER, "pnl", 0, `http ${res.status}`, "failed"); return failure("unavailable"); }
  recordCall(FOMOSCAN_PROVIDER, "pnl", 0, `${FOMOSCAN_CU.pnl} CU`);
  return { state: "hit", value: pnl, cu: FOMOSCAN_CU.pnl, note: describePnl(pnl) };
}

/** POST /v2/user/handles/pnl: up to 100 handles at 1,250 CU each. */
export async function fetchFomoPnlBatch(handles: string[], opts: FetchOptions = {}): Promise<FomoResult<{ entries: FomoPnl[]; missing: string[] }>> {
  const hs = Array.from(new Set(handles.map(normalizeHandle).filter(Boolean))).slice(0, 100);
  if (!hs.length) return failure("skipped");
  const res = await call("/v2/user/handles/pnl", { ...opts, method: "POST", body: { handles: hs } });
  if ("error" in res) { recordCall(FOMOSCAN_PROVIDER, "pnl-batch", 0, res.error, "failed"); return failure(res.error); }
  if (res.status !== 200 || !res.json || typeof res.json !== "object") { recordCall(FOMOSCAN_PROVIDER, "pnl-batch", 0, `http ${res.status}`, "failed"); return failure("unavailable"); }
  const o = res.json as Record<string, unknown>;
  const entries = Array.isArray(o.entries) ? o.entries.map(parsePnl).filter((x): x is FomoPnl => !!x) : [];
  const missing = Array.isArray(o.missing) ? o.missing.filter((x): x is string => typeof x === "string") : [];
  const cu = entries.length * FOMOSCAN_CU.pnlBatchPerHandle;
  recordCall(FOMOSCAN_PROVIDER, "pnl-batch", 0, `${cu} CU for ${entries.length} handles`);
  return { state: entries.length ? "hit" : "miss", value: { entries, missing }, cu, note: `FomoScan returned trading numbers for ${entries.length} of ${hs.length} handles.` };
}

/** GET /v2/thesis/token/{tokenAddress}: the 25 newest theses, 250 CU. */
export async function fetchFomoTokenTheses(tokenAddress: string, opts: FetchOptions = {}): Promise<FomoResult<FomoThesis[]>> {
  const a = tokenAddress.trim();
  if (!a) return failure("skipped");
  const res = await call(`/v2/thesis/token/${encodeURIComponent(a)}`, opts);
  if ("error" in res) { recordCall(FOMOSCAN_PROVIDER, "theses-token", 0, res.error, "failed"); return failure(res.error); }
  if (res.status !== 200 || !res.json || typeof res.json !== "object") { recordCall(FOMOSCAN_PROVIDER, "theses-token", 0, `http ${res.status}`, "failed"); return failure("unavailable"); }
  const o = res.json as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map(parseThesis).filter((x): x is FomoThesis => !!x) : [];
  recordCall(FOMOSCAN_PROVIDER, "theses-token", 0, `${FOMOSCAN_CU.thesisPage} CU`);
  return {
    state: items.length ? "hit" : "miss",
    value: items,
    cu: FOMOSCAN_CU.thesisPage,
    note: items.length ? `FomoScan holds ${items.length} recent FOMO theses on this token.` : "FomoScan holds no FOMO theses on this token.",
  };
}

/** GET /v2/thesis/user/{id}: a trader's newest 20 theses, 250 CU. */
export async function fetchFomoUserTheses(userId: string, opts: FetchOptions = {}): Promise<FomoResult<FomoThesis[]>> {
  const id = userId.trim();
  if (!id) return failure("skipped");
  const res = await call(`/v2/thesis/user/${encodeURIComponent(id)}`, opts);
  if ("error" in res) { recordCall(FOMOSCAN_PROVIDER, "theses-user", 0, res.error, "failed"); return failure(res.error); }
  if (res.status !== 200 || !res.json || typeof res.json !== "object") { recordCall(FOMOSCAN_PROVIDER, "theses-user", 0, `http ${res.status}`, "failed"); return failure("unavailable"); }
  const o = res.json as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map(parseThesis).filter((x): x is FomoThesis => !!x) : [];
  recordCall(FOMOSCAN_PROVIDER, "theses-user", 0, `${FOMOSCAN_CU.thesisPage} CU`);
  return { state: items.length ? "hit" : "miss", value: items, cu: FOMOSCAN_CU.thesisPage, note: `FomoScan holds ${items.length} theses by this trader.` };
}

const usd = (n: number): string => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** One sentence on the numbers, always naming them as cash flow. */
export function describePnl(pnl: FomoPnl): string {
  const w = pnl.windows["30d"] ?? pnl.windows.all;
  if (!w || w.netUsd == null) return `FomoScan holds FOMO account ${pnl.handle} but no on-chain trading numbers for it.`;
  const window = pnl.windows["30d"] ? "30 days" : "all time";
  const sign = w.netUsd >= 0 ? "net cash in of" : "net cash out of";
  const rank = w.rank != null ? `, ranked ${w.rank.toLocaleString("en-US")} of FOMO accounts with a traded wallet` : "";
  return `FomoScan reads ${pnl.handle}'s FOMO trades over ${window} as ${sign} ${usd(w.netUsd)} (sold minus bought, not realized profit)${rank}.`;
}

/**
 * Does a FOMO record belong to the audited X handle? The FOMO handle is not an
 * X handle, so a same-name FOMO account is only adopted when FOMO's own
 * `twitter` field names the subject, or when FOMO holds no X link at all and
 * the handle is an exact match (reported as weaker in the note).
 */
export function fomoRecordBindsToSubject(user: FomoUser, subjectHandle: string): "x-confirmed" | "handle-only" | "other-person" {
  const subject = normalizeHandle(subjectHandle);
  const twitter = user.twitter ? normalizeHandle(user.twitter) : null;
  if (twitter) return twitter === subject ? "x-confirmed" : "other-person";
  return normalizeHandle(user.handle) === subject ? "handle-only" : "other-person";
}

const wasAsked = (evidence: CollectContext["evidence"]): boolean =>
  evidence.wallets.some((w) => w.provider === FOMOSCAN_PROVIDER);

/**
 * Collector lane: resolve the audited handle on FOMO and attach its verified
 * wallet(s) as InvestigatorAttributed wallets so the on-chain lane (Helius,
 * Arkham) has something to examine. Runs before onchainAdapter in WALLET_LANE.
 */
export const fomoscanAdapter: Adapter = {
  id: "fomoscan",
  label: "FomoScan (FOMO trader identity)",
  available: () => !!apiKey(),
  applicable: (evidence) => !!evidence.profile?.handle && !wasAsked(evidence),
  async run(ctx: CollectContext) {
    if (!apiKey()) return { state: "skipped", attempts: 0, detail: "FomoScan is not configured" };
    const handle = normalizeHandle(ctx.handle);
    if (!handle) return { state: "skipped", attempts: 0, detail: "no handle to resolve" };
    ctx.emit({ phase: "On-chain", label: "FomoScan identity", detail: `Resolving @${handle} on FOMO…`, tone: "neutral" });
    const result = await fetchFomoUserByHandle(handle);
    if (result.state !== "hit" && result.state !== "miss") {
      ctx.emit({ phase: "On-chain", label: "FomoScan identity", detail: result.note, source: FOMOSCAN_PROVIDER, tone: "neutral" });
      return { state: "failed", attempts: 1, detail: result.note };
    }
    if (result.state === "miss" || !result.value) {
      ctx.emit({ phase: "On-chain", label: "FomoScan identity", detail: result.note, source: FOMOSCAN_PROVIDER, tone: "neutral" });
      return { state: "executed", attempts: 1, detail: result.note };
    }
    const user = result.value;
    const binding = fomoRecordBindsToSubject(user, handle);
    if (binding === "other-person") {
      const detail = `FOMO account ${user.handle} links to X @${user.twitter}, not @${handle}; its wallets were not adopted.`;
      ctx.emit({ phase: "On-chain", label: "FomoScan identity", detail, source: FOMOSCAN_PROVIDER, tone: "neutral" });
      return { state: "executed", attempts: 1, detail };
    }
    const known = new Set(ctx.evidence.wallets.map((w) => `${w.chain}:${w.address.toLowerCase()}`));
    const added: string[] = [];
    const candidates: Array<{ chain: string; address: string }> = [];
    if (user.solanaAddress) candidates.push({ chain: "solana", address: user.solanaAddress });
    if (user.evmAddress) candidates.push({ chain: "ethereum", address: user.evmAddress });
    for (const c of candidates) {
      const key = `${c.chain}:${c.address.toLowerCase()}`;
      if (known.has(key)) continue;
      ctx.evidence.wallets.push({
        address: c.address,
        chain: c.chain,
        link_tier: "InvestigatorAttributed",
        link_evidence_url: `${FOMOSCAN_HOST}/v2/user/handle/${encodeURIComponent(user.handle)}`,
        notes: binding === "x-confirmed"
          ? `FomoScan: verified wallet of FOMO account ${user.handle}, whose linked X account is @${user.twitter}.`
          : `FomoScan: verified wallet of FOMO account ${user.handle} (same name as the subject; FOMO holds no X link for it, so the binding rests on the name).`,
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: FOMOSCAN_PROVIDER,
      });
      added.push(`${c.chain} ${c.address.slice(0, 8)}…`);
    }
    const detail = added.length
      ? `FomoScan attached ${added.length} verified wallet${added.length === 1 ? "" : "s"} for FOMO account ${user.handle} (${added.join(", ")}).`
      : result.note;
    ctx.emit({ phase: "On-chain", label: "FomoScan identity", detail, source: FOMOSCAN_PROVIDER, tone: "neutral" });
    return { state: "executed", attempts: 1, detail };
  },
};
