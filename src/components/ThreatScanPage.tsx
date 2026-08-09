// Token Threat Scanner — run view + report. A self-contained page: token ref in,
// live trace while the scan runs, then the threat report: risk gauge (higher =
// worse), one-line action, three tiers of plain-English findings, the LYRA code
// read (static flags with file:line citations + lazy AI read that may dissent),
// deployer memory, and the transparent checklist of everything examined.

import { useEffect, useRef, useState } from "react";
import { AuditConsole } from "./AuditConsole";
import type { ResolvedInput } from "../lib/resolveInput";
import type { TraceStep } from "../data/evidence";
import type { CodeFlag, ThreatCheck, ThreatScan, ThreatVerdict } from "../threat/types";
import { threatScan } from "../threat/scan";
import { aiCodeRead } from "../threat/codereview";
import { receiptStats, sharedReceiptStats } from "../threat/receipts";

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
  n == null ? "—" : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(2);

// Risk gauge: fills WITH risk — a full ring is a bad sign, deliberately inverted
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

// Lazy AI read: fires after the mechanical verdict renders, so LYRA can be fed
// the verdict she is allowed to dissent from.
function LyraRead({ scan }: { scan: ThreatScan }) {
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
        <span className="mono text-[10.5px] uppercase tracking-widest text-ink-faint">LYRA · AI source read</span>
        {ai?.dissent && (
          <span className="mono rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider" style={{ color: ai.dissent === "cleaner" ? "var(--color-pass)" : "var(--color-avoid)", border: "1px solid currentColor" }}>
            dissents: code reads {ai.dissent}
          </span>
        )}
      </div>
      {state === "loading" && <p className="mt-2 animate-pulse text-[12.5px] text-ink-faint">Reading the source line by line…</p>}
      {ai && ai.summary.split(/\n{2,}/).map((p, i) => (
        <p key={i} className="mt-2 text-[13px] leading-relaxed text-ink-dim">{p}</p>
      ))}
    </div>
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
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[22px] font-semibold text-ink">${scan.symbol}</h1>
            <span className="truncate text-[13px] text-ink-faint">{scan.name}</span>
          </div>
          <div className="mono mt-0.5 text-[11px] text-ink-faint">{scan.chain} · {shortAddr(scan.address)} · {money(d.liquidityUsd)} liq · {money(d.mcap)} mcap</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="mono rounded px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: m.color, border: "1px solid currentColor" }}>{call.verdict}</span>
            <span className="text-[13px] text-ink-dim">{call.action}</span>
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
              : code.checked ? "no verified source" : "SPL — no per-token code"}
          </span>
        </div>
        {code.verified && code.flags.length === 0 && (
          <p className="mt-2 text-[13px] text-ink-dim">No dangerous patterns found in the source: no hidden mint, no balance rewrite, no trading kill-switch, no fake renounce.</p>
        )}
        {code.flags.length > 0 && <div className="mt-1 divide-y divide-line/60">{code.flags.map((f, i) => <CodeFlagRow key={i} f={f} />)}</div>}
        {!code.verified && code.checked && (
          <p className="mt-2 text-[13px] text-ink-dim">The source is not published on any public verification database. Unreadable code is a risk in itself — nobody outside the team knows what it does.</p>
        )}
        {!code.checked && (
          <p className="mt-2 text-[13px] text-ink-dim">Solana tokens share the standard token program — there is no per-token code to read. The mint, freeze, and transfer-hook authorities above carry the equivalent risk.</p>
        )}
        <LyraRead scan={scan} />
      </div>

      {/* deployer */}
      {(deployer.address || deployer.serialHoneypoter) && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <h2 className="text-[14px] font-semibold text-ink">Deployer</h2>
          <div className="mono mt-1 text-[11.5px] text-ink-faint">{deployer.address ? shortAddr(deployer.address) : "unresolved"}</div>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            {deployer.serialHoneypoter
              ? "This wallet has deployed honeypot tokens before — a serial scammer's wallet."
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

      {/* checklist */}
      <div className="mt-4 rounded-xl border border-line p-4">
        <h2 className="text-[14px] font-semibold text-ink">Everything we checked</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-faint">The full checklist, including the checks that came back clean or could not run — a scan you can audit.</p>
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
export function ThreatLanding({ onScan }: { onScan: (ref: string) => void }) {
  const [val, setVal] = useState("");
  const rs = useLedgerStats();
  const submit = () => { const s = val.trim(); if (s) onScan(s); };
  const samples = [
    { label: "$PEPE", ref: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
    { label: "$BONK", ref: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  ];
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-16">
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">Token threat scan</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-dim">
        Paste a contract address or DexScreener link. NERON reads the chain — authorities, liquidity, holders, the deployer's history — and LYRA reads the actual contract code, citing the functions and lines. You get a plain-English verdict on whether it's a trap.
      </p>
      <div className="mt-5 flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="0x… / Solana mint / dexscreener.com/…"
          className="mono flex-1 rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] text-ink outline-none focus:border-signal"
          autoFocus
        />
        <button onClick={submit} className="btn-primary shrink-0 px-5 py-2.5 text-[13px] font-medium">Scan</button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-faint">
        <span>Try:</span>
        {samples.map((s) => (
          <button key={s.ref} onClick={() => onScan(s.ref)} className="mono rounded border border-line px-2 py-0.5 hover:border-signal">{s.label}</button>
        ))}
      </div>
      {rs.flagged > 0 && (
        <p className="mono mt-8 text-[10.5px] text-ink-faint">
          ledger: {rs.flagged} token{rs.flagged === 1 ? "" : "s"} flagged to date{rs.checked > 0 ? ` · ${rs.confirmedDead}/${rs.checked} re-checked flags confirmed dead` : ""}
        </p>
      )}
    </div>
  );
}

export function ThreatScanPage({ input, onError }: { input: ResolvedInput; onError?: () => void }) {
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [scan, setScan] = useState<ThreatScan | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    threatScan(input, (s) => setSteps((prev) => [...prev, s]))
      .then((r) => { if (r) setScan(r); else { setFailed(true); onError?.(); } })
      .catch(() => { setFailed(true); onError?.(); });
  }, [input, onError]);

  if (scan) return <Report scan={scan} />;
  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-[14px] text-ink-dim">No DEX pair found for this token — nothing to scan yet.</p>
        <p className="mt-1 text-[12px] text-ink-faint">A token with no pool has no market to protect you from. If it just launched, try again in a minute.</p>
      </div>
    );
  }
  const label = input.kind === "token" && input.ref.length > 20 ? input.ref.slice(0, 8) + "…" + input.ref.slice(-4) : input.ref;
  return (
    <AuditConsole
      handle={label}
      subtitle="threat scan · market + contract + code + deployer · NERON reads the chain, LYRA reads the code"
      steps={steps}
      pct={Math.min(95, steps.length * 9)}
      working
      mode="live"
    />
  );
}
