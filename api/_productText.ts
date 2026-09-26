// Text extraction shared by the product probe and the claims ledger: the
// visible copy of a page, the human-readable string literals of an app
// bundle (a client-rendered app carries its copy there, not in the HTML),
// and the same-origin bundle URLs a page loads.

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bundleCopy(code: string): string {
  const out: string[] = [];
  const re = /["'`]([^"'`\n]{12,240})["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) && out.length < 4000) {
    const lit = m[1];
    if (/\s/.test(lit) && /[a-z]{3,}/i.test(lit) && !/[{}<>=;()]/.test(lit)) out.push(lit);
  }
  return out.join(" ");
}

export function hostOf(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

export function bundleUrls(html: string, base: string, limit = 3): string[] {
  const out: string[] = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, "") === hostOf(base) && /\.m?js(\?|$)/i.test(u.pathname + u.search)) out.push(u.toString());
    } catch { /* skip */ }
  }
  return [...new Set(out)].slice(0, limit);
}

// Sentence split for claim extraction: periods, bullets, line-ish breaks in
// bundle copy. Short fragments are dropped.
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s*[•·|]\s*|\s{3,}/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 400);
}
