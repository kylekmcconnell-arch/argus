// Token Threat Scanner - run view + report. A self-contained page: token ref in,
// live trace while the scan runs, then the threat report: risk gauge (higher =
// worse), one-line action, three tiers of plain-English findings, the the ARGUS engine code
// read (static flags with file:line citations + lazy AI read that may dissent),
// deployer memory, and the transparent checklist of everything examined.

import { useEffect, useRef, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import type { ResolvedInput } from "../lib/resolveInput";
import type { TraceStep } from "../data/evidence";
import type { CodeFlag, ThreatCheck, ThreatScan, ThreatVerdict } from "../threat/types";
import { threatScan } from "../threat/scan";
import { projectLinks } from "../threat/links";
import { aiCodeRead } from "../threat/codereview";
import { insiderClusters } from "../threat/insiders";
import { buyerCohort, walletTaxonomy } from "../threat/cohort";
import { receiptStats, sharedReceiptStats } from "../threat/receipts";
import { ThreatReceipts } from "./ThreatReceipts";

const VERDICT_META: Record<ThreatVerdict, { color: string; blurb: string }> = {
  SAFE: { color: "var(--color-pass)", blurb: "no mechanical red flags" },
  CAUTION: { color: "var(--color-caution)", blurb: "real risks, not disqualifying" },
  DANGER: { color: "var(--color-avoid)", blurb: "trap doors outnumber exits" },
  RUG: { color: "var(--color-avoid)", blurb: "confirmed trap" },
  UNKNOWN: { color: "var(--color-ink-faint)", blurb: "could not verify" },
};

// Ledger stats: instant local first paint, then the shared server figures.
function useLedgerStats() {
  const [stats, setStats] = useState(() => receiptStats());
  useEffect(() => { sharedReceiptStats().then((s) => setStats({ flagged: s.flagged, confirmedDead: s.confirmedDead, checked: s.checked })); }, []);
  return stats;
}

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const money = (n?: number) =>
  n == null ? "-" : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(2);

// Risk gauge: fills WITH risk - a full ring is a bad sign, deliberately inverted
// from the quality-score ring on the token report.
function RiskRing({ risk, verdict, size = 108 }: { risk: number; verdict: ThreatVerdict; size?: number }) {
  const m = VERDICT_META[verdict];
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, risk)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={m.color} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 0.8s ease-out" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="mono text-[26px] font-semibold leading-none tabular" style={{ color: m.color }}>{risk}</span>
        <span className="mono text-[9px] text-ink-faint">risk pts</span>
      </div>
    </div>
  );
}

function Tier({ title, items, tone }: { title: string; items: string[]; tone: "bad" | "warn" | "good" }) {
  if (!items.length) return null;
  const color = tone === "bad" ? "var(--color-avoid)" : tone === "warn" ? "var(--color-caution)" : "var(--color-pass)";
  const glyph = tone === "bad" ? "✗" : tone === "warn" ? "⚠" : "✓";
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mono text-[10.5px] uppercase tracking-widest" style={{ color }}>{title}</div>
      <ul className="mt-2 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink-dim">
            <span className="mono shrink-0" style={{ color }}>{glyph}</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CodeFlagRow({ f }: { f: CodeFlag }) {
  const color = f.severity === "critical" ? "var(--color-avoid)" : f.severity === "high" ? "var(--color-avoid)" : f.severity === "medium" ? "var(--color-caution)" : "var(--color-ink-faint)";
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-ink" style={{ color }}>{f.title}</span>
        <span className="mono shrink-0 text-[10.5px] text-ink-faint">{f.file.split("/").pop()}:{f.line}</span>
      </div>
      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-dim">{f.detail}</p>
      {f.excerpt && <pre className="mono mt-1 overflow-x-auto rounded bg-line/40 px-2 py-1 text-[10.5px] leading-relaxed text-ink-faint">{f.excerpt}</pre>}
    </div>
  );
}

function CheckGrid({ checks }: { checks: ThreatCheck[] }) {
  const color = (s: ThreatCheck["status"]) =>
    s === "pass" ? "var(--color-pass)" : s === "warn" ? "var(--color-caution)" : s === "fail" ? "var(--color-avoid)" : "var(--color-ink-faint)";
  const glyph = (s: ThreatCheck["status"]) => (s === "pass" ? "✓" : s === "warn" ? "⚠" : s === "fail" ? "✗" : "•");
  return (
    <div className="grid gap-x-6 sm:grid-cols-2">
      {checks.map((c) => (
        <div key={c.key} className="flex items-start justify-between gap-3 border-b border-line/60 py-2">
          <div>
            <div className="text-[12.5px] text-ink-dim">{c.label}</div>
            <div className="text-[11px] leading-snug text-ink-faint">{c.detail}</div>
          </div>
          <span className="mono mt-0.5 shrink-0 text-[13px]" style={{ color: color(c.status) }}>{glyph(c.status)}</span>
        </div>
      ))}
    </div>
  );
}

// Lazy AI read: fires after the mechanical verdict renders, so the ARGUS engine can be fed
// the verdict she is allowed to dissent from.
// Lazy insider-cluster panel (#9): proves which "separate" top holders are one
// operator, via the funding/transfer graph. Loaded on demand after the verdict -
// it's a keyed, slow call, so it never blocks the main scan.
function InsiderClusters({ scan }: { scan: ThreatScan }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "empty">("idle");
  const [data, setData] = useState<import("../threat/types").InsiderCluster | null>(null);
  const run = () => {
    if (state === "loading") return;
    setState("loading");
    insiderClusters(scan.chain, scan.address).then((r) => {
      if (r && r.clusters.length) { setData(r); setState("done"); }
      else setState("empty");
    });
  };
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Creator & insider clusters</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">Which of the "separate" top holders are secretly one hand - proven from the funding graph.</p>
        </div>
        {state === "idle" && (
          <button onClick={run} className="mono shrink-0 rounded border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink">run detection ↯</button>
        )}
      </div>
      {state === "loading" && <p className="mt-2 animate-pulse text-[12.5px] text-ink-faint">Tracing funders and transfers across the top holders…</p>}
      {state === "empty" && <p className="mt-2 text-[12.5px] text-ink-dim">No coordinated wallet groups found among the top holders (or clustering unavailable on this chain/tier).</p>}
      {state === "done" && data && (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{data.note}</p>
          <div className="mt-3 space-y-1.5">
            {data.clusters.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5">
                <span className="text-[12.5px] text-ink-dim">{c.size} wallets = 1 operator{c.includesCreator ? " · incl. creator" : ""}{c.sharedFunders.length ? " · shared funder" : ""}</span>
                <span className="mono text-[12px] font-semibold" style={{ color: c.combinedPct >= 25 ? "var(--color-avoid)" : c.combinedPct >= 10 ? "var(--color-caution)" : "var(--color-ink-dim)" }}>{c.combinedPct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Lazy buyer-cohort panel (Common Coins): the OTHER tokens this token's top
// holders also hold. A shared set of obscure bags across many wallets is a
// coordinated crowd/insider farm - computed live per scan, so it's never stale.
function money2(n: number | null): string {
  if (n == null) return "-";
  return n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "K" : "$" + Math.round(n);
}
function BuyerCohort({ scan }: { scan: ThreatScan }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [data, setData] = useState<import("../threat/types").CohortOverlap | null>(null);
  const [tax, setTax] = useState<import("../threat/types").WalletTaxonomy | null>(null);
  const run = () => {
    if (state === "loading") return;
    setState("loading");
    // Cohort (common coins + reputation) and the wallet-age/funding mix, together.
    Promise.all([
      buyerCohort(scan.chain, scan.address, scan.call.verdict, scan.symbol),
      walletTaxonomy(scan.chain, scan.address),
    ]).then(([c, t]) => { setData(c); setTax(t); setState("done"); });
  };
  const rep = data?.reputation;
  const chip = (label: string, o?: { n: number; pct: number }, tone?: string) =>
    o && o.n > 0 ? <span className="mono rounded border px-2 py-0.5 text-[11px]" style={{ borderColor: tone ?? "var(--color-line)", color: tone ?? "var(--color-ink-dim)" }}>{label} {o.n} · {o.pct.toFixed(0)}%</span> : null;
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Buyer intelligence</h2>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">The top holders' shared bags, their wallet age &amp; funding mix, and their track record from our own prior scans.</p>
        </div>
        {state === "idle" && (
          <button onClick={run} className="mono shrink-0 rounded border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink">run analysis ↯</button>
        )}
      </div>
      {state === "loading" && <p className="mt-2 animate-pulse text-[12.5px] text-ink-faint">Reading each top holder's bags, age, funding, and history…</p>}
      {state === "done" && (
        <div className="mt-3 space-y-4">
          {/* wallet mix */}
          {tax && tax.analyzed > 0 && (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-widest text-ink-faint">Wallet mix ({tax.analyzed} holders)</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {chip("fresh", tax.cohorts.fresh, "var(--color-caution)")}
                {chip("CEX-funded", tax.cohorts.cexFunded, "var(--color-caution)")}
                {chip("dormant", tax.cohorts.dormant)}
                {chip("recent", tax.cohorts.recent)}
                {chip("aged", tax.cohorts.aged, "var(--color-pass)")}
              </div>
            </div>
          )}
          {/* wallet reputation from our ledger */}
          {rep && (rep.holdersWithHistory > 0) && (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-widest text-ink-faint">Holder track record (our ledger)</div>
              <p className="mt-1 text-[12.5px] text-ink-dim">{rep.holdersWithHistory} of these holders have appeared in our prior scans{rep.holdersWithDeadBags > 0 ? `; ${rep.holdersWithDeadBags} have held tokens that later went to zero` : " - none have held a token that later died"}.</p>
              {rep.topOffenders.map((o) => (
                <div key={o.wallet} className="mt-1 flex items-center justify-between gap-3 text-[11.5px]">
                  <span className="mono text-ink-dim">{shortWallet(o.wallet)}</span>
                  <span className="mono" style={{ color: "var(--color-avoid)" }}>{o.dead}/{o.held} died{o.deadSymbols.length ? ` (${o.deadSymbols.map((s) => "$" + s).slice(0, 3).join(", ")})` : ""}</span>
                </div>
              ))}
            </div>
          )}
          {/* common coins */}
          <div>
            <div className="mono text-[10.5px] uppercase tracking-widest text-ink-faint">Common coins</div>
            {data && data.commonCoins.length ? (
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead><tr className="text-left text-ink-faint"><th className="py-1 pr-3 font-normal">Token</th><th className="py-1 pr-3 font-normal">Held by</th><th className="py-1 pr-3 font-normal">Cohort</th><th className="py-1 font-normal">Mcap · liq</th></tr></thead>
                  <tbody>
                    {data.commonCoins.map((c) => (
                      <tr key={c.address} className="border-t border-line/50">
                        <td className="mono py-1.5 pr-3 text-ink-dim">${c.symbol}</td>
                        <td className="mono py-1.5 pr-3 tabular text-ink-dim">{c.heldBy}/{data.cohortSize}</td>
                        <td className="mono py-1.5 pr-3 tabular" style={{ color: c.pctOfCohort >= 50 ? "var(--color-avoid)" : c.pctOfCohort >= 30 ? "var(--color-caution)" : "var(--color-ink-faint)" }}>{c.pctOfCohort}%</td>
                        <td className="mono py-1.5 tabular text-ink-faint">{money2(c.mcap)} · {money2(c.liqUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1 text-[12.5px] text-ink-dim">{data?.note ?? "No shared holdings across the top holders (or unavailable on this chain/tier)."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EngineRead({ scan }: { scan: ThreatScan }) {
  const [state, setState] = useState<"loading" | "done" | "off">(scan.code.verified ? "loading" : "off");
  const [ai, setAi] = useState(scan.code.ai);
  const fired = useRef(false);
  useEffect(() => {
    if (!scan.code.verified || fired.current) return;
    fired.current = true;
    aiCodeRead(scan.chain, scan.address, scan.code, { verdict: scan.call.verdict, risk: scan.call.risk })
      .then((r) => { setAi(r); setState(r ? "done" : "off"); });
  }, [scan]);
  if (state === "off" && !ai) return null;
  return (
    <div className="mt-3 rounded-lg border border-line/70 bg-line/20 p-3">
      <div className="flex items-center justify-between">
        <span className="mono text-[10.5px] uppercase tracking-widest text-ink-faint">the ARGUS engine · AI source read</span>
        {ai?.dissent && (
          <span className="mono rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: ai.dissent === "cleaner" ? "var(--color-pass)" : "var(--color-avoid)", border: "1px solid currentColor" }}>
            dissents: code reads {ai.dissent}
          </span>
        )}
      </div>
      {state === "loading" && <p className="mt-2 animate-pulse text-[12.5px] text-ink-faint">Reading the source line by line…</p>}
      {ai?.proxyOf && (
        <p className="mono mt-2 text-[10.5px] text-caution">⚠ upgradeable proxy - read the current implementation; the logic can be swapped by whoever controls the upgrade</p>
      )}
      {ai && ai.summary.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="mt-2 text-[13px] leading-relaxed text-ink-dim">{p}</p>
      ))}
    </div>
  );
}

function LpBadge({ status }: { status: ThreatScan["tokenomics"]["lp"]["status"] }) {
  const map: Record<string, { c: string; t: string }> = {
    burned: { c: "var(--color-pass)", t: "LP burned" },
    locked: { c: "var(--color-pass)", t: "LP secured" },
    "launchpad-locked": { c: "var(--color-pass)", t: "Launchpad-locked" },
    "nft-position": { c: "var(--color-ink-dim)", t: "NFT position" },
    unlocked: { c: "var(--color-avoid)", t: "LP unlocked" },
    unconfirmed: { c: "var(--color-caution)", t: "Lock unconfirmed" },
  };
  const m = map[status];
  return <span className="mono rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: m.c, border: "1px solid currentColor" }}>{m.t}</span>;
}

// Launch provenance: how the token came to market - fair launch vs launchpad,
// bonding-curve state, quote asset, the venue's LP mechanics, and what the
// creator does with platform fee revenue.
function LaunchPanel({ launch }: { launch: NonNullable<ThreatScan["deep"]["launch"]> }) {
  const row = (label: string, body: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <span className="shrink-0 text-[12.5px] text-ink-dim">{label}</span>
      <span className="text-right text-[12px] text-ink-faint">{body}</span>
    </div>
  );
  const cf = launch.creatorFees;
  const cfGood = cf && (cf.usage === "lp-add" || cf.usage === "buyback-burn" || cf.usage === "buyback");
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <h2 className="text-[14px] font-semibold text-ink">Launch</h2>
      <p className="mt-0.5 text-[11.5px] text-ink-faint">How this token came to market - the venue's mechanics decide what "locked liquidity" even means here.</p>
      <div className="mt-2">
        {row("Venue", launch.kind === "fair-launch"
          ? "Fair launch - listed directly on a DEX, no launchpad"
          : <span className="mono text-ink">{launch.venue ?? "unknown launchpad"}</span>)}
        {launch.onCurve != null && (launch.onCurve || launch.graduated != null) && row("Bonding curve", launch.onCurve
          ? <span style={{ color: "var(--color-caution)" }}>still on the curve{launch.curveProgressPct != null ? ` · ${launch.curveProgressPct.toFixed(0)}% to graduation` : ""}</span>
          : launch.graduated
            ? <span style={{ color: "var(--color-pass)" }}>graduated - curve completed, liquidity migrated</span>
            : "state unknown")}
        {launch.quote && row("Bonded to", <span className="flex flex-col items-end gap-0.5"><span className="mono text-ink">{launch.quote}</span>{launch.quoteNote && <span>{launch.quoteNote}</span>}</span>)}
        {launch.lpNote && row("LP custody", launch.lpNote)}
        {cf && cf.platformPays && row("Creator fees", (
          <span className="flex flex-col items-end gap-0.5">
            <span style={{ color: cfGood ? "var(--color-pass)" : cf.usage === "dump" ? "var(--color-caution)" : undefined }}>
              {cf.usage === "unknown" ? (cf.claimCount != null && cf.claimCount > 0 ? `${cf.claimCount} claim${cf.claimCount === 1 ? "" : "s"} observed - usage untraced` : "platform pays creator fees - claims not observed") : cf.usage.replace(/-/g, " ")}
            </span>
            {cf.note && <span>{cf.note}</span>}
          </span>
        ))}
        {launch.snipe && row("Launch window", `${launch.snipe.sameBlockBuyers} same-block buyer${launch.snipe.sameBlockBuyers === 1 ? "" : "s"}${launch.snipe.pctOfSupply != null ? ` · ~${launch.snipe.pctOfSupply.toFixed(0)}% of supply` : ""} (${launch.snipe.window})`)}
        {launch.notes.map((n, i) => row(i === 0 ? "Notes" : "", n))}
      </div>
    </div>
  );
}

// Sell structure: who has actually been selling, and are they the bad actors -
// the deployer (dev sold), wallets the deployer seeded directly, or launch-block
// snipers who have exited. Answers what the honeypot sim (CAN they sell) and the
// insider clusters (who is POSITIONED to dump) cannot: realized behaviour.
function shortWallet(a: string) { return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; }

// Linked-site safety: the token's own website is where drainers hide - a scam
// tell that no contract check sees. Only rendered when there's something to say
// (a flag, or a fresh token with no socials at all).
function SitePanel({ s }: { s: NonNullable<ThreatScan["deep"]["site"]> }) {
  const c = s.worst === "malicious" ? "var(--color-avoid)" : s.worst === "suspicious" ? "var(--color-caution)" : "var(--color-ink-dim)";
  return (
    <div className="mt-4 rounded-xl border p-4" style={{ borderColor: s.worst === "malicious" ? "var(--color-avoid)" : "var(--color-line)" }}>
      <h2 className="text-[14px] font-semibold text-ink">Linked site &amp; socials</h2>
      <p className="mt-0.5 text-[11.5px] text-ink-faint">Where the token points you off-chain - checked against Google Safe Browsing, GoPlus, the URLhaus malware feed, and drainer-signature heuristics.</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <span className="mono rounded border px-2 py-0.5" style={{ borderColor: c, color: c }}>{s.worst === "clean" ? "SITE CLEAN" : s.worst.toUpperCase()}</span>
        <span className="mono rounded border border-line px-2 py-0.5 text-ink-dim">{s.hasX ? "X linked" : "no X account"}</span>
        {!s.hasWebsite && <span className="mono rounded border border-line px-2 py-0.5 text-ink-dim">no website</span>}
        {s.xBio && (
          <span className="mono rounded border px-2 py-0.5" style={{
            borderColor: s.xBio.status === "mismatch" ? "var(--color-avoid)" : s.xBio.status === "verified" ? "var(--color-pass)" : "var(--color-line)",
            color: s.xBio.status === "mismatch" ? "var(--color-avoid)" : s.xBio.status === "verified" ? "var(--color-pass)" : "var(--color-ink-dim)",
          }}>{s.xBio.status === "verified" ? "CA in X bio ✓" : s.xBio.status === "mismatch" ? "IMPERSONATION" : s.xBio.status === "absent" ? "CA not in X bio" : "X bio unread"}</span>
        )}
      </div>
      {s.xBio && s.xBio.status !== "absent" && (
        <p className="mt-2 text-[11.5px]" style={{ color: s.xBio.status === "mismatch" ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>{s.xBio.note}</p>
      )}
      {s.sites.map((x) => (
        <div key={x.url} className="mt-2 border-t border-line/50 pt-2">
          <div className="mono text-[11.5px] text-ink-dim">{x.host} <span className="text-ink-faint">· {x.verdict}{x.sources.length ? ` (${x.sources.join(", ")})` : ""}</span></div>
          {x.flags.map((f, i) => <div key={i} className="mt-0.5 text-[11.5px]" style={{ color: c }}>⚠ {f}</div>)}
        </div>
      ))}
    </div>
  );
}
function SellStructurePanel({ s, chain }: { s: NonNullable<ThreatScan["deep"]["sellers"]>; chain: string }) {
  const flagged = s.topSellers.filter((x) => x.flags.length > 0);
  const rows = (flagged.length ? flagged : s.topSellers).slice(0, 8);
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <h2 className="text-[14px] font-semibold text-ink">Sell structure</h2>
      <p className="mt-0.5 text-[11.5px] text-ink-faint">Who has actually been selling - and whether they are the deployer, wallets it seeded, or launch-block snipers cashing out.</p>
      {/* Recent 24h trade tape (GeckoTerminal) - the direct "who's selling now" view. */}
      {s.recentTape && (
        <div className="mt-3 rounded-lg border border-line/70 p-3">
          <p className="text-[12.5px] text-ink-dim">{s.recentTape.note}</p>
          {s.recentTape.topSellers.length > 0 && (
            <div className="mt-2 space-y-1">
              {s.recentTape.topSellers.slice(0, 6).map((t) => (
                <div key={t.wallet} className="flex items-center justify-between gap-3 text-[11.5px]">
                  <span className="mono text-ink-dim">{shortWallet(t.wallet)}{t.isDeployer ? " · deployer" : ""}{t.isCreator ? " · creator" : ""}</span>
                  <span className="mono tabular" style={{ color: t.isDeployer || t.isCreator ? "var(--color-avoid)" : "var(--color-ink-faint)" }}>${t.usd.toLocaleString()} sold</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {s.devSold != null && (
          <span className="mono rounded border px-2 py-0.5" style={{ borderColor: s.devSold ? "var(--color-avoid)" : "var(--color-pass)", color: s.devSold ? "var(--color-avoid)" : "var(--color-pass)" }}>
            {s.devSold ? "DEV SOLD" : "dev has not sold"}
          </span>
        )}
        <span className="mono rounded border border-line px-2 py-0.5 text-ink-dim">{s.sellerCount} sellers</span>
        {s.badSellerCount > 0 && <span className="mono rounded border px-2 py-0.5" style={{ borderColor: "var(--color-caution)", color: "var(--color-caution)" }}>{s.badSellerCount} flagged</span>}
      </div>
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-left text-ink-faint">
              <th className="py-1 pr-3 font-normal">Wallet</th><th className="py-1 pr-3 font-normal">Sold</th><th className="py-1 pr-3 font-normal">Exited</th><th className="py-1 font-normal">Flag</th>
            </tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.wallet} className="border-t border-line/50">
                  <td className="mono py-1.5 pr-3 text-ink-dim">{shortWallet(x.wallet)}</td>
                  <td className="mono py-1.5 pr-3 tabular text-ink-dim">{x.soldPct != null ? `${x.soldPct.toFixed(1)}%` : "-"}</td>
                  <td className="mono py-1.5 pr-3 tabular text-ink-faint">{x.boughtPct ? `${x.realizedExitPct}%` : "seeded"}</td>
                  <td className="py-1.5 text-[11px]" style={{ color: x.isDeployer || x.deployerSeeded ? "var(--color-avoid)" : "var(--color-caution)" }}>{x.flags[0] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.truncated && <p className="mt-2 text-[10.5px] text-ink-faint">Based on the token's earliest ~6k transfers; a very active token is analyzed partially.</p>}
      <p className="mt-2 text-[10.5px] text-ink-faint">{chain === "solana" ? "" : "Sold % is of total supply; Exited % is the share of that wallet's own buys it has sold back."}</p>
    </div>
  );
}

function Tokenomics({ tk, lpOverride }: { tk: ThreatScan["tokenomics"]; lpOverride?: string | null }) {
  const taxColor = tk.tax.tone === "good" ? "var(--color-pass)" : tk.tax.tone === "warn" ? "var(--color-caution)" : "var(--color-ink-dim)";
  const row = (label: string, body: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <span className="shrink-0 text-[12.5px] text-ink-dim">{label}</span>
      <span className="text-right text-[12px] text-ink-faint">{body}</span>
    </div>
  );
  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <h2 className="text-[14px] font-semibold text-ink">Tokenomics</h2>
      <p className="mt-0.5 text-[11.5px] text-ink-faint">Pools and reward contracts separated from holders; LP lock read at the launchpad level; what the tax does; and burns.</p>
      <div className="mt-2">
        {row("Liquidity", lpOverride
          // The launch venue's mechanics prove custody (e.g. "pump.fun graduated
          // - migration LP burned"); show that instead of the generic
          // lock-unconfirmed read, which would contradict it.
          ? <span className="flex flex-col items-end gap-1"><span className="mono rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: "var(--color-pass)", color: "var(--color-pass)" }}>SECURED BY VENUE</span><span>{lpOverride}</span></span>
          : <span className="flex flex-col items-end gap-1"><LpBadge status={tk.lp.status} /><span>{tk.lp.note}</span></span>)}
        {row("Buy / sell tax", <span style={{ color: taxColor }}>{tk.tax.note}</span>)}
        {row("Burn", <span>{tk.burn.note}</span>)}
        {row("Pools set aside", tk.pools.length ? <span>{tk.pools.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(", ")}</span> : <span>none identified</span>)}
        {tk.rewardPools.length > 0 && row("Reward / emission pools", <span>{tk.rewardPools.map((p) => `${p.label} ${p.pct.toFixed(1)}%`).join(", ")} <span className="text-ink-faint/70">· cadence tracking is a next phase</span></span>)}
        {row("Top non-pool holder", <span>{tk.realHolderTopPct.toFixed(1)}%</span>)}
      </div>
    </div>
  );
}

function ShareButton({ scan }: { scan: ThreatScan }) {
  const [copied, setCopied] = useState(false);
  const share = () => {
    // Deep link straight into the scan. (The old /api/card unfurl path took the
    // verdict/score as query params; main closed that route because callers could
    // forge the card, so sharing is the honest re-scan link - the crawler card is
    // reintroduced once threat scans persist as share-token snapshots.)
    const url = `${window.location.origin}/?threat=${encodeURIComponent(scan.address)}`;
    void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  };
  return (
    <button onClick={share} className="mono rounded border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink">
      {copied ? "link copied ✓" : "share ↗"}
    </button>
  );
}

function Report({ scan }: { scan: ThreatScan }) {
  const { call, dossier: d, code, deployer, checks } = scan;
  const m = VERDICT_META[call.verdict];
  const rs = useLedgerStats();
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      {/* header */}
      <div className="flex items-center gap-5 py-6">
        <RiskRing risk={call.risk} verdict={call.verdict} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[22px] font-semibold text-ink">${scan.symbol}</h1>
            <span className="truncate text-[13px] text-ink-faint">{scan.name}</span>
            <span className="ml-auto flex shrink-0 gap-2">
              {/* Browser print-to-PDF: the print stylesheet strips the app chrome
                  so what saves is the clean report itself. */}
              <button onClick={() => window.print()} className="mono rounded border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink print:hidden">export PDF ↓</button>
              <ShareButton scan={scan} />
            </span>
          </div>
          <div className="mono mt-0.5 text-[11px] text-ink-faint">{scan.chain} · {shortAddr(scan.address)} · {money(d.liquidityUsd)} liq · {money(d.mcap)} mcap</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="mono rounded px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: m.color, border: "1px solid currentColor" }}>{call.verdict}</span>
            <span className="text-[13px] text-ink-dim">{call.action}</span>
          </div>
          {/* Every pertinent project link in one strip - what the token points
              at, plus the chart/registry pages an analyst opens next anyway. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {projectLinks(d).map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="mono rounded border border-line px-2 py-0.5 text-[10.5px] text-ink-dim transition hover:border-signal hover:text-ink">{l.label} ↗</a>
            ))}
          </div>
        </div>
      </div>

      {/* three tiers */}
      <div className="space-y-3">
        <Tier title={`Flags · ${call.flags.length}`} items={call.flags} tone="bad" />
        <Tier title={`Warnings · ${call.warnings.length}`} items={call.warnings} tone="warn" />
        <Tier title={`Positives · ${call.positives.length}`} items={call.positives} tone="good" />
      </div>

      {/* code read */}
      <div className="mt-6 rounded-xl border border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold text-ink">The code, read</h2>
          <span className="mono text-[10.5px] text-ink-faint">
            {code.verified
              ? `${code.contractName ?? "contract"} · ${code.stats?.functions ?? 0} fns · ${code.stats?.gatedFunctions ?? 0} privileged · via ${code.origin}`
              : code.checked ? "no verified source" : "SPL - no per-token code"}
          </span>
        </div>
        {code.verified && code.flags.length === 0 && (
          <p className="mt-2 text-[13px] text-ink-dim">No dangerous patterns found in the source: no hidden mint, no balance rewrite, no trading kill-switch, no fake renounce.</p>
        )}
        {code.flags.length > 0 && <div className="mt-1 divide-y divide-line/60">{code.flags.map((f, i) => <CodeFlagRow key={i} f={f} />)}</div>}
        {!code.verified && code.checked && (
          <p className="mt-2 text-[13px] text-ink-dim">The source is not published on any public verification database. Unreadable code is a risk in itself - nobody outside the team knows what it does.</p>
        )}
        {!code.checked && (
          <p className="mt-2 text-[13px] text-ink-dim">Solana tokens share the standard token program - there is no per-token code to read. The mint, freeze, and transfer-hook authorities above carry the equivalent risk.</p>
        )}
        <EngineRead scan={scan} />
      </div>

      {/* launch provenance */}
      {scan.deep.launch && scan.deep.launch.kind !== "unknown" && <LaunchPanel launch={scan.deep.launch} />}

      {/* linked-site safety */}
      {scan.deep.site && (scan.deep.site.worst !== "clean" || !scan.deep.site.hasX || scan.deep.site.xBio != null) && <SitePanel s={scan.deep.site} />}

      {/* sell structure */}
      {scan.deep.sellers && (scan.deep.sellers.sellerCount > 0 || scan.deep.sellers.devSold || scan.deep.sellers.recentTape) && <SellStructurePanel s={scan.deep.sellers} chain={scan.chain} />}

      {/* tokenomics */}
      <Tokenomics
        tk={scan.tokenomics}
        lpOverride={scan.deep.launch && !scan.deep.launch.onCurve
          && (scan.deep.launch.lpDisposition === "burned" || scan.deep.launch.lpDisposition === "protocol-owned" || scan.deep.launch.lpDisposition === "locked")
          && (scan.tokenomics.lp.status === "unconfirmed" || scan.tokenomics.lp.status === "unlocked")
          ? `${scan.deep.launch.venue}: ${scan.deep.launch.lpNote}` : null}
      />

      {/* migration */}
      {scan.deep.migration?.migrated && (
        <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--color-caution)" }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Migrate.fun migration</h2>
            <span className="mono text-[10.5px] text-ink-faint">{scan.deep.migration.projects.map((p) => p.projectId).join(", ")}</span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{scan.deep.migration.note}</p>
          {scan.deep.migration.projects[0]?.counterpartMint && (
            <p className="mono mt-1.5 text-[10.5px] text-ink-faint">pre/post-migration counterpart: {shortAddr(scan.deep.migration.projects[0].counterpartMint)}</p>
          )}
        </div>
      )}

      {/* cross-chain / OFT */}
      {scan.deep.xchain?.isOft && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Cross-chain (LayerZero OFT)</h2>
            <span className="mono text-[10.5px] text-ink-faint">{scan.deep.xchain.isAdapter ? "lockbox adapter" : "native OFT"} · {scan.deep.xchain.resolvedLegs > 1 ? `${money(scan.deep.xchain.totalLiquidityUsd)} total` : ""}</span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">One asset bridged across chains - mesh proven from on-chain peers, not name-matching. Single-chain liquidity understates the real depth.</p>
          <div className="mt-2">
            {scan.deep.xchain.legs.map((l) => (
              <div key={`${l.chain}:${l.address}`} className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5">
                <span className="text-[12.5px] text-ink-dim">{l.chain}{l.self ? " (this token)" : ""}</span>
                <span className="mono text-[11px] text-ink-faint">{shortAddr(l.address)} · {l.liquidityUsd != null ? money(l.liquidityUsd) : "bridged (pool not auto-resolved)"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* deployer */}
      {(deployer.address || deployer.serialHoneypoter) && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[14px] font-semibold text-ink">Deployer</h2>
            {d.safety.creatorPercent > 0 && (
              <span className="mono text-[11px]" style={{ color: d.safety.creatorPercent >= 15 ? "var(--color-avoid)" : d.safety.creatorPercent >= 5 ? "var(--color-caution)" : "var(--color-ink-faint)" }}>
                creator holds {d.safety.creatorPercent.toFixed(1)}% of supply
              </span>
            )}
          </div>
          <div className="mono mt-1 text-[11.5px] text-ink-faint">{deployer.address ? shortAddr(deployer.address) : "unresolved"}</div>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            {deployer.serialHoneypoter
              ? "This wallet has deployed honeypot tokens before - a serial scammer's wallet."
              : deployer.priorRugs > 0
                ? `Seen before in this scanner's ledger: ${deployer.priorRugs} of this wallet's tokens were flagged DANGER or RUG.`
                : deployer.priorScans.length > 0
                  ? `Seen ${deployer.priorScans.length} time${deployer.priorScans.length === 1 ? "" : "s"} in the ledger with no flagged tokens.`
                  : "No adverse history in GoPlus or the local ledger."}
          </p>
          {deployer.priorScans.length > 0 && (
            <div className="mono mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
              {deployer.priorScans.slice(0, 8).map((p) => (
                <span key={p.address} className="rounded border border-line px-1.5 py-0.5" style={{ color: p.verdict === "RUG" || p.verdict === "DANGER" ? "var(--color-avoid)" : "var(--color-ink-faint)" }}>
                  ${p.symbol} · {p.verdict}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* creator & insider clusters (lazy, #9) */}
      <InsiderClusters scan={scan} />

      {/* buyer cohort · common coins (lazy, RAVN-style) */}
      <BuyerCohort scan={scan} />

      {/* checklist */}
      <div className="mt-4 rounded-xl border border-line p-4">
        <h2 className="text-[14px] font-semibold text-ink">Everything we checked</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-faint">The full checklist, including the checks that came back clean or could not run - a scan you can audit.</p>
        <div className="mt-2"><CheckGrid checks={checks} /></div>
      </div>

      {/* ledger line */}
      {rs.flagged > 0 && (
        <p className="mono mt-4 text-center text-[10.5px] text-ink-faint">
          ledger: {rs.flagged} token{rs.flagged === 1 ? "" : "s"} flagged to date{rs.checked > 0 ? ` · ${rs.confirmedDead}/${rs.checked} re-checked flags confirmed dead` : ""}
        </p>
      )}
    </div>
  );
}

// Entry surface for the Threat scan rail item: paste a contract / DexScreener
// URL → run. Shows the recent-flags ledger line so the track record is visible
// before you even scan.
type LandingMode = "token" | "wallet" | "receipts";

// Full threat scan embedded inside another report (the New Investigation token
// lane). Cache-first: a scan saved within the last hour renders immediately;
// otherwise the pipeline runs live with a slim progress strip. The full threat
// Report body is reused so the merged surface never diverges from the
// standalone one.
export function EmbeddedThreatScan({ address, chain }: { address: string; chain: string }) {
  const [scan, setScan] = useState<ThreatScan | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const input: ResolvedInput = { kind: "token", ref: address, via: chain === "solana" ? "solana" : "evm" };
    (async () => {
      try {
        const r = await fetch(`/api/threat-scan?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(6000) });
        const d = r.ok ? ((await r.json()) as { hit?: boolean; scan?: ThreatScan }) : null;
        if (d?.hit && d.scan?.address) { setScan(d.scan); return; }
      } catch { /* live scan below */ }
      threatScan(input, (s) => setSteps((prev) => [...prev, s]))
        .then((r) => {
          if (!r) { setFailed(true); return; }
          setScan(r);
          void fetch("/api/threat-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan: r }) }).catch(() => {});
        })
        .catch(() => setFailed(true));
    })();
  }, [address, chain]);
  if (failed) return <div className="mono px-1 py-3 text-[11.5px] text-ink-faint">Threat scan unavailable for this token.</div>;
  if (!scan) {
    const last = steps[steps.length - 1];
    return (
      <div className="flex items-center gap-3 px-1 py-4">
        <span className="pulse-ring h-2 w-2 shrink-0 rounded-full bg-signal" aria-hidden />
        <span className="mono text-[11.5px] text-ink-dim">threat scan running · {last ? `${last.phase} · ${last.label}` : "starting"}</span>
      </div>
    );
  }
  return <Report scan={scan} />;
}

export function ThreatLanding({ onScan }: { onScan: (ref: string, mode: "token" | "wallet") => void }) {
  const [val, setVal] = useState("");
  const [mode, setMode] = useState<LandingMode>("token");
  const rs = useLedgerStats();
  const submit = () => { const s = val.trim(); if (s && mode !== "receipts") onScan(s, mode); };
  const samples = [
    { label: "$PEPE", ref: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
    { label: "$BONK", ref: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  ];
  const Tab = ({ m, label }: { m: LandingMode; label: string }) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${mode === m ? "bg-panel text-ink soft-shadow" : "text-ink-faint hover:text-ink-dim"}`}
    >{label}</button>
  );
  const tabs = (
    <div className="inline-flex w-fit gap-1 rounded-lg border border-line p-1">
      <Tab m="token" label="Scan a token" />
      <Tab m="wallet" label="Scan a wallet" />
      <Tab m="receipts" label={`Track record${rs.flagged ? ` · ${rs.flagged}` : ""}`} />
    </div>
  );

  if (mode === "receipts") {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-10">
        {tabs}
        <ThreatReceipts onOpen={(addr) => onScan(addr, "token")} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-16">
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">{mode === "token" ? "Token threat scan" : "Wallet threat triage"}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-dim">
        {mode === "token"
          ? "Paste a contract address or DexScreener link. ARGUS reads the chain - authorities, liquidity, holders, the deployer's history - and the ARGUS engine reads the actual contract code, citing the functions and lines. You get a plain-English verdict on whether it's a trap."
          : "Paste a wallet address. Every token position is joined against the scanner's verdicts, with an at-risk-USD figure and a flag on any position with no market left to sell into. EVM is read keyless; Solana needs a Helius key on the backend."}
      </p>
      <div className="mt-4">{tabs}</div>
      <div className="mt-4 flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={mode === "token" ? "0x… / Solana mint / dexscreener.com/…" : "0x… wallet / Solana wallet address"}
          className="mono flex-1 rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] text-ink outline-none focus:border-signal"
          autoFocus
        />
        <button onClick={submit} className="btn-primary shrink-0 px-5 py-2.5 text-[13px] font-medium">{mode === "token" ? "Scan" : "Triage"}</button>
      </div>
      {mode === "token" && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-faint">
          <span>Try:</span>
          {samples.map((s) => (
            <button key={s.ref} onClick={() => onScan(s.ref, "token")} className="mono rounded border border-line px-2 py-0.5 hover:border-signal">{s.label}</button>
          ))}
        </div>
      )}
      {rs.flagged > 0 && (
        <button onClick={() => setMode("receipts")} className="mono mt-8 text-left text-[10.5px] text-ink-faint hover:text-ink-dim">
          ledger: {rs.flagged} token{rs.flagged === 1 ? "" : "s"} flagged to date{rs.checked > 0 ? ` · ${rs.confirmedDead}/${rs.checked} re-checked flags confirmed dead` : ""} - see the track record →
        </button>
      )}
    </div>
  );
}

export function ThreatScanPage({ input, onError }: { input: ResolvedInput; onError?: () => void }) {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [scan, setScan] = useState<ThreatScan | null>(null);
  const [cachedAgeMs, setCachedAgeMs] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const runLive = (i: ResolvedInput) =>
    threatScan(i, (s) => setSteps((prev) => [...prev, s]))
      .then((r) => {
        if (r) {
          setScan(r);
          // Store the finished scan so a shared link opens the report instantly
          // instead of re-running the whole pipeline (1h freshness, server-side).
          void fetch("/api/threat-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan: r }) }).catch(() => {});
        } else { setFailed(true); onError?.(); }
      })
      .catch(() => { setFailed(true); onError?.(); });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Shared-link fast path: a fresh cached scan renders immediately; anything
    // else (miss, stale, endpoint down) falls through to the live scan.
    (async () => {
      if (input.kind === "token" && (input.via === "evm" || input.via === "solana")) {
        try {
          const r = await fetch(`/api/threat-scan?address=${encodeURIComponent(input.ref)}`, { signal: AbortSignal.timeout(6000) });
          const d = r.ok ? ((await r.json()) as { hit?: boolean; ageMs?: number; scan?: ThreatScan }) : null;
          if (d?.hit && d.scan && d.scan.address) { setScan(d.scan); setCachedAgeMs(d.ageMs ?? 0); return; }
        } catch { /* fall through to live */ }
      }
      void runLive(input);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, onError]);

  const rescan = () => { setScan(null); setCachedAgeMs(null); setSteps([]); void runLive(input); };

  if (scan) return (
    <div>
      {cachedAgeMs != null && (
        <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-line px-4 py-2">
          <span className="mono text-[11px] text-ink-faint">saved scan · {Math.max(1, Math.round(cachedAgeMs / 60000))}m old · shared links reuse scans for 1h</span>
          <button onClick={rescan} className="mono rounded border border-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:border-signal hover:text-ink">rescan now ↻</button>
        </div>
      )}
      <Report scan={scan} />
    </div>
  );
  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-[14px] text-ink-dim">No DEX pair found for this token - nothing to scan yet.</p>
        <p className="mt-1 text-[12px] text-ink-faint">A token with no pool has no market to protect you from. If it just launched, try again in a minute.</p>
      </div>
    );
  }
  const label = input.kind === "token" && input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref;
  return (
    <AuditConsole
      handle={label}
      subtitle="threat scan · market + contract + code + deployer · the ARGUS threat engine reads the chain and the code"
      steps={steps}
      working
      mode="live"
    />
  );
}
