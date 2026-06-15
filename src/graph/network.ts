// Cross-audit intelligence layer. Each audit produces its own Panoptes graph;
// individually they are single-subject star maps. Merged, they compound: an
// entity that appears in two separate investigations becomes a bridge, a wallet
// or operator tied to several rugs becomes a serial actor, and a cluster of
// flagged subjects sharing the same hidden hub becomes a cabal. None of that is
// visible in any single report — it only emerges when the graphs are unified.
import type { Dossier } from "../data/dossier";
import type { PanoptesNode } from "../engine";

export type NetFlag = "bridge" | "serial" | "cabal" | "hub";

export interface NetNode {
  id: string;            // canonical id (entity-resolved)
  key: string;           // best display label
  type: string;          // Person | Company | Identity | DeceptionFinding
  subject: boolean;      // is this one of the audited subjects?
  verdict?: string;      // for subject nodes
  wasRug: boolean;
  outcome?: string;      // Rug | Acquisition | IPO | Active
  deception: boolean;
  inCabal: boolean;
  subjects: string[];    // audited subjects whose graph surfaced this node
  degree: number;
  rugLinks: number;      // distinct connected nodes that are rugs / deceptions
  flags: NetFlag[];
}

export interface NetEdge {
  src: string;
  dst: string;
  type: string;
  verdict?: string;
  outcome?: string;
  rug: boolean;          // edge points at a rugged / deceptive node
}

export interface Network {
  nodes: NetNode[];
  edges: NetEdge[];
  bridges: NetNode[];      // shared across >= 2 audited subjects
  serialActors: NetNode[]; // tied to >= 2 rugs / deceptions
  cabals: { subjects: string[]; via: NetNode[] }[];
}

// Entity resolution: normalize a raw node key to a canonical id so that
// "@zenithdao", "ZenithDAO" and "$ZENITH" collapse to one node across audits.
const ALIAS: Record<string, string> = {
  zenith: "zenithdao",
  $zenith: "zenithdao",
};
export function canonical(raw: string): string {
  let k = String(raw).trim().toLowerCase().replace(/^[@$]/, "").replace(/\s+/g, "");
  return ALIAS[k] ?? k;
}

const isRuggy = (n?: NetNode) => !!n && (n.wasRug || n.outcome === "Rug" || n.deception);
// "Bad" for serial-actor purposes: a rug/deception node, or an audited subject
// that itself failed. An entity wired into several of these is a serial actor.
const isBad = (n?: NetNode) => isRuggy(n) || (!!n && n.subject && (n.verdict === "FAIL" || n.verdict === "AVOID"));

export function buildNetwork(dossiers: { handle: string; d: Dossier }[]): Network {
  const map = new Map<string, NetNode>();
  const edgeMap = new Map<string, NetEdge>();

  const upsert = (raw: PanoptesNode, surfacedBy: string): NetNode => {
    const id = canonical(raw.key);
    let n = map.get(id);
    if (!n) {
      n = {
        id, key: String(raw.key), type: String(raw.type), subject: false,
        wasRug: false, deception: false, inCabal: false, subjects: [],
        degree: 0, rugLinks: 0, flags: [],
      };
      map.set(id, n);
    }
    // merge attributes (truthy wins)
    if (raw.subject) { n.subject = true; n.key = String(raw.key); }
    if (raw.was_rug) n.wasRug = true;
    if (raw.outcome) n.outcome = String(raw.outcome);
    if (raw.outcome === "Rug") n.wasRug = true;
    if (raw.type === "DeceptionFinding") n.deception = true;
    if (raw.in_cabal_kb) n.inCabal = true;
    // a real entity label (with @ / $) beats a bare one
    if (/^[@$]/.test(String(raw.key)) && !/^[@$]/.test(n.key)) n.key = String(raw.key);
    if (!n.subject && surfacedBy && !n.subjects.includes(surfacedBy)) n.subjects.push(surfacedBy);
    return n;
  };

  for (const { handle, d } of dossiers) {
    const subjId = canonical(handle);
    for (const raw of d.graph.nodes) {
      const n = upsert(raw, subjId);
      if (raw.subject) n.verdict = d.report.composite_verdict;
    }
    for (const e of d.graph.edges) {
      const src = canonical(e.src);
      const dst = canonical(e.dst);
      const key = `${src}->${dst}:${e.type}`;
      if (edgeMap.has(key)) continue;
      edgeMap.set(key, {
        src, dst, type: String(e.type),
        verdict: e.verdict ? String(e.verdict) : undefined,
        outcome: e.outcome ? String(e.outcome) : undefined,
        rug: e.outcome === "Rug" || e.verdict === "Contradicted",
      });
    }
  }

  const nodes = [...map.values()];
  const edges = [...edgeMap.values()];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // degree + rug-link counts
  const neighbors = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!neighbors.has(e.src)) neighbors.set(e.src, new Set());
    if (!neighbors.has(e.dst)) neighbors.set(e.dst, new Set());
    neighbors.get(e.src)!.add(e.dst);
    neighbors.get(e.dst)!.add(e.src);
  }
  for (const n of nodes) {
    const nb = neighbors.get(n.id) ?? new Set();
    n.degree = nb.size;
    n.rugLinks = [...nb].filter((id) => isBad(byId.get(id))).length;
  }

  // flags
  for (const n of nodes) {
    if (!n.subject && n.subjects.length >= 2) n.flags.push("bridge");
    if (n.rugLinks >= 2) n.flags.push("serial");
    if (n.inCabal) n.flags.push("cabal");
    if (!n.subject && n.degree >= 3 && (n.inCabal || n.rugLinks >= 2)) n.flags.push("hub");
  }

  const bridges = nodes.filter((n) => n.flags.includes("bridge")).sort((a, b) => b.subjects.length - a.subjects.length);
  const serialActors = nodes.filter((n) => !n.subject && n.flags.includes("serial")).sort((a, b) => b.rugLinks - a.rugLinks);

  // cabals: connected components (union-find) that contain >= 2 audited subjects
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) { const a = find(e.src), b = find(e.dst); if (a !== b) parent.set(a, b); }
  const comp = new Map<string, string[]>();
  for (const n of nodes) { const r = find(n.id); (comp.get(r) ?? comp.set(r, []).get(r)!).push(n.id); }
  const cabals: Network["cabals"] = [];
  for (const ids of comp.values()) {
    const members = ids.map((id) => byId.get(id)!);
    const subj = members.filter((m) => m.subject);
    if (subj.length < 2) continue;
    const via = members.filter((m) => !m.subject && (m.subjects.length >= 2 || m.wasRug || m.inCabal)).sort((a, b) => b.subjects.length - a.subjects.length);
    if (via.length === 0) continue;
    cabals.push({ subjects: subj.map((s) => s.key), via });
  }

  return { nodes, edges, bridges, serialActors, cabals };
}
