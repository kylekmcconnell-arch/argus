import { useCallback, useEffect, useRef, useState } from "react";
import { radarTokens } from "../token/sources";
import { auditToken, type TokenDossier } from "../token/audit";
import { verdictMeta } from "../lib/verdict";

const RANK: Record<string, number> = { AVOID: 4, FAIL: 3, CAUTION: 2, PASS: 1 };
const SCAN_LIMIT = 16;

function money(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n);
}

const BADGE_TONE: Record<string, string> = { bad: "var(--color-avoid)", warn: "var(--color-caution)", good: "var(--color-pass)" };

// At-a-glance forensic flags for the feed, worst first. All available from the
// fast (skipSim) scan — GoPlus contract data + DexScreener price action.
function riskBadges(d: TokenDossier): { label: string; tone: "bad" | "warn" | "good" }[] {
  const s = d.safety;
  const pc = d.priceChange?.h24 ?? 0;
  const b: { label: string; tone: "bad" | "warn" | "good" }[] = [];
  if (s.mintable) b.push({ label: "mintable", tone: "bad" });
  if (s.freezable) b.push({ label: "freeze", tone: "bad" });
  if (s.ownerChangeBalance && !s.ownerRenounced) b.push({ label: "owner-bal", tone: "bad" });
  if (s.lpTopUnlockedEoaPct >= 80) b.push({ label: "LP 1-wallet", tone: "bad" });
  if (s.slippageModifiable && !s.ownerRenounced) b.push({ label: "tax-mod", tone: "bad" });
  if (pc <= -60) b.push({ label: "dumped", tone: "bad" });
  if (d.bundleRisk === "high") b.push({ label: "bundled", tone: "bad" });
  if (s.proxy) b.push({ label: "proxy", tone: "warn" });
  if (d.bundleRisk === "elevated") b.push({ label: "snipe risk", tone: "warn" });
  if (pc >= 300 && (d.liquidityUsd ?? 0) < 100000) b.push({ label: "vertical pump", tone: "warn" });
  if (b.length === 0) {
    if (s.lpBurnedPct >= 50) b.push({ label: "LP burned", tone: "good" });
    else if (s.lpLockedPct >= 50) b.push({ label: "LP locked", tone: "good" });
    if (s.ownerRenounced && !s.mintable && !s.freezable) b.push({ label: "renounced", tone: "good" });
  }
  return b.slice(0, 4);
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        res[i] = await fn(items[i], i);
      }
    }),
  );
  return res;
}

export function RadarPage({ onAudit }: { onAudit: (id: string) => void }) {
  const [results, setResults] = useState<TokenDossier[]>([]);
  const [scanning, setScanning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [chain, setChain] = useState<string>("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const runId = useRef(0);

  const scan = useCallback(async () => {
    const myRun = ++runId.current;
    setScanning(true);
    setProgress(0);
    const refs = (await radarTokens()).slice(0, SCAN_LIMIT);
    let done = 0;
    const scanned = await pool(refs, 6, async (r) => {
      const d = await auditToken(
        { kind: "token", ref: r.tokenAddress, via: r.chainId === "solana" ? "solana" : "evm" },
        undefined,
        { skipSim: true },
      ).catch(() => null);
      done++;
      if (myRun === runId.current) setProgress(Math.round((done / refs.length) * 100));
      return d;
    });
    if (myRun !== runId.current) return;
    const live = (scanned.filter(Boolean) as TokenDossier[]).sort(
      (a, b) => (RANK[b.verdict] ?? 0) - (RANK[a.verdict] ?? 0) || (a.score ?? 0) - (b.score ?? 0),
    );
    setResults(live);
    setScanning(false);
    setUpdatedAt(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    scan();
    const t = setInterval(scan, 60000);
    return () => clearInterval(t);
  }, [scan]);

  const flagged = results.filter((r) => r.verdict === "AVOID" || r.verdict === "FAIL").length;
  const chains = ["all", ...Array.from(new Set(results.map((r) => r.chain)))];
  const filtered = results.filter(
    (r) => (chain === "all" || r.chain === chain) && (!flaggedOnly || r.verdict === "AVOID" || r.verdict === "FAIL"),
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative inline-block h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-signal" />
              <span className="pulse-ring absolute inset-0" />
            </span>
            <h1 className="display-sm text-[24px] text-ink">Radar</h1>
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-dim">
            Trending and freshly-listed tokens, audited live on-chain. Scams float to the top.
          </p>
        </div>
        <div className="text-right text-[12.5px] text-ink-faint">
          {scanning ? (
            <span className="mono">scanning… {progress}%</span>
          ) : (
            <>
              <div>
                <span className="mono text-ink-dim">{results.length}</span> scanned ·{" "}
                <span className="mono text-avoid">{flagged}</span> flagged
              </div>
              <div className="mt-0.5">updated {updatedAt} · auto every 60s</div>
            </>
          )}
        </div>
      </div>

      {/* filters */}
      {results.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {chains.map((c) => (
            <button
              key={c}
              onClick={() => setChain(c)}
              className={`mono rounded-md border px-2.5 py-1 text-[11px] capitalize transition ${chain === c ? "tint-signal" : "border-line text-ink-dim hover:text-ink"}`}
            >
              {c}
            </button>
          ))}
          <button
            onClick={() => setFlaggedOnly((v) => !v)}
            className={`mono ml-auto rounded-md border px-2.5 py-1 text-[11px] transition ${flaggedOnly ? "tint-avoid" : "border-line text-ink-dim hover:text-ink"}`}
          >
            {flaggedOnly ? "● flagged only" : "flagged only"}
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {scanning && results.length === 0
          ? Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-[92px] animate-pulse rounded-xl border border-line bg-panel-2/40" />
            ))
          : filtered.map((d) => {
              const m = verdictMeta(d.verdict);
              return (
                <button
                  key={d.chain + d.address}
                  onClick={() => onAudit(d.address)}
                  className={`panel group p-3.5 text-left transition soft-shadow ${d.verdict === "AVOID" || d.verdict === "FAIL" ? "tint-var" : "hover:border-line-2"}`}
                  style={d.verdict === "AVOID" || d.verdict === "FAIL" ? ({ "--tint": m.color } as React.CSSProperties) : undefined}
                >
                  <div className="flex items-center gap-2">
                    {d.imageUrl ? (
                      <img src={d.imageUrl} alt="" className="h-7 w-7 rounded-md border border-line object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-panel-2 text-[11px] text-signal">{d.symbol.slice(0, 3)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mono truncate text-[13.5px] text-ink">${d.symbol}</div>
                      <div className="text-[11px] capitalize text-ink-faint">{d.chain} · {d.ageDays != null ? (d.ageDays < 1 ? "<1d" : Math.round(d.ageDays) + "d") : "?"}</div>
                    </div>
                    <span className={`verdict-pill ${d.verdict === "FAIL" ? "tint-fail" : "tint-var"}`} style={d.verdict === "FAIL" ? undefined : ({ "--tint": m.color } as React.CSSProperties)}>
                      {m.label}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-ink-faint">
                    <span>liq <span className="mono text-ink-dim">{money(d.liquidityUsd)}</span></span>
                    <span>mc <span className="mono text-ink-dim">{money(d.mcap)}</span></span>
                    {d.capApplied ? (
                      <span className="mono text-avoid">▲ {d.capApplied.replace(/_.*/, "")}</span>
                    ) : (
                      <span className="mono">{d.score}/100</span>
                    )}
                  </div>
                  {(() => {
                    const badges = riskBadges(d);
                    return badges.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {badges.map((bd) => (
                          <span key={bd.label} className="chip tint-var" style={{ "--tint": BADGE_TONE[bd.tone] } as React.CSSProperties}>
                            {bd.label}
                          </span>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </button>
              );
            })}
      </div>
    </div>
  );
}
