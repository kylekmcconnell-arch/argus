// A local, accumulating record of the entities every real audit surfaces. Each
// token audit and recorded site recon contributes its Panoptes subgraph here;
// the trust graph then unifies them, so the network compounds with use — audit
// two tokens that share a deployer and they connect, even across sessions. This
// is the seed of the data asset, kept in localStorage until there is a backend.
import type { GraphContribution } from "./network";
import type { PanoptesNode, PanoptesEdge } from "../engine";

const KEY = "argus:graphstore";
const CAP = 80; // most recent contributions

export function getContributions(): GraphContribution[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GraphContribution[]) : [];
  } catch {
    return [];
  }
}

export function recordContribution(c: GraphContribution): void {
  if (!c.nodes.length) return;
  try {
    const all = getContributions().filter((x) => canonicalKey(x) !== canonicalKey(c)); // replace prior audit of the same subject
    all.unshift(c);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, CAP)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearContributions(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

function canonicalKey(c: GraphContribution): string {
  return c.handle.trim().toLowerCase().replace(/^[@$]/, "");
}

// Convenience: build a contribution from a token audit's graph, tagging the
// subject node with its verdict so the network colors it correctly.
export function tokenContribution(symbol: string, verdict: string, nodes: PanoptesNode[], edges: PanoptesEdge[]): GraphContribution {
  return { handle: "$" + symbol, verdict, nodes, edges };
}
