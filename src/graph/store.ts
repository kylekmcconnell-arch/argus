// An accumulating record of the entities every real audit surfaces. Each token
// audit and recorded site recon contributes its Panoptes subgraph here; the
// trust graph then unifies them, so the network compounds with use — audit two
// tokens that share a deployer and they connect, even across sessions.
//
// localStorage is the synchronous working cache. When a shared backend is
// configured (/api/graph, gated on Supabase env), every contribution also syncs
// up and the COMMUNITY graph hydrates down on load — so Kyle's and Enigma's
// audits compound into one network. With no backend it stays local-only.
import {
  buildAliasResolver,
  canonical,
  normalizeAddress,
  normalizeChain,
  tokenEntityKey,
  walletEntityKey,
  type GraphContribution,
} from "./network";
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

// Merge extra nodes/edges INTO the subject's existing contribution (not a replace),
// so a forensic panel that runs after the audit can attach its findings to the
// same subject — keeping them "mine" for subjectConnections. Creates the
// contribution if none exists yet.
function mergeContribution(handle: string, addNodes: PanoptesNode[], addEdges: PanoptesEdge[]): void {
  try {
    const all = getContributions();
    const resolve = buildAliasResolver(all);
    const hk = resolve(handle);
    const existing = all.find((c) => canonicalKey(c) === hk);
    if (!existing) {
      // A ticker is never sufficient to create a token identity. This can occur
      // when two address-backed tokens share a symbol and an older panel only
      // supplies `$SYMBOL`; dropping that ambiguous graph attachment is safer
      // than joining the two investigations.
      if (handle.trim().startsWith("$")) return;
      const typedSubject = /^(?:token|wallet):[^:]+:.+/.test(hk) ? hk : handle;
      const edges = addEdges.map((e) => ({
        ...e,
        src: canonical(e.src) === hk ? typedSubject : e.src,
        dst: canonical(e.dst) === hk ? typedSubject : e.dst,
      }));
      const subjectNode: PanoptesNode = typedSubject.startsWith("wallet:")
        ? { type: "Identity", subtype: "Wallet", key: typedSubject, subject: true }
        : typedSubject.startsWith("token:")
          ? { type: "Token", key: typedSubject, subject: true }
          : { type: "Person", key: typedSubject, subject: true };
      recordContribution({ handle: typedSubject, nodes: [subjectNode, ...addNodes], edges });
      return;
    }
    const subjectKey = String(existing.nodes.find((n) => n.subject)?.key ?? existing.handle);
    const haveN = new Set(existing.nodes.map((n) => canonical(String(n.key))));
    for (const n of addNodes) {
      const k = canonical(String(n.key));
      if (!haveN.has(k)) { haveN.add(k); existing.nodes.push(n); }
    }
    const normalizeEdge = (e: PanoptesEdge): PanoptesEdge => ({
      ...e,
      src: resolve(e.src) === hk ? subjectKey : e.src,
      dst: resolve(e.dst) === hk ? subjectKey : e.dst,
    });
    const edgeKey = (e: PanoptesEdge) => `${canonical(e.src)}|${canonical(e.dst)}|${String(e.type).toLowerCase()}`;
    const haveE = new Set(existing.edges.map(edgeKey));
    for (const raw of addEdges) {
      const e = normalizeEdge(raw);
      const k = edgeKey(e);
      if (!haveE.has(k)) { haveE.add(k); existing.edges.push(e); }
    }
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, CAP)));
    void syncContribution(existing);
    emitGraphChange();
  } catch {
    /* non-fatal */
  }
}

// Attach forensic entities a panel discovered (leaked dev emails, prior handles,
// cross-platform accounts, seeded deployers) to the subject in the graph. Uses
// consistent keys (email:… / platform:username / wallet:chain:full-address) so the SAME entity
// collapses across audits — two projects sharing a dev email or a funder bridge
// automatically. This is what turns the panels' findings into the compounding web.
export interface ForensicEntity { key: string; type: string; subtype?: string; edgeType: string; label?: string }
export function recordForensicEntities(subjectKey: string, entities: ForensicEntity[]): void {
  const clean = entities.filter((e) => e && e.key && e.key.trim());
  if (!clean.length || !subjectKey) return;
  const nodes: PanoptesNode[] = [];
  const edges: PanoptesEdge[] = [];
  for (const e of clean) {
    const walletLike = /wallet/i.test(e.subtype ?? "") || /^(?:wallet|holder|funder):/i.test(e.key);
    const tokenLike = e.type === "Token" || /^(?:token|mint):/i.test(e.key);
    const resolved = walletLike || tokenLike ? canonical(e.key) : e.key;
    // A prefix such as wallet:7Xa91c2f cannot be made globally unique. Keep it
    // out of the graph unless the producer supplied a complete address that can
    // be upgraded to a typed wallet id.
    if (walletLike && !/^wallet:[^:]+:.+/.test(resolved)) continue;
    if (tokenLike && !/^token:[^:]+:.+/.test(resolved)) continue;
    nodes.push({ type: e.type, key: resolved, ...(e.subtype ? { subtype: e.subtype } : {}), ...(e.label ? { label: e.label } : {}) } as PanoptesNode);
    edges.push({ src: subjectKey, dst: resolved, type: e.edgeType });
  }
  if (nodes.length) mergeContribution(subjectKey, nodes, edges);
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
    const d = await r.json().catch(() => ({})) as { ok?: boolean };
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
    const d = await r.json() as { available?: boolean; contributions?: GraphContribution[] };
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
  const subject = c.nodes.find((n) => n.subject)?.key;
  return canonical(String(subject ?? c.handle));
}

// Convenience: build a contribution from a token audit's graph, tagging the
// subject node with its verdict so the network colors it correctly.
export function tokenContribution(symbol: string, verdict: string, nodes: PanoptesNode[], edges: PanoptesEdge[]): GraphContribution {
  const subject = nodes.find((n) => n.subject);
  const subjectKey = subject ? String(subject.key) : "$" + symbol;
  return { handle: subjectKey, aliases: ["$" + symbol.replace(/^\$/, "")], verdict, nodes, edges };
}

// Convenience: build a contribution from a person audit. This is what lets the
// graph compound across people, not just tokens — once a subject's discovered
// affiliations (Company nodes) are recorded, a later audit of that same company,
// or of another person tied to it, bridges to them automatically. Affiliation
// edges become the connective tissue of the network.
export function personContribution(d: Dossier): GraphContribution {
  const reportVersionId = d.versionContext?.reportVersionId
    ?? (d.persistence?.state === "persisted" ? d.persistence.reportVersionId ?? undefined : undefined);
  return {
    handle: d.handle,
    verdict: d.report.composite_verdict,
    nodes: d.graph.nodes,
    edges: d.graph.edges,
    ...(reportVersionId
      ? { reportVersionId, provenanceState: "server_collected" as const }
      : { provenanceState: "client_submitted" as const }),
  };
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
// engine through canonical `wallet:${chain}:${address}` ids.
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
    const key = walletEntityKey(w.chain, w.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key, chain: normalizeChain(w.chain), address: w.address });
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
    // EVM identity ignores checksum case; Solana identity must retain base58
    // case. Lower-casing Solana here previously merged distinct addresses.
    const k = normalizeAddress(chain === "evm" ? "ethereum" : "solana", addr);
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
        const sol = src.match(SOL);
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
  const chain = inv.token.chain;
  const subjectKey = tokenEntityKey(chain, inv.token.address);

  // Upgrade safely recoverable keys in stored pre-address-ID reports. The token
  // contract, deployer and top-holder full addresses all live on the dossier,
  // even when their old graph labels were only `$SYMBOL` / eight-char prefixes.
  const replacements = new Map<string, Set<string>>();
  const replace = (oldKey: string, newKey: string) => {
    const set = replacements.get(oldKey) ?? new Set<string>();
    set.add(newKey);
    replacements.set(oldKey, set);
  };
  for (const n of g.nodes) if (n.subject) replace(String(n.key), subjectKey);
  replace("$" + inv.token.symbol, subjectKey);
  if (inv.token.deployer) replace("wallet:" + inv.token.deployer.slice(0, 8), walletEntityKey(chain, inv.token.deployer));
  for (const h of inv.token.topHolders ?? []) {
    replace((h.tag || "holder") + ":" + h.address.slice(0, 8), walletEntityKey(chain, h.address));
  }
  for (const n of g.nodes) {
    const address = typeof n.address === "string" ? n.address : "";
    if (address && (n.type === "Identity" || String(n.subtype ?? "").toLowerCase().includes("wallet"))) {
      replace(String(n.key), walletEntityKey(typeof n.chain === "string" ? n.chain : chain, address));
    }
  }
  const upgraded = (key: string) => {
    const candidates = replacements.get(key);
    return candidates?.size === 1 ? [...candidates][0] : key;
  };
  const nodes: PanoptesNode[] = g.nodes.map((n) => {
    const key = n.subject ? subjectKey : upgraded(String(n.key));
    if (n.subject) return { ...n, type: "Token", key, label: "$" + inv.token.symbol, symbol: inv.token.symbol, chain, address: inv.token.address };
    return key === n.key ? n : { ...n, key };
  });
  const edges: PanoptesEdge[] = g.edges.map((e) => ({ ...e, src: upgraded(e.src), dst: upgraded(e.dst) }));
  const trail = inv.deployerTrail;
  const dep = inv.token.deployer;
  const keyOf = (addr: string) => walletEntityKey(chain, addr);
  if (dep && trail?.chain?.length) {
    for (const hop of trail.chain) {
      if (hop.kind === "cex") continue; // exchange, not a bridging node
      const fromKey = keyOf(hop.from);
      const toKey = keyOf(hop.to);
      nodes.push({ type: "Identity", subtype: "FunderWallet", key: toKey, label: "funder:" + hop.to.slice(0, 8), chain, address: hop.to });
      edges.push({ src: toKey, dst: fromKey, type: "FUNDED" }); // funder -> recipient
    }
  } else if (dep && trail?.funder && trail.funder.kind === "wallet") {
    const funderKey = keyOf(trail.funder.address);
    nodes.push({ type: "Identity", subtype: "FunderWallet", key: funderKey, label: "funder:" + trail.funder.address.slice(0, 8), chain, address: trail.funder.address });
    edges.push({ src: funderKey, dst: keyOf(dep), type: "FUNDED" });
  }
  return { handle: subjectKey, aliases: ["$" + inv.token.symbol], verdict: inv.token.verdict, nodes, edges };
}
