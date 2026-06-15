import { useCallback, useEffect, useRef, useState } from "react";
import { CORPUS } from "../benchmark/corpus";
import { runBench, summarize, type BenchResult } from "../benchmark/run";
import { verdictMeta } from "../lib/verdict";

function Pill({ verdict }: { verdict: string }) {
  const m = verdictMeta(verdict);
  return (
    <span
      className="mono rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
      style={{ color: m.color, background: m.glow, border: `1px solid ${m.color}33` }}
    >
      {verdict}
    </span>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mono mt-1 text-[30px] font-semibold leading-none tabular" style={{ color: tone }}>{value}</div>
      <div className="mt-1.5 text-[12px] leading-snug text-ink-faint">{sub}</div>
    </div>
  );
}

export function TrackRecordPage({ onAudit }: { onAudit?: (addr: string) => void }) {
  const [results, setResults] = useState<BenchResult[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const ran = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResults([]);
    setDone(0);
    const acc: BenchResult[] = [];
    await runBench((r, n) => {
      acc.push(r);
      setDone(n);
      // keep corpus order stable while streaming
      setResults(CORPUS.map((t) => acc.find((x) => x.token.address === t.address)).filter(Boolean) as BenchResult[]);
    });
    setRunning(false);
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    run();
  }, [run]);

  const sum = summarize(results);
  const okResults = results.filter((r) => r.status === "ok");
  const specPct = sum.established.total ? Math.round((sum.established.cleared / sum.established.total) * 100) : null;
  const pass = verdictMeta("PASS").color;
  const fail = verdictMeta("FAIL").color;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-medium tracking-[-0.02em] text-ink">Track record</h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-dim">
            ARGUS run live, in your browser, over a labeled set of real tokens. Nothing here is precomputed
            or hand-tuned. Two honest questions: does it stay quiet on known-good tokens, and does it catch
            dangerous on-chain power even when the name is reputable?
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="mono shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-ink-dim transition hover:border-line-2 hover:text-ink disabled:opacity-50"
        >
          {running ? `running ${done}/${CORPUS.length}` : "re-run"}
        </button>
      </div>

      {/* headline metrics */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Specificity"
          value={specPct == null ? "—" : `${sum.established.cleared}/${sum.established.total}`}
          sub="established, fixed-supply tokens cleared (no false alarms)"
          tone={pass}
        />
        <Stat
          label="Authority detection"
          value={sum.governance.total ? `${sum.governance.flagged}/${sum.governance.total}` : "—"}
          sub="reputable governance tokens whose live mint authority was caught"
          tone={fail}
        />
        <Stat
          label="As labeled"
          value={sum.total ? `${sum.asExpected}/${sum.total}` : "—"}
          sub="verdicts that matched the declared expectation"
          tone="var(--color-ink)"
        />
      </div>

      {/* progress bar while running */}
      {running && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${(done / CORPUS.length) * 100}%` }} />
        </div>
      )}

      {/* results table */}
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line px-4 py-2 text-[10.5px] uppercase tracking-wider text-ink-faint">
          <span>Token</span>
          <span>What drove the verdict</span>
          <span className="text-right">Verdict</span>
        </div>
        {CORPUS.map((t) => {
          const r = results.find((x) => x.token.address === t.address);
          return (
            <button
              key={t.address}
              onClick={() => onAudit?.(t.address)}
              className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line px-4 py-3 text-left transition last:border-0 hover:bg-panel/40"
            >
              <span className="flex items-center gap-2">
                <span className="mono text-[13px] font-medium text-ink">{t.symbol}</span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
                  style={t.bucket === "established"
                    ? { color: pass, background: "rgba(22,163,74,0.08)" }
                    : { color: "var(--color-caution)", background: "rgba(217,119,6,0.08)" }}
                >
                  {t.bucket === "established" ? "fixed-supply" : "mintable gov"}
                </span>
              </span>
              <span className="min-w-0 truncate text-[12.5px] text-ink-dim">
                {r ? r.driver : <span className="text-ink-faint">auditing…</span>}
              </span>
              <span className="flex items-center justify-end gap-2">
                {r?.status === "ok" && <span className="mono text-[11px] tabular text-ink-faint">{r.score}</span>}
                {r ? (
                  r.status === "ok" ? <Pill verdict={r.verdict} /> : <span className="mono text-[10.5px] text-ink-faint">{r.error === "unresolved" ? "no pair" : "error"}</span>
                ) : (
                  <span className="h-3 w-3 animate-pulse rounded-full bg-line" />
                )}
                {r && (
                  <span className="w-3 text-[12px]" style={{ color: r.correct ? pass : fail }}>{r.correct ? "✓" : "✗"}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* the honest point about the governance bucket */}
      {okResults.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-panel/40 p-4 text-[13px] leading-relaxed text-ink-dim">
          <span className="font-medium text-ink">Power, not reputation.</span> MKR, CRV and ENS are blue chips a
          name-based checker waves straight through. ARGUS flags them anyway, because their contracts retain a live
          mint authority: the supply can still be expanded by whoever controls them. That is a fact about the
          contract, not a judgment about the team, and it is exactly what a forensic audit should surface.
        </div>
      )}

      {/* methodology + limitations: scrupulously honest */}
      <h2 className="mt-7 text-[14px] font-semibold tracking-tight text-ink">How to read this</h2>
      <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-dim">
        <li>
          <span className="text-ink">Measured, not asserted.</span> Every row is a live audit against DexScreener,
          GoPlus and honeypot.is at the moment you loaded this page. The counts above are computed from those
          results. Hit re-run and watch them recompute.
        </li>
        <li>
          <span className="text-ink">Present state, not a time machine.</span> This evaluates the contract as it
          stands now using time-invariant safety signals (mint / freeze / reclaimable ownership / failed sell
          simulation). It is not a claim that ARGUS predicted a past rug before it happened.
        </li>
        <li>
          <span className="text-ink">No cherry-picked "catches."</span> We intentionally omit a "rugs we caught"
          bucket: a token that already rugged is dead on-chain today, so auditing its corpse would not be an honest
          test. The governance bucket is the real sensitivity test, on live, verifiable authorities.
        </li>
        <li>
          <span className="text-ink">Free-tier data, with guardrails.</span> honeypot.is can false-positive on
          complex or older contracts; ARGUS down-weights a lone simulation flag when on-chain sells against deep
          liquidity (or many CEX listings) prove the token is sellable. GoPlus's free holder list is sometimes
          self-inconsistent, and is suppressed rather than reported when it is.
        </li>
      </ul>
    </div>
  );
}
