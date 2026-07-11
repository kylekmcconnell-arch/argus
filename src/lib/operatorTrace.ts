// The recursive evidence collector, on-chain edition.
//
// A single token page shows you one deployer. But a rug operator doesn't launch
// once — they spin up a fresh dev wallet per token and seed them all from a
// shared funder, so no single token reveals the operation. ARGUS already has the
// two primitives to expose it: /api/deployer walks BACKWARD (deployer <- funder
// <- CEX) and /api/funder walks FORWARD one hop (funder -> the other deployers it
// seeded). This chains them into a bounded, deduped, budgeted frontier trace that
// assembles the WHOLE operator cluster from one root: trace up to the topmost
// anonymous hub, sweep forward from it to find the sibling launches, and recurse
// when a hub is itself funded by another anon wallet (a higher, shared hand).
//
// Client-driven on purpose: a multi-hop trace can't fit one Vercel function (the
// forward sweep alone is a 60s call), so the frontier, budget, dedup, and the
// graph write live here and each server call stays individually bounded.
import { recordForensicEntities } from "../graph/store";

const SOLADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type OperatorRole = "deployer" | "funder" | "cex";
export interface OperatorWallet {
  address: string;
  role: OperatorRole;
  label?: string | null;       // CEX name when kind=cex
  tokensCreated?: number;      // how many mints this wallet itself launched
  seededCount?: number;        // how many other deployers it funded
  ageDays?: number | null;
  depth: number;               // hops from the root deployer (0 = root)
  isRoot?: boolean;
}
export interface OperatorToken { mint: string; name?: string; deployer: string; dead?: boolean }
export interface OperatorEdge { from: string; to: string; type: "FUNDED" | "SEEDED" | "LAUNCHED" }

export interface OperatorCluster {
  rootDeployer: string;
  rootLabel?: string;
  wallets: OperatorWallet[];
  tokens: OperatorToken[];
  edges: OperatorEdge[];
  origin: { address: string; label: string | null; kind: "cex" | "wallet" } | null;
  hub: string | null;          // the anon wallet that seeded the most deployers
  stats: { deployers: number; tokens: number; deadTokens: number; hops: number; sweeps: number };
  verdict: { tone: "good" | "warn" | "bad"; line: string };
  budgetExhausted: boolean;
}

export interface TraceOpts {
  maxSweeps?: number;   // /api/funder calls (each up to ~60s)
  maxTraces?: number;   // /api/deployer calls
  maxTokens?: number;   // surfaced tokens we bother to liveness-check
  deadlineMs?: number;  // wall-clock budget
  checkLiveness?: boolean;
  rootLabel?: string;   // e.g. "$SYMBOL" — for display only
  chain?: string;       // "solana" (default) or an EVM chain id (ethereum/base/…)
  record?: boolean;     // false for historical overlays that must not mutate the graph
}
export type TraceStep = (s: { label: string; detail?: string; tone?: "neutral" | "good" | "warn" | "bad" }) => void;

interface FundingOrigin {
  address: string;
  label?: string | null;
  kind: "cex" | "wallet";
}

interface DeployerTraceResponse {
  available?: boolean;
  tokensCreated?: number;
  deployments?: number;
  walletAgeDays?: number;
  chain?: Array<{ from: string; to: string; label: string | null; kind: "cex" | "wallet" }>;
  funder?: FundingOrigin;
  origin?: FundingOrigin;
}

interface FunderSweepResponse {
  available?: boolean;
  seededCount?: number;
  ownTokens?: Array<{ mint: string; name?: string }>;
  ownLaunches?: number;
  seededDeployers?: Array<{
    wallet: string;
    tokensCreated: number;
    sampleTokens?: Array<{ mint: string; name?: string }>;
  }>;
}

const short = (a: string) => a.slice(0, 4) + "…" + a.slice(-4);

// ── the trace ───────────────────────────────────────────────────────────────
export async function traceOperator(rootDeployer: string, opts: TraceOpts, onStep: TraceStep): Promise<OperatorCluster | null> {
  // Chain-branch: the trace chains the same two primitives on either chain, just
  // pointed at the chain's endpoints (Solana/Helius vs EVM/Etherscan). The server
  // shapes are aligned (same field names) so the loop below is chain-agnostic.
  const chainName = (opts.chain ?? "solana").toLowerCase();
  const isSol = chainName === "solana";
  const ADDR = isSol ? SOLADDR : /^0x[a-fA-F0-9]{40}$/;
  if (!ADDR.test(rootDeployer)) return null;
  const deployerEP = isSol ? "/api/deployer" : "/api/evm-deployer";
  const funderEP = isSol ? "/api/funder" : "/api/evm-funder";
  const cp = isSol ? "" : `&chain=${encodeURIComponent(chainName)}`;
  const maxSweeps = opts.maxSweeps ?? 3;
  const maxTraces = opts.maxTraces ?? 4;
  const maxTokens = opts.maxTokens ?? 60;
  const deadline = Date.now() + (opts.deadlineMs ?? 95_000);

  const wallets = new Map<string, OperatorWallet>();
  const tokens = new Map<string, OperatorToken>();
  const edgeSet = new Set<string>();
  const edges: OperatorEdge[] = [];
  const tracedFunder = new Set<string>();  // ran /api/deployer on
  const sweptForward = new Set<string>();  // ran /api/funder on
  const sweepQueue: { address: string; depth: number }[] = [];
  let origin: OperatorCluster["origin"] = null;
  let sweeps = 0, traces = 0, maxHops = 0;
  let budgetExhausted = false;
  const overBudget = () => Date.now() > deadline;

  const addWallet = (addr: string, role: OperatorRole, depth: number, extra?: Partial<OperatorWallet>) => {
    const cur = wallets.get(addr);
    if (cur) { Object.assign(cur, { ...extra }); if (depth < cur.depth) cur.depth = depth; return cur; }
    const w: OperatorWallet = { address: addr, role, depth, ...extra };
    wallets.set(addr, w);
    return w;
  };
  const addEdge = (from: string, to: string, type: OperatorEdge["type"]) => {
    const k = `${from}|${to}|${type}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push({ from, to, type });
  };
  const addToken = (mint: string, name: string | undefined, deployer: string) => {
    if (!mint || tokens.has(mint)) return;
    tokens.set(mint, { mint, name, deployer });
  };

  // Pull the deployer's funding chain; enqueue every anonymous wallet in it as a
  // forward-sweep candidate (each is a hub that may have seeded siblings). CEX
  // terminals are recorded but never expanded — an exchange isn't an operator.
  async function traceUp(addr: string, depth: number): Promise<void> {
    if (tracedFunder.has(addr) || traces >= maxTraces || overBudget()) return;
    tracedFunder.add(addr);
    traces++;
    let d: DeployerTraceResponse;
    try {
      const r = await fetch(`${deployerEP}?wallet=${encodeURIComponent(addr)}${cp}`);
      d = await r.json() as DeployerTraceResponse;
    } catch { return; }
    if (!d || d.available === false) return;
    const w = wallets.get(addr);
    if (w) {
      // Solana returns tokensCreated; EVM returns deployments — either is the count.
      const created = typeof d.tokensCreated === "number" ? d.tokensCreated : d.deployments;
      if (typeof created === "number") w.tokensCreated = created;
      if (typeof d.walletAgeDays === "number") w.ageDays = d.walletAgeDays;
    }
    // Solana returns a full hop chain (deployer<-funder<-…<-CEX); EVM returns a
    // single funder, so synthesize a one-hop chain from it. Uniform downstream.
    const hops: { from: string; to: string; label: string | null; kind: "cex" | "wallet" }[] =
      Array.isArray(d.chain) ? d.chain
      : d.funder ? [{ from: addr, to: d.funder.address, label: d.funder.label ?? null, kind: d.funder.kind }]
      : [];
    maxHops = Math.max(maxHops, depth + hops.length);
    for (const hop of hops) {
      // money flows to -> from (the recipient is FUNDED BY the funder)
      const funderRole: OperatorRole = hop.kind === "cex" ? "cex" : "funder";
      addWallet(hop.to, funderRole, depth + 1, hop.kind === "cex" ? { label: hop.label } : undefined);
      addEdge(hop.to, hop.from, "FUNDED");
      if (hop.kind !== "cex") sweepQueue.push({ address: hop.to, depth: depth + 1 });
    }
    // Record where the trail ultimately lands (the root's origin is the headline).
    // Solana gives an explicit origin; on EVM the single funder IS the origin.
    const org = d.origin ?? d.funder;
    if (depth === 0 && org) origin = { address: org.address, label: org.label ?? null, kind: org.kind };
  }

  // Forward-sweep a hub: every fresh deployer it seeded + those deployers' tokens.
  // This is the reveal — one wallet standing behind a fan of launches.
  async function sweepForward(addr: string, depth: number): Promise<void> {
    if (sweptForward.has(addr) || sweeps >= maxSweeps || overBudget()) { if (sweeps >= maxSweeps) budgetExhausted = true; return; }
    sweptForward.add(addr);
    sweeps++;
    onStep({ label: `Sweeping forward from ${short(addr)}`, detail: "every wallet this hub seeded, and which of them minted tokens…", tone: "neutral" });
    let d: FunderSweepResponse;
    try {
      const r = await fetch(`${funderEP}?wallet=${encodeURIComponent(addr)}${cp}`);
      d = await r.json() as FunderSweepResponse;
    } catch { return; }
    if (!d || d.available === false) return;
    const hub = addWallet(addr, "funder", depth, { seededCount: d.seededCount ?? 0 });
    for (const t of (d.ownTokens ?? []) as { mint: string; name?: string }[]) {
      addToken(t.mint, t.name, addr);
      addEdge(addr, `mint:${t.mint}`, "LAUNCHED");
    }
    if ((d.ownLaunches ?? 0) > 0) hub.tokensCreated = d.ownLaunches;
    const seeded: { wallet: string; tokensCreated: number; sampleTokens?: { mint: string; name?: string }[] }[] = d.seededDeployers ?? [];
    for (const s of seeded) {
      addWallet(s.wallet, "deployer", depth + 1, { tokensCreated: s.tokensCreated });
      addEdge(addr, s.wallet, "SEEDED");
      for (const t of s.sampleTokens ?? []) {
        addToken(t.mint, t.name, s.wallet);
        addEdge(s.wallet, `mint:${t.mint}`, "LAUNCHED");
      }
    }
    if (seeded.length) {
      onStep({ label: `${seeded.length} sibling deployer${seeded.length === 1 ? "" : "s"} under ${short(addr)}`, detail: `behind ${seeded.reduce((n, s) => n + s.tokensCreated, 0)} tokens.`, tone: "warn" });
    }
    // Recurse UP: if this hub is itself funded by an anon wallet, that funder is a
    // higher, shared hand — trace it so its own forward sweep can join the cluster.
    await traceUp(addr, depth);
  }

  // 1. Trace up from the root deployer.
  onStep({ label: `Tracing the deployer's funding trail`, detail: `following the SOL that funded ${short(rootDeployer)} back to its source…`, tone: "neutral" });
  addWallet(rootDeployer, "deployer", 0, { isRoot: true });
  await traceUp(rootDeployer, 0);

  // 2. Sweep the hubs, nearest-first (the immediate funder yields the tightest
  //    sibling set; walking up finds cousins). The queue grows as traceUp inside
  //    sweepForward discovers higher funders — that's the recursion.
  while (sweepQueue.length && sweeps < maxSweeps && !overBudget()) {
    const next = sweepQueue.shift()!;
    if (sweptForward.has(next.address)) continue;
    await sweepForward(next.address, next.depth);
  }
  if (sweepQueue.length && sweeps >= maxSweeps) budgetExhausted = true;

  // 3. Liveness: which of the surfaced tokens are actually dead now? Cheap batched
  //    dexscreener reads turn "M tokens" into "K of M dead" — the real indictment.
  if (opts.checkLiveness !== false && tokens.size) {
    onStep({ label: "Checking which launches are dead", detail: "pricing the cluster's tokens on-chain…", tone: "neutral" });
    await markLiveness([...tokens.values()], maxTokens, chainName, (mint, dead) => { const t = tokens.get(mint); if (t) t.dead = dead; });
  }

  // 4. Assemble stats + verdict.
  const deployerWallets = [...wallets.values()].filter((w) => w.role === "deployer");
  const deadTokens = [...tokens.values()].filter((t) => t.dead).length;
  // The hub = the funder that seeded the most deployers (the operator's hand).
  const seededBy = new Map<string, number>();
  for (const e of edges) if (e.type === "SEEDED") seededBy.set(e.from, (seededBy.get(e.from) ?? 0) + 1);
  const hub = [...seededBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const hubSeeded = hub ? seededBy.get(hub)! : 0;
  const stats = { deployers: deployerWallets.length, tokens: tokens.size, deadTokens, hops: maxHops, sweeps };

  const verdict = buildVerdict({ hub, hubSeeded, stats, origin });

  const cluster: OperatorCluster = {
    rootDeployer, rootLabel: opts.rootLabel,
    wallets: [...wallets.values()], tokens: [...tokens.values()], edges,
    origin, hub, stats, verdict, budgetExhausted,
  };

  if (opts.record !== false) recordCluster(cluster);
  return cluster;
}

function buildVerdict(a: { hub: string | null; hubSeeded: number; stats: OperatorCluster["stats"]; origin: OperatorCluster["origin"] }): OperatorCluster["verdict"] {
  const { hub, hubSeeded, stats, origin } = a;
  const dead = stats.deadTokens ? `, ${stats.deadTokens} now dead` : "";
  // A shared hand behind several deployers, or a large token fan, is a factory.
  if ((hub && hubSeeded >= 3) || stats.deployers >= 4 || stats.tokens >= 6) {
    return { tone: "bad", line: `This deployer is one node in a serial operation: a shared funder${hub ? ` (${short(hub)})` : ""} seeded ${Math.max(hubSeeded, stats.deployers - 1)} other launch wallets behind ${stats.tokens} tokens${dead}. That is a rug factory, not an isolated project.` };
  }
  if (stats.deployers >= 2 || stats.tokens >= 2) {
    return { tone: "warn", line: `The deployer shares a funder with ${stats.deployers - 1 || 1} other launch wallet${stats.deployers - 1 === 1 ? "" : "s"} (${stats.tokens} tokens${dead}). A small cluster worth watching.` };
  }
  if (origin?.kind === "cex") {
    return { tone: "good", line: `Funded from a KYC'd ${origin.label ?? "exchange"} account with no sibling launches found. Isolated and traceable, not a serial pattern.` };
  }
  return { tone: "good", line: `No serial-launch cluster found around this deployer. It traces back${origin ? ` to ${short(origin.address)}` : ""} without fanning out into other launches.` };
}

// dexscreener tokens endpoint: up to 30 mints per call. A mint with no live pair,
// or effectively no market cap AND no liquidity, is a dead launch. Chain-scoped so
// EVM contract addresses hit the right dexscreener chain slug.
async function markLiveness(toks: OperatorToken[], cap: number, chain: string, mark: (mint: string, dead: boolean) => void): Promise<void> {
  const valid = chain === "solana" ? SOLADDR : /^0x[a-fA-F0-9]{40}$/;
  const mints = toks.slice(0, cap).map((t) => t.mint).filter((m) => valid.test(m));
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain)}/${batch.join(",")}`);
      const pairs = await r.json() as Array<Record<string, unknown>>;
      const alive = new Set<string>();
      for (const p of Array.isArray(pairs) ? pairs : []) {
        const liquidity = p.liquidity && typeof p.liquidity === "object" ? p.liquidity as Record<string, unknown> : {};
        const baseToken = p.baseToken && typeof p.baseToken === "object" ? p.baseToken as Record<string, unknown> : {};
        const mc = Number(p.marketCap ?? p.fdv ?? 0);
        const liq = Number(liquidity.usd ?? 0);
        const base = String(baseToken.address ?? "");
        if (base && (mc >= 50_000 || liq >= 5_000)) alive.add(base);
      }
      for (const m of batch) mark(m, !alive.has(m));
    } catch { /* liveness is best-effort; leave unmarked */ }
  }
}

// Write the whole cluster to the shared graph so it COMPOUNDS: every anon wallet
// is keyed the same way the token audit + investigation graphs key theirs
// (wallet:xxxxxxxx / funder:xxxxxxxx), so a hub that reappears in a separate
// audit collapses to one node and bridges the two operations automatically.
function recordCluster(c: OperatorCluster): void {
  const keyOf = (w: OperatorWallet) => (w.role === "deployer" ? "wallet:" : "funder:") + w.address.slice(0, 8);
  const rootKey = "wallet:" + c.rootDeployer.slice(0, 8);
  const ents = [] as Parameters<typeof recordForensicEntities>[1];
  for (const w of c.wallets) {
    if (w.isRoot || w.role === "cex") continue;
    ents.push({ key: keyOf(w), type: "Identity", subtype: w.role === "deployer" ? "Wallet" : "FunderWallet", edgeType: w.role === "deployer" ? "SIBLING_DEPLOYER" : "FUNDED_BY", label: short(w.address) });
  }
  // Surface the cluster's tokens as nodes too, so a later audit of one of them
  // bridges straight into this operator web.
  for (const t of c.tokens.slice(0, 24)) {
    ents.push({ key: `mint:${t.mint}`, type: "Token", edgeType: "IN_CLUSTER", label: t.name || short(t.mint) });
  }
  if (ents.length) recordForensicEntities(rootKey, ents);
}
