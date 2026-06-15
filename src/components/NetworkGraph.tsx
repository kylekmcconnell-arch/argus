import { useMemo, useRef, useState, useCallback } from "react";
import type { Network, NetNode } from "../graph/network";
import { verdictMeta } from "../lib/verdict";

// A dependency-free force-directed layout, settled synchronously (fixed
// iterations, deterministic seed) so it renders identically every time with no
// animation-frame dependency. Pan, zoom, hover-to-focus and node-drag are added
// on top of the settled positions.

interface XY { x: number; y: number }

function settle(net: Network, W: number, H: number): Map<string, XY> {
  const nodes = net.nodes;
  const N = nodes.length || 1;
  const pos = new Map<string, XY>();
  const vel = new Map<string, XY>();
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2;
    const r = Math.min(W, H) * 0.32;
    pos.set(n.id, { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r });
    vel.set(n.id, { x: 0, y: 0 });
  });
  const REP = 2600, SPRING = 0.022, DESIRED = 76, CENTER = 0.011, DAMP = 0.86, ITER = 460;
  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!, b = pos.get(nodes[j].id)!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        const f = REP / d2, fx = (dx / d) * f, fy = (dy / d) * f;
        const vi = vel.get(nodes[i].id)!, vj = vel.get(nodes[j].id)!;
        vi.x += fx; vi.y += fy; vj.x -= fx; vj.y -= fy;
      }
    }
    for (const e of net.edges) {
      const a = pos.get(e.src), b = pos.get(e.dst); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - DESIRED) * SPRING, fx = (dx / d) * f, fy = (dy / d) * f;
      const va = vel.get(e.src)!, vb = vel.get(e.dst)!;
      va.x += fx; va.y += fy; vb.x -= fx; vb.y -= fy;
    }
    for (const n of nodes) {
      const p = pos.get(n.id)!, v = vel.get(n.id)!;
      v.x += (W / 2 - p.x) * CENTER; v.y += (H / 2 - p.y) * CENTER;
      v.x *= DAMP; v.y *= DAMP; p.x += v.x; p.y += v.y;
    }
  }
  return pos;
}

function nodeRadius(n: NetNode): number {
  if (n.subject) return 13 + Math.min(8, n.degree * 0.7);
  return 4.5 + Math.min(7, n.degree * 1.3);
}

function nodeColor(n: NetNode): { fill: string; ring: string } {
  if (n.subject) { const c = verdictMeta(n.verdict ?? "INCOMPLETE").color; return { fill: c, ring: c }; }
  if (n.wasRug || n.deception || n.outcome === "Rug") return { fill: "var(--color-avoid)", ring: "var(--color-avoid)" };
  if (n.outcome === "Acquisition" || n.outcome === "IPO") return { fill: "var(--color-pass)", ring: "var(--color-pass)" };
  if (n.flags.includes("bridge")) return { fill: "var(--color-panel-2)", ring: "var(--color-unverifiable)" };
  return { fill: "var(--color-panel-2)", ring: "var(--color-line-2)" };
}

const trunc = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function NetworkGraph({
  net,
  onOpenSubject,
  height = 520,
}: {
  net: Network;
  onOpenSubject?: (handle: string) => void;
  height?: number;
}) {
  const W = 900, H = 560;
  const base = useMemo(() => settle(net, W, H), [net]);
  const [override, setOverride] = useState<Map<string, XY>>(new Map());
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string | null; moved: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const panning = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  const pos = useCallback((id: string): XY => override.get(id) ?? base.get(id) ?? { x: W / 2, y: H / 2 }, [override, base]);

  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of net.edges) {
      (m.get(e.src) ?? m.set(e.src, new Set()).get(e.src)!).add(e.dst);
      (m.get(e.dst) ?? m.set(e.dst, new Set()).get(e.dst)!).add(e.src);
    }
    return m;
  }, [net]);

  const focusSet = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const n of adj.get(hover) ?? []) s.add(n);
    return s;
  }, [hover, adj]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const r = svgRef.current!.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * W;
    const my = (e.clientY - r.top) / r.height * H;
    const k = Math.max(0.45, Math.min(3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    setView((v) => ({ k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) }));
  };

  const onPointerDownNode = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = pos(id);
    drag.current = { id, moved: false, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
  };
  const onPointerDownBg = (e: React.PointerEvent) => {
    panning.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current?.id) {
      const r = svgRef.current!.getBoundingClientRect();
      const dx = (e.clientX - drag.current.sx) / r.width * W / view.k;
      const dy = (e.clientY - drag.current.sy) / r.height * H / view.k;
      if (Math.abs(e.clientX - drag.current.sx) + Math.abs(e.clientY - drag.current.sy) > 3) drag.current.moved = true;
      const id = drag.current.id;
      setOverride((m) => new Map(m).set(id, { x: drag.current!.ox + dx, y: drag.current!.oy + dy }));
    } else if (panning.current) {
      const r = svgRef.current!.getBoundingClientRect();
      const dx = (e.clientX - panning.current.sx) / r.width * W;
      const dy = (e.clientY - panning.current.sy) / r.height * H;
      setView((v) => ({ ...v, x: panning.current!.vx + dx, y: panning.current!.vy + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent, n?: NetNode) => {
    if (n && drag.current && !drag.current.moved && n.subject) onOpenSubject?.(n.key);
    drag.current = null; panning.current = null;
    void e;
  };

  const dim = (id: string) => (focusSet ? !focusSet.has(id) : false);

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel/30" style={{ height }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full touch-none select-none"
        style={{ cursor: panning.current ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e)}
        onPointerLeave={() => { drag.current = null; panning.current = null; }}
      >
        <defs>
          <filter id="ng-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="ng-vignette" cx="50%" cy="42%" r="70%">
            <stop offset="0%" stopColor="var(--color-signal)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--color-signal)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#ng-vignette)" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* edges */}
          {net.edges.map((e, i) => {
            const a = pos(e.src), b = pos(e.dst);
            const faded = focusSet ? !(focusSet.has(e.src) && focusSet.has(e.dst)) : false;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.08;
            const stroke = e.rug ? "var(--color-avoid)" : e.verdict === "Unconfirmed" ? "var(--color-line-2)" : "var(--color-line-2)";
            return (
              <path
                key={`e${i}`}
                d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={e.rug ? 1.6 : 1}
                strokeDasharray={e.verdict === "Unconfirmed" ? "3 4" : e.rug ? "6 3" : undefined}
                opacity={faded ? 0.06 : e.rug ? 0.7 : 0.32}
              />
            );
          })}

          {/* nodes */}
          {net.nodes.map((n) => {
            const p = pos(n.id);
            const r = nodeRadius(n);
            const c = nodeColor(n);
            const faded = dim(n.id);
            const flagged = n.flags.includes("serial") || n.flags.includes("hub") || n.flags.includes("bridge");
            const showLabel = n.subject || n.flags.includes("bridge") || n.flags.includes("hub") || hover === n.id || (focusSet?.has(n.id) ?? false);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={faded ? 0.18 : 1}
                style={{ cursor: n.subject ? "pointer" : "grab" }}
                onPointerDown={(e) => onPointerDownNode(e, n.id)}
                onPointerUp={(e) => onPointerUp(e, n)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                {/* serial / cabal halo */}
                {n.flags.includes("serial") && (
                  <circle r={r + 6} fill="none" stroke="var(--color-caution)" strokeWidth="1.2" opacity="0.5">
                    <animate attributeName="r" values={`${r + 4};${r + 9};${r + 4}`} dur="3.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.5;0.15;0.5" dur="3.2s" repeatCount="indefinite" />
                  </circle>
                )}
                {n.flags.includes("bridge") && !n.flags.includes("serial") && (
                  <circle r={r + 4} fill="none" stroke="var(--color-unverifiable)" strokeWidth="1" opacity="0.55" />
                )}
                {n.subject && <circle r={r + 7} fill="none" stroke={c.ring} strokeWidth="1" opacity="0.22" />}
                <circle
                  r={r}
                  fill={c.fill}
                  stroke={c.ring}
                  strokeWidth={n.subject ? 0 : 1.4}
                  filter={flagged || n.subject ? "url(#ng-glow)" : undefined}
                />
                {showLabel && (
                  <text
                    y={r + (n.subject ? 15 : 11)}
                    textAnchor="middle"
                    className="mono"
                    fontSize={n.subject ? 11 : 8.5}
                    fontWeight={n.subject ? 600 : 400}
                    fill={n.subject ? "var(--color-ink)" : "var(--color-ink-dim)"}
                    style={{ pointerEvents: "none" }}
                  >
                    {trunc(n.key, n.subject ? 18 : 14)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* controls hint + reset */}
      <div className="pointer-events-none absolute bottom-2 left-3 text-[10.5px] text-ink-faint">
        scroll to zoom · drag to pan · drag a node to pull it
      </div>
      {(view.k !== 1 || view.x !== 0 || view.y !== 0 || override.size > 0) && (
        <button
          onClick={() => { setView({ x: 0, y: 0, k: 1 }); setOverride(new Map()); }}
          className="mono absolute bottom-2 right-3 rounded-md border border-line bg-white/80 px-2 py-0.5 text-[10.5px] text-ink-dim backdrop-blur transition hover:text-ink"
        >
          reset view
        </button>
      )}
    </div>
  );
}
