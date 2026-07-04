import { useEffect, useRef, useState } from "react";
import type { TokenDossier } from "../token/audit";

// Adversarial review of the verdict, auto-run on every token report. A second set
// of eyes that tries to break the verdict both ways — too harsh (false positive)
// and too lenient (false negative) — grounded only in the evidence the audit
// produced. Surfaces its challenges + a recommendation (uphold/soften/harden) so a
// questionable verdict doesn't ship unchallenged.
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

export function SecondOpinion({ dossier }: { dossier: TokenDossier }) {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "done">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const r = await fetch("/api/challenge-verdict", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: dossier.symbol ? `$${dossier.symbol}` : "token", verdict: dossier.verdict, score: dossier.score, evidence: buildEvidence(dossier) }),
        });
        setData(await r.json());
      } catch { /* non-fatal */ }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[11.5px] text-ink-faint">stress-testing the verdict…</div>;
  if (!data || data.available === false || (!data.summary && !(data.challenges ?? []).length)) return null;

  const rec = REC[data.recommendation ?? "uphold"] ?? REC.uphold;
  const challenges = data.challenges ?? [];
  const harsh = challenges.filter((c) => c.direction === "too_harsh");
  const lenient = challenges.filter((c) => c.direction === "too_lenient");

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: data.recommendation === "uphold" ? "var(--color-line)" : `${rec.color}55`, background: data.recommendation === "uphold" ? "var(--color-panel)" : `${rec.color}0d` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Adversarial review</span>
        <span className="mono rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${rec.color}1a`, color: rec.color }}>{rec.label}</span>
        {data.confidence && <span className="mono ml-auto text-[10px] text-ink-faint">{data.confidence} confidence</span>}
      </div>

      {data.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{data.summary}</p>}

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {harsh.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-caution)" }}>Why it might be too harsh</div>
            <ul className="mt-1 space-y-1">{harsh.map((c, i) => <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-ink-dim"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-caution)" }} />{c.point}</li>)}</ul>
          </div>
        )}
        {lenient.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-avoid)" }}>Why it might be too lenient</div>
            <ul className="mt-1 space-y-1">{lenient.map((c, i) => <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-ink-dim"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-avoid)" }} />{c.point}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
