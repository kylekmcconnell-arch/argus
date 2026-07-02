// Press coverage for a subject. GET /api/news?q=<name>&kind=<person|project|token>
//
// What you'd see clicking Google's "News" tab: recent articles about the subject,
// with source + date. A real project has press; a fresh shell has none, and a
// founder's coverage (funding, hacks, exits) is corroboration the account can't
// fake. Google News RSS — keyless, read-only.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/<[^>]+>/g, "").trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) { res.status(400).json({ error: "q required" }); return; }
  // Crypto-scope the query so a common name doesn't pull unrelated press; quote
  // multi-word names so "Vulcan Forged" stays together.
  const scoped = /\s/.test(q) ? `"${q}" (crypto OR token OR web3 OR blockchain)` : `${q} (crypto OR token OR web3)`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(scoped)}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { res.status(200).json({ available: true, articles: [], note: `news feed ${r.status}` }); return; }
    const xml = await r.text();
    const items = xml.split(/<item>/).slice(1).map((b) => b.split("</item>")[0]);
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    const articles = items
      .map((b) => {
        const rawTitle = tag(b, "title") ?? "";
        const source = tag(b, "source") ?? (rawTitle.includes(" - ") ? rawTitle.split(" - ").pop()! : "");
        // Google News titles end with " - Source"; strip it for a clean headline.
        const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
        const link = tag(b, "link");
        const pub = tag(b, "pubDate");
        return { title, source, url: link, publishedAt: pub ? Date.parse(pub) : null };
      })
      .filter((a) => a.title && a.url)
      // relevance guard: at least one name term must appear in the headline
      .filter((a) => (terms.length ? terms.some((t) => a.title.toLowerCase().includes(t)) : true))
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, 10);

    res.status(200).json({ available: true, query: q, articles });
  } catch (e) {
    res.status(200).json({ available: true, articles: [], error: String(e), note: "news lookup failed" });
  }
}
