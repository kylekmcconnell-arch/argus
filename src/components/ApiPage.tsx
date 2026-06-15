import { useState } from "react";

const BASE = typeof window !== "undefined" ? window.location.origin : "https://argus-one-flax.vercel.app";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}
      className="mono rounded-md border border-line bg-white px-2 py-0.5 text-[11px] text-ink-dim transition hover:border-line-2 hover:text-ink"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Block({ code }: { code: string }) {
  return (
    <div className="relative mt-2 rounded-lg border border-line bg-panel-2/50">
      <div className="absolute right-2 top-2"><Copy text={code} /></div>
      <pre className="thin-scroll mono overflow-x-auto p-3 pr-16 text-[12px] leading-relaxed text-ink-dim">{code}</pre>
    </div>
  );
}

function Endpoint({ method, path, desc, params, curl, response }: { method: string; path: string; desc: string; params: [string, string][]; curl: string; response: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="mono rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-pass">{method}</span>
        <span className="mono text-[13px] text-ink">{path}</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{desc}</p>
      <div className="mt-3 space-y-1">
        {params.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[12px]">
            <span className="mono shrink-0 text-ink">{k}</span>
            <span className="text-ink-faint">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-wider text-ink-faint">Request</div>
      <Block code={curl} />
      <div className="mt-3 text-[11px] uppercase tracking-wider text-ink-faint">Response</div>
      <Block code={response} />
    </div>
  );
}

export function ApiPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-[28px] font-medium tracking-[-0.02em] text-ink">API</h1>
      <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-dim">
        Programmatic access to ARGUS, for funds, launchpads, and bots. Token audits run live and keyless;
        principal audits return curated dossiers until provider keys are configured. Every endpoint is JSON
        and CORS-open, so you can call it straight from a browser, a backend, or a Telegram bot.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-faint">
        <span>Base URL <span className="mono text-ink-dim">{BASE}</span></span>
        <span>· no key required (token)</span>
        <span>· responses cached 30s</span>
      </div>

      <div className="mt-6 space-y-4">
        <Endpoint
          method="GET"
          path="/api/v1/token"
          desc="Live forensic rug-audit of a token from its contract address or a DexScreener link. EVM and Solana."
          params={[["address", "contract address (or url= a DexScreener link)"]]}
          curl={`curl "${BASE}/api/v1/token?address=0x6982508145454ce325ddbe47a25d4ec3d2311933"`}
          response={`{
  "api": "argus/v1",
  "kind": "token",
  "symbol": "PEPE",
  "chain": "ethereum",
  "verdict": "PASS",
  "score": 89,
  "cap_applied": null,
  "headline": "Clears the forensic bar: authorities revoked, LP locked...",
  "market": { "marketCap": 1.2e9, "liquidityUsd": 20500000, "ageDays": 1157 },
  "safety": { "honeypot": false, "mintable": false, "ownerRenounced": true, "lpLocked": true },
  "holders": { "insiderPct": 39, "bundleRisk": "elevated" },
  "corroboration": { "listed": true, "rank": 63, "cexCount": 67 },
  "axes": [ { "key": "T1", "label": "Liquidity & lock", "score": 24, "weight": 24 } ],
  "findings": [ { "claim": "...", "tone": "good", "source": "goplus" } ]
}`}
        />

        <Endpoint
          method="GET"
          path="/api/v1/person"
          desc="Multi-class principal audit (founder / fund / KOL / advisor / agency), governed by the most severe role."
          params={[["handle", "an X handle, e.g. @0xlumen"]]}
          curl={`curl "${BASE}/api/v1/person?handle=0xlumen"`}
          response={`{
  "api": "argus/v1",
  "kind": "person",
  "handle": "@0xlumen",
  "verdict": "FAIL",
  "governing_role": "ADVISOR",
  "score": 25,
  "cap_applied": "advised_rug_with_allocation",
  "roles": [
    { "role": "FOUNDER", "verdict": "PASS", "score": 71 },
    { "role": "INVESTOR", "verdict": "CAUTION", "score": 46 },
    { "role": "ADVISOR", "verdict": "FAIL", "score": 25 }
  ]
}`}
        />

        <Endpoint
          method="GET"
          path="/api/audit"
          desc="Server-Sent Events stream of an audit's trace steps, then the final dossier. Use for a live progress UI."
          params={[["handle", "an X handle or token contract"]]}
          curl={`curl -N "${BASE}/api/audit?handle=satoshi_builds"`}
          response={`event: step
data: {"phase":"P0 · Intake","label":"Resolve handle",...}

event: done
data: { ...full dossier... }`}
        />
      </div>

      <div className="mt-6 rounded-xl border border-line bg-panel/40 p-4 text-[12.5px] leading-relaxed text-ink-faint">
        <span className="text-ink-dim">Coming for production:</span> API keys, per-key rate limits, usage plans, and webhooks
        for watchlist drift alerts. Token audits stay free; live people-collection and higher volume move behind a key.
      </div>
    </div>
  );
}
