import { useMemo } from "react";
import { labelAddress, explorerAddr } from "../lib/addressLabels";

// A native holder bubble map, from ARGUS's OWN clustering (Bubblemaps went paid).
// Each analyzed top-holder is a bubble sized by its share of supply; wallets the
// clustering tied to one operator share a colour and pull together, with the
// co-funding / direct-transfer links drawn between them. A dependency-free force
// layout, settled synchronously so it renders identically every time.
export type BubbleWallet = { address: string; pct: number; cluster: number | null; isCreator?: boolean };
export type BubbleEdge = { a: string; b: string; type?: string };

const CLUSTER_COLORS = ["#e8b12a", "#f43f5e", "#22d3ee", "#a78bfa", "#34d399", "#fb923c", "#60a5fa", "#f472b6"];
const W = 380, H = 300;

interface Node { id: string; r: number; pct: number; cluster: number | null; isCreator: boolean }
interface XY { x: number; y: number }

const radiusOf = (pct: number) => Math.max(7, Math.min(38, 7 + Math.sqrt(Math.max(0, pct)) * 4.6));

function settle(nodes: Node[], edges: BubbleEdge[]): Map<string, XY> {
  const N = nodes.length || 1;
  const pos = new Map<string, XY>();
  const vel = new Map<string, XY>();
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2;
    pos.set(n.id, { x: W / 2 + Math.cos(a) * W * 0.28, y: H / 2 + Math.sin(a) * H * 0.28 });
    vel.set(n.id, { x: 0, y: 0 });
  });
  const inSet = new Set(nodes.map((n) => n.id));
  const links = edges.filter((e) => inSet.has(e.a) && inSet.has(e.b));
  const SPRING = 0.03, CENTER = 0.012, DAMP = 0.85, COHESION = 0.02, ITER = 500;
  for (let it = 0; it < ITER; it++) {
    // collision-aware repulsion (min gap = sum of radii)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!, b = pos.get(nodes[j].id)!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const min = nodes[i].r + nodes[j].r + 8;
        const f = (2200 / (d * d)) + (d < min ? (min - d) * 0.25 : 0);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        const vi = vel.get(nodes[i].id)!, vj = vel.get(nodes[j].id)!;
        vi.x += fx; vi.y += fy; vj.x -= fx; vj.y -= fy;
      }
    }
    // link springs (clustered wallets attract)
    for (const e of links) {
      const a = pos.get(e.a)!, b = pos.get(e.b)!;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - 54) * SPRING, fx = (dx / d) * f, fy = (dy / d) * f;
      const va = vel.get(e.a)!, vb = vel.get(e.b)!;
      va.x += fx; va.y += fy; vb.x -= fx; vb.y -= fy;
    }
    // cluster cohesion — pull same-cluster nodes toward their centroid
    const cent = new Map<number, { x: number; y: number; n: number }>();
    for (const n of nodes) if (n.cluster != null) { const p = pos.get(n.id)!; const c = cent.get(n.cluster) ?? { x: 0, y: 0, n: 0 }; c.x += p.x; c.y += p.y; c.n++; cent.set(n.cluster, c); }
    for (const n of nodes) {
      const p = pos.get(n.id)!, v = vel.get(n.id)!;
      if (n.cluster != null) { const c = cent.get(n.cluster)!; v.x += (c.x / c.n - p.x) * COHESION; v.y += (c.y / c.n - p.y) * COHESION; }
      v.x += (W / 2 - p.x) * CENTER; v.y += (H / 2 - p.y) * CENTER;
      v.x *= DAMP; v.y *= DAMP; p.x += v.x; p.y += v.y;
    }
  }
  // clamp inside the frame
  for (const n of nodes) { const p = pos.get(n.id)!; p.x = Math.max(n.r + 2, Math.min(W - n.r - 2, p.x)); p.y = Math.max(n.r + 2, Math.min(H - n.r - 2, p.y)); }
  return pos;
}

export function HolderBubbleMap({ wallets, edges, chain }: { wallets: BubbleWallet[]; edges: BubbleEdge[]; chain: string }) {
  const nodes: Node[] = useMemo(
    () => wallets.filter((w) => w.pct > 0 || w.isCreator).slice(0, 30).map((w) => ({ id: w.address, r: radiusOf(w.pct), pct: w.pct, cluster: w.cluster, isCreator: !!w.isCreator })),
    [wallets],
  );
  const pos = useMemo(() => settle(nodes, edges), [nodes, edges]);
  if (nodes.length < 2) return null;
  const color = (c: number | null) => (c == null ? "var(--color-panel-2)" : CLUSTER_COLORS[c % CLUSTER_COLORS.length]);
  const stroke = (c: number | null) => (c == null ? "var(--color-line-2)" : CLUSTER_COLORS[c % CLUSTER_COLORS.length]);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-void/40">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 300 }} role="img" aria-label="holder bubble map">
        {/* links */}
        {edges.map((e, i) => {
          const a = pos.get(e.a), b = pos.get(e.b); if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-line-2)" strokeWidth={e.type === "transfer" ? 1.4 : 1} opacity={0.5} />;
        })}
        {/* bubbles */}
        {nodes.map((n) => {
          const p = pos.get(n.id)!; const lab = labelAddress(n.id).text;
          const showLabel = n.r >= 13;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <a href={explorerAddr(n.id, chain)} target="_blank" rel="noreferrer">
                <title>{lab} · {n.pct.toFixed(1)}%{n.cluster != null ? " · clustered" : ""}{n.isCreator ? " · creator" : ""}</title>
                <circle r={n.r} fill={color(n.cluster)} fillOpacity={n.cluster == null ? 0.5 : 0.28} stroke={stroke(n.cluster)} strokeWidth={n.isCreator ? 2.2 : 1.3} />
                {n.isCreator && <circle r={n.r + 3} fill="none" stroke="var(--color-avoid)" strokeWidth="1" opacity="0.7" />}
                {showLabel && <text textAnchor="middle" dy="0.32em" fontSize={Math.min(11, n.r * 0.55)} fill="var(--color-ink)" className="mono" style={{ pointerEvents: "none" }}>{n.pct.toFixed(0)}%</text>}
              </a>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 px-3 py-1.5 text-[9.5px] text-ink-faint">
        <span>bubble = holder · size = % supply · colour = same operator</span>
        <span className="ml-auto mono">{nodes.length} wallets</span>
      </div>
    </div>
  );
}
