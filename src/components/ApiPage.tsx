import { useState } from "react";

const BASE = typeof window !== "undefined" ? window.location.origin : "https://argus-one-flax.vercel.app";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}
      className="mono rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-dim transition hover:border-line-2 hover:text-ink"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Block({ code }: { code: string }) {
  return (
    <div className="relative mt-2 rounded-lg border border-line bg-panel-2/50">
      <div className="absolute right-2 top-2"><Copy text={code} /></div>
      <pre className="thin-scroll mono overflow-x-auto p-3 pr-16 text-[12.5px] leading-relaxed text-ink-dim">{code}</pre>
    </div>
  );
}

function Endpoint({ method, path, desc, params, curl, response }: { method: string; path: string; desc: string; params: [string, string][]; curl: string; response: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <span className="chip tint-pass">{method}</span>
        <span className="mono text-[13.5px] text-ink">{path}</span>
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">{desc}</p>
      <div className="mt-3 space-y-1">
        {params.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[12.5px]">
            <span className="mono shrink-0 text-ink">{k}</span>
            <span className="text-ink-faint">{v}</span>
          </div>
        ))}
      </div>
      <div className="eyebrow mt-3">Request</div>
      <Block code={curl} />
      <div className="eyebrow mt-3">Response</div>
      <Block code={response} />
    </div>
  );
}

export function ApiPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display-sm text-[24px] text-ink">API</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        Programmatic access to ARGUS for funds, launchpads, and internal bots. Every investigation endpoint
        requires an active analyst account and a Supabase access token. Send it as a Bearer token; workspace
        membership and daily investigation limits are enforced server-side.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-faint">
        <span>Base URL <span className="mono text-ink-dim">{BASE}</span></span>
        <span>· Bearer auth required</span>
        <span>· private responses are not shared-cached</span>
      </div>

      <div className="mt-6 space-y-4">
        <Endpoint
          method="GET"
          path="/api/v1/token"
          desc="Live forensic rug-audit of a token from its contract address or a DexScreener link. EVM and Solana."
          params={[["address", "contract address (or url= a DexScreener link)"]]}
          curl={`curl -H "Authorization: Bearer $ARGUS_ACCESS_TOKEN" \\
  "${BASE}/api/v1/token?address=0x6982508145454ce325ddbe47a25d4ec3d2311933"`}
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
          desc="Multi-class principal audit (founder / fund / KOL / advisor / agency), governed by the most severe role. Final verdict and score are withheld until frozen coverage is decision-ready; raw scorer output remains explicit and preliminary."
          params={[["handle", "an X handle, e.g. @gakonst"]]}
          curl={`curl -H "Authorization: Bearer $ARGUS_ACCESS_TOKEN" \\
  "${BASE}/api/v1/person?handle=gakonst"`}
          response={`{
  "api": "argus/v1",
  "kind": "person",
  "handle": "@gakonst",
  "verdict": "INCOMPLETE",
  "score": null,
  "decision_ready": false,
  "completeness_state": "partial",
  "decision_readiness": {
    "state": "provisional",
    "coverage_percent": 90,
    "successful_checks": 9,
    "applicable_checks": 10,
    "unresolved_checks": 1
  },
  "preliminary_model_signal": {
    "verdict": "PASS",
    "score": 83,
    "classification": "preliminary"
  },
  "governing_role": "INVESTOR",
  "roles": [
    { "role": "INVESTOR", "verdict": "INCOMPLETE", "score": null, "status": "preliminary" }
  ]
}`}
        />

        <Endpoint
          method="GET"
          path="/api/audit"
          desc="Server-Sent Events stream of an audit's trace steps, then the final dossier. Use for a live progress UI."
          params={[["handle", "an X handle or token contract"]]}
          curl={`curl -N -H "Authorization: Bearer $ARGUS_ACCESS_TOKEN" \\
  "${BASE}/api/audit?handle=satoshi_builds"`}
          response={`event: step
data: {"phase":"P0 · Intake","label":"Resolve handle",...}

event: done
data: { ...full dossier... }`}
        />
      </div>

      {/* spec */}
      <div className="panel mt-6 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink">OpenAPI 3.1 spec</div>
          <div className="mt-0.5 text-[12.5px] text-ink-faint">Import into Postman or Swagger, or generate a typed client with openapi-generator.</div>
        </div>
        <a href={`${BASE}/api/v1/openapi.json`} target="_blank" rel="noreferrer" className="link-ext mono shrink-0 text-[12.5px]">/api/v1/openapi.json</a>
      </div>

      {/* recipes */}
      <h2 className="mt-7 text-[13.5px] font-semibold tracking-tight text-ink">Recipes</h2>
      <div className="mt-2 space-y-4">
        <div>
          <div className="text-[12.5px] text-ink-dim">JavaScript · flag a token before you ape</div>
          <Block code={`const a = await (await fetch(\n  "${BASE}/api/v1/token?address=" + addr,\n  { headers: { Authorization: "Bearer " + ARGUS_ACCESS_TOKEN } }\n)).json();\nif (a.verdict === "AVOID" || a.verdict === "FAIL")\n  alert(\`⚠ $\{a.symbol}: $\{a.headline}\`);`} />
        </div>
        <div>
          <div className="text-[12.5px] text-ink-dim">Python</div>
          <Block code={`import os, requests\na = requests.get("${BASE}/api/v1/token",\n  params={"address": addr},\n  headers={"Authorization": "Bearer " + os.environ["ARGUS_ACCESS_TOKEN"]}).json()\nprint(a["verdict"], a["score"], a["headline"])`} />
        </div>
        <div>
          <div className="text-[12.5px] text-ink-dim">Telegram bot · reply with a verdict on any contract</div>
          <Block code={`bot.onText(/^\\/audit (.+)/, async (msg, m) => {\n  const a = await (await fetch(\n    "${BASE}/api/v1/token?address=" + m[1],\n    { headers: { Authorization: "Bearer " + process.env.ARGUS_ACCESS_TOKEN } }\n  )).json();\n  bot.sendMessage(msg.chat.id,\n    \`$\{a.symbol}: $\{a.verdict} $\{a.score}/100\\n$\{a.headline}\`);\n});`} />
        </div>
      </div>

      <div className="panel mt-6 p-4 text-[12.5px] leading-relaxed text-ink-faint">
        <span className="text-ink-dim">Next API milestone:</span> revocable service-account keys, per-key scopes, usage plans,
        signed webhooks, and watchlist drift events. Interactive session tokens are the secure access path today.
      </div>
    </div>
  );
}
