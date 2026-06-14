import type { PanoptesNode, PanoptesEdge } from "../engine";

const EDGE_LABEL: Record<string, string> = {
  ASSOCIATES_WITH: "associates",
  FOUNDED: "founded",
  PROMOTED: "promoted",
  CLAIMED_ENDORSEMENT: "claims endorsement",
  ADVISED: "advised",
  SERVICED: "serviced",
  CONTROLS_WALLET: "wallet",
  FLAGS: "flags",
};

function nodeStyle(n: PanoptesNode, e?: PanoptesEdge): { fill: string; ring: string; label: string } {
  if (n.subject) return { fill: "var(--color-signal)", ring: "var(--color-signal)", label: String(n.key) };
  if (n.type === "DeceptionFinding") return { fill: "var(--color-avoid)", ring: "var(--color-avoid)", label: "deception" };
  if (n.outcome === "Rug" || n.was_rug) return { fill: "var(--color-avoid)", ring: "var(--color-avoid)", label: String(n.key) };
  if (n.outcome === "Acquisition" || n.outcome === "IPO") return { fill: "var(--color-pass)", ring: "var(--color-pass)", label: String(n.key) };
  if (e?.verdict === "Unconfirmed") return { fill: "var(--color-panel-2)", ring: "var(--color-caution)", label: String(n.key) };
  if (e?.verdict === "Contradicted") return { fill: "var(--color-panel-2)", ring: "var(--color-avoid)", label: String(n.key) };
  return { fill: "var(--color-panel-2)", ring: "var(--color-line-2)", label: String(n.key) };
}

export function TrustGraph({ nodes, edges }: { nodes: PanoptesNode[]; edges: PanoptesEdge[] }) {
  const W = 560;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;

  const subject = nodes.find((n) => n.subject)!;
  // dedupe peripheral nodes by key, keep first edge for styling
  const seen = new Set<string>([subject.key]);
  const peri: { node: PanoptesNode; edge?: PanoptesEdge }[] = [];
  for (const e of edges) {
    const otherKey = e.src === subject.key ? e.dst : e.src;
    if (seen.has(otherKey)) continue;
    const node = nodes.find((n) => n.key === otherKey && !n.subject);
    if (!node) continue;
    seen.add(otherKey);
    peri.push({ node, edge: e });
  }

  const R = 138;
  const placed = peri.map((p, i) => {
    const a = (i / peri.length) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.82 };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* edges */}
      {placed.map((p, i) => {
        const st = nodeStyle(p.node, p.edge);
        const contradicted = p.edge?.verdict === "Contradicted";
        const unconfirmed = p.edge?.verdict === "Unconfirmed";
        return (
          <g key={`e${i}`}>
            <line
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke={contradicted ? "var(--color-avoid)" : unconfirmed ? "var(--color-line-2)" : st.ring}
              strokeWidth={contradicted ? 1.4 : 1}
              strokeDasharray={unconfirmed ? "3 4" : contradicted ? "5 3" : undefined}
              opacity={unconfirmed ? 0.5 : 0.7}
            />
            {p.edge && (
              <text
                x={(cx + p.x) / 2}
                y={(cy + p.y) / 2 - 3}
                textAnchor="middle"
                className="mono"
                fontSize="7.5"
                fill="var(--color-ink-faint)"
              >
                {EDGE_LABEL[p.edge.type] ?? p.edge.type.toLowerCase()}
              </text>
            )}
          </g>
        );
      })}

      {/* peripheral nodes */}
      {placed.map((p, i) => {
        const st = nodeStyle(p.node, p.edge);
        const label = st.label.length > 16 ? st.label.slice(0, 15) + "…" : st.label;
        return (
          <g key={`n${i}`}>
            <circle cx={p.x} cy={p.y} r={6} fill={st.fill} stroke={st.ring} strokeWidth="1.5" />
            <text
              x={p.x}
              y={p.y + (p.y < cy ? -11 : 17)}
              textAnchor="middle"
              className="mono"
              fontSize="8.5"
              fill="var(--color-ink-dim)"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* subject */}
      <g>
        <circle cx={cx} cy={cy} r={26} fill="none" stroke="var(--color-signal)" strokeWidth="1" opacity="0.25" />
        <circle cx={cx} cy={cy} r={11} fill="var(--color-signal)" />
        <text x={cx} y={cy + 30} textAnchor="middle" className="mono" fontSize="10" fill="var(--color-ink)">
          {subject.key}
        </text>
      </g>
    </svg>
  );
}
