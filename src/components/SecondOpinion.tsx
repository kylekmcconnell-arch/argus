import { useEffect, useRef, useState } from "react";
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
      : "Safety: contract controls could not be checked on this blockchain.",
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    const focusChallenge = () => {
      if (window.location.hash !== `#${id}`) return;
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    focusChallenge();
    window.addEventListener("hashchange", focusChallenge);
    return () => window.removeEventListener("hashchange", focusChallenge);
  }, [id]);

  const runChallenge = () => {
    const concern = question.trim();
    if (!panelCostToken || !concern || state === "loading") return;
    setState("loading");
    setData(null);
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
            question: concern,
          }),
        });
        setData(await r.json());
      } catch { /* non-fatal */ }
      setState("done");
    })();
  };

  const usableResult = data?.available !== false && Boolean(data?.summary || (data?.challenges ?? []).length);
  const rec = REC[data?.recommendation ?? "uphold"] ?? REC.uphold;
  const challenges = data?.challenges ?? [];
  const harsh = challenges.filter((c) => c.direction === "too_harsh");
  const lenient = challenges.filter((c) => c.direction === "too_lenient");
  const flagged = data?.recommendation !== "uphold";

  return (
    <section
      id={id}
      className={`panel scroll-mt-28 p-4 ${usableResult && flagged ? "tint-var" : ""}`}
      style={usableResult && flagged ? ({ "--tint": rec.color } as React.CSSProperties) : undefined}
      aria-labelledby={`${id}-title`}
    >
      <form onSubmit={(event) => { event.preventDefault(); runChallenge(); }}>
        <label id={`${id}-title`} htmlFor={`${id}-input`} className="block text-[14px] font-semibold text-ink">
          What do you want to challenge about this report?
        </label>
        <textarea
          ref={inputRef}
          id={`${id}-input`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          placeholder="For example: the team looks wrong, a risk seems overstated, or key evidence is missing."
          className="field mt-2 w-full resize-y px-3 py-2.5 text-[13px] leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="mr-auto text-[11.5px] leading-snug text-ink-faint">
            {panelCostToken
              ? "We’ll check your concern against the evidence in this report."
              : "Run a fresh scan before checking a challenge."}
          </p>
          {!panelCostToken && onRescan ? (
            <button type="button" onClick={onRescan} className="btn-secondary min-h-9 px-3 text-[12px]">
              Rescan
            </button>
          ) : (
            <button
              type="submit"
              disabled={state === "loading" || !question.trim() || !panelCostToken}
              className="btn-primary min-h-9 px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "loading" ? "Checking…" : "Check my challenge"}
            </button>
          )}
        </div>
      </form>

      {state === "loading" && (
        <p className="mt-3 border-t border-line/60 pt-3 text-[12.5px] text-ink-faint" aria-live="polite">
          Checking your concern against the report…
        </p>
      )}

      {state === "done" && !usableResult && (
        <p className="mt-3 border-t border-line/60 pt-3 text-[12.5px] text-ink-faint" aria-live="polite">
          We couldn’t check that concern. Try again.
        </p>
      )}

      {state === "done" && usableResult && data && (
        <div className="mt-3 border-t border-line/60 pt-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">What the evidence says</span>
            <span className="chip tint-var" style={{ "--tint": rec.color } as React.CSSProperties}>{rec.label}</span>
            {data.confidence && <span className="mono ml-auto text-[11px] text-ink-dim">{data.confidence} confidence</span>}
          </div>

          {data.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{data.summary}</p>}

          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {harsh.length > 0 && (
              <div>
                <div className="eyebrow text-caution">Why the score may be too low</div>
                <ul className="mt-1 space-y-1">{harsh.map((c, i) => <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-ink-dim"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-caution" />{c.point}</li>)}</ul>
              </div>
            )}
            {lenient.length > 0 && (
              <div>
                <div className="eyebrow text-avoid">Why the score may be too high</div>
                <ul className="mt-1 space-y-1">{lenient.map((c, i) => <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-ink-dim"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-avoid" />{c.point}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
