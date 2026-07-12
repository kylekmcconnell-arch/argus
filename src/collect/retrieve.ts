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

export function visibleText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return stripped.replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
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

  if (directOutcome === "ok" && directHtml) {
    const text = visibleText(directHtml);
    return {
      url: u, status: "rendered", content: text, title: titleOf(directHtml), stages,
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
    return {
      url: u, status: "recovered", content, title, stages,
      coverageNote: "Direct retrieval failed; content recovered by rendering the JavaScript app.",
    };
  }

  // ---- Both failed: a COVERAGE GAP, never an absence claim ----
  return {
    url: u, status: "gap", content: "", title: null, stages,
    coverageNote:
      "Could not retrieve or render the site. This is recorded as a coverage gap. The audit cannot speak to content it never saw and will not infer a team, or its absence, from a failed fetch.",
  };
}
