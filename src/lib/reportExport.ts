// Export a rendered audit to a portable document. Two dependency-free targets:
//   • PDF      — render a print-styled standalone page and hand it to the browser's
//                native "Save as PDF" (window.print). Highest fidelity, no libs.
//   • Google Doc — emit a Word/Docs-importable .doc (HTML under an msword MIME).
//                Google Docs opens it directly (Drive → Open with Google Docs), as
//                does Word/Pages. This is the honest keyless path: creating a doc
//                straight into the user's Drive would need an OAuth integration.
//
// The heavy lifting is a pure Dossier → HTML serializer (reportToHtml), kept
// DOM-free so it unit-tests without a browser. The two exporters are thin wrappers.
import type { Dossier } from "../data/dossier";
import type { SubjectClass } from "../engine";
import { ROLE_META, axisLabel, capLabel } from "./verdict";

/* ── helpers ──────────────────────────────────────────────────────── */

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Concrete hex for each verdict band (the app uses CSS vars that don't survive
// export). Falls back to a neutral grey for anything unmapped.
const VERDICT_HEX: Record<string, string> = {
  PASS: "#16a34a",
  CAUTION: "#d97706",
  FAIL: "#ea580c",
  AVOID: "#dc2626",
  UNVERIFIABLE_IDENTITY: "#7c3aed",
  INCOMPLETE: "#6b7280",
};
const verdictHex = (v: string) => VERDICT_HEX[v] ?? "#6b7280";
const verdictLabel = (v: string) => (v === "UNVERIFIABLE_IDENTITY" ? "UNVERIFIABLE" : v);

const roleLabel = (r: string) => ROLE_META[r as SubjectClass]?.label ?? r;

// A short host string from a URL for compact source lines.
const host = (u: string) => String(u ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/* ── section builders ─────────────────────────────────────────────── */

function subjectBlock(d: Dossier): string {
  const roles = (d.report.roles ?? []).map((r) => esc(roleLabel(r))).join(" · ");
  const last =
    typeof d.days_since_post === "number"
      ? d.days_since_post === 0
        ? "posted today"
        : d.days_since_post === 1
        ? "posted yesterday"
        : `last posted ${d.days_since_post}d ago`
      : "";
  const meta = [
    d.followers ? `${esc(d.followers)} followers` : "",
    d.joined ? `joined ${esc(d.joined)}` : "",
    last,
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");
  return `
    <div class="subject">
      <h1>${esc(d.display_name || d.handle)} <span class="handle">${esc(d.handle)}</span></h1>
      ${d.bio ? `<p class="bio">${esc(d.bio)}</p>` : ""}
      <p class="meta">${meta}</p>
      ${roles ? `<p class="roles">Roles: ${roles}</p>` : ""}
    </div>`;
}

function verdictBanner(d: Dossier): string {
  const r = d.report;
  const color = verdictHex(r.composite_verdict);
  const gov = r.governing_role ? ` &nbsp;·&nbsp; governed by ${esc(roleLabel(r.governing_role))}` : "";
  const cap = r.cap_applied ? `<div class="cap">▲ Hard cap · ${esc(capLabel(r.cap_applied))}</div>` : "";
  return `
    <div class="banner" style="border-color:${color}">
      <div class="banner-score" style="color:${color}">${r.governing_score == null ? "—" : r.governing_score}<span>/100</span></div>
      <div class="banner-body">
        <div class="banner-kicker">Composite verdict</div>
        <div class="banner-verdict" style="color:${color}">${esc(verdictLabel(r.composite_verdict))}${gov}</div>
        ${d.headline ? `<p class="headline">${esc(d.headline)}</p>` : ""}
        ${cap}
      </div>
    </div>`;
}

function identityBlock(d: Dossier): string {
  const conf = d.report.identity_confidence ?? "Unknown";
  const team = d.report.governing_role !== "KOL" ? d.webTeam ?? [] : [];
  if (team.length > 0) {
    const rows = team
      .map(
        (p) => `
        <tr>
          <td>${esc(p.name)}${p.handle ? ` <span class="mono dim">${esc(p.handle)}</span>` : ""}</td>
          <td>${esc(p.role ?? "")}</td>
          <td class="dim">${esc(p.evidence ?? "")}${p.source ? ` (${esc(p.source)})` : ""}</td>
        </tr>`,
      )
      .join("");
    return section(
      "Identity",
      `<p class="note"><span class="pill">${esc(conf)}</span> resolved through the named team.</p>
       <table><thead><tr><th>Person</th><th>Role</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }
  return section(
    "Identity",
    `<p class="note"><span class="pill">${esc(conf)}</span> ${esc(d.identity_note ?? "")}</p>`,
  );
}

function contradictionsBlock(d: Dossier): string {
  if (!d.contradictions?.length) return "";
  const rows = d.contradictions
    .map(
      (c) => `
      <li>
        <span class="sev sev-${esc(c.severity)}">${esc(c.severity)}</span>
        <span class="claim">${esc(c.claim)}</span> — but <span class="dim">${esc(c.conflict)}</span>
        ${c.confidence === "low" ? `<span class="dim">(low confidence)</span>` : ""}
      </li>`,
    )
    .join("");
  return section("Contradictions", `<ul class="contradictions">${rows}</ul>`, "claims that do not match the collected evidence");
}

function roleBreakdown(d: Dossier): string {
  const reports = d.report.role_reports ?? [];
  if (!reports.length) return "";
  const gov = d.report.governing_role;
  const ordered = [...reports].sort((a, b) => (a.role === gov ? -1 : b.role === gov ? 1 : 0));
  const cards = ordered
    .map((rr) => {
      const color = verdictHex(rr.verdict);
      const axes = Object.entries(rr.axes ?? {})
        .map(([k, a]) => {
          const pct = a.weight ? Math.round((a.score / a.weight) * 100) : 0;
          return `
          <div class="axis">
            <div class="axis-head"><span>${esc(axisLabel(k))}</span><span class="mono dim">${a.score}/${a.weight}</span></div>
            <div class="bar"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></div></div>
            ${a.rationale ? `<p class="axis-note">${esc(a.rationale)}</p>` : ""}
          </div>`;
        })
        .join("");
      return `
        <div class="role-card">
          <div class="role-head">
            <span class="role-name">${esc(roleLabel(rr.role))}${rr.role === gov ? ' <span class="pill">governs</span>' : ""}</span>
            <span class="role-verdict" style="color:${color}">${esc(verdictLabel(rr.verdict))} · ${rr.score_total == null ? "—" : rr.score_total}/100</span>
          </div>
          ${rr.cap_applied ? `<p class="cap-line">cap · ${esc(capLabel(rr.cap_applied))}</p>` : ""}
          ${axes}
        </div>`;
    })
    .join("");
  return section("Role breakdown", cards, "each role scored on its own track · never averaged");
}

function venturesBlock(d: Dossier): string {
  const v = d.evidence.ventures ?? [];
  if (!v.length) return "";
  const rows = v
    .map(
      (x) => `
      <tr>
        <td>${esc(x.project_name)}</td>
        <td>${esc(x.role)}</td>
        <td>${esc(x.period ?? "")}</td>
        <td>${esc(x.outcome ?? "")}</td>
        <td class="dim">${x.evidence_url ? esc(host(x.evidence_url)) : ""}</td>
      </tr>`,
    )
    .join("");
  return section(
    "Ventures & affiliations",
    `<table><thead><tr><th>Project</th><th>Role</th><th>Period</th><th>Outcome</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function walletsBlock(d: Dossier): string {
  const w = d.evidence.wallets ?? [];
  if (!w.length) return "";
  const rows = w
    .map((x) => {
      const flags = [
        x.sold_into_own_promo ? "sold into own promo" : "",
        x.scam_adjacent_flow ? "scam-adjacent flow" : "",
        x.positive_signals ? x.positive_signals : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
      <tr>
        <td>${esc(x.chain === "solana" ? "SOL" : "EVM")}</td>
        <td class="mono">${esc(x.address)}</td>
        <td>${esc(x.link_tier)}</td>
        <td class="dim">${esc([x.notes, x.activity_summary, flags].filter(Boolean).join(" · "))}</td>
      </tr>`;
    })
    .join("");
  return section(
    "Wallets & on-chain links",
    `<table><thead><tr><th>Chain</th><th>Address</th><th>Attribution</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function testimonialsBlock(d: Dossier): string {
  const t = d.evidence.testimonials ?? [];
  if (!t.length) return "";
  const rows = t
    .map(
      (x) => `
      <tr>
        <td>${esc(x.claimed_endorser_handle ?? x.claimed_endorser_name ?? "—")}${x.claimed_relationship ? `<br><span class="dim">claims: ${esc(x.claimed_relationship)}</span>` : ""}</td>
        <td>${x.follows_subject ? "follows" : "no follow"} · ${esc(x.public_acknowledgment && x.public_acknowledgment !== "none" ? x.public_acknowledgment : "no ack")}</td>
        <td>${esc(x.corroboration_verdict ?? "Unconfirmed")}</td>
      </tr>`,
    )
    .join("");
  return section(
    "Testimonial corroboration",
    `<table><thead><tr><th>Claimed endorser</th><th>Public signal</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
}

function founderBlock(d: Dossier): string {
  const s = d.founderSummary;
  if (!s) return "";
  const backers = s.repeat_backing.repeat_backers?.length
    ? `<p class="note">Returning backers: <span class="dim">${esc(s.repeat_backing.repeat_backers.join(", "))}</span></p>`
    : "";
  return section(
    "Founder pattern",
    `<p class="note">Pattern: <b>${esc(s.pattern)}</b> &nbsp;·&nbsp; Repeat backing: <b>${esc(s.repeat_backing.strength)}</b></p>${backers}`,
  );
}

// ── the token threat leg of the FULL scan ──
// The full scan carries the project token's complete threat report; the export
// must too — a printed dossier that silently dropped the token verdict would
// misrepresent what the audit covered. Renders the verdict banner, the three
// finding tiers, the code read (file:line citations), tokenomics, deployer
// memory, and the transparent checklist. When the leg was skipped or failed,
// the threatNote states why — a gap is reported as a gap.
const THREAT_HEX: Record<string, string> = {
  SAFE: "#16a34a",
  CAUTION: "#d97706",
  DANGER: "#dc2626",
  RUG: "#dc2626",
  UNKNOWN: "#6b7280",
};

const usd = (n?: number | null): string =>
  n == null ? "—"
    : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B"
    : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M"
    : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K"
    : "$" + Math.round(n);

function threatBlock(d: Dossier): string {
  const t = d.threat;
  const attribution = d.threatNote ? `<p class="note dim">${esc(d.threatNote)}</p>` : "";
  if (!t) {
    // A skipped/failed leg still prints its reason; an old pre-fold-in dossier
    // (no threat, no note) prints nothing.
    return d.threatNote ? section("Project token · threat scan", attribution) : "";
  }
  const color = THREAT_HEX[t.call.verdict] ?? "#6b7280";

  const banner = `
    <div class="banner" style="border-color:${color}">
      <div class="banner-score" style="color:${color}">${Math.round(t.call.risk)}<span>/100 risk</span></div>
      <div class="banner-body">
        <div class="banner-kicker">Token threat verdict · higher risk = worse</div>
        <div class="banner-verdict" style="color:${color}">${esc(t.call.verdict)} · $${esc(t.symbol)}${t.classification && t.classification.kind !== "unknown" ? ` <span class="pill">${esc(t.classification.label)}</span>` : ""}</div>
        <p class="headline">${esc(t.call.action)}</p>
        ${t.classification?.lens ? `<p class="note dim">${esc(t.classification.lens)}</p>` : ""}
        <p class="note dim mono">${esc(t.chain)} · ${esc(t.address)} · ${usd(t.dossier.liquidityUsd)} liquidity · ${usd(t.dossier.mcap)} mcap</p>
      </div>
    </div>`;

  const tier = (title: string, items: string[], cls: string) =>
    items.length
      ? `<div class="tier ${cls}"><h3>${esc(title)} · ${items.length}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
      : "";
  const tiers = tier("Flags", t.call.flags, "t-bad") + tier("Warnings", t.call.warnings, "t-warn") + tier("Positives", t.call.positives, "t-good");

  const code = t.code;
  const codeHead = code.verified
    ? `${esc(code.contractName ?? "contract")} · ${code.stats?.functions ?? 0} functions · ${code.stats?.gatedFunctions ?? 0} privileged${code.origin ? ` · via ${esc(code.origin)}` : ""}`
    : code.checked
      ? "no verified source — the code cannot be read"
      : "SPL — standard token program, no per-token code";
  const codeFlags = code.flags
    .map(
      (f) => `
      <li class="codeflag sev-band-${esc(f.severity)}">
        <p class="claim"><b>${esc(f.title)}</b> <span class="mono dim">${esc(f.file.split("/").pop() ?? f.file)}:${f.line}</span> <span class="pill">${esc(f.severity)}</span></p>
        <p class="finding-meta">${esc(f.detail)}</p>
      </li>`,
    )
    .join("");
  const ai = code.ai
    ? `<p class="note"><span class="pill">AI source read${code.ai.dissent ? ` · dissents: reads ${esc(code.ai.dissent)}` : ""}</span> ${esc(code.ai.summary)}</p>`
    : "";
  const codeBlock = `
    <div class="sub">
      <h3>The code, read <span class="kicker">${codeHead}</span></h3>
      ${code.flags.length ? `<ul class="findings">${codeFlags}</ul>` : code.verified ? `<p class="note">No dangerous patterns found in the source.</p>` : ""}
      ${ai}
    </div>`;

  const tk = t.tokenomics;
  const tkRows = [
    ["Liquidity", tk.lp.note],
    ["Buy / sell tax", tk.tax.note],
    ["Burn", tk.burn.note],
    ["Pools set aside", tk.pools.length ? tk.pools.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(", ") : "none identified"],
    ...(tk.rewardPools.length ? [["Reward / emission pools", tk.rewardPools.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(", ")]] : []),
    ["Top non-pool holder", `${tk.realHolderTopPct.toFixed(1)}%`],
  ]
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="dim">${esc(v)}</td></tr>`)
    .join("");
  const tkBlock = `
    <div class="sub">
      <h3>Tokenomics <span class="kicker">pools separated from holders · LP custody · tax destination · burns</span></h3>
      <table><tbody>${tkRows}</tbody></table>
    </div>`;

  const dep = t.deployer;
  const depLine = dep.serialHoneypoter
    ? "This wallet has deployed honeypot tokens before — a serial scammer's wallet."
    : dep.priorRugs > 0
      ? `Seen before in the scanner's ledger: ${dep.priorRugs} of this wallet's tokens were flagged DANGER or RUG.`
      : dep.priorScans.length > 0
        ? `Seen ${dep.priorScans.length} time${dep.priorScans.length === 1 ? "" : "s"} in the ledger with no flagged tokens.`
        : "No adverse history in GoPlus or the scanner's ledger.";
  const depBlock = dep.address || dep.serialHoneypoter
    ? `<div class="sub"><h3>Deployer <span class="kicker mono">${esc(dep.address ?? "unresolved")}</span></h3><p class="note">${esc(depLine)}</p></div>`
    : "";

  const CHK = { pass: "✓ pass", warn: "⚠ warn", fail: "✗ fail", na: "— n/a" } as const;
  const checks = t.checks
    .map((c) => `<tr><td>${esc(c.label)}</td><td><span class="chk chk-${esc(c.status)}">${CHK[c.status] ?? c.status}</span></td><td class="dim">${esc(c.detail)}</td></tr>`)
    .join("");
  const checksBlock = `
    <div class="sub">
      <h3>Everything we checked <span class="kicker">including checks that came back clean or could not run</span></h3>
      <table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>${checks}</tbody></table>
    </div>`;

  return section(
    "Project token · threat scan",
    `${attribution}${banner}${tiers}${codeBlock}${tkBlock}${depBlock}${checksBlock}`,
    "the token threat leg of this audit · same pipeline as the standalone threat scanner",
  );
}

function findingsBlock(d: Dossier): string {
  const f = d.report.publishable_findings ?? [];
  if (!f.length) return "";
  const rows = f
    .map(
      (x) => `
      <li class="finding ${x.polarity > 0 ? "pos" : "neg"}">
        <p class="claim">${esc(x.claim)}</p>
        <p class="finding-meta"><span class="pill">${esc(x.verification_status)}</span>
          ${x.independent_source_count} src · ${esc(x.source_date)}${x.source_author ? ` · ${esc(x.source_author)}` : ""}
          · <span class="dim">${esc(host(x.source_url))}</span></p>
      </li>`,
    )
    .join("");
  return section("Publishable findings", `<ul class="findings">${rows}</ul>`, "sourced · dated · independently corroborated");
}

function section(title: string, body: string, kicker?: string): string {
  return `
    <section>
      <h2>${esc(title)}${kicker ? ` <span class="kicker">${esc(kicker)}</span>` : ""}</h2>
      ${body}
    </section>`;
}

/* ── document CSS ─────────────────────────────────────────────────── */

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #18181b; background: #fff; margin: 0; padding: 40px 48px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .dim { color: #71717a; }
  a { color: #2563eb; text-decoration: none; }
  header.masthead { display: flex; align-items: baseline; gap: 10px; border-bottom: 2px solid #18181b; padding-bottom: 10px; margin-bottom: 8px; }
  header.masthead .brand { font-weight: 700; letter-spacing: .18em; font-size: 15px; }
  header.masthead .id { color: #71717a; font-size: 11px; font-family: ui-monospace, monospace; }
  header.masthead .tag { margin-left: auto; font-size: 10px; letter-spacing: .1em; border: 1px solid #d4d4d8; border-radius: 4px; padding: 2px 6px; color: #52525b; }
  .subject h1 { font-size: 21px; margin: 14px 0 4px; }
  .subject h1 .handle { font-size: 13px; color: #71717a; font-weight: 400; font-family: ui-monospace, monospace; }
  .subject .bio { margin: 4px 0; color: #3f3f46; max-width: 46em; }
  .subject .meta, .subject .roles { margin: 3px 0; font-size: 11.5px; color: #71717a; }
  .banner { display: flex; gap: 20px; align-items: center; border: 2px solid; border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
  .banner-score { font-size: 36px; font-weight: 700; line-height: 1; font-family: ui-monospace, monospace; }
  .banner-score span { font-size: 13px; color: #a1a1aa; }
  .banner-kicker { text-transform: uppercase; letter-spacing: .2em; font-size: 10px; color: #71717a; }
  .banner-verdict { font-size: 24px; font-weight: 700; margin-top: 2px; }
  .banner .headline { margin: 8px 0 0; color: #3f3f46; max-width: 46em; }
  .cap, .cap-line { color: #dc2626; font-size: 12px; margin-top: 8px; }
  section { margin: 20px 0; page-break-inside: avoid; }
  h2 { font-size: 14px; border-bottom: 1px solid #e4e4e7; padding-bottom: 5px; margin: 0 0 10px; }
  h2 .kicker { font-weight: 400; font-size: 11px; color: #a1a1aa; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #71717a; border-bottom: 1px solid #e4e4e7; padding: 5px 8px; }
  td { border-bottom: 1px solid #f4f4f5; padding: 6px 8px; vertical-align: top; }
  .pill { display: inline-block; border: 1px solid #d4d4d8; border-radius: 4px; padding: 0 5px; font-size: 10px; color: #52525b; }
  .note { color: #3f3f46; }
  ul.contradictions { list-style: none; padding: 0; margin: 0; }
  ul.contradictions li { padding: 6px 0; border-bottom: 1px solid #f4f4f5; }
  .sev { display: inline-block; font-size: 9px; text-transform: uppercase; border-radius: 3px; padding: 1px 5px; margin-right: 6px; }
  .sev-high { background: #fee2e2; color: #dc2626; } .sev-medium { background: #fef3c7; color: #d97706; } .sev-low { background: #f4f4f5; color: #71717a; }
  .role-card { border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: avoid; }
  .role-head { display: flex; justify-content: space-between; font-size: 13px; }
  .role-name { font-weight: 600; }
  .role-verdict { font-weight: 600; font-family: ui-monospace, monospace; font-size: 12px; }
  .axis { margin-top: 8px; }
  .axis-head { display: flex; justify-content: space-between; font-size: 12px; color: #3f3f46; }
  .bar { height: 5px; background: #f4f4f5; border-radius: 3px; overflow: hidden; margin-top: 3px; }
  .bar-fill { height: 100%; border-radius: 3px; }
  .axis-note { font-size: 11px; color: #71717a; margin: 3px 0 0; }
  ul.findings { list-style: none; padding: 0; margin: 0; }
  .finding { border-left: 3px solid #e4e4e7; padding: 4px 0 4px 12px; margin-bottom: 10px; }
  .finding.pos { border-color: #16a34a; } .finding.neg { border-color: #dc2626; }
  .finding .claim { margin: 0; }
  .finding-meta { margin: 4px 0 0; font-size: 11px; color: #71717a; }
  .sub { margin-top: 14px; page-break-inside: avoid; }
  .sub h3, .tier h3 { font-size: 12.5px; margin: 0 0 6px; }
  .sub h3 .kicker { font-weight: 400; font-size: 10.5px; color: #a1a1aa; }
  .tier { border: 1px solid #e4e4e7; border-radius: 10px; padding: 10px 14px; margin-top: 8px; page-break-inside: avoid; }
  .tier ul { margin: 0; padding-left: 18px; }
  .tier li { margin: 3px 0; }
  .tier.t-bad h3 { color: #dc2626; } .tier.t-warn h3 { color: #d97706; } .tier.t-good h3 { color: #16a34a; }
  .codeflag.sev-band-critical, .codeflag.sev-band-high { border-color: #dc2626; }
  .codeflag.sev-band-medium { border-color: #d97706; }
  .chk { font-family: ui-monospace, monospace; font-size: 11px; white-space: nowrap; }
  .chk-pass { color: #16a34a; } .chk-warn { color: #d97706; } .chk-fail { color: #dc2626; } .chk-na { color: #a1a1aa; }
  footer { margin-top: 28px; border-top: 1px solid #e4e4e7; padding-top: 12px; font-size: 11px; color: #71717a; }
  @media print { body { padding: 0; } a { color: #18181b; } }
`;

/* ── the pure serializer ──────────────────────────────────────────── */

export interface ReportHtmlOptions {
  // Embed an onload print() trigger (for the PDF path). Off for the .doc path.
  autoPrint?: boolean;
  // ISO/formatted stamp for the footer; injectable for deterministic tests.
  generatedAt?: string;
  // Override the document <title>. The print dialog suggests it as the PDF
  // filename, so the PDF path passes the export filename here.
  docTitle?: string;
}

// Turn a Dossier into a complete, self-contained HTML document. Pure: no DOM,
// no window — safe to unit-test and to reuse on a server if ever needed.
export function reportToHtml(d: Dossier, opts: ReportHtmlOptions = {}): string {
  const r = d.report;
  const title = opts.docTitle ?? `${d.display_name || d.handle} — ${verdictLabel(r.composite_verdict)} · ARGUS`;
  const stamp = opts.generatedAt ?? "";
  const printScript = opts.autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print();},120);};</script>` : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>${CSS}</style>
${printScript}
</head>
<body>
  <header class="masthead">
    <span class="brand">ARGUS</span>
    <span class="id">/ ${esc(r.audit_id)}</span>
    <span class="tag">${d.live ? "LIVE" : "CURATED"} · PRINCIPAL AUDIT</span>
  </header>
  ${subjectBlock(d)}
  ${verdictBanner(d)}
  ${identityBlock(d)}
  ${contradictionsBlock(d)}
  ${roleBreakdown(d)}
  ${venturesBlock(d)}
  ${walletsBlock(d)}
  ${testimonialsBlock(d)}
  ${founderBlock(d)}
  ${threatBlock(d)}
  ${findingsBlock(d)}
  <footer>
    Each role is scored to 100 on its own axes. Disqualifying findings act as hard caps that override the weighted
    total rather than averaging into it; the composite is the most severe role band, never a mean. Identity is
    rewarded, not gated. API-only acquisition, evidence-disciplined, reproducible.
    ${stamp ? `<br/>Generated ${esc(stamp)} · ARGUS forensic due-diligence.` : ""}
  </footer>
</body></html>`;
}

/* ── filenames ────────────────────────────────────────────────────── */

// Same convention as printReportPdf on main (src/lib/printPdf.ts):
// <subject>_<date>_Argus_Forensic_due_diligence.<ext>. Fold into the shared
// helper when this branch merges.
export function reportFilename(d: Dossier, ext: string, when: Date = new Date()): string {
  const base = String(d.handle || d.display_name || "audit")
    .replace(/^[@$]/, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "") || "audit";
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return `${base}_${date}_Argus_Forensic_due_diligence.${ext}`;
}

/* ── DOM exporters (thin wrappers) ────────────────────────────────── */

function nowStamp(): string {
  try {
    return new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  } catch {
    return "";
  }
}

// Open the styled document in a fresh window and let the browser print it —
// the "Save as PDF" destination produces the file. No PDF library needed.
export function exportReportPdf(d: Dossier): boolean {
  const html = reportToHtml(d, {
    autoPrint: true,
    generatedAt: nowStamp(),
    docTitle: reportFilename(d, "pdf").replace(/\.pdf$/, ""),
  });
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return false; // popup blocked — caller can fall back
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

// Download a Word/Google-Docs-importable .doc. Google Docs opens it via
// Drive → "Open with Google Docs"; Word/Pages open it natively.
export function exportReportDoc(d: Dossier): void {
  const html = reportToHtml(d, { generatedAt: nowStamp() });
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFilename(d, "doc");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
