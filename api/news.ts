// Press coverage for a subject. GET /api/news?q=<name>&h=<x_handle>
//
// What you'd see clicking Google's "News" tab: recent articles about the subject,
// with source + date. A real project has press; a fresh shell has none, and a
// founder's coverage (funding, hacks, exits) is corroboration the account can't
// fake. Google News RSS — keyless, read-only.
//
// PRECISION over recall: a partial-word match drowns the report in noise (query
// "0xlumen" must never return Lumen Technologies or Stellar Lumens articles). So
// we search exact phrases and only keep headlines/descriptions that contain the
// exact phrase. A multi-word display name is distinctive; a single-word name is
// not, so then we anchor on the handle instead.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/<[^>]+>/g, "").trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : null;
}

interface Article { title: string; source: string; url: string | null; publishedAt: number | null; blob: string }

async function newsSearch(phrase: string): Promise<Article[]> {
  const scoped = `"${phrase}" (crypto OR token OR web3 OR blockchain OR NFT)`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(scoped)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.split(/<item>/).slice(1).map((b) => b.split("</item>")[0]);
    return items
      .map((b) => {
        const rawTitle = tag(b, "title") ?? "";
        const source = tag(b, "source") ?? (rawTitle.includes(" - ") ? rawTitle.split(" - ").pop()! : "");
        const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
        const link = tag(b, "link");
        const pub = tag(b, "pubDate");
        const desc = tag(b, "description") ?? "";
        return { title, source, url: link, publishedAt: pub ? Date.parse(pub) : null, blob: `${title} ${desc}`.toLowerCase() };
      })
      .filter((a) => a.title && a.url);
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Clean the display name (emoji/decoration off), keep the handle as a fallback anchor.
  const rawName = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const handle = typeof req.query.h === "string" ? req.query.h.trim().replace(/^@/, "") : "";
  const name = rawName.replace(/[^\p{L}\p{N}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!name && !handle) { res.status(400).json({ error: "q or h required" }); return; }

  // A one-word name ("Lumen") matches half the internet; only trust it with 2+
  // words. Otherwise anchor on the exact handle, which is globally distinctive.
  const phrases: string[] = [];
  if (name && name.split(/\s+/).length >= 2) phrases.push(name);
  if (handle) phrases.push(handle);
  if (!phrases.length && name) phrases.push(name);

  try {
    const seen = new Set<string>();
    const out: Omit<Article, "blob">[] = [];
    for (const phrase of phrases) {
      const p = phrase.toLowerCase();
      const results = (await newsSearch(phrase))
        // exact-phrase relevance: the headline or description must contain the
        // phrase verbatim — no partial-word or single-term matches.
        .filter((a) => a.blob.includes(p));
      for (const a of results) {
        const k = (a.url ?? a.title).toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        const { blob: _b, ...rest } = a;
        out.push(rest);
      }
      if (out.length >= 6) break; // the primary phrase found enough; skip the fallback
    }
    out.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    res.status(200).json({ available: true, query: phrases[0] ?? name, articles: out.slice(0, 10) });
  } catch (e) {
    res.status(200).json({ available: true, articles: [], error: String(e), note: "news lookup failed" });
  }
}
