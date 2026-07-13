// Site substance / liveness reader. This adapter classifies what the fetch
// actually proved. A denied automated request is not evidence that a site is
// offline, and a transport failure is not evidence that a project is unshipped.
// Only a parked page or explicit coming-soon page served by the domain can
// support a SiteNotLive finding downstream.
import { recordCall } from "../cost";

export type SiteSubstanceStatus =
  | "live"
  | "coming_soon"
  | "unreachable"
  | "access_blocked"
  | "unavailable"
  | "client_rendered";

export type SiteSubstanceReason =
  | "parked"
  | "coming_soon"
  | "dns"
  | "transport"
  | "dns_and_transport"
  | "http_access"
  | "anti_bot"
  | "http"
  | "content";

export interface SiteSubstance {
  url: string;
  status: SiteSubstanceStatus;
  detail: string;
  /** Machine-readable attribution. Coming-soon reasons are verified markers. */
  reason?: SiteSubstanceReason;
}

const COMING = /coming[\s_-]*soon|under[\s_-]*construction|launching[\s_-]*soon|join[\s_-]*(the[\s_-]*)?waitlist|\bwaitlist\b|early[\s_-]*access|get[\s_-]*notified|notify[\s_-]*me|be[\s_-]*the[\s_-]*first|request[\s_-]*access|sign[\s_-]*up[\s_-]*for[\s_-]*(early[\s_-]*)?access/i;
const HARD_COMING = /coming[\s_-]*soon|under[\s_-]*construction|launching[\s_-]*soon/i;
const PARKED = /this[\s_-]*domain[\s_-]*is[\s_-]*for[\s_-]*sale|buy[\s_-]*this[\s_-]*domain|hugedomains|sedoparking|parkingcrew|domain[\s_-]*(is[\s_-]*)?parked/i;
const PRODUCT = /\b(docs|whitepaper|dashboard|pricing|features|roadmap|marketplace|explorer|portfolio|order\s*book|connect\s*wallet|launch\s*app|sign\s*in|log\s*in|deposit|withdraw|governance|staking)\b/i;
const ANTI_BOT = /cf-chl-|challenge-platform|just a moment(?:\.{3})?|checking (?:your )?browser(?: before accessing)?|verify (?:that )?you are human|captcha-delivery|_pxcaptcha|perimeterx|datadome|incapsula|akamai bot manager|bot verification/i;
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA", "ENONAME"]);

type PageSuccess = { kind: "page"; url: string; html: string };
type PageFailure = { kind: "failure" } & SiteSubstance;
type PageResult = PageSuccess | PageFailure;

function stripText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function errorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code.toUpperCase();
    current = candidate.cause;
  }
  return undefined;
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function isAntiBotResponse(response: Response, body: string): boolean {
  const mitigation = response.headers.get("cf-mitigated") ?? "";
  const challenge = response.headers.get("x-datadome")
    ?? response.headers.get("x-captcha")
    ?? "";
  return /challenge|captcha/i.test(`${mitigation} ${challenge}`) || ANTI_BOT.test(body);
}

async function get(url: string, opts?: { requireHtml?: boolean }): Promise<PageResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)",
        accept: "text/html,application/javascript",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const dns = DNS_CODES.has(errorCode(error) ?? "");
    recordCall("site-fetch", "substance", 0, dns ? "dns_error" : "transport_error", "failed");
    return {
      kind: "failure",
      url,
      status: "unreachable",
      reason: dns ? "dns" : "transport",
      detail: dns
        ? `DNS resolution failed for ${hostname(url)}`
        : `the request to ${hostname(url)} failed at the transport layer`,
    };
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    recordCall("site-fetch", "substance", 0, "response_text_error", "failed");
    return {
      kind: "failure",
      url: response.url || url,
      status: "unavailable",
      reason: "content",
      detail: `HTTP ${response.status} responded, but its body could not be read`,
    };
  }

  const finalUrl = response.url || url;
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    recordCall("site-fetch", "substance", 0, `http_${response.status}_access_blocked`, "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "access_blocked",
      reason: "http_access",
      detail: response.status === 429
        ? "the site rate-limited the automated liveness request (HTTP 429)"
        : `the site denied the automated liveness request (HTTP ${response.status})`,
    };
  }

  // Challenges are often returned as HTTP 200 or 503. Detect their content and
  // headers before interpreting the status as site availability.
  if (isAntiBotResponse(response, html)) {
    recordCall("site-fetch", "substance", 0, `anti_bot_http_${response.status}`, "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "access_blocked",
      reason: "anti_bot",
      detail: `the site served an anti-bot challenge instead of its homepage (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    recordCall("site-fetch", "substance", 0, `http_${response.status}`, "failed");
    return {
      kind: "failure",
      url: finalUrl,
      status: "unavailable",
      reason: "http",
      detail: `the liveness request returned HTTP ${response.status}; this does not prove the site is offline`,
    };
  }

  // The homepage must be HTML; a JS bundle (application/javascript) must not be.
  if ((opts?.requireHtml ?? true) && !/html/i.test(response.headers.get("content-type") ?? "")) {
    recordCall("site-fetch", "substance", 0, "unexpected_content_type", "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "unavailable",
      reason: "content",
      detail: `the homepage returned ${response.headers.get("content-type") || "an unknown content type"}, not HTML`,
    };
  }
  if (!html.trim()) {
    recordCall("site-fetch", "substance", 0, "empty_body", "partial");
    return {
      kind: "failure",
      url: finalUrl,
      status: "unavailable",
      reason: "content",
      detail: "the homepage returned an empty body; no liveness conclusion can be drawn",
    };
  }
  recordCall("site-fetch", "substance", 0, undefined, "succeeded");
  return { kind: "page", url: finalUrl, html };
}

function failedSiteResult(domain: string, failures: PageFailure[]): SiteSubstance {
  const blocked = failures.find((failure) => failure.status === "access_blocked");
  if (blocked) return { url: blocked.url, status: blocked.status, reason: blocked.reason, detail: blocked.detail };

  // A received HTTP/content response is stronger attribution than a failure on
  // the alternate hostname. It proves the host responded, but not that it is live.
  const unavailable = failures.find((failure) => failure.status === "unavailable");
  if (unavailable) {
    return { url: unavailable.url, status: unavailable.status, reason: unavailable.reason, detail: unavailable.detail };
  }

  const reasons = new Set(failures.map((failure) => failure.reason));
  const reason: SiteSubstanceReason = reasons.has("dns") && reasons.has("transport")
    ? "dns_and_transport"
    : reasons.has("dns")
      ? "dns"
      : "transport";
  return {
    url: `https://${domain}`,
    status: "unreachable",
    reason,
    detail: reason === "dns"
      ? `DNS resolution failed for ${domain}`
      : reason === "dns_and_transport"
        ? `DNS resolution and transport attempts both failed for ${domain}`
        : `transport requests failed for ${domain}`,
  };
}

// Pull the first same-origin module/script bundle URLs from the shell. Bundle
// text may explain why static reading is limited, but an unrendered string is
// not verified evidence that the homepage itself is a coming-soon page.
function bundleUrls(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && out.length < 3) {
    const src = match[1];
    if (/\.js(\?|$)/i.test(src) && !/googletagmanager|gtag|analytics|hotjar|intercom|segment|cdn\.jsdelivr|unpkg/i.test(src)) {
      try {
        const resolved = new URL(src, base);
        if (resolved.origin === new URL(base).origin) out.push(resolved.href);
      } catch { /* skip invalid or cross-origin bundles */ }
    }
  }
  return out;
}

function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameFirst = html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];
  if (nameFirst) return nameFirst;
  return html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, "i"))?.[1] ?? "";
}

export async function checkSiteSubstance(domain: string): Promise<SiteSubstance | null> {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().trim();
  if (!d || !/\.[a-z]{2,}$/i.test(d)) return null;

  const candidates = d.startsWith("www.")
    ? [`https://${d}`, `https://${d.slice(4)}`]
    : [`https://${d}`, `https://www.${d}`];
  const failures: PageFailure[] = [];
  let page: PageSuccess | undefined;
  for (const candidate of candidates) {
    const result = await get(candidate);
    if (result.kind === "page") {
      page = result;
      break;
    }
    failures.push(result);
  }
  if (!page) return failedSiteResult(d, failures);

  const meta = metaContent(page.html, "description");
  const title = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g, " ").trim() ?? "";
  const body = stripText(page.html);
  const hasSubstantialProductSurface = body.length >= 400 && PRODUCT.test(body);

  // Registrar parking / for-sale pages are direct served-page evidence.
  if (PARKED.test(page.html)) {
    return {
      url: page.url,
      status: "coming_soon",
      reason: "parked",
      detail: "the served homepage is a registrar parking or domain-for-sale page",
    };
  }

  // Require an explicit marker in the served title, metadata, or visible body.
  // Incidental waitlist text on a substantial product surface is not enough.
  const hardComingMarker = HARD_COMING.test(`${title} ${meta}`);
  const comingOnlySurface = COMING.test(`${title} ${meta} ${body}`) && !hasSubstantialProductSurface;
  if (hardComingMarker || comingOnlySurface) {
    const excerpt = [title, meta].find((value) => COMING.test(value)) || body.match(COMING)?.[0] || "coming-soon marker";
    return {
      url: page.url,
      status: "coming_soon",
      reason: "coming_soon",
      detail: `the served homepage explicitly presents a coming-soon or waitlist surface ("${excerpt.slice(0, 80)}")`,
    };
  }

  if (hasSubstantialProductSurface) {
    return { url: page.url, status: "live", detail: `live site${meta ? `: "${meta.slice(0, 80)}"` : ""}` };
  }

  // A static shell proves a web app is served, but not which route or component
  // is rendered. Bundle-only coming-soon strings remain neutral discovery hints.
  const isShell = /id=["'](root|__next|app|__nuxt)["']/i.test(page.html) || /<script[^>]+type=["']module["']/i.test(page.html);
  if (isShell && body.length < 300) {
    let bundleHint = false;
    for (const bundle of bundleUrls(page.html, page.url)) {
      const js = await get(bundle, { requireHtml: false }).catch(() => null);
      if (!js || js.kind !== "page") continue;
      if (COMING.test(js.html) || /ComingSoon|Waitlist|EarlyAccess|UnderConstruction/i.test(js.html)) {
        bundleHint = true;
      }
    }
    return {
      url: page.url,
      status: "client_rendered",
      detail: bundleHint
        ? "client-rendered app; its bundle contains an unrendered coming-soon string, which is not treated as homepage liveness evidence"
        : `client-rendered app; static read could not confirm a product surface${meta ? ` ("${meta.slice(0, 80)}")` : ""}`,
    };
  }

  // Some content, no clear product surface: the host served a normal page and
  // no explicit adverse liveness evidence was observed.
  return { url: page.url, status: "live", detail: `site is up${meta ? `: "${meta.slice(0, 80)}"` : ""}` };
}
