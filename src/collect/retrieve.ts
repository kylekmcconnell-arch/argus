// Retrieval with evidence discipline. The cardinal sin a forensic engine can
// commit is asserting absence from a failed fetch — "anonymous team" when the
// truth is "the site is a JavaScript app and we never rendered it." This module
// makes that impossible: it classifies every retrieval, escalates a failed or
// stub response to a rendering fallback (keyless), and when nothing can be
// retrieved it returns a COVERAGE GAP, never content-derived absence.
//
// Routing, exactly as the protocol calls for: no fail -> use it; fail -> escalate.

export type RetrievalStatus = "rendered" | "recovered" | "gap";
export type StageOutcome = "ok" | "spa-stub" | "blocked" | "unreachable";

export interface RetrievalStage {
  method: "direct fetch" | "rendering crawler";
  outcome: StageOutcome;
  chars: number;
  note: string;
}

export interface Retrieval {
  url: string;
  status: RetrievalStatus;
  content: string;       // best text obtained (markdown / visible text). "" on gap.
  title: string | null;
  /**
   * Anchor hrefs lifted from the raw HTML BEFORE the tags were stripped. An href
   * only ever lives inside a tag, so visibleText() erases every one of them: an
   * icon-only <a href="https://x.com/..."><svg/></a> leaves nothing at all in
   * `content`. Undefined means there was no raw HTML to read them out of (the
   * rendering crawler hands back markdown, which carries its URLs inline), never
   * that the page has no links.
   */
  links?: string[];
  /**
   * The page's own `<meta name="description">` / `og:description`, read from
   * the raw HTML. This is the site's first-party one-line self-description, the
   * thing a reader wants before any regex over the body. Undefined when there
   * was no raw HTML (the rendering crawler returns markdown, which has no head).
   */
  description?: string | null;
  stages: RetrievalStage[];
  /** honest, human one-liner about what we did and did not get */
  coverageNote: string;
}

const RENDER_PROXY = "https://r.jina.ai/";
const STUB_MARKER = /you need to enable javascript|please enable javascript|enable javascript to run|<noscript/i;
const SPA_ROOT = /<div[^>]+id=["']?(root|app|__next|__nuxt|svelte)\b/i;

export function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// Bounded: a Retrieval is stored with its report, so a nav-heavy or paginated
// page must not carry an unbounded list into the record.
const MAX_LINKS = 300;
const SKIP_HREF = /^(?:#|javascript:|mailto:|tel:|data:)/i;

/**
 * Every anchor href in the raw HTML, deterministically. This is the same fix the
 * LinkedIn extraction miss got: read the markup, do not ask a model what the page
 * links to. Extraction only. Nothing here is ever fetched.
 */
export function extractLinks(html: string): string[] {
  const markup = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out = new Set<string>();
  // The \s before href is load-bearing: it stops data-href and similar
  // author-defined attributes from being read as real destinations.
  for (const m of markup.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? "").trim().replace(/&amp;/gi, "&");
    if (!href || SKIP_HREF.test(href)) continue;
    out.add(href);
    if (out.size >= MAX_LINKS) break;
  }
  return [...out];
}

// Block-level boundaries become line breaks instead of spaces. A team roster is
// a structural fact of the page (a heading with the name, the next block with
// the role); flattening every tag to one space erased that structure and left
// only an adjacency regex to guess where one person's card ended and the next
// began. The lines are what the roster reader downstream works from.
const BLOCK_TAG = /<\/?(?:p|div|br|h[1-6]|li|ul|ol|tr|td|th|section|article|header|footer|nav|aside|main|blockquote|figcaption|figure|dt|dd|table|hr|pre|address)\b[^>]*>/gi;
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#38": "&", "#x26": "&" };

function decodeEntities(text: string): string {
  return text.replace(/&([a-z]+|#x?[0-9a-f]+);/gi, (_whole, name: string) => ENTITY[name.toLowerCase()] ?? " ");
}

export function visibleText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(BLOCK_TAG, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** The page's own one-line self-description, from the head. Extraction only. */
export function metaDescription(html: string): string | null {
  const head = html.slice(0, 60_000);
  for (const name of ["description", "og:description", "twitter:description"]) {
    const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name.replace(":", "\\:")}["'][^>]*>`, "i");
    const tag = head.match(re)?.[0];
    const content = tag?.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const value = decodeEntities((content?.[1] ?? content?.[2] ?? "")).replace(/\s+/g, " ").trim();
    if (value.length >= 12) return value.slice(0, 400);
  }
  return null;
}

// Is this raw HTML a usable render, or just an unrendered single-page-app shell?
export function classifyHtml(html: string): "ok" | "spa-stub" {
  const text = visibleText(html);
  if (STUB_MARKER.test(html) && text.length < 600) return "spa-stub";
  if (SPA_ROOT.test(html) && text.length < 250) return "spa-stub";
  if (text.length < 200) return "spa-stub";
  return "ok";
}

function titleOf(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

// The rendering proxy returns: "Title: ...\nURL Source: ...\nMarkdown Content:\n<body>"
function parseRendered(raw: string): { title: string | null; content: string } {
  const t = raw.match(/^Title:\s*(.+)$/m);
  const idx = raw.indexOf("Markdown Content:");
  const content = idx >= 0 ? raw.slice(idx + "Markdown Content:".length).trim() : raw.trim();
  return { title: t ? t[1].trim() : null, content };
}

// "Recovered by rendering the JavaScript app" was stamped on every crawler read,
// including a plain server-rendered page whose direct fetch the browser's
// cross-origin policy refused. Say what actually happened at stage one.
export function recoveredNote(direct: StageOutcome): string {
  if (direct === "spa-stub") return "The site is a JavaScript app that served no content directly; content recovered by rendering it.";
  if (direct === "blocked") return "Direct fetch was blocked (cross-origin or network), not a site failure; content read through the rendering crawler.";
  return "The host did not answer the direct fetch; content read through the rendering crawler.";
}

export async function retrieveSite(
  url: string,
  emit?: (s: RetrievalStage) => void,
): Promise<Retrieval> {
  const u = normalizeUrl(url);
  const stages: RetrievalStage[] = [];
  const push = (s: RetrievalStage) => { stages.push(s); emit?.(s); };

  // ---- Stage 1: direct fetch ----
  let directHtml: string | null = null;
  let directOutcome: StageOutcome;
  try {
    const r = await fetch(u, { redirect: "follow" });
    if (!r.ok) directOutcome = "unreachable";
    else { directHtml = await r.text(); directOutcome = classifyHtml(directHtml); }
  } catch {
    // cross-origin blocks or network failure — a retrieval failure, NOT absence
    directOutcome = "blocked";
  }
  push({
    method: "direct fetch",
    outcome: directOutcome,
    chars: directHtml ? visibleText(directHtml).length : 0,
    note:
      directOutcome === "ok" ? "Server-rendered HTML retrieved." :
      directOutcome === "spa-stub" ? "Only a JavaScript app shell returned with no rendered content. Escalating." :
      directOutcome === "blocked" ? "Direct fetch blocked (cross-origin). Escalating to the rendering crawler." :
      "Host did not return a usable response. Escalating.",
  });

  // Whatever raw HTML we hold, we hold its hrefs too. Pull them before the tag
  // strip, or they are gone for the rest of the pipeline.
  const rawLinks = directHtml ? extractLinks(directHtml) : undefined;
  const rawDescription = directHtml ? metaDescription(directHtml) : undefined;

  if (directOutcome === "ok" && directHtml) {
    const text = visibleText(directHtml);
    return {
      url: u, status: "rendered", content: text, links: rawLinks, description: rawDescription, title: titleOf(directHtml), stages,
      coverageNote: "Retrieved directly; full page content available.",
    };
  }

  // ---- Stage 2: rendering crawler (keyless JS render) ----
  let renderedRaw: string | null = null;
  let renderOutcome: StageOutcome;
  try {
    const r = await fetch(RENDER_PROXY + u, { headers: { Accept: "text/plain" } });
    if (!r.ok) renderOutcome = "unreachable";
    else { renderedRaw = await r.text(); renderOutcome = (renderedRaw.trim().length > 200) ? "ok" : "spa-stub"; }
  } catch {
    renderOutcome = "unreachable";
  }
  push({
    method: "rendering crawler",
    outcome: renderOutcome,
    chars: renderedRaw ? renderedRaw.length : 0,
    note:
      renderOutcome === "ok" ? "JavaScript rendered; page content recovered." :
      "Rendering crawler could not return content either.",
  });

  if (renderOutcome === "ok" && renderedRaw) {
    const { title, content } = parseRendered(renderedRaw);
    // The markdown carries its own URLs inline, so `links` here is only the extra
    // an app shell happened to serve (a static footer, say). Undefined when the
    // direct fetch returned no HTML at all.
    return {
      url: u, status: "recovered", content, links: rawLinks, description: rawDescription, title, stages,
      coverageNote: recoveredNote(directOutcome),
    };
  }

  // ---- Both failed: a COVERAGE GAP, never an absence claim ----
  // No `links` here on purpose: a gap asserts nothing about the page, and a
  // half-read shell must not become a partial inventory of the site.
  return {
    url: u, status: "gap", content: "", title: null, stages,
    coverageNote:
      "Could not retrieve or render the site. This is recorded as a coverage gap. The audit cannot speak to content it never saw and will not infer a team, or its absence, from a failed fetch.",
  };
}
