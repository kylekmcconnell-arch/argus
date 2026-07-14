import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

const MAX_TEXT_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const JINA_READER_ORIGIN = "https://r.jina.ai/";
const PUBLIC_WEB_USER_AGENT = "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)";
const JINA_RECOVERABLE_FAILURES = new Set([
  "anti_bot_challenge",
  "http_403",
  "http_429",
  "transport_error",
  "response_stream_error",
]);
const JINA_TRANSIENT_FAILURES = new Set([
  "http_422",
  "http_429",
  "transport_error",
  "response_stream_error",
]);
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
const CAPABILITY_PATH_LABEL = /^(?:auth|invite|magic|private|secret|share|signed|token)$/i;
const SAFE_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xhtml+xml",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

function antiBotChallengeHeaders(headers: Headers): boolean {
  const mitigation = headers.get("cf-mitigated") ?? "";
  const captcha = headers.get("x-datadome") ?? headers.get("x-captcha") ?? "";
  return /challenge|captcha/i.test(`${mitigation} ${captcha}`);
}

/** Match only explicit interstitial machinery, not an article that happens to
 * discuss bot protection. These pages sometimes arrive with HTTP 200. */
function antiBotChallengeBody(contentType: string, text: string): boolean {
  if (!/html|xhtml/i.test(contentType)) return false;
  const sample = text.slice(0, 200_000);
  const cloudflareTitle = /<title[^>]*>\s*just a moment(?:\.{3})?\s*<\/title>/i.test(sample);
  const cloudflareRuntime = /(?:\/cdn-cgi\/challenge-platform\/|challenges\.cloudflare\.com|\bcf-chl-)/i.test(sample);
  const otherChallengeRuntime = /(?:captcha-delivery|_pxcaptcha|perimeterx|datadome|incapsula|akamai bot manager)/i.test(sample);
  const humanPrompt = /(?:verify (?:that )?you are human|checking (?:your )?browser(?: before accessing)?|enable javascript and cookies to continue)/i.test(sample);
  return (cloudflareTitle && cloudflareRuntime)
    || (otherChallengeRuntime && humanPrompt);
}

export interface PublicTextDocument {
  status: "ok";
  url: string;
  host: string;
  contentType: string;
  text: string;
  contentHash: string;
  capturedAt: string;
}

export interface PublicTextFailure {
  status: "rejected" | "failed";
  reason: string;
}

export type PublicTextResult = PublicTextDocument | PublicTextFailure;

export interface RetrievedPublicTextDocument extends PublicTextDocument {
  /** How the bytes were obtained, independently of the evidence URL. */
  retrievalMethod: "direct" | "reader_recovery";
  /** Network service that returned the bytes. */
  retrievalProvider: "origin" | "jina-reader";
  /** Actual fetched URL; differs from `url` only for reader recovery. */
  retrievalUrl: string;
}

export type PublicTextWithRecoveryResult = RetrievedPublicTextDocument | PublicTextFailure;

function normalizedJinaSource(text: string): string | null {
  const matches = [...text.matchAll(/^URL Source:\s*(\S+)\s*$/gm)];
  if (matches.length !== 1) return null;
  try {
    const source = new URL(matches[0][1]);
    if ((source.protocol !== "https:" && source.protocol !== "http:") || source.username || source.password) return null;
    source.hash = "";
    return source.toString();
  } catch {
    return null;
  }
}

function pathnameMayContainCapability(url: URL): boolean {
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  return segments.some((segment, index) => {
    if (CAPABILITY_PATH_LABEL.test(segment) && Boolean(segments[index + 1])) return true;
    return /^(?:share|invite|token|secret)[-_][A-Za-z0-9_-]{12,}$/i.test(segment);
  });
}

type LookupAddress = { address: string; family: number };
type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

export interface PinnedRequestOptions {
  signal: AbortSignal;
  headers: Record<string, string>;
  /** Socket-level resolver containing only the addresses validated for this hop. */
  lookup: LookupFunction;
}

type RequestFn = (url: URL, options: PinnedRequestOptions) => Promise<Response>;

export interface PublicWebDependencies {
  request?: RequestFn;
  lookup?: LookupFn;
  now?: () => Date;
  wait?: (delayMs: number) => Promise<void>;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    const parts = value.split(":");
    const first = Number.parseInt(parts[0] || "0", 16);
    const second = Number.parseInt(parts[1] || "0", 16);
    // Public evidence fetches use a positive global-unicast policy. This
    // rejects loopback/site-local/ULA, IPv4-compatible and NAT64 forms, plus
    // 6to4/Teredo/ORCHID transition ranges that can encapsulate private IPv4.
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
    if (first === 0x2002 || first === 0x3ffe) return false;
    if (first === 0x2001 && (
      second === 0x0000
      || second === 0x0002
      || (second >= 0x0010 && second <= 0x002f)
      || second === 0x0db8
    )) return false;
    return true;
  }
  return false;
}

const defaultLookup: LookupFn = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

interface ValidatedPublicTarget {
  url: URL;
  hostname: string;
  addresses: readonly LookupAddress[];
}

const normalizedHostname = (value: string): string => value
  .replace(/^\[|\]$/g, "")
  .replace(/\.$/, "")
  .toLowerCase();

async function validatedPublicTarget(
  raw: string,
  base?: URL,
  lookup: LookupFn = defaultLookup,
): Promise<ValidatedPublicTarget | null> {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) return null;
  if ([...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))) return null;

  const hostname = normalizedHostname(url.hostname);
  if (
    !hostname
    || isIP(hostname)
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) return null;

  try {
    const resolved = await lookup(hostname);
    if (!resolved.length) return null;
    const addresses = resolved.map((entry) => ({
      address: entry.address,
      // Trust the parsed address rather than provider-supplied family metadata.
      family: isIP(entry.address),
    }));
    if (addresses.some((entry) => !entry.family || !isPublicIpAddress(entry.address))) return null;
    url.hash = "";
    return {
      url,
      hostname,
      addresses: Object.freeze(addresses.map((entry) => Object.freeze({ ...entry }))),
    };
  } catch {
    return null;
  }
}

export async function validatedPublicUrl(
  raw: string,
  base?: URL,
  lookup: LookupFn = defaultLookup,
): Promise<URL | null> {
  return (await validatedPublicTarget(raw, base, lookup))?.url ?? null;
}

const pinnedLookupFor = (target: ValidatedPublicTarget): LookupFunction =>
  (hostname, options, callback) => {
    const requestedHost = normalizedHostname(hostname);
    if (requestedHost !== target.hostname) {
      const error = new Error("socket lookup hostname differed from validated target") as NodeJS.ErrnoException;
      error.code = "EACCES";
      callback(error, "", 0);
      return;
    }

    // Revalidate the frozen set at connection time. The native request receives
    // only these addresses; it never calls the external resolver a second time.
    const publicAddresses = target.addresses.filter((entry) =>
      entry.family === isIP(entry.address) && isPublicIpAddress(entry.address));
    const requestedFamily = options.family === "IPv4"
      ? 4
      : options.family === "IPv6"
        ? 6
        : options.family;
    const eligible = requestedFamily === 4 || requestedFamily === 6
      ? publicAddresses.filter((entry) => entry.family === requestedFamily)
      : publicAddresses;
    if (!eligible.length) {
      const error = new Error("validated target has no public address for requested family") as NodeJS.ErrnoException;
      error.code = "EACCES";
      callback(error, "", 0);
      return;
    }
    if (options.all) callback(null, eligible.map((entry) => ({ ...entry })));
    else callback(null, eligible[0].address, eligible[0].family);
  };

const responseHeaders = (rawHeaders: readonly string[]): Headers => {
  const headers = new Headers();
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    headers.append(rawHeaders[index], rawHeaders[index + 1]);
  }
  return headers;
};

const nativeRequest: RequestFn = (url, options) => new Promise<Response>((resolve, reject) => {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestOptions: RequestOptions = {
    method: "GET",
    headers: options.headers,
    signal: options.signal,
    lookup: options.lookup,
    // Never reuse a socket whose connection was established under another DNS
    // decision. Every hop must exercise this request's pinned lookup.
    agent: false,
  };
  const outgoing = request(url, requestOptions, (incoming) => {
    const status = incoming.statusCode ?? 500;
    const headers = responseHeaders(incoming.rawHeaders);
    const noBody = status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400);
    if (noBody) {
      incoming.resume();
      resolve(new Response(null, { status, statusText: incoming.statusMessage, headers }));
      return;
    }
    const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    resolve(new Response(body, { status, statusText: incoming.statusMessage, headers }));
  });
  outgoing.once("error", reject);
  outgoing.end();
});

async function readBoundedText(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_TEXT_BYTES) return null;
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  const reader = response.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TEXT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchValidatedPublicText(
  initialTarget: ValidatedPublicTarget,
  dependencies: PublicWebDependencies = {},
  accept = "text/html,application/xhtml+xml,application/json,text/plain;q=0.8",
): Promise<PublicTextResult> {
  const request = dependencies.request ?? nativeRequest;
  const lookup = dependencies.lookup ?? defaultLookup;
  let target: ValidatedPublicTarget | null = initialTarget;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Response;
    try {
      response = await request(target.url, {
        signal: AbortSignal.timeout(8_000),
        headers: {
          accept,
          "accept-language": "en-US,en;q=0.8",
          "user-agent": PUBLIC_WEB_USER_AGENT,
        },
        lookup: pinnedLookupFor(target),
      });
    } catch {
      return { status: "failed", reason: "transport_error" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) return { status: "failed", reason: "invalid_or_excessive_redirect" };
      target = await validatedPublicTarget(location, target.url, lookup);
      if (!target) return { status: "rejected", reason: "unsafe_redirect" };
      continue;
    }
    // Anti-bot interstitials can be returned as HTTP 200 or 503. Treat an
    // explicit mitigation header as retrieval failure so the caller may use
    // the same bounded, source-checked recovery path as an ordinary 403.
    if (antiBotChallengeHeaders(response.headers)) {
      return { status: "failed", reason: "anti_bot_challenge" };
    }
    if (!response.ok) return { status: "failed", reason: `http_${response.status}` };

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType && !SAFE_CONTENT_TYPES.has(contentType)) {
      return { status: "failed", reason: "unsupported_content_type" };
    }
    let bytes: Buffer | null;
    try {
      bytes = await readBoundedText(response);
    } catch {
      return { status: "failed", reason: "response_stream_error" };
    }
    if (!bytes) return { status: "failed", reason: "response_too_large" };
    const text = bytes.toString("utf8");
    if (!text.trim()) return { status: "failed", reason: "empty_response" };
    if (antiBotChallengeBody(contentType, text)) {
      return { status: "failed", reason: "anti_bot_challenge" };
    }

    return {
      status: "ok",
      url: target.url.toString(),
      host: target.url.hostname.replace(/^www\./i, "").toLowerCase(),
      contentType: contentType || "text/plain",
      text,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      capturedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    };
  }
  return { status: "failed", reason: "redirect_loop" };
}

export async function fetchPublicText(
  raw: string,
  dependencies: PublicWebDependencies = {},
): Promise<PublicTextResult> {
  const lookup = dependencies.lookup ?? defaultLookup;
  const target = await validatedPublicTarget(raw, undefined, lookup);
  if (!target) return { status: "rejected", reason: "unsafe_or_unresolvable_url" };
  return fetchValidatedPublicText(target, dependencies);
}

/**
 * Fetch source text directly, then make one bounded keyless Jina Reader recovery
 * only when the validated origin returned an ordinary retrieval failure. A
 * transient reader failure receives at most one delayed retry.
 * Unsafe origins and unsafe redirects remain rejected and never reach a proxy.
 */
export async function fetchPublicTextWithRecovery(
  raw: string,
  dependencies: PublicWebDependencies = {},
): Promise<PublicTextWithRecoveryResult> {
  const lookup = dependencies.lookup ?? defaultLookup;
  const originalTarget = await validatedPublicTarget(raw, undefined, lookup);
  if (!originalTarget) return { status: "rejected", reason: "unsafe_or_unresolvable_url" };

  const direct = await fetchValidatedPublicText(originalTarget, dependencies);
  if (direct.status === "ok") {
    return {
      ...direct,
      retrievalMethod: "direct",
      retrievalProvider: "origin",
      retrievalUrl: direct.url,
    };
  }
  // Rejected redirects are security decisions, not recoverable availability
  // failures. Never disclose their target to a third-party reader.
  if (direct.status === "rejected") return direct;
  if (!JINA_RECOVERABLE_FAILURES.has(direct.reason)) return direct;
  // Query strings routinely carry share tokens, OAuth codes, and other opaque
  // capabilities whose names cannot be exhaustively classified. Never forward
  // any query-bearing evidence URL to a third-party rendering service.
  if (originalTarget.url.search) return direct;
  // Some products put the same bearer capability in a path segment. Direct
  // origin retrieval remains allowed, but a likely token/share/invite path or
  // opaque high-entropy segment must never be disclosed to the reader proxy.
  if (pathnameMayContainCapability(originalTarget.url)) return direct;

  const readerTarget = await validatedPublicTarget(
    `${JINA_READER_ORIGIN}${originalTarget.url.toString()}`,
    undefined,
    lookup,
  );
  if (!readerTarget) return { status: "failed", reason: "reader_target_validation_failed" };
  let recovered = await fetchValidatedPublicText(readerTarget, dependencies, "text/plain,text/markdown;q=0.9");
  // Reader 422/429 and transport failures are frequently transient while the
  // upstream page is rendered. One delayed retry is enough to reuse a warmed
  // reader result without turning source verification into an open-ended job.
  if (recovered.status === "failed" && JINA_TRANSIENT_FAILURES.has(recovered.reason)) {
    await (dependencies.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))))(750);
    recovered = await fetchValidatedPublicText(readerTarget, dependencies, "text/plain,text/markdown;q=0.9");
  }
  if (recovered.status !== "ok") {
    return { status: "failed", reason: `reader_recovery_failed_${recovered.reason}` };
  }
  if (recovered.url !== readerTarget.url.toString()) {
    return { status: "failed", reason: "reader_redirect_mismatch" };
  }
  if (normalizedJinaSource(recovered.text) !== originalTarget.url.toString()) {
    return { status: "failed", reason: "reader_source_mismatch" };
  }

  return {
    ...recovered,
    // Evidence classification and citations must stay bound to the source the
    // model named, never to the rendering intermediary.
    url: originalTarget.url.toString(),
    host: originalTarget.hostname.replace(/^www\./i, "").toLowerCase(),
    retrievalMethod: "reader_recovery",
    retrievalProvider: "jina-reader",
    retrievalUrl: recovered.url,
  };
}
