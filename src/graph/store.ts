// A local, accumulating record of the entities every real audit surfaces. Each
// token audit and recorded site recon contributes its Panoptes subgraph here;
// the trust graph then unifies them, so the network compounds with use — audit
// two tokens that share a deployer and they connect, even across sessions. This
// is the seed of the data asset, kept in localStorage until there is a backend.
import type { GraphContribution } from "./network";
import type { PanoptesNode, PanoptesEdge } from "../engine";
import type { Dossier } from "../data/dossier";

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

// Convenience: build a contribution from a person audit. This is what lets the
// graph compound across people, not just tokens — once a subject's discovered
// affiliations (Company nodes) are recorded, a later audit of that same company,
// or of another person tied to it, bridges to them automatically. Affiliation
// edges become the connective tissue of the network.
export function personContribution(d: Dossier): GraphContribution {
  return { handle: d.handle, verdict: d.report.composite_verdict, nodes: d.graph.nodes, edges: d.graph.edges };
}
