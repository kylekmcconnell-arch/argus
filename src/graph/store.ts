// An accumulating record of the entities every real audit surfaces. Each token
// audit and recorded site recon contributes its Panoptes subgraph here; the
// trust graph then unifies them, so the network compounds with use — audit two
// tokens that share a deployer and they connect, even across sessions.
//
// localStorage is the synchronous working cache. When a shared backend is
// configured (/api/graph, gated on Supabase env), every contribution also syncs
// up and the COMMUNITY graph hydrates down on load — so Kyle's and Enigma's
// audits compound into one network. With no backend it stays local-only.
import type { GraphContribution } from "./network";
import type { PanoptesNode, PanoptesEdge } from "../engine";
import type { Dossier } from "../data/dossier";
import type { Investigation, WebPerson } from "../lib/investigation";

const KEY = "argus:graphstore";
const CAP = 150; // working-cache size (the shared backend holds the full community set)
const SYNC_URL = "/api/graph";

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
  void syncContribution(c); // push to the shared graph (no-op if no backend)
  emitGraphChange();
}

export function clearContributions(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  emitGraphChange();
}

// ── shared backend: sync up, hydrate down ──────────────────────────────────
// Views read getContributions() synchronously; the community hydrate is async,
// so notify subscribers (e.g. the Trust graph page) to re-read once it lands.
type GraphListener = () => void;
const listeners = new Set<GraphListener>();
export function subscribeGraph(cb: GraphListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function emitGraphChange(): void {
  for (const cb of [...listeners]) { try { cb(); } catch { /* */ } }
}

async function syncContribution(c: GraphContribution): Promise<boolean> {
  try {
    // No keepalive: it caps the body at 64KB, which a large subgraph can exceed.
    const r = await fetch(SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
    if (!r.ok) return false;
    const d = await r.json().catch(() => ({}));
    return d?.ok === true;
  } catch {
    return false; // offline or no backend — the local cache still holds it
  }
}

let hydrated = false;
// Pull the community graph and merge it into the local cache. Local-only entries
// (recorded in a prior session whose POST never landed) win for their own
// subjects AND get backfilled up, so the shared graph self-heals. Runs once per
// session, on app mount. No-op when no backend is configured.
export async function hydrateCommunityGraph(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const r = await fetch(SYNC_URL, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return;
    const d = await r.json();
    if (d?.available === false) return; // backend not configured — stay local-only
    const remote: GraphContribution[] = Array.isArray(d?.contributions) ? d.contributions : [];
    const local = getContributions();
    const remoteKeys = new Set(remote.map(canonicalKey));
    const localOnly = local.filter((c) => !remoteKeys.has(canonicalKey(c)));
    if (remote.length) {
      const merged = [...localOnly, ...remote].slice(0, CAP);
      localStorage.setItem(KEY, JSON.stringify(merged));
      emitGraphChange();
    }
    // Backfill contributions that exist locally but not in the shared graph
    // (a POST that failed/was cancelled in a past session). Best-effort.
    for (const c of localOnly) void syncContribution(c);
  } catch {
    /* no backend / offline — stay local-only */
  }
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

// A find-wallet resolution contributes the clue (as its subject) wired to each
// wallet it resolved, so the result compounds: a handle resolved to a wallet here
// bridges to any token audit whose deployer/holder graph touches that same wallet,
// and to a later people-audit of the same handle. Wallet keys match the audit
// engine's `${chain}:${address}` so the nodes collapse to one.
export function walletContribution(
  clue: string,
  wallets: { address: string; chain: string }[],
): GraphContribution | null {
  if (!wallets.length) return null;
  const handleLike = /^@?[A-Za-z0-9_]{2,30}$/.test(clue) && !clue.includes(".");
  const subjectKey = handleLike ? "@" + clue.replace(/^@/, "") : clue;
  const nodes: PanoptesNode[] = [{ type: handleLike ? "Person" : "Identity", key: subjectKey, subject: true }];
  const edges: PanoptesEdge[] = [];
  for (const w of wallets) {
    const key = `${w.chain}:${w.address}`;
    nodes.push({ type: "Identity", subtype: "Wallet", key, address: w.address });
    edges.push({ src: subjectKey, dst: key, type: "CONTROLS_WALLET" });
  }
  return { handle: subjectKey, nodes, edges };
}

// Every full wallet address ARGUS has already surfaced across all contributions,
// with the entities it is tied to. This is the index a partial-address clue
// (0x71C0…A04e) is matched against — a best effort against the accumulated graph,
// since there is no public "search by partial address" service.
export function knownAddresses(): { address: string; chain: "evm" | "solana"; tiedTo: string[] }[] {
  const EVM = /0x[a-fA-F0-9]{40}/;
  const SOL = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
  const byAddr = new Map<string, { address: string; chain: "evm" | "solana"; tiedTo: Set<string> }>();
  const tie = (addr: string, chain: "evm" | "solana", label: string) => {
    const k = addr.toLowerCase();
    let e = byAddr.get(k);
    if (!e) { e = { address: addr, chain, tiedTo: new Set() }; byAddr.set(k, e); }
    if (label) e.tiedTo.add(label);
  };
  for (const c of getContributions()) {
    const owner = c.handle;
    for (const n of c.nodes) {
      const fromAddr = typeof (n as { address?: unknown }).address === "string" ? String((n as { address?: unknown }).address) : "";
      const fromKey = String(n.key ?? "");
      const label = `${owner}${n.type ? ` (${n.type}${(n as { subtype?: unknown }).subtype ? `/${(n as { subtype?: unknown }).subtype}` : ""})` : ""}`;
      for (const src of [fromAddr, fromKey]) {
        const evm = src.match(EVM);
        if (evm) { tie(evm[0], "evm", label); continue; }
        const sol = src.replace(/^\w+:/, "").match(SOL);
        if (sol && !src.startsWith("0x")) tie(sol[0], "solana", label);
      }
    }
  }
  return [...byAddr.values()].map((e) => ({ address: e.address, chain: e.chain, tiedTo: [...e.tiedTo] }));
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
