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

// Contract and wallet identities are typed and address-backed. Display aliases
// (notably $SYMBOL) are intentionally kept out of these keys: tickers are not
// unique, and lower-casing a Solana address changes its identity.
const EVM_ADDRESS = /^0x[0-9a-f]+$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeChain(chain: string): string {
  return String(chain).trim().toLowerCase();
}

export function normalizeAddress(chain: string, address: string): string {
  const value = String(address).trim();
  // EVM addresses are case-insensitive for identity purposes (checksum casing is
  // display metadata). Solana/base58 addresses are case-sensitive.
  return normalizeChain(chain) !== "solana" && EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}

export function tokenEntityKey(chain: string, address: string): string {
  return `token:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}

export function walletEntityKey(chain: string, address: string): string {
  return `wallet:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}

// Entity resolution for untyped legacy keys remains conservative. In
// particular, "$ABC" stays distinct from a person/company named "ABC". New
// token and wallet records always take the typed paths above.
export function canonical(raw: string): string {
  const value = String(raw).trim();
  let m = value.match(/^token:([^:]+):(.+)$/i);
  if (m) return tokenEntityKey(m[1], m[2]);

  m = value.match(/^(?:wallet|holder|funder):([^:]+):(.+)$/i);
  if (m) return walletEntityKey(m[1], m[2]);

  // Safely recover chainless legacy keys only when the address format itself is
  // decisive. This keeps old full-address forensic contributions useful without
  // carrying their role prefix into identity.
  m = value.match(/^(?:token|mint):(.+)$/i);
  if (m && EVM_ADDRESS.test(m[1])) return tokenEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS.test(m[1])) return tokenEntityKey("solana", m[1]);
  m = value.match(/^(?:wallet|holder|funder):(.+)$/i);
  if (m && EVM_ADDRESS.test(m[1])) return walletEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS.test(m[1])) return walletEntityKey("solana", m[1]);

  // Wallets produced by the people-audit engine historically use
  // `${chain}:${address}`. Safely upgrade only recognizable full addresses;
  // arbitrary namespaced keys (email:, risk:, code:, …) must not be recast.
  m = value.match(/^([^:]+):(.+)$/);
  if (m && (EVM_ADDRESS.test(m[2]) || (normalizeChain(m[1]) === "solana" && SOLANA_ADDRESS.test(m[2])))) {
    return walletEntityKey(m[1], m[2]);
  }

  // A bare Solana address can occur in old evidence. Preserve its exact case.
  if (SOLANA_ADDRESS.test(value)) return value;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (lower.startsWith("$")) return lower; // legacy display alias, never a name id
  return lower.replace(/^@/, "");
}

const isRuggy = (n?: NetNode) => !!n && (n.wasRug || n.outcome === "Rug" || n.deception);
// "Bad" for serial-actor purposes: a rug/deception node, or an audited subject
// that itself failed. An entity wired into several of these is a serial actor.
const isBad = (n?: NetNode) => isRuggy(n) || (!!n && n.subject && (n.verdict === "FAIL" || n.verdict === "AVOID"));

// A raw audit subgraph (token audits, recorded site recons) — the same
// {nodes, edges} shape Panoptes uses, with an optional verdict on the subject.
export interface GraphContribution {
  handle: string;
  nodes: PanoptesNode[];
  edges: PanoptesEdge[];
  verdict?: string;
  // Search/display aliases only. They resolve to a subject solely when exactly
  // one address-backed token claims them.
  aliases?: string[];
  reportVersionId?: string;
  provenanceState?: "server_collected" | "client_submitted" | "legacy";
}

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
const CONTEXT_ONLY_EDGE_TYPES = new Set(["INVESTED_IN", "AFFILIATED_WITH"]);

function contextOnlyNodeKeys(contribution: GraphContribution, resolve: AliasResolver): Set<string> {
  const byNode = new Map<string, string[]>();
  for (const edge of contribution.edges) {
    const type = String(edge.type).toUpperCase();
    for (const endpoint of [resolve(edge.src), resolve(edge.dst)]) {
      const types = byNode.get(endpoint) ?? [];
      types.push(type);
      byNode.set(endpoint, types);
    }
  }
  return new Set([...byNode.entries()]
    .filter(([, types]) => types.length > 0 && types.every((type) => CONTEXT_ONLY_EDGE_TYPES.has(type)))
    .map(([key]) => key));
}

// ── Safe alias resolution ─────────────────────────────────────────────────
// A token's address-backed id is authoritative. Its $ticker, observed project X
// account and observed domain may resolve to that id for backwards-compatible
// lookups, but only when exactly ONE token claims the alias. Two same-ticker
// contracts (or two contracts sharing a project account) remain distinct and the
// shared account/domain remains an ordinary bridge node.
export type AliasResolver = (key: string) => string;
export function buildAliasResolver(contributions: GraphContribution[]): AliasResolver {
  const targets = new Map<string, Set<string>>();
  const add = (alias: string, subject: string) => {
    const a = canonical(alias);
    if (!a) return;
    const set = targets.get(a) ?? new Set<string>();
    set.add(subject);
    targets.set(a, set);
  };
  const DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
  for (const c of contributions) {
    const rawSubject = c.nodes.find((n) => n.subject)?.key ?? c.handle;
    const subj = canonical(String(rawSubject));
    const addressBacked = subj.startsWith("token:");

    // Register legacy $token subjects as competing claims. This prevents a new
    // address-backed token with the same ticker from absorbing an old record.
    if (String(c.handle).startsWith("$")) add(c.handle, subj);
    if (!addressBacked) continue;

    for (const alias of c.aliases ?? []) add(alias, subj);
    const subjectNode = c.nodes.find((n) => n.subject);
    if (subjectNode) {
      if (typeof subjectNode.label === "string") add(subjectNode.label, subj);
      if (typeof subjectNode.symbol === "string") add("$" + subjectNode.symbol.replace(/^\$/, ""), subj);
    }
    for (const e of c.edges) {
      if (canonical(e.src) !== subj) continue;
      const dst = String(e.dst);
      if (e.type === "TEAM" && dst.startsWith("@")) add(dst, subj);
      else if (e.type === "LINKS" && DOMAIN.test(dst)) add(dst, subj);
    }
  }
  const unique = new Map<string, string>();
  for (const [alias, ids] of targets) if (ids.size === 1) unique.set(alias, [...ids][0]);
  return (key: string) => {
    const id = canonical(key);
    return unique.get(id) ?? id;
  };
}

export function buildNetwork(dossiers: { handle: string; d: Dossier }[], extra: GraphContribution[] = []): Network {
  const resolve = buildAliasResolver(extra);
  const map = new Map<string, NetNode>();
  const edgeMap = new Map<string, NetEdge>();
  const governingSubjectsByNode = new Map<string, Set<string>>();

  const markGoverningSurface = (contribution: GraphContribution, subjectId: string) => {
    const contextOnly = contextOnlyNodeKeys(contribution, resolve);
    for (const node of contribution.nodes) {
      if (node.subject || isGenericKey(String(node.key))) continue;
      const key = resolve(node.key);
      if (contextOnly.has(key)) continue;
      const subjects = governingSubjectsByNode.get(key) ?? new Set<string>();
      subjects.add(subjectId);
      governingSubjectsByNode.set(key, subjects);
    }
  };

  const upsert = (raw: PanoptesNode, surfacedBy: string): NetNode | null => {
    if (!raw.subject && isGenericKey(String(raw.key))) return null;
    const id = resolve(raw.key);
    const display = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : String(raw.key);
    let n = map.get(id);
    if (!n) {
      n = {
        id, key: display, type: String(raw.type), subject: false,
        wasRug: false, deception: false, inCabal: false, subjects: [],
        degree: 0, rugLinks: 0, flags: [],
      };
      map.set(id, n);
    }
    // merge attributes (truthy wins)
    if (raw.subject) { n.subject = true; n.key = display; }
    if (raw.verdict) n.verdict = String(raw.verdict);
    if (raw.was_rug) n.wasRug = true;
    if (raw.outcome) n.outcome = String(raw.outcome);
    if (raw.outcome === "Rug") n.wasRug = true;
    if (raw.type === "DeceptionFinding") n.deception = true;
    if (raw.in_cabal_kb) n.inCabal = true;
    // a real entity label (with @ / $) beats a bare one
    if (/^[@$]/.test(display) && !/^[@$]/.test(n.key)) n.key = display;
    if (!n.subject && surfacedBy && !n.subjects.includes(surfacedBy)) n.subjects.push(surfacedBy);
    return n;
  };

  const ingestEdges = (edges: PanoptesEdge[]) => {
    for (const e of edges) {
      if (isGenericKey(String(e.src)) || isGenericKey(String(e.dst))) continue;
      const src = resolve(e.src);
      const dst = resolve(e.dst);
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
    const subjId = resolve(handle);
    markGoverningSurface({ handle, nodes: d.graph.nodes, edges: d.graph.edges }, subjId);
    for (const raw of d.graph.nodes) {
      const n = upsert(raw, subjId);
      if (n && raw.subject) n.verdict = d.report.composite_verdict;
    }
    ingestEdges(d.graph.edges);
  }

  for (const c of extra) {
    const subjId = resolve(c.handle);
    markGoverningSurface(c, subjId);
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
    if (CONTEXT_ONLY_EDGE_TYPES.has(e.type.toUpperCase())) continue;
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
  const governingSubjects = (node: NetNode): string[] => [...(governingSubjectsByNode.get(node.id) ?? [])];
  const sharedVias = nodes.filter((n) => !n.subject && governingSubjects(n).length >= 2);
  const viasByCluster = new Map<string, NetNode[]>();
  for (const v of sharedVias) {
    const present = governingSubjects(v).filter((s) => parent.has(s));
    for (let i = 1; i < present.length; i++) {
      const a = find(present[0]), b = find(present[i]);
      if (a !== b) parent.set(a, b);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const id of subjectIds) { const r = find(id); (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(id); }
  for (const v of sharedVias) {
    const present = governingSubjects(v).filter((s) => parent.has(s));
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

// How strong is a shared tie as evidence of "same operator"? The key prefix tells
// us: on-chain infra + a leaked identity are near-proof; a shared person/site is
// strong-but-not-proof (people work on many projects); holder overlap is weak.
export function tieStrength(rawKey: string): "hard" | "medium" | "weak" {
  const k = String(rawKey).toLowerCase();
  if (/^(code:|email:|wallet:|funder:|mint:|token:)/.test(k)) return "hard";
  // Shared analytics / monetization property: you control that account, so an
  // unrelated project can't legitimately carry your GA/GTM/AdSense/Pixel ID.
  if (/^(ga:|gtm:|adsense:|fbpixel:)/.test(k)) return "hard";
  // Shared hosting IP / favicon: real but circumstantial (CDNs, reused templates).
  // On-chain exposure to an Arkham-flagged hacker / mixer / sanctioned entity.
  if (/^risk:/.test(k)) return "hard";
  if (/^(holder|amm|dex|pool|lp|market|ip:|favicon:)/.test(k)) return "weak";
  return "medium"; // shared @handle / domain / company
}

// Direct exposure to an Arkham-flagged bad actor in the subject's OWN graph — a
// wallet it deployed near, was funded by, or transacts with that Arkham ties to a
// hacker, mixer, or sanctioned entity. Unlike subjectConnections (which needs the
// other end to be a scanned FAILED subject), this fires off the risk label alone.
export function riskExposure(handle: string, contributions: GraphContribution[]): { severity: "avoid" | "caution"; entities: { key: string; label: string }[] } | null {
  const resolve = buildAliasResolver(contributions);
  const me = resolve(handle);
  const found = new Map<string, { label: string; avoid: boolean }>();
  for (const c of contributions) {
    if (resolve(c.handle) !== me) continue;
    for (const n of c.nodes) {
      const k = String(n.key);
      if (!k.startsWith("risk:")) continue;
      const node = n as { label?: string; subtype?: string };
      const label = node.label ? String(node.label) : k.slice(5);
      const avoid = String(node.subtype ?? "") === "risk-avoid";
      const ex = found.get(k);
      found.set(k, { label, avoid: ex ? ex.avoid || avoid : avoid });
    }
  }
  if (!found.size) return null;
  return { severity: [...found.values()].some((v) => v.avoid) ? "avoid" : "caution", entities: [...found.entries()].map(([key, v]) => ({ key, label: v.label })) };
}

export interface Reconciliation {
  severity: "avoid" | "caution";
  line: string;
  via: SubjectConnection[]; // the bad connections that drove the override, hardest first
  riskEntities?: { key: string; label: string }[]; // Arkham-flagged bad actors, when risk drove it
}

// Verdict reconciliation: the contract-level audit can't see that this subject
// shares its deployer / funder / bytecode / dev-email with an already-FAILED
// subject. When it does, that connection should OVERRIDE a clean headline — a
// hard infra tie to a rug means AVOID regardless of how the contract scans.
const BAD_VERDICTS = new Set(["FAIL", "AVOID"]);
export function reconcileVerdict(handle: string, contributions: GraphContribution[]): Reconciliation | null {
  const bad = subjectConnections(handle, contributions, 24).filter((c) => c.otherVerdict && BAD_VERDICTS.has(c.otherVerdict));
  const strongestOf = (c: SubjectConnection): "hard" | "medium" | "weak" => {
    if (c.direct) return "hard"; // the flagged subject IS an entity this audit surfaced
    let best: "hard" | "medium" | "weak" = "weak";
    for (const t of c.ties) { const s = tieStrength(t.key); if (s === "hard") return "hard"; if (s === "medium") best = "medium"; }
    return best;
  };
  const hard = bad.filter((c) => strongestOf(c) === "hard");
  const medium = bad.filter((c) => strongestOf(c) === "medium");
  const risk = riskExposure(handle, contributions);

  // Candidate overrides, in descending severity: a hard connection to a failed
  // subject and a hacker/mixer/sanctioned exposure are both AVOID; a shared
  // team/domain and a lower-tier risk flag are both CAUTION. Return the strongest.
  const connHard: Reconciliation | null = hard.length
    ? (() => { const c = hard[0]; const how = c.direct ? "was surfaced directly in this audit" : `shares ${c.ties.map((t) => tieLabel(t.key)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(" + ")}`; return { severity: "avoid", line: `Byte/infra-identical link to ${c.other} (${c.otherVerdict}): it ${how}. A shared deployer, funder, contract fingerprint, or dev email with a failed subject is the same operation.`, via: hard }; })()
    : null;
  const names = risk ? risk.entities.map((e) => e.label.split(" · ")[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(", ") : "";
  const riskAvoid: Reconciliation | null = risk?.severity === "avoid" ? { severity: "avoid", line: `On-chain exposure to a flagged bad actor: ${names}. Arkham ties this subject's wallets to a hacker, mixer, or sanctioned entity — a hard AVOID regardless of how the contract itself scans.`, via: [], riskEntities: risk.entities } : null;
  const connMedium: Reconciliation | null = medium.length ? { severity: "caution", line: `Shares a team member or domain with ${medium[0].other} (${medium[0].otherVerdict}). Not proof of the same operation, but the overlap warrants caution.`, via: medium } : null;
  const riskCaution: Reconciliation | null = risk?.severity === "caution" ? { severity: "caution", line: `On-chain exposure to a risk-flagged wallet: ${names}. Verify the nature of the flow before trusting the subject.`, via: [], riskEntities: risk.entities } : null;

  return connHard ?? riskAvoid ?? connMedium ?? riskCaution ?? null;
}
function tieLabel(rawKey: string): string {
  const k = String(rawKey).toLowerCase();
  if (k.startsWith("code:")) return "a contract fingerprint";
  if (k.startsWith("email:")) return "a dev email";
  if (k.startsWith("wallet:")) return "a deployer wallet";
  if (k.startsWith("funder:")) return "a funding wallet";
  if (k.startsWith("mint:") || k.startsWith("token:")) return "a token";
  if (k.startsWith("ga:") || k.startsWith("gtm:")) return "an analytics ID";
  if (k.startsWith("adsense:")) return "an AdSense account";
  if (k.startsWith("fbpixel:")) return "a Meta Pixel";
  if (k.startsWith("ip:")) return "a hosting IP";
  if (k.startsWith("favicon:")) return "a favicon";
  return "an entity";
}

export function subjectConnections(handle: string, contributions: GraphContribution[], max = 12): SubjectConnection[] {
  const resolve = buildAliasResolver(contributions);
  const me = resolve(handle);
  // entities my own audits surfaced (canonical key -> display label + type)
  const mine = new Map<string, { label: string; type: string }>();
  for (const c of contributions) {
    if (resolve(c.handle) !== me) continue;
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue; // "site"/"twitter" junk can't be a tie
      const k = resolve(n.key);
      const label = typeof n.label === "string" && n.label.trim() ? n.label : String(n.key);
      if (k !== me && !contextOnly.has(k)) mine.set(k, { label, type: String(n.type) });
    }
  }
  if (!mine.size) return [];

  const byOther = new Map<string, { label: string; verdict?: string; ties: Map<string, SharedTie>; direct: boolean }>();
  const ensure = (id: string, label: string, verdict?: string) => {
    if (!byOther.has(id)) byOther.set(id, { label, verdict, ties: new Map(), direct: false });
    return byOther.get(id)!;
  };
  for (const c of contributions) {
    const other = resolve(c.handle);
    if (other === me) continue;
    const otherLabel = c.aliases?.[0]
      ?? (typeof c.nodes.find((n) => n.subject)?.label === "string" ? String(c.nodes.find((n) => n.subject)!.label) : c.handle);
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    // direct tie: the other subject is itself one of the entities I surfaced
    if (mine.has(other)) { const e = ensure(other, otherLabel, c.verdict); e.direct = true; }
    // shared tie: a third entity both of us touch
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      if (k !== me && k !== other && mine.has(k) && !contextOnly.has(k)) {
        const e = ensure(other, otherLabel, c.verdict);
        e.ties.set(k, { key: k, label: mine.get(k)!.label, type: mine.get(k)!.type });
      }
    }
  }
  return [...byOther.entries()]
    .map(([, v]) => ({ other: v.label, otherVerdict: v.verdict, ties: [...v.ties.values()], direct: v.direct }))
    .filter((x) => x.ties.length > 0 || x.direct)
    .sort((a, b) => Number(b.direct) - Number(a.direct) || b.ties.length - a.ties.length)
    .slice(0, max);
}
