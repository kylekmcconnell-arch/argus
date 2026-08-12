// Record-once / replay-forever provider traffic for full-pipeline evals.
//
// Record mode wraps global fetch during ONE paid live audit and captures every
// provider response to disk. Replay mode serves those responses back so the
// identical pipeline runs offline, deterministically, for free: model swaps,
// prompt changes, and discovery re-routes get measured against frozen ground
// truth instead of paying for a live run per experiment.
//
// Matching is two-tier. A request matches first on the exact scrubbed
// (method + url + body) hash; when a code change alters a prompt, it falls
// back to the next unconsumed recording for the same scrubbed URL so the run
// still completes, and the fidelity report says exactly how much drifted.
// Never store request headers: keys must not reach disk.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evalNativeRequest } from "./evalTransport";
import { setEvalTransportMode } from "./publicWeb";

export type EvalMode = "record" | "replay";

export interface RecordedCall {
  key: string;
  urlKey: string;
  seq: number;
  method: string;
  url: string;
  status: number;
  contentType: string;
  body: string;
  /**
   * The structured-output tool the REQUEST asked for, where it named one.
   * Recorded so a replay can answer an analyst call with the analyst's own
   * response instead of whatever happened to be next in arrival order.
   */
  tool?: string | null;
}

export interface ReplayFidelity {
  exactHits: number;
  toolFallbackHits: number;
  urlFallbackHits: number;
  liveAllowed: number;
  liveForced: number;
  misses: Array<{ method: string; url: string }>;
}

// These outputs directly govern the published decision. Replaying one against
// a changed request is unsafe even when the requested tool name is unchanged:
// the evidence catalog and its positional citation aliases may now describe
// different facts. Exact matching already scrubs clocks, UUIDs, and auth
// nonces, so any remaining request drift is material and requires a refreshed
// recording (or an explicitly forced live tool lane).
const EXACT_MATCH_ONLY_TOOLS = new Set([
  "record_contradictions",
  "record_verdict",
]);

// Locally-generated volatile values that differ between the recording run and
// a replay run (clocks, run ids) but flow into request bodies. Scrubbed from
// the match key only; stored bodies keep their original text.
const VOLATILE_PATTERNS: RegExp[] = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, // ISO timestamps
  /\b1[6-9]\d{11}\b/g, // epoch milliseconds
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuids
  /\bPA-[0-9A-F]{10,}\b/g, // report ids
  // Per-request auth nonces in a query string. GMGN's read routes require a
  // unix-seconds timestamp and a fresh client_id on every call, so without this
  // no two requests to the same endpoint ever share a URL and a recording could
  // never be replayed.
  /timestamp=\d{9,13}/g,
  /client_id=[0-9a-zA-Z-]{8,}/g,
];

const SENSITIVE_QUERY_PARAM = /^(?:(?:x[-_]api|api|access|refresh|id|oauth|auth|bearer|session|client)[-_]?)?(?:key|token|secret|auth|authorization|signature|sig|credential|password|passwd)$/i;

export function scrubUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const param of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAM.test(param)) url.searchParams.set(param, "REDACTED");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function scrubVolatile(text: string): string {
  let out = text;
  for (const pattern of VOLATILE_PATTERNS) out = out.replace(pattern, "VOLATILE");
  return out;
}

export function matchKey(method: string, url: string, body: string): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${scrubVolatile(scrubUrl(url))}\n${scrubVolatile(body)}`)
    .digest("hex");
}

export function urlOnlyKey(method: string, url: string): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${scrubVolatile(scrubUrl(url))}`)
    .digest("hex");
}

function callsPath(dir: string): string {
  return join(dir, "calls.jsonl");
}

export function loadRecording(dir: string): RecordedCall[] {
  const path = callsPath(dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line) as RecordedCall;
      // Recordings made before request-tool metadata existed have no `tool`
      // property at all. A provider response with exactly one structured
      // `tool_use` block can safely recover that missing routing key: the block
      // names the response class itself. Do not infer over an explicit null
      // from a modern recording, from ordinary text, or from an ambiguous
      // multi-tool response.
      if (!Object.prototype.hasOwnProperty.call(parsed, "tool")) {
        parsed.tool = inferLegacyResponseTool(parsed);
      }
      return parsed;
    });
}

function inferLegacyResponseTool(call: RecordedCall): string | null {
  if (!/json/i.test(call.contentType)) return null;
  try {
    const payload = JSON.parse(call.body) as { content?: unknown };
    if (!Array.isArray(payload.content)) return null;
    const names = payload.content.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const candidate = block as { type?: unknown; name?: unknown };
      if (candidate.type !== "tool_use" || typeof candidate.name !== "string") return [];
      const name = candidate.name.trim();
      return name ? [name] : [];
    });
    return names.length === 1 ? names[0] : null;
  } catch {
    return null;
  }
}

async function materializeRequest(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<{ method: string; url: string; body: string }> {
  if (input instanceof Request) {
    const clone = input.clone();
    return {
      method: input.method || "GET",
      url: input.url,
      body: init?.body ? String(init.body) : await clone.text().catch(() => ""),
    };
  }
  return {
    method: init?.method || "GET",
    url: String(input),
    body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "",
  };
}

function toResponse(call: RecordedCall): Response {
  return new Response(call.body, {
    status: call.status,
    headers: call.contentType ? { "content-type": call.contentType } : {},
  });
}

/**
 * Run `work` with global fetch recording to (or replaying from) `dir`.
 * Replay throws on a miss unless the host is in `allowLiveHosts`, in which
 * case the request goes out live (an A/B lane) and is appended to a side
 * recording so the comparison run is itself repeatable.
 */
export async function withRecordedFetch<T>(
  mode: EvalMode,
  dir: string,
  work: () => Promise<T>,
  options: {
    allowLiveHosts?: string[];
    forceLiveHosts?: string[];
    forceLiveTools?: string[];
    /** Recording boundary used by provider timestamp helpers during replay. */
    replayCapturedAt?: string;
  } = {},
): Promise<{ result: T; fidelity: ReplayFidelity; recordedCalls: number }> {
  mkdirSync(dir, { recursive: true });
  const fidelity: ReplayFidelity = {
    exactHits: 0,
    toolFallbackHits: 0,
    urlFallbackHits: 0,
    liveAllowed: 0,
    liveForced: 0,
    misses: [],
  };
  let recordedCalls = 0;

  const byExact = new Map<string, RecordedCall[]>();
  const byUrl = new Map<string, RecordedCall[]>();
  // Keyed url + tool. A recording made before this field existed simply has no
  // entries here and falls through to the url tier exactly as it used to.
  const byTool = new Map<string, RecordedCall[]>();
  const toolTierKey = (urlKey: string, tool: string | null | undefined): string | null =>
    tool ? `${urlKey}|${tool}` : null;
  if (mode === "replay") {
    for (const call of loadRecording(dir)) {
      (byExact.get(call.key) ?? byExact.set(call.key, []).get(call.key)!).push(call);
      (byUrl.get(call.urlKey) ?? byUrl.set(call.urlKey, []).get(call.urlKey)!).push(call);
      const toolKey = toolTierKey(call.urlKey, call.tool);
      if (toolKey) (byTool.get(toolKey) ?? byTool.set(toolKey, []).get(toolKey)!).push(call);
    }
  }

  const originalFetch = globalThis.fetch;
  const priorEvalMode = process.env.ARGUS_EVAL_MODE;
  const priorEvalCapturedAt = process.env.ARGUS_EVAL_CAPTURED_AT;
  process.env.ARGUS_EVAL_MODE = mode;
  // The public-web transport takes eval mode from THIS call, not from the
  // environment, so a stray variable can neither switch it on in a deployment
  // nor switch it off in a local shell that has pulled deployment env vars.
  setEvalTransportMode(mode);
  if (mode === "replay") {
    if (options.replayCapturedAt && Number.isFinite(Date.parse(options.replayCapturedAt))) {
      process.env.ARGUS_EVAL_CAPTURED_AT = new Date(options.replayCapturedAt).toISOString();
    } else {
      delete process.env.ARGUS_EVAL_CAPTURED_AT;
    }
  }
  const hostAllowed = (host: string, allowedHosts: readonly string[] | undefined): boolean =>
    allowedHosts?.some((allowed) =>
      allowed === "*" || host === allowed || host.endsWith(`.${allowed}`)) ?? false;
  const requestTool = (body: string): string | null => {
    try {
      const parsed = JSON.parse(body) as {
        tool_choice?: { name?: unknown };
        response_format?: { json_schema?: { name?: unknown } };
      };
      const name = parsed.tool_choice?.name ?? parsed.response_format?.json_schema?.name;
      return typeof name === "string" ? name : null;
    } catch {
      return null;
    }
  };
  const removeRecordedCall = (call: RecordedCall): void => {
    const exactTier = byExact.get(call.key);
    if (exactTier) {
      const index = exactTier.indexOf(call);
      if (index >= 0) exactTier.splice(index, 1);
      if (exactTier.length === 0) byExact.delete(call.key);
    }
    const urlTier = byUrl.get(call.urlKey);
    if (urlTier) {
      const index = urlTier.indexOf(call);
      if (index >= 0) urlTier.splice(index, 1);
      if (urlTier.length === 0) byUrl.delete(call.urlKey);
    }
    const toolKey = toolTierKey(call.urlKey, call.tool);
    const toolTier = toolKey ? byTool.get(toolKey) : undefined;
    if (toolKey && toolTier) {
      const index = toolTier.indexOf(call);
      if (index >= 0) toolTier.splice(index, 1);
      if (toolTier.length === 0) byTool.delete(toolKey);
    }
  };
  const record = (method: string, url: string, body: string, response: Response, sideFile?: string): Promise<Response> => {
    const clone = response.clone();
    return clone.text().then((text) => {
      const call: RecordedCall = {
        key: matchKey(method, url, body),
        urlKey: urlOnlyKey(method, url),
        seq: recordedCalls,
        method: method.toUpperCase(),
        url: scrubUrl(url),
        status: response.status,
        contentType: clone.headers.get("content-type") ?? "",
        body: text,
        tool: requestTool(body),
      };
      const target = sideFile ?? callsPath(dir);
      mkdirSync(dirname(target), { recursive: true });
      appendFileSync(target, `${JSON.stringify(call)}\n`);
      recordedCalls += 1;
      return toResponse(call);
    });
  };

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const { method, url, body } = await materializeRequest(input, init);
    const bridgedNativeRequest = evalNativeRequest(init);
    const liveRequest = (): Promise<Response> => bridgedNativeRequest
      ? bridgedNativeRequest()
      : originalFetch(input, init);
    if (mode === "record") {
      const live = await liveRequest();
      return record(method, url, body, live);
    }
    const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
    // Variance checks need an explicit paid lane that bypasses even an exact
    // frozen response. Keep this separate from allowLiveHosts, which only
    // permits changed-request misses to go live.
    const tool = requestTool(body);
    const toolForced = tool !== null && options.forceLiveTools?.includes(tool);
    if (hostAllowed(host, options.forceLiveHosts) || toolForced) {
      fidelity.liveForced += 1;
      const live = await liveRequest();
      return record(method, url, body, live, join(dir, "live-lane.jsonl"));
    }
    const exact = byExact.get(matchKey(method, url, body));
    if (exact?.length) {
      fidelity.exactHits += 1;
      const call = exact[0];
      removeRecordedCall(call);
      return toResponse(call);
    }
    if (tool && EXACT_MATCH_ONLY_TOOLS.has(tool)) {
      fidelity.misses.push({ method, url: scrubUrl(url) });
      throw new Error(
        `eval replay miss: ${method} ${scrubUrl(url)} has no exact recording for decision tool ${tool} in ${dir}`,
      );
    }
    // A changed non-decision request to a live-allowed host goes live before
    // the URL tier. Decision variants use forceLiveTools and were handled above;
    // they never fall through implicitly. "*" allows every other miss in a
    // variant lane, while identical requests still replay through the exact tier.
    const liveAllowed = hostAllowed(host, options.allowLiveHosts);
    if (liveAllowed) {
      fidelity.liveAllowed += 1;
      const live = await liveRequest();
      return record(method, url, body, live, join(dir, "live-lane.jsonl"));
    }
    // Non-decision structured calls may survive harmless request drift by
    // matching the tool they asked for. Decision tools already failed closed
    // above because their evidence and citation semantics require an exact
    // request match.
    const toolKey = toolTierKey(urlOnlyKey(method, url), tool);
    const toolTier = toolKey ? byTool.get(toolKey) : undefined;
    if (toolTier?.length) {
      fidelity.toolFallbackHits += 1;
      const call = toolTier[0];
      removeRecordedCall(call);
      return toResponse(call);
    }
    const urlTier = byUrl.get(urlOnlyKey(method, url));
    if (urlTier?.length) {
      fidelity.urlFallbackHits += 1;
      // A structured request may only consume a response recorded for that
      // same structured tool. An untagged response can end with ordinary text
      // and no tool call, which turns an honest fixture miss into a misleading
      // analyst failure. Untagged requests remain eligible only for untagged
      // rows.
      const call = tool
        ? urlTier.find((candidate) => candidate.tool === tool)
        : urlTier.find((candidate) => !candidate.tool);
      if (call) {
        removeRecordedCall(call);
        return toResponse(call);
      }
      // The remaining rows belong to another request class. Serving one anyway
      // answers a call with someone else's response; a miss is the honest result.
      fidelity.urlFallbackHits -= 1;
    }
    fidelity.misses.push({ method, url: scrubUrl(url) });
    throw new Error(`eval replay miss: ${method} ${scrubUrl(url)} has no recording in ${dir}`);
  }) as typeof fetch;

  try {
    const result = await work();
    return { result, fidelity, recordedCalls };
  } finally {
    globalThis.fetch = originalFetch;
    setEvalTransportMode(null);
    if (priorEvalMode === undefined) delete process.env.ARGUS_EVAL_MODE;
    else process.env.ARGUS_EVAL_MODE = priorEvalMode;
    if (priorEvalCapturedAt === undefined) delete process.env.ARGUS_EVAL_CAPTURED_AT;
    else process.env.ARGUS_EVAL_CAPTURED_AT = priorEvalCapturedAt;
  }
}

export interface EvalSnapshot {
  subject: string;
  recordedAt: string;
  score: number | null;
  verdict: string | null;
  completeness: string | null;
  verifiedFactCount: number;
  costUsd: number | null;
}

export function writeSnapshot(dir: string, snapshot: EvalSnapshot): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function readSnapshot(dir: string): EvalSnapshot | null {
  const path = join(dir, "snapshot.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as EvalSnapshot;
}
