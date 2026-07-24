import { useState } from "react";
import type { TokenDossier } from "../token/audit";

// On-demand adversarial review of the verdict. A second set of eyes tries to
// break the result both ways, grounded only in the evidence the audit produced.
type Challenge = { direction: "too_harsh" | "too_lenient"; point: string };
type Data = { available: boolean; recommendation?: string; confidence?: string; summary?: string; challenges?: Challenge[]; note?: string };

const REC: Record<string, { label: string; color: string }> = {
  uphold: { label: "Verdict holds", color: "var(--color-pass)" },
  soften: { label: "May be too harsh", color: "var(--color-caution)" },
  harden: { label: "May be too lenient", color: "var(--color-avoid)" },
};

// Compact evidence summary the reviewer reasons over — the same facts the score used.
function buildEvidence(d: TokenDossier): string {
  const yn = (b: boolean) => (b ? "yes" : "no");
  const money = (n?: number) => (n == null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`);
  const s = d.safety;
  const lines = [
    `${d.symbol ? "$" + d.symbol : "token"} on ${d.chain}. Verdict ${d.verdict} ${d.score ?? "?"}/100${d.capApplied ? ` (capped by: ${d.capApplied})` : ""}.`,
    `Headline: ${d.headline}`,
    `Findings: ${d.findings.map((f) => `[${f.tone}] ${f.claim}`).join(" | ") || "none"}`,
    s.available
      ? `Safety: source-verified=${yn(s.openSource)}, mintable=${yn(s.mintable)}, honeypot=${yn(s.honeypot)}, owner-renounced=${yn(s.ownerRenounced)}, pausable=${yn(s.pausable)}, serial-scammer-creator=${yn(s.serialScammerCreator)}, buy/sell tax ${s.buyTax.toFixed(0)}/${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : " (static)"}.`
      : "Safety: on-chain contract safety was NOT verifiable on this chain.",
    `Market: mcap ${money(d.mcap)}, liquidity ${money(d.liquidityUsd)}, age ${d.ageDays ?? "?"}d, ${d.cg ? `CoinGecko rank ${d.cg.rank ? "#" + d.cg.rank : "unranked"} (${d.cg.cexCount ?? 0} CEX)` : "NOT listed on CoinGecko"}.`,
    `Holders: top holder ${(d.topHolders[0]?.percent ?? 0).toFixed(0)}%, insiders ${d.insiderPct.toFixed(0)}%, bundle risk ${d.bundleRisk}.`,
    `Deployer: ${d.deployer ? "resolved" : "could not be resolved"}. Official X: ${d.projectX ?? "none found"}.`,
  ];
  return lines.join("\n");
}

export function SecondOpinion({
  dossier,
  panelCostToken,
  id = "challenge-score",
  onRescan,
}: {
  dossier: TokenDossier;
  panelCostToken?: string;
  id?: string;
  onRescan?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  const runChallenge = () => {
    if (!panelCostToken || state === "loading") return;
    setState("loading");
    (async () => {
      try {
        const r = await fetch("/api/challenge-verdict", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(panelCostToken ? { "x-argus-panel-token": panelCostToken } : {}),
          },
          body: JSON.stringify({
            subject: dossier.symbol ? `$${dossier.symbol}` : "token",
            verdict: dossier.verdict,
            score: dossier.score,
            evidence: buildEvidence(dossier),
          }),
        });
        setData(await r.json());
      } catch { /* non-fatal */ }
      setState("done");
    })();
  };

  if (!panelCostToken) {
    return (
      <section id={id} className="panel scroll-mt-28 p-4" aria-label="Challenge the score">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Challenge the score</span>
          {onRescan && (
            <button type="button" onClick={onRescan} className="btn-secondary ml-auto min-h-9 px-3 text-[12px]">
              Rescan to challenge
            </button>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
          A second model can look for reasons this score may be too high or too low. Run a fresh scan first.
        </p>
      </section>
    );
  }

  if (state === "idle") {
    return (
      <section id={id} className="panel scroll-mt-28 p-4" aria-label="Challenge the score">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Challenge the score</span>
          <button type="button" onClick={runChallenge} className="btn-primary ml-auto min-h-9 px-3 text-[12px]">
            Run second opinion
          </button>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
          Ask a second model to argue both sides using only the evidence in this report.
        </p>
      </section>
    );
  }

  if (state === "loading") {
    return <section id={id} className="panel scroll-mt-28 p-4 text-[12.5px] text-ink-faint">Checking whether the score is too high or too low…</section>;
  }
  if (!data || data.available === false || (!data.summary && !(data.challenges ?? []).length)) {
    return (
      <section id={id} className="panel scroll-mt-28 p-4 text-[12.5px] text-ink-faint">
        The second opinion did not return a usable result. The original report is unchanged.
      </section>
    );
  }

  const rec = REC[data.recommendation ?? "uphold"] ?? REC.uphold;
  const challenges = data.challenges ?? [];
  const harsh = challenges.filter((c) => c.direction === "too_harsh");
  const lenient = challenges.filter((c) => c.direction === "too_lenient");
  const flagged = data.recommendation !== "uphold";

  return (
    <section id={id} className={`panel scroll-mt-28 p-4 ${flagged ? "tint-var" : ""}`} style={flagged ? ({ "--tint": rec.color } as React.CSSProperties) : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Second opinion</span>
        <span className="chip tint-var" style={{ "--tint": rec.color } as React.CSSProperties}>{rec.label}</span>
        {data.confidence && <span className="mono ml-auto text-[11px] text-ink-dim">{data.confidence} confidence</span>}
      </div>

      {data.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{data.summary}</p>}

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {harsh.length > 0 && (
          <div>
            <div className="eyebrow text-caution">Why it might be too harsh</div>
            <ul className="mt-1 space-y-1">{harsh.map((c, i) => <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-ink-dim"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-caution" />{c.point}</li>)}</ul>
          </div>
        )}
        {lenient.length > 0 && (
          <div>
            <div className="eyebrow text-avoid">Why it might be too lenient</div>
            <ul className="mt-1 space-y-1">{lenient.map((c, i) => <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-ink-dim"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-avoid" />{c.point}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}
