import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

const MAX_TEXT_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;
const SAFE_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xhtml+xml",
  "text/html",
  "text/plain",
  "text/xml",
]);

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
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return !(
      value === "::"
      || value === "::1"
      || value.startsWith("fc")
      || value.startsWith("fd")
      || /^fe[89ab]/.test(value)
      || value.startsWith("ff")
      || value.startsWith("2001:db8:")
      || value.startsWith("::ffff:")
    );
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

export async function fetchPublicText(
  raw: string,
  dependencies: PublicWebDependencies = {},
): Promise<PublicTextResult> {
  const request = dependencies.request ?? nativeRequest;
  const lookup = dependencies.lookup ?? defaultLookup;
  let target = await validatedPublicTarget(raw, undefined, lookup);
  if (!target) return { status: "rejected", reason: "unsafe_or_unresolvable_url" };

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Response;
    try {
      response = await request(target.url, {
        signal: AbortSignal.timeout(8_000),
        headers: {
          accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8",
          "user-agent": "ARGUS due-diligence evidence collector/1.0",
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
