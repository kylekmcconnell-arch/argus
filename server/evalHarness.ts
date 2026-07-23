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
}

export interface ReplayFidelity {
  exactHits: number;
  urlFallbackHits: number;
  liveAllowed: number;
  misses: Array<{ method: string; url: string }>;
}

// Locally-generated volatile values that differ between the recording run and
// a replay run (clocks, run ids) but flow into request bodies. Scrubbed from
// the match key only; stored bodies keep their original text.
const VOLATILE_PATTERNS: RegExp[] = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, // ISO timestamps
  /\b1[6-9]\d{11}\b/g, // epoch milliseconds
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, // uuids
  /\bPA-[0-9A-F]{10,}\b/g, // report ids
];

const SENSITIVE_QUERY_PARAM = /^(?:(?:api[-_]?)?key|token|secret|auth|signature|sig|apikey|x[-_]api[-_]key)$/i;

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
    .map((line) => JSON.parse(line) as RecordedCall);
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
  options: { allowLiveHosts?: string[] } = {},
): Promise<{ result: T; fidelity: ReplayFidelity; recordedCalls: number }> {
  mkdirSync(dir, { recursive: true });
  const fidelity: ReplayFidelity = { exactHits: 0, urlFallbackHits: 0, liveAllowed: 0, misses: [] };
  let recordedCalls = 0;

  const byExact = new Map<string, RecordedCall[]>();
  const byUrl = new Map<string, RecordedCall[]>();
  if (mode === "replay") {
    for (const call of loadRecording(dir)) {
      (byExact.get(call.key) ?? byExact.set(call.key, []).get(call.key)!).push(call);
      (byUrl.get(call.urlKey) ?? byUrl.set(call.urlKey, []).get(call.urlKey)!).push(call);
    }
  }

  const originalFetch = globalThis.fetch;
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
    if (mode === "record") {
      const live = await originalFetch(input, init);
      return record(method, url, body, live);
    }
    const exact = byExact.get(matchKey(method, url, body));
    if (exact?.length) {
      fidelity.exactHits += 1;
      const call = exact.length > 1 ? exact.shift()! : exact[0];
      // Also consume the url-tier copy so fallback ordering stays aligned.
      const urlTier = byUrl.get(call.urlKey);
      if (urlTier) {
        const index = urlTier.indexOf(call);
        if (index >= 0 && urlTier.length > 1) urlTier.splice(index, 1);
      }
      return toResponse(call);
    }
    const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
    // A CHANGED request to a live-allowed host goes live BEFORE the url-tier
    // fallback: serving a recorded response for a different request body would
    // poison an A/B variant (e.g. the baseline's verdict answered for a packet
    // it never scored). "*" allows every miss (the variant lane). Identical
    // requests still replay via the exact tier above.
    const liveAllowed = options.allowLiveHosts?.some((allowed) => allowed === "*" || host === allowed || host.endsWith(`.${allowed}`)) ?? false;
    if (liveAllowed) {
      fidelity.liveAllowed += 1;
      const live = await originalFetch(input, init);
      return record(method, url, body, live, join(dir, "live-lane.jsonl"));
    }
    const urlTier = byUrl.get(urlOnlyKey(method, url));
    if (urlTier?.length) {
      fidelity.urlFallbackHits += 1;
      return toResponse(urlTier.length > 1 ? urlTier.shift()! : urlTier[0]);
    }
    fidelity.misses.push({ method, url: scrubUrl(url) });
    throw new Error(`eval replay miss: ${method} ${scrubUrl(url)} has no recording in ${dir}`);
  }) as typeof fetch;

  try {
    const result = await work();
    return { result, fidelity, recordedCalls };
  } finally {
    globalThis.fetch = originalFetch;
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
