// Runs the benchmark corpus through the real ARGUS token engine, live, and
// judges each verdict against its declared label. Nothing here is precomputed:
// the page calls runBench() on view and the numbers are whatever the live
// on-chain data produces right now.
import { auditToken, type TokenDossier } from "../token/audit";
import { resolveInput } from "../lib/resolveInput";
import { CORPUS, type CorpusToken } from "./corpus";

export interface BenchResult {
  token: CorpusToken;
  status: "ok" | "error";
  verdict: string;
  score: number | null;
  capApplied: string | null;
  mintable: boolean;
  freezable: boolean;
  headline: string;
  /** did ARGUS behave as the label expects? */
  correct: boolean;
  /** one-line plain-English reason the verdict landed where it did */
  driver: string;
  error?: string;
}

function judge(token: CorpusToken, d: TokenDossier): { correct: boolean; driver: string } {
  if (token.expect === "clear") {
    return {
      correct: d.verdict === "PASS",
      driver: d.verdict === "PASS" ? "Cleared the forensic bar." : `Flagged: ${d.capApplied ?? "scored below pass"}.`,
    };
  }
  // flag-authority: the token's contract must show a live, supply-affecting power
  const flagged = d.capApplied === "mint_authority_active" || d.capApplied === "freeze_authority_active" || d.safety.mintable || d.safety.freezable;
  return {
    correct: flagged && d.verdict !== "PASS",
    driver: flagged
      ? `Live ${d.safety.freezable ? "freeze" : "mint"} authority detected — supply/transfer not locked.`
      : "Passed — no live authority detected (unexpected).",
  };
}

export interface BenchSummary {
  established: { total: number; cleared: number };
  governance: { total: number; flagged: number };
  total: number;
  asExpected: number;
}

export function summarize(results: BenchResult[]): BenchSummary {
  const est = results.filter((r) => r.token.bucket === "established" && r.status === "ok");
  const gov = results.filter((r) => r.token.bucket === "mintable-governance" && r.status === "ok");
  return {
    established: { total: est.length, cleared: est.filter((r) => r.verdict === "PASS").length },
    governance: { total: gov.length, flagged: gov.filter((r) => r.correct).length },
    total: results.filter((r) => r.status === "ok").length,
    asExpected: results.filter((r) => r.status === "ok" && r.correct).length,
  };
}

// Bounded-concurrency map so we are gentle on the free public APIs.
async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runBench(
  onResult?: (r: BenchResult, doneCount: number) => void,
  concurrency = 3,
): Promise<BenchResult[]> {
  let done = 0;
  return pool(CORPUS, concurrency, async (token) => {
    let r: BenchResult;
    try {
      const d = await auditToken(resolveInput(token.address));
      if (!d) {
        r = { token, status: "error", verdict: "—", score: null, capApplied: null, mintable: false, freezable: false, headline: "", correct: false, driver: "No DEX pair resolved.", error: "unresolved" };
      } else {
        const { correct, driver } = judge(token, d);
        r = {
          token, status: "ok", verdict: d.verdict, score: d.score, capApplied: d.capApplied,
          mintable: d.safety.mintable, freezable: d.safety.freezable, headline: d.headline,
          correct, driver,
        };
      }
    } catch (e) {
      r = { token, status: "error", verdict: "—", score: null, capApplied: null, mintable: false, freezable: false, headline: "", correct: false, driver: "Audit error.", error: String(e) };
    }
    onResult?.(r, ++done);
    return r;
  });
}
