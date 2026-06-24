// A local, accumulating record of the entities every real audit surfaces. Each
// token audit and recorded site recon contributes its Panoptes subgraph here;
// the trust graph then unifies them, so the network compounds with use — audit
// two tokens that share a deployer and they connect, even across sessions. This
// is the seed of the data asset, kept in localStorage until there is a backend.
import type { GraphContribution } from "./network";
import type { PanoptesNode, PanoptesEdge } from "../engine";
import type { Dossier } from "../data/dossier";
import type { Investigation, WebPerson } from "../lib/investigation";

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

// A project-centric discovery contributes the project node + everyone found to
// have worked on it. This is how clicking a project compounds the web: the people
// become nodes that bridge to any other audit they appear in.
export function projectPeopleContribution(projectName: string, people: WebPerson[]): GraphContribution {
  const nodes: PanoptesNode[] = [{ type: "Company", key: projectName, subject: true }];
  const edges: PanoptesEdge[] = [];
  for (const p of people) {
    const key = p.handle ?? p.name;
    if (!key) continue;
    nodes.push({ type: "Person", key, role: p.role });
    edges.push({ src: key, dst: projectName, type: "WORKED_ON" });
  }
  return { handle: projectName, nodes, edges };
}

// Convenience: a full investigation contributes its token subgraph PLUS the
// deployer's full funding chain. Every ANONYMOUS wallet in the chain becomes a
// node: these are the connective tissue that exposes a serial operator when the
// same intermediary funds deployers across separate investigations. CEX hops are
// deliberately omitted — a legitimate exchange is not an operator, and a shared
// exchange node would falsely read as a hub.
export function investigationContribution(inv: Investigation): GraphContribution | null {
  const g = inv.token?.graph;
  if (!g) return null;
  const nodes: PanoptesNode[] = [...g.nodes];
  const edges: PanoptesEdge[] = [...g.edges];
  const trail = inv.deployerTrail;
  const dep = inv.token.deployer;
  // Match the deployer's existing token-graph node key; chain wallets get a
  // stable funder key so the same wallet collapses to one node across audits.
  const keyOf = (addr: string) => (dep && addr === dep ? "wallet:" + addr.slice(0, 8) : "funder:" + addr.slice(0, 8));
  if (dep && trail?.chain?.length) {
    for (const hop of trail.chain) {
      if (hop.kind === "cex") continue; // exchange, not a bridging node
      const fromKey = keyOf(hop.from);
      const toKey = keyOf(hop.to);
      nodes.push({ type: "Identity", subtype: "FunderWallet", key: toKey, address: hop.to });
      edges.push({ src: toKey, dst: fromKey, type: "FUNDED" }); // funder -> recipient
    }
  } else if (dep && trail?.funder && trail.funder.kind === "wallet") {
    const funderKey = "funder:" + trail.funder.address.slice(0, 8);
    nodes.push({ type: "Identity", subtype: "FunderWallet", key: funderKey, address: trail.funder.address });
    edges.push({ src: funderKey, dst: "wallet:" + dep.slice(0, 8), type: "FUNDED" });
  }
  return { handle: "$" + inv.token.symbol, verdict: inv.token.verdict, nodes, edges };
}
