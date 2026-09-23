/* Export brief (design §9): a real two-page PDF of the frozen decision brief.

   Generated in the browser from the same presentation contract the report
   renders, so the PDF carries the saved scores, the reconciliation warnings,
   the follow-ups, source scope and clickable identity links of this exact
   version. It never includes the newer market snapshot, the perspective
   selector, or any private watchlist, checklist or challenge draft. */

import type { PDFFont, PDFPage } from "pdf-lib";
import { chainLabel, dexscreenerUrl, tokenExplorer, utcStamp, xHandleUrl, type ReportIssue } from "./model";
import type { ReportView, ScoreView } from "./view";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const WIDTH = PAGE_W - MARGIN * 2;
const INK = [0.098, 0.169, 0.149] as const;
const BODY = [0.263, 0.333, 0.294] as const;
const MUTED = [0.408, 0.451, 0.427] as const;
const GREEN = [0.141, 0.384, 0.298] as const;
const TINT = [0.933, 0.949, 0.91] as const;
const LINE = [0.863, 0.882, 0.847] as const;

/** Standard PDF fonts are WinAnsi: replace what they cannot encode. */
export function pdfSafe(value: string): string {
  return value
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, "\"")
    .replace(/[–—−]/g, "-")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/[↑↗]/g, "")
    .replace(/[★☆△○✓◉]/g, "")
    .replace(/·/g, "|")
    .replace(/[^\x20-\x7e\u00a0-\u00ff\n]/g, "");
}

interface Ctx {
  lib: typeof import("pdf-lib");
  doc: import("pdf-lib").PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
  pageNumber: number;
  footer: string;
}

function color(ctx: Ctx, rgb: readonly [number, number, number]) {
  return ctx.lib.rgb(rgb[0], rgb[1], rgb[2]);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
      } else {
        // Break an unbreakable token (a contract address) across lines.
        let chunk = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > width) {
            lines.push(chunk);
            chunk = char;
          } else chunk += char;
        }
        line = chunk;
      }
    }
    lines.push(line);
  }
  return lines;
}

function addFooter(ctx: Ctx) {
  ctx.page.drawText(pdfSafe(ctx.footer), { x: MARGIN, y: 29, size: 8, font: ctx.regular, color: color(ctx, MUTED) });
  const number = String(ctx.pageNumber);
  ctx.page.drawText(number, { x: PAGE_W - MARGIN - ctx.regular.widthOfTextAtSize(number, 8), y: 29, size: 8, font: ctx.regular, color: color(ctx, MUTED) });
}

function newPage(ctx: Ctx) {
  addFooter(ctx);
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNumber += 1;
  ctx.y = PAGE_H - 42;
}

function ensure(ctx: Ctx, height: number) {
  if (ctx.y - height < 56) newPage(ctx);
}

function text(ctx: Ctx, value: string, options: { size?: number; font?: PDFFont; rgb?: readonly [number, number, number]; leading?: number; gap?: number; indent?: number } = {}) {
  const size = options.size ?? 10;
  const font = options.font ?? ctx.regular;
  const leading = options.leading ?? size * 1.5;
  const indent = options.indent ?? 0;
  for (const line of wrap(value, font, size, WIDTH - indent)) {
    ensure(ctx, leading);
    ctx.y -= leading;
    ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y + (leading - size) / 2, size, font, color: color(ctx, options.rgb ?? BODY) });
  }
  ctx.y -= options.gap ?? 0;
}

function heading(ctx: Ctx, value: string, size = 19) {
  ensure(ctx, size * 2.6);
  ctx.y -= size * 0.8;
  text(ctx, value, { size, font: ctx.serif, rgb: INK, leading: size * 1.22, gap: 6 });
}

function link(ctx: Ctx, x: number, y: number, width: number, height: number, url: string) {
  const { PDFString } = ctx.lib;
  const annotation = ctx.doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  ctx.page.node.addAnnot(ctx.doc.context.register(annotation));
}

function linkRow(ctx: Ctx, links: Array<{ label: string; url: string }>) {
  const size = 10;
  const leading = 16;
  ensure(ctx, leading);
  ctx.y -= leading;
  let x = MARGIN;
  for (const [index, item] of links.entries()) {
    const label = pdfSafe(item.label);
    const width = ctx.bold.widthOfTextAtSize(label, size);
    if (x + width > MARGIN + WIDTH) {
      ctx.y -= leading;
      x = MARGIN;
    }
    ctx.page.drawText(label, { x, y: ctx.y + 3, size, font: ctx.bold, color: color(ctx, GREEN) });
    link(ctx, x, ctx.y, width, size + 4, item.url);
    x += width;
    if (index < links.length - 1) {
      ctx.page.drawText("  |  ", { x, y: ctx.y + 3, size, font: ctx.regular, color: color(ctx, MUTED) });
      x += ctx.regular.widthOfTextAtSize("  |  ", size);
    }
  }
}

function scoreBox(ctx: Ctx, scores: ScoreView[]) {
  const height = 96;
  ensure(ctx, height + 10);
  ctx.y -= height;
  const columnWidth = WIDTH / Math.max(1, scores.length);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: WIDTH, height, color: color(ctx, TINT), borderColor: color(ctx, LINE), borderWidth: 0.6 });
  scores.forEach((score, index) => {
    const x = MARGIN + 14 + index * columnWidth;
    const shown = score.score != null && !score.withheldReason && !score.deferredReason;
    ctx.page.drawText(pdfSafe(score.eyebrow.toUpperCase()), { x, y: ctx.y + height - 24, size: 8, font: ctx.bold, color: color(ctx, MUTED) });
    ctx.page.drawText(shown ? `${score.score} / 100` : score.deferredReason ? score.verdictWord : "Withheld", { x, y: ctx.y + height - 58, size: 26, font: ctx.regular, color: color(ctx, INK) });
    ctx.page.drawText(pdfSafe(`${score.verdictWord.toUpperCase()} - saved result`), { x, y: ctx.y + 16, size: 8, font: ctx.regular, color: color(ctx, BODY) });
  });
  ctx.y -= 8;
}

function issueLines(issues: ReportIssue[]): ReportIssue[] {
  const reconciliation = issues.filter((issue) => issue.kind === "reconciliation");
  const serious = reconciliation.filter((issue) => issue.severity === "Critical" || issue.severity === "High");
  return serious.length ? serious : reconciliation;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 24)).trimEnd()}...`;
}

interface Layout { maxIssues: number; compact: boolean }

async function renderBrief(view: ReportView, layout: Layout, generatedAt: Date): Promise<{ bytes: Uint8Array; pages: number }> {
  const lib = await import("pdf-lib");
  const doc = await lib.PDFDocument.create();
  doc.setTitle(pdfSafe(`ARGUS - ${view.subjectName} decision brief`));
  doc.setAuthor("ARGUS");
  doc.setSubject(pdfSafe(`Saved report ${view.version ? `v${view.version}` : ""} ${view.savedAt ? utcStamp(view.savedAt) ?? "" : ""}`.trim()));
  doc.setCreationDate(generatedAt);
  const ctx: Ctx = {
    lib,
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - 42,
    regular: await doc.embedFont(lib.StandardFonts.Helvetica),
    bold: await doc.embedFont(lib.StandardFonts.HelveticaBold),
    serif: await doc.embedFont(lib.StandardFonts.TimesRomanBold),
    pageNumber: 1,
    footer: `ARGUS | Evidence before conviction | Saved report${view.version ? ` v${view.version}` : ""}`,
  };

  const scores = [view.primary, view.tokenScore].filter((score): score is ScoreView => Boolean(score));
  const issues = issueLines(view.issues);
  const investor = view.lenses.find((lens) => lens.key === "Investor") ?? view.lenses[0];
  const limit = layout.compact ? 260 : 520;

  // Page 1: the decision.
  text(ctx, "ARGUS / DECISION BRIEF", { size: 8, font: ctx.bold, rgb: MUTED, gap: 10 });
  text(ctx, view.subjectName, { size: 34, font: ctx.serif, rgb: INK, leading: 39, gap: 4 });
  text(ctx, [view.version ? `Saved version ${view.version}` : "Saved report", view.savedAt ? utcStamp(view.savedAt) : null].filter(Boolean).join(" | "), { size: 8, rgb: MUTED, gap: 14 });
  if (scores.length) scoreBox(ctx, scores);

  heading(ctx, "Read before relying on the scores");
  if (issues.length) {
    text(ctx, `Scores need reconciliation. ${issues.slice(0, 3).map((issue) => issue.title).join("; ")}. This brief preserves the historical scores; it does not assert a corrected assessment.`);
  } else {
    text(ctx, `${scores.some((score) => score.provisional) ? "The saved result is provisional. " : ""}No reconciliation conflict was detected between the saved score views. The scores are the saved results of this version, not a recommendation.`);
  }

  heading(ctx, "The investment question");
  text(ctx, clip([view.productLabel ? `${view.productLabel}.` : "", view.summary].filter(Boolean).join(" "), limit), { gap: 4 });
  if (investor?.body) text(ctx, clip(investor.body, limit));

  const steps = investor?.tasks ?? [];
  if (steps.length) {
    heading(ctx, "Resolve these first");
    steps.slice(0, layout.compact ? 3 : 4).forEach((step, index) => {
      text(ctx, clip(`${index + 1}. ${step.title}${step.detail ? `: ${step.detail}` : ""}`, layout.compact ? 150 : 240), { gap: 2 });
    });
  }

  const links: Array<{ label: string; url: string }> = [];
  const x = xHandleUrl(view.xHandle);
  if (x) links.push({ label: `X: @${String(view.xHandle).replace(/^@/, "")}`, url: x });
  if (view.website) links.push({ label: "Website", url: view.website });
  if (view.token) {
    const pool = dexscreenerUrl(view.token.chain, view.token.pairAddress ?? view.token.address);
    if (pool) links.push({ label: "DexScreener", url: pool });
    const explorer = tokenExplorer(view.token.chain, view.token.address);
    if (explorer) links.push({ label: explorer.name, url: explorer.url });
  }
  if (links.length || view.token) {
    heading(ctx, "Fast access");
    if (links.length) linkRow(ctx, links);
    if (view.token) {
      text(ctx, `Chain: ${chainLabel(view.token.chain)} | Token: ${view.token.symbol}`, { gap: 0 });
      text(ctx, view.token.address, { size: 8, rgb: MUTED });
    }
  }

  // Page 2: what needs reconciliation, the arithmetic, and scope.
  newPage(ctx);
  const shown = issues.slice(0, layout.maxIssues);
  text(ctx, shown.length ? "Evidence that needs reconciliation" : "How to read this brief", { size: 30, font: ctx.serif, rgb: INK, leading: 35, gap: 2 });
  for (const issue of shown) {
    heading(ctx, issue.title, 14);
    text(ctx, clip(issue.observed, layout.compact ? 280 : 420), { size: 9.5, gap: 1 });
    text(ctx, clip(`Handling: ${issue.handling}`, 220), { size: 8.5, rgb: MUTED });
  }
  if (issues.length > shown.length) {
    text(ctx, `${issues.length - shown.length} further reconciliation note${issues.length - shown.length === 1 ? " is" : "s are"} listed in the interactive report's quality audit.`, { size: 8.5, rgb: MUTED, gap: 2 });
  }
  if (scores.some((score) => score.rows.length)) {
    heading(ctx, "The arithmetic", 14);
    for (const score of scores) {
      if (score.rows.length) text(ctx, `${score.eyebrow}: ${score.arithmetic}`, { size: 9.5, gap: 2 });
      if (score.scaleNote && !layout.compact) text(ctx, score.scaleNote, { size: 8.5, rgb: MUTED, gap: 2 });
    }
  }
  heading(ctx, "Source and scope", 14);
  text(ctx, `Based on the frozen ${view.subjectName} report${view.version ? ` version ${view.version}` : ""}${view.savedAt ? `, saved ${utcStamp(view.savedAt)}` : ""}. Sources are read as saved report evidence, not independently re-audited. Newer market observations shown in the interactive report are excluded from this historical brief. This PDF contains no watchlist, checklist or challenge-form entries.`, { size: 9.5 });
  ctx.y -= 6;
  text(ctx, [view.caseLabel ? `Case: ${view.caseLabel}` : null, `Report: ${view.auditId}`].filter(Boolean).join("\n"), { size: 8, rgb: MUTED });
  addFooter(ctx);
  return { bytes: await doc.save(), pages: doc.getPageCount() };
}

/** The brief is always two pages: the decision, then what needs reconciliation. */
export async function buildBriefPdf(view: ReportView, options: { generatedAt?: Date } = {}): Promise<Uint8Array> {
  const generatedAt = options.generatedAt ?? new Date();
  let last: Uint8Array | null = null;
  for (const compact of [false, true]) {
    for (let maxIssues = 4; maxIssues >= 0; maxIssues -= 1) {
      const result = await renderBrief(view, { maxIssues, compact }, generatedAt);
      last = result.bytes;
      if (result.pages <= 2) return result.bytes;
    }
  }
  return last!;
}
