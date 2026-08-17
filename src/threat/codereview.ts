// The ARGUS engine layer: read the actual contract code. Three tiers, best-effort:
//   1. Verified source fetched keyless (Sourcify / Blockscout).
//   2. Static red-flag scan with file+line citations (always runs on source).
//   3. AI read via /api/code-review (Claude, server-side, keyed) — a cached
//      second opinion that may DISSENT from the mechanical score; dissent is
//      surfaced, never averaged away.
// Solana has no per-token code (SPL tokens share the token program), so the
// review is marked not-checked there and authority checks carry that weight.

import type { CodeReview, CodeStats, ContractSource } from "./types";
import { fetchContractSource, EVM_CHAIN_ID } from "./source";
import { scanSolidity, stripComments, functionsOf, tokenomicsSignals } from "./solidity";

const DANGER_PATTERNS =
  /\bselfdestruct\b|\bdelegatecall\b|blacklist|\bbots?\b|banned|tradingEnabled|tradingOpen|whenNotPaused|_balances\s*\[[^\]]+\]\s*=(?!=)/gi;

function statsOf(src: ContractSource): CodeStats {
  let functions = 0, gated = 0, danger = 0, loc = 0;
  let isProxy = false;
  for (const f of src.files) {
    const stripped = stripComments(f.content);
    loc += stripped.filter((l) => l.trim()).length;
    const fns = functionsOf(stripped);
    functions += fns.length;
    gated += fns.filter((fn) => fn.gated).length;
    const whole = stripped.join("\n");
    danger += whole.match(DANGER_PATTERNS)?.length ?? 0;
    if (/\bdelegatecall\b/.test(whole) && /implementation|_IMPLEMENTATION_SLOT|upgradeTo/i.test(whole)) isProxy = true;
  }
  return { functions, gatedFunctions: gated, dangerHits: danger, isProxy, loc };
}

const notChecked: CodeReview = {
  checked: false, verified: false, origin: null, contractName: null,
  compiler: null, stats: null, flags: [], tokenomics: null, ai: null,
};

export async function reviewCode(chain: string, address: string): Promise<CodeReview> {
  if (!EVM_CHAIN_ID[chain]) return notChecked; // Solana / unknown chain: no per-token code
  const src = await fetchContractSource(chain, address);
  if (!src.verified) {
    return { ...notChecked, checked: true };
  }
  const flags = scanSolidity(src.files);
  const stats = statsOf(src);
  return {
    checked: true,
    verified: true,
    origin: src.origin,
    contractName: src.contractName,
    compiler: src.compiler,
    stats,
    flags,
    tokenomics: tokenomicsSignals(src.files),
    ai: null,
  };
}

// The AI pass runs server-side (api/code-review.ts) because it needs the
// Anthropic key, and is called LAZILY by the UI after the mechanical verdict
// renders — the read is fed that verdict so it can dissent from it. Server-side
// it is cached per contract (source is immutable). Unreachable API (static
// hosting, no key) degrades gracefully to the static flags alone.
export async function aiCodeRead(
  chain: string,
  address: string,
  mech: CodeReview,
  call?: { verdict: string; risk: number },
): Promise<CodeReview["ai"]> {
  if (!mech.verified) return null;
  try {
    const res = await fetch(
      `/api/code-review?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}` +
        `&danger=${mech.stats?.dangerHits ?? 0}&gated=${mech.stats?.gatedFunctions ?? 0}` +
        (call ? `&verdict=${encodeURIComponent(call.verdict)}&risk=${call.risk}` : ""),
      { signal: AbortSignal.timeout(55000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { ok?: boolean; summary?: string; dissent?: "cleaner" | "darker" | null; proxyOf?: string | null };
    if (!d.ok || !d.summary) return null;
    return { summary: d.summary, dissent: d.dissent ?? null, proxyOf: d.proxyOf ?? null };
  } catch {
    return null;
  }
}
