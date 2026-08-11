// The Telegram verdict card. Lives in src/ (not api/) so it is part of the
// esbuild-bundled server pipeline (api/_threatlib.mjs) AND directly unit-
// testable from source. HTML parse mode; every dynamic string escaped.
import { projectLinks } from "./links";
import type { ThreatScan } from "./types";

const APP_URL = "https://argus-one-flax.vercel.app";

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function verdictEmoji(v: string): string {
  return v === "SAFE" ? "\u{1F7E2}" : v === "CAUTION" ? "\u{1F7E1}" : v === "DANGER" ? "\u{1F534}" : v === "RUG" ? "\u{2620}\u{FE0F}" : "\u{26AA}";
}

const money = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + Math.round(n);

export function formatScanMessage(scan: ThreatScan): string {
  const c = scan.call;
  const d = scan.dossier;
  const lines: string[] = [];
  lines.push(`${verdictEmoji(c.verdict)} <b>$${escHtml(scan.symbol)}</b> · <b>${escHtml(c.verdict)}</b> (${c.risk} risk pts)`);
  lines.push(`${escHtml(scan.name)} · ${escHtml(scan.chain)} · ${escHtml(money(d.liquidityUsd ?? 0))} liq · ${escHtml(money(d.mcap ?? 0))} mcap`);
  lines.push(escHtml(c.action));
  const tier = (title: string, items: string[], cap: number) => {
    if (!items.length) return;
    lines.push("");
    lines.push(`<b>${title}</b>`);
    for (const it of items.slice(0, cap)) lines.push(`• ${escHtml(it)}`);
    if (items.length > cap) lines.push(`• +${items.length - cap} more in the full report`);
  };
  tier("\u{1F6A9} Flags", c.flags, 4);
  tier("⚠️ Warnings", c.warnings, 4);
  tier("✓ Positives", c.positives, 4);
  if (scan.code.ai?.summary) {
    lines.push("");
    lines.push(`<b>Code read:</b> ${escHtml(scan.code.ai.summary.slice(0, 350))}${scan.code.ai.summary.length > 350 ? "…" : ""}`);
  }
  const links = projectLinks(d);
  if (links.length) {
    lines.push("");
    lines.push(links.map((l) => `<a href="${escHtml(l.url)}">${escHtml(l.label)}</a>`).join(" · "));
  }
  lines.push("");
  lines.push(`<a href="${APP_URL}/?threat=${encodeURIComponent(scan.address)}">Full ARGUS report ↗</a>`);
  lines.push("<i>research only · not financial advice</i>");
  return lines.join("\n");
}
