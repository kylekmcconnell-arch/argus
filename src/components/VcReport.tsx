import { useEffect, useRef, useState } from "react";
import { auditToken } from "../token/audit";
import { isRunnableTokenInput, resolveInput } from "../lib/resolveInput";
import { verdictMeta } from "../lib/verdict";
import { TokenSparkline } from "./TokenSparkline";

// VC portfolio discovery is deliberately analyst-triggered: it can be the most
// expensive supplemental panel on a report, and opening a report must never
// silently spend that budget. Grok rows remain unverified investigative leads.
// Pricing a named token enriches the lead but does not verify that the investor
// backed it, so this component never promotes rows into the trust graph.
type InvestmentLead = {
  project: string;
  ticker: string | null;
  contract: string | null;
  chain: string | null;
  x_handle: string | null;
  stage: string | null;
  year: string | null;
  outcome: string | null;
  source_url?: string | null;
  source_title?: string | null;
  evidence_state?: "model_lead";
};
type Scored = InvestmentLead & { address?: string; chainResolved?: string; verdict?: string; score?: number | null; liquidityUsd?: number; mcap?: number; dead?: boolean; resolved?: boolean };
type DexPair = { baseToken?: { address?: unknown; symbol?: unknown }; liquidity?: { usd?: unknown } };
type PanelState = "idle" | "loading" | "ok" | "empty" | "unavailable" | "context-error" | "auth-error" | "error";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

async function tickerToContract(ticker: string): Promise<string | null> {
  const sym = ticker.replace(/^\$/, "").toUpperCase();
  if (!sym || sym.length < 2) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(sym)}`);
    const d = await r.json() as unknown;
    const pairsValue = isRecord(d) ? d.pairs : null;
    const all: DexPair[] = Array.isArray(pairsValue)
      ? pairsValue.filter((pair): pair is DexPair => isRecord(pair))
      : [];
    const pairs = all
      .filter((pair) => typeof pair.baseToken?.address === "string" && String(pair.baseToken.symbol ?? "").toUpperCase() === sym)
      .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
    return typeof pairs[0]?.baseToken?.address === "string" ? pairs[0].baseToken.address : null;
  } catch {
    return null;
  }
}

function safeCandidateSource(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !host
      || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
      || host === "[::1]"
      || host === "localhost"
      || host.endsWith(".local")
      || host.endsWith(".internal")
    ) return null;
    if ([...url.searchParams.keys()].some((key) => /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i.test(key))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function auditInvestment(inv: InvestmentLead): Promise<Scored> {
  let contract = inv.contract;
  if (!contract && inv.ticker) contract = await tickerToContract(inv.ticker);
  if (!contract) return { ...inv, resolved: false };
  const input = resolveInput(contract);
  const d = isRunnableTokenInput(input) ? await auditToken(input, undefined, { skipSim: true }).catch(() => null) : null;
  if (!d) return { ...inv, resolved: false };
  const liq = d.liquidityUsd ?? 0;
  const mc = d.mcap ?? 0;
  // "dead" means the token is actually gone: essentially no MARKET CAP and no
  // tradeable liquidity — NOT merely a low ARGUS risk score. A real token ($IMX)
  // can carry a FAIL/CAUTION risk verdict yet have a huge cap and be very much
  // alive. Market cap, not the verdict, is the life signal.
  const dead = mc < 50_000 && liq < 5_000;
  return { ...inv, address: d.address, chainResolved: d.chain, verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, mcap: d.mcap, dead, resolved: true };
}

export function VcReport({ handle, name, verifiedProjects = [], panelCostToken, onAudit }: { handle: string; name: string; verifiedProjects?: string[]; panelCostToken?: string; onAudit?: (q: string) => void }) {
  const [rows, setRows] = useState<Scored[] | null>(null);
  const [state, setState] = useState<PanelState>("idle");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(-1);
  const verifiedProjectKeys = new Set(verifiedProjects.map((project) => project.trim().toLowerCase()));

  useEffect(() => {
    if (attempt < 1 || ran.current === attempt || !panelCostToken) return;
    ran.current = attempt;
    setState("loading");
    setMessage("");
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ handle: handle.replace(/^@/, ""), name });
        const r = await fetch(`/api/vc-portfolio?${params}`, panelCostToken
          ? { headers: { "x-argus-panel-token": panelCostToken } }
          : undefined);
        const body = await r.json().catch(() => null) as unknown;
        const d = isRecord(body) ? body : {};
        if (cancelled) return;
        if (!r.ok) {
          const detail = typeof d.message === "string" ? d.message : "The portfolio search did not complete.";
          setMessage(detail);
          if (r.status === 409 || d.error === "invalid_panel_context") setState("context-error");
          else if (r.status === 401 || r.status === 403) setState("auth-error");
          else setState("error");
          return;
        }
        if (d.available === false) {
          setMessage(typeof d.note === "string" ? d.note : "The portfolio search provider is not configured.");
          setState("unavailable");
          return;
        }
        const rawCandidates = Array.isArray(d.candidates) ? d.candidates : [];
        setMessage(typeof d.coverage_note === "string" ? d.coverage_note : "");
        const inv = rawCandidates.filter(isRecord).map((row): InvestmentLead => ({
          project: typeof row.project === "string" ? row.project : "Unresolved project",
          ticker: typeof row.ticker === "string" ? row.ticker : null,
          contract: typeof row.contract === "string" ? row.contract : null,
          chain: typeof row.chain === "string" ? row.chain : null,
          x_handle: typeof row.x_handle === "string" ? row.x_handle : null,
          stage: typeof row.stage === "string" ? row.stage : null,
          year: typeof row.year === "string" ? row.year : null,
          outcome: typeof row.outcome === "string" ? row.outcome : null,
          source_url: typeof row.source_url === "string" ? row.source_url : null,
          source_title: typeof row.source_title === "string" ? row.source_title : null,
          evidence_state: "model_lead",
        }));
        if (!inv.length) {
          setRows([]);
          setState("empty");
          return;
        }
        // Price the token investments up to a cap (each is an on-chain lookup), but
        // NEVER drop the rest. These are still leads: resolving a token contract
        // does not verify the investor-project relationship.
        const withToken = inv.filter((i) => i.contract || i.ticker);
        const toPrice = withToken.slice(0, 16);
        const overflow = withToken.slice(16);
        const rest = inv.filter((i) => !(i.contract || i.ticker));
        const scored = await Promise.all(toPrice.map(auditInvestment));
        if (cancelled) return;
        setRows([...scored, ...overflow.map((i) => ({ ...i, resolved: false })), ...rest.map((i) => ({ ...i, resolved: false }))]);
        setState("ok");
      } catch {
        if (!cancelled) {
          setMessage("The paid portfolio search could not be reached. No portfolio conclusion or graph relationship was recorded.");
          setState("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [handle, name, panelCostToken, attempt]);

  const run = () => {
    if (!panelCostToken || state === "loading") return;
    setState("loading");
    setAttempt((current) => current + 1);
  };

  if (state === "idle") {
    return (
      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="text-[12.5px] font-medium text-ink">Portfolio outcome analysis</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">
              Search for source-linked portfolio candidates, then price up to 16 named tokens. This can run up to two paid Grok searches plus live market lookups. Results stay unverified, outside the trust graph, and do not change the frozen verdict.
            </p>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!panelCostToken}
            className="btn-chip tint-signal shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {panelCostToken ? "Run portfolio analysis →" : "Saved report required"}
          </button>
        </div>
      </div>
    );
  }

  if (state === "loading") return <div className="panel p-4 text-[12.5px] text-ink-faint">assembling source-linked candidates + pricing named tokens…</div>;
  if (state === "context-error") {
    return (
      <div className="finding tint-caution p-4 text-[12.5px] leading-relaxed">
        <div className="font-medium text-caution">Fresh saved report required</div>
        <p className="mt-1">{message || "This paid supplemental check needs a fresh persisted report. Rescan before running it."}</p>
      </div>
    );
  }
  if (state === "auth-error") {
    return (
      <div className="finding tint-caution p-4 text-[12.5px] leading-relaxed">
        <div className="font-medium text-caution">Session authorization required</div>
        <p className="mt-1">{message || "Sign in again before running this paid supplemental search."}</p>
      </div>
    );
  }
  if (state === "unavailable") {
    return <div className="panel p-4 text-[12.5px] text-ink-dim">{message}</div>;
  }
  if (state === "error") {
    return (
      <div className="finding tint-caution flex flex-wrap items-center justify-between gap-3 p-4 text-[12.5px]">
        <span className="max-w-2xl">{message || "The paid search failed. No portfolio conclusion was recorded."}</span>
        <button onClick={run} className="btn-chip tint-signal">Retry paid search (may incur cost) →</button>
      </div>
    );
  }
  if (state === "empty" || !rows) {
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-[12.5px] text-ink-dim">
        <div className="max-w-2xl">
          <p>No source-linked portfolio candidates surfaced. This is not evidence that the investor has no portfolio.</p>
          {message && <p className="mt-1 text-[11px] text-ink-faint">{message}</p>}
        </div>
        <button onClick={run} className="btn-chip tint-signal">Search again (may incur another paid Grok search) →</button>
      </div>
    );
  }

  const priced = rows.filter((r) => r.resolved && r.verdict);
  const dead = priced.filter((r) => r.dead);
  const projectNameOverlapCount = rows.filter((r) => verifiedProjectKeys.has(r.project.trim().toLowerCase())).length;
  const money = (n?: number) => (n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n));

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">{rows.length} unverified current-search portfolio {rows.length === 1 ? "candidate" : "candidates"}{projectNameOverlapCount ? ` · ${projectNameOverlapCount} name overlap${projectNameOverlapCount === 1 ? "" : "s"}` : ""}</span>
        {priced.length > 0 && dead.length > 0 && (
          <span className="mono text-[11px] text-caution">{dead.length}/{priced.length} priced token candidates inactive</span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        Grok surfaced these current-search leads. {projectNameOverlapCount
          ? "The name overlap only chip means the same project appears in frozen evidence; this panel does not verify the investor attribution."
          : "A name overlap only chip would indicate a matching project name in separately frozen evidence, not a verified investor attribution."} Every panel row remains outside the trust graph and verdict. Token market data checks the named token only, not the investment claim.
      </p>
      {message && <p className="mt-1 text-[11px] leading-relaxed text-caution">{message}</p>}

      <div className="panel-inset mt-2 divide-y divide-line/60">
        {rows.map((r, i) => {
          const m = r.verdict ? verdictMeta(r.verdict) : null;
          const openTarget = r.address || r.x_handle;
          const source = safeCandidateSource(r.source_url);
          const projectNameOverlap = verifiedProjectKeys.has(r.project.trim().toLowerCase());
          return (
            <div key={i} className="px-3 py-2 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                {openTarget && onAudit ? (
                  <button onClick={() => onAudit(openTarget!)} className="font-medium text-ink underline-offset-2 hover:text-signal-dim hover:underline">{r.project}</button>
                ) : (
                  <span className="font-medium text-ink">{r.project}</span>
                )}
                {r.ticker && <span className="mono text-[11px] text-ink-faint">{r.ticker}</span>}
                {(r.stage || r.year) && <span className="text-[11px] text-ink-faint">{[r.stage, r.year].filter(Boolean).join(" · ")}</span>}
                {projectNameOverlap && <span className="chip">name overlap only</span>}
                {m && <span className={`verdict-pill ${r.verdict === "FAIL" ? "tint-fail" : "tint-var"}`} style={r.verdict === "FAIL" ? undefined : ({ "--tint": m.color } as React.CSSProperties)}>token risk · {r.verdict}{r.score != null ? ` ${r.score}` : ""}</span>}
                {r.resolved && <span className="text-[11px] text-ink-faint">{r.mcap ? `mcap ${money(r.mcap)}` : `liq ${money(r.liquidityUsd)}`}</span>}
                {r.dead && <span className="chip tint-caution">inactive market</span>}
                {r.address && r.chainResolved && <span className="ml-auto"><TokenSparkline address={r.address} chain={r.chainResolved} compact /></span>}
              </div>
              {r.outcome && !r.resolved && <div className="mt-0.5 text-[11px] text-ink-faint">Model-reported status: {r.outcome}</div>}
              {source && (
                <a href={source} target="_blank" rel="noopener noreferrer" className="mono link-ext mt-1 inline-block text-[11px]">
                  Candidate source{r.source_title ? ` · ${r.source_title}` : ""}
                </a>
              )}
            </div>
          );
        })}
      </div>
      {dead.length > 0 && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-caution">
          {dead.length} of {priced.length} priceable token candidates {dead.length === 1 ? "appears" : "appear"} inactive based on current market cap and liquidity. This does not verify that the fund invested in them.
        </p>
      )}
    </div>
  );
}
