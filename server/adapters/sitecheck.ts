// Site substance / liveness reader. A project audit must know whether the
// project's OWN website is actually a live product — or still a coming-soon /
// waitlist page. That's a first-order substance signal: a token-promoting project
// whose site isn't live yet is early/vaporware, and the verdict should say so.
//
// The trap this avoids: modern sites are client-rendered SPAs whose served HTML is
// a near-empty shell (<div id="root"> + a JS bundle). "Thin HTML" is NOT "not live"
// — flagging a real app that way is the same false-attribution mistake as blaming a
// project for same-ticker copycats. So for a shell we read the JS BUNDLE, where the
// coming-soon / waitlist strings actually live, and only flag on an explicit marker.
import { recordCall } from "../cost";

export interface SiteSubstance {
  url: string;
  status: "live" | "coming_soon" | "unreachable" | "client_rendered";
  detail: string;
}

const COMING = /coming[\s_-]*soon|under[\s_-]*construction|launching[\s_-]*soon|join[\s_-]*(the[\s_-]*)?waitlist|\bwaitlist\b|early[\s_-]*access|get[\s_-]*notified|notify[\s_-]*me|be[\s_-]*the[\s_-]*first|request[\s_-]*access|sign[\s_-]*up[\s_-]*for[\s_-]*(early[\s_-]*)?access/i;
const PARKED = /this[\s_-]*domain[\s_-]*is[\s_-]*for[\s_-]*sale|buy[\s_-]*this[\s_-]*domain|hugedomains|sedoparking|parkingcrew|domain[\s_-]*(is[\s_-]*)?parked/i;
const PRODUCT = /\b(docs|whitepaper|dashboard|pricing|features|roadmap|marketplace|explorer|portfolio|order\s*book|connect\s*wallet|launch\s*app|sign\s*in|log\s*in|deposit|withdraw|governance|staking)\b/i;

function stripText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url: string, opts?: { requireHtml?: boolean }): Promise<{ url: string; html: string } | null> {
  try {
    recordCall("site-fetch", "substance", 0);
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html,application/javascript" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    // The homepage must be HTML; a JS bundle (application/javascript) must not be.
    if ((opts?.requireHtml ?? true) && !/html/i.test(r.headers.get("content-type") ?? "")) return null;
    return { url: r.url || url, html: await r.text() };
  } catch { return null; }
}

// Pull the first same-origin module/script bundle URL from the shell so we can read
// the strings a client-rendered page hides. Only the app's own bundle, not CDNs.
function bundleUrls(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 3) {
    const src = m[1];
    if (/\.js(\?|$)/i.test(src) && !/googletagmanager|gtag|analytics|hotjar|intercom|segment|cdn\.jsdelivr|unpkg/i.test(src)) {
      try { out.push(new URL(src, base).href); } catch { /* skip */ }
    }
  }
  return out;
}

export async function checkSiteSubstance(domain: string): Promise<SiteSubstance | null> {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase().trim();
  if (!d || !/\.[a-z]{2,}$/i.test(d)) return null;

  const page = (await get(`https://${d}`)) || (await get(`https://www.${d}`));
  if (!page) return { url: `https://${d}`, status: "unreachable", detail: "the site does not resolve or returns no page" };

  const meta = page.html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const body = stripText(page.html);

  // Registrar parking / for-sale page.
  if (PARKED.test(page.html)) return { url: page.url, status: "coming_soon", detail: "the domain is parked / for sale, not a live project site" };

  // Explicit coming-soon language in the served page or its meta.
  if (COMING.test(body) || COMING.test(meta)) return { url: page.url, status: "coming_soon", detail: `the homepage is a coming-soon / waitlist page${meta ? ` ("${meta.slice(0, 80)}")` : ""}` };

  // Real, server-rendered content with product surface → live.
  if (body.length >= 400 && PRODUCT.test(body)) return { url: page.url, status: "live", detail: `live site${meta ? ` — "${meta.slice(0, 80)}"` : ""}` };

  // Client-rendered shell: near-empty body but a JS app. Read the bundle for the
  // coming-soon / waitlist markers the served HTML doesn't show.
  const isShell = /id=["'](root|__next|app|__nuxt)["']/i.test(page.html) || /<script[^>]+type=["']module["']/i.test(page.html);
  if (isShell && body.length < 300) {
    for (const b of bundleUrls(page.html, page.url)) {
      const js = await get(b, { requireHtml: false }).catch(() => null);
      const text = js?.html ?? "";
      if (!text) continue;
      // Component / lazy-chunk names survive minification (e.g. a dynamic import of
      // "ComingSoonApp", a "Waitlist" route) — distinctive enough to match as a
      // substring without false-flagging a real app.
      if (COMING.test(text) || /ComingSoon|Waitlist|EarlyAccess|UnderConstruction/i.test(text)) {
        return { url: page.url, status: "coming_soon", detail: `the live site is a coming-soon / waitlist page (client-rendered${meta ? `, "${meta.slice(0, 60)}"` : ""})` };
      }
    }
    return { url: page.url, status: "client_rendered", detail: `client-rendered app; static read couldn't confirm a live product surface${meta ? ` ("${meta.slice(0, 80)}")` : ""}` };
  }

  // Some content, no clear product surface — call it live but thin, no false alarm.
  return { url: page.url, status: "live", detail: `site is up${meta ? ` — "${meta.slice(0, 80)}"` : ""}` };
}
