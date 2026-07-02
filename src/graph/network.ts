// Cross-audit intelligence layer. Each audit produces its own Panoptes graph;
// individually they are single-subject star maps. Merged, they compound: an
// entity that appears in two separate investigations becomes a bridge, a wallet
// or operator tied to several rugs becomes a serial actor, and a cluster of
// flagged subjects sharing the same hidden hub becomes a cabal. None of that is
// visible in any single report — it only emerges when the graphs are unified.
import type { Dossier } from "../data/dossier";
import type { PanoptesNode, PanoptesEdge } from "../engine";

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
  cabals: { subjects: string[]; via: NetNode[]; score?: number; holderOnly?: boolean }[];
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

// A raw audit subgraph (token audits, recorded site recons) — the same
// {nodes, edges} shape Panoptes uses, with an optional verdict on the subject.
export interface GraphContribution { handle: string; nodes: PanoptesNode[]; edges: PanoptesEdge[]; verdict?: string }

// Generic labels that older audits recorded as literal node keys ("site",
// "twitter", …). They collapse to one node via canonical() and fake-bridge
// EVERY audit into one blob cabal. Filtered on ingest so even old stored
// contributions can't pollute the network.
const GENERIC_KEYS = new Set([
  "site", "website", "web", "twitter", "x", "telegram", "discord", "github",
  "docs", "documentation", "medium", "linktree", "whitepaper", "mail", "email",
  "youtube", "tiktok", "instagram", "reddit", "facebook", "warpcast", "farcaster",
  "coingecko", "dexscreener", "linkedin", "blog", "other", "unknown",
]);
const isGenericKey = (raw: string) => GENERIC_KEYS.has(canonical(raw));

export function buildNetwork(dossiers: { handle: string; d: Dossier }[], extra: GraphContribution[] = []): Network {
  const map = new Map<string, NetNode>();
  const edgeMap = new Map<string, NetEdge>();

  const upsert = (raw: PanoptesNode, surfacedBy: string): NetNode | null => {
    if (!raw.subject && isGenericKey(String(raw.key))) return null;
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
    if (raw.verdict) n.verdict = String(raw.verdict);
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

  const ingestEdges = (edges: PanoptesEdge[]) => {
    for (const e of edges) {
      if (isGenericKey(String(e.src)) || isGenericKey(String(e.dst))) continue;
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
  };

  for (const { handle, d } of dossiers) {
    const subjId = canonical(handle);
    for (const raw of d.graph.nodes) {
      const n = upsert(raw, subjId);
      if (n && raw.subject) n.verdict = d.report.composite_verdict;
    }
    ingestEdges(d.graph.edges);
  }

  for (const c of extra) {
    const subjId = canonical(c.handle);
    for (const raw of c.nodes) {
      const n = upsert(raw, subjId);
      if (n && raw.subject && c.verdict && !n.verdict) n.verdict = c.verdict;
    }
    ingestEdges(c.edges);
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

  // ── cabals v2: shared entities between audited subjects, weighted by how hard
  // the tie is to fake. A shared NAMED person/company or a shared deployer/funder
  // wallet is strong evidence of coordination; overlapping top-holders is weak
  // (exchanges and market makers hold everything). Calling a "cabal" requires at
  // least one strong tie, or three-plus holder overlaps. Each qualifying subject
  // cluster is its own cabal, strongest first — never one blob.
  const isHolderVia = (n: NetNode) => /^holder:/i.test(n.key);
  const isWalletVia = (n: NetNode) => !isHolderVia(n) && (/^(wallet|funder):/i.test(n.key) || n.type === "Identity");
  const isNamedVia = (n: NetNode) => (n.type === "Person" || n.type === "Company") && !isHolderVia(n) && !isWalletVia(n);

  // Union subjects ONLY through shared via-entities (a node surfaced by >= 2
  // subjects), so unrelated subjects that merely coexist in one component don't
  // get lumped together.
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const subjectIds = nodes.filter((n) => n.subject).map((n) => n.id);
  for (const id of subjectIds) parent.set(id, id);
  const sharedVias = nodes.filter((n) => !n.subject && n.subjects.length >= 2);
  const viasByCluster = new Map<string, NetNode[]>();
  for (const v of sharedVias) {
    const present = v.subjects.filter((s) => parent.has(s));
    for (let i = 1; i < present.length; i++) {
      const a = find(present[0]), b = find(present[i]);
      if (a !== b) parent.set(a, b);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const id of subjectIds) { const r = find(id); (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(id); }
  for (const v of sharedVias) {
    const present = v.subjects.filter((s) => parent.has(s));
    if (present.length < 2) continue;
    const r = find(present[0]);
    (viasByCluster.get(r) ?? viasByCluster.set(r, []).get(r)!).push(v);
  }

  const cabals: Network["cabals"] = [];
  for (const [root, ids] of clusters) {
    if (ids.length < 2) continue;
    const via = (viasByCluster.get(root) ?? []).sort((a, b) => {
      const w = (n: NetNode) => (isNamedVia(n) ? 3 : isWalletVia(n) ? 2 : 1);
      return w(b) - w(a) || b.subjects.length - a.subjects.length;
    });
    const named = via.filter(isNamedVia).length;
    const wallets = via.filter(isWalletVia).length;
    const holders = via.filter(isHolderVia).length;
    if (named + wallets === 0 && holders < 3) continue; // holder overlap alone isn't a cabal
    cabals.push({
      subjects: ids.map((id) => byId.get(id)!.key),
      via,
      score: (named + wallets) * 2 + holders,
      holderOnly: named + wallets === 0,
    });
  }
  cabals.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return { nodes, edges, bridges, serialActors, cabals };
}

// ── Per-subject connections: the navigable web for one audited subject ──
// Given everything accumulated, find the OTHER audited subjects this one is tied
// to, and the shared entities (projects, companies, people, wallets) that connect
// them — i.e. "worked together at X", "both tied to deployer Y". This is what the
// report turns into a fluid, clickable web: each connection is another subject you
// can open, whose report shows ITS connections, and so on.
export interface SharedTie { key: string; label: string; type: string }
export interface SubjectConnection { other: string; otherVerdict?: string; ties: SharedTie[]; direct: boolean }

export function subjectConnections(handle: string, contributions: GraphContribution[], max = 12): SubjectConnection[] {
  const me = canonical(handle);
  // entities my own audits surfaced (canonical key -> display label + type)
  const mine = new Map<string, { label: string; type: string }>();
  for (const c of contributions) {
    if (canonical(c.handle) !== me) continue;
    for (const n of c.nodes) {
      const k = canonical(n.key);
      if (k !== me) mine.set(k, { label: String(n.key), type: String(n.type) });
    }
  }
  if (!mine.size) return [];

  const byOther = new Map<string, { verdict?: string; ties: Map<string, SharedTie>; direct: boolean }>();
  const ensure = (h: string, verdict?: string) => {
    if (!byOther.has(h)) byOther.set(h, { verdict, ties: new Map(), direct: false });
    return byOther.get(h)!;
  };
  for (const c of contributions) {
    const other = canonical(c.handle);
    if (other === me) continue;
    // direct tie: the other subject is itself one of the entities I surfaced
    if (mine.has(other)) { const e = ensure(c.handle, c.verdict); e.direct = true; }
    // shared tie: a third entity both of us touch
    for (const n of c.nodes) {
      const k = canonical(n.key);
      if (k !== me && k !== other && mine.has(k)) {
        const e = ensure(c.handle, c.verdict);
        e.ties.set(k, { key: k, label: mine.get(k)!.label, type: mine.get(k)!.type });
      }
    }
  }
  return [...byOther.entries()]
    .map(([other, v]) => ({ other, otherVerdict: v.verdict, ties: [...v.ties.values()], direct: v.direct }))
    .filter((x) => x.ties.length > 0 || x.direct)
    .sort((a, b) => Number(b.direct) - Number(a.direct) || b.ties.length - a.ties.length)
    .slice(0, max);
}
