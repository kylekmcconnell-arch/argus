// A local, accumulating record of the entities every real audit surfaces. Each
// token audit and recorded site recon contributes its Panoptes subgraph here;
// the trust graph then unifies them, so the network compounds with use — audit
// two tokens that share a deployer and they connect, even across sessions. This
// is the seed of the data asset, kept in localStorage until there is a backend.
import type { GraphContribution } from "./network";
import type { PanoptesNode, PanoptesEdge } from "../engine";
import type { Dossier } from "../data/dossier";
import type { Investigation } from "../lib/investigation";

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

// Convenience: a full investigation contributes its token subgraph PLUS the
// deployer's funding source. Only an ANONYMOUS funder wallet is added as a node:
// it is the connective tissue that exposes a serial operator when the same
// wallet funds multiple deployers across separate investigations. A CEX funder
// is deliberately omitted — it is a legitimate exchange, not an operator, and a
// shared exchange node would falsely read as a hub.
export function investigationContribution(inv: Investigation): GraphContribution | null {
  const g = inv.token?.graph;
  if (!g) return null;
  const nodes: PanoptesNode[] = [...g.nodes];
  const edges: PanoptesEdge[] = [...g.edges];
  const trail = inv.deployerTrail;
  if (trail?.funder && trail.funder.kind === "wallet" && inv.token.deployer) {
    const deployerKey = "wallet:" + inv.token.deployer.slice(0, 8);
    const funderKey = "funder:" + trail.funder.address.slice(0, 8);
    nodes.push({ type: "Identity", subtype: "FunderWallet", key: funderKey, address: trail.funder.address, tokens_created: trail.tokensCreated });
    edges.push({ src: funderKey, dst: deployerKey, type: "FUNDED" });
  }
  return { handle: "$" + inv.token.symbol, verdict: inv.token.verdict, nodes, edges };
}
