import type { PanoptesNode, PanoptesEdge } from "../engine";
import { canonical, type SubjectConnection } from "../graph/network";

const EDGE_LABEL: Record<string, string> = {
  ASSOCIATES_WITH: "associates",
  FOUNDED: "founded",
  PROMOTED: "promoted",
  CLAIMED_ENDORSEMENT: "claims endorsement",
  ADVISED: "advised",
  SERVICED: "serviced",
  CONTROLS_WALLET: "wallet",
  FLAGS: "flags",
  WORKED_ON: "worked on",
  FUNDED: "funded",
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

const trunc = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Is this node a navigable entity, and how do we open it?
function nodeAction(n: PanoptesNode, onAudit?: (q: string) => void, onOpenProject?: (name: string) => void): (() => void) | undefined {
  if (n.subject) return undefined;
  const key = String(n.key);
  if ((n.type === "Person" || /^@[A-Za-z0-9_]{2,30}$/.test(key)) && onAudit) return () => onAudit(key);
  if (n.type === "Company" && onOpenProject) return () => onOpenProject(key);
  return undefined;
}

export function TrustGraph({
  nodes,
  edges,
  connections = [],
  onAudit,
  onOpenProject,
}: {
  nodes: PanoptesNode[];
  edges: PanoptesEdge[];
  connections?: SubjectConnection[];
  onAudit?: (q: string) => void;
  onOpenProject?: (name: string) => void;
}) {
  const W = 600;
  const hasConns = connections.length > 0;
  const H = hasConns ? 460 : 360;
  const cx = W / 2;
  const cy = H / 2;

  const subject = nodes.find((n) => n.subject)!;
  if (!subject) return null;

  // inner ring: the subject's own entities (dedup by key, keep first edge)
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

  const R1 = hasConns ? 120 : 138;
  const placed = peri.map((p, i) => {
    const a = (i / Math.max(peri.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: cx + Math.cos(a) * R1, y: cy + Math.sin(a) * R1 * 0.82, canon: canonical(p.node.key) };
  });
  const innerByCanon = new Map(placed.map((p) => [p.canon, p]));

  // outer ring: other audited subjects connected to this one, anchored to the
  // shared entity that links them (so you see subject -> project -> other person)
  const R2 = 205;
  const placedConns = connections.map((c, i) => {
    const tie = c.ties.find((t) => innerByCanon.has(t.key));
    if (tie) {
      const inner = innerByCanon.get(tie.key)!;
      const ang = Math.atan2(inner.y - cy, inner.x - cx);
      return { c, x: cx + Math.cos(ang) * R2, y: cy + Math.sin(ang) * R2 * 0.82, viaX: inner.x, viaY: inner.y };
    }
    const a = ((i + 0.5) / connections.length) * Math.PI * 2 - Math.PI / 2;
    return { c, x: cx + Math.cos(a) * (R2 - 30), y: cy + Math.sin(a) * (R2 - 30) * 0.82, viaX: cx, viaY: cy };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* inner edges */}
      {placed.map((p, i) => {
        const st = nodeStyle(p.node, p.edge);
        const contradicted = p.edge?.verdict === "Contradicted";
        const unconfirmed = p.edge?.verdict === "Unconfirmed";
        return (
          <g key={`e${i}`}>
            <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={contradicted ? "var(--color-avoid)" : unconfirmed ? "var(--color-line-2)" : st.ring} strokeWidth={contradicted ? 1.4 : 1} strokeDasharray={unconfirmed ? "3 4" : contradicted ? "5 3" : undefined} opacity={unconfirmed ? 0.5 : 0.7} />
            {p.edge && (
              <text x={(cx + p.x) / 2} y={(cy + p.y) / 2 - 3} textAnchor="middle" className="mono" fontSize="7.5" fill="var(--color-ink-faint)">
                {EDGE_LABEL[p.edge.type] ?? p.edge.type.toLowerCase()}
              </text>
            )}
          </g>
        );
      })}

      {/* outer edges: shared entity (or center) -> connected subject */}
      {placedConns.map((p, i) => (
        <line key={`ce${i}`} x1={p.viaX} y1={p.viaY} x2={p.x} y2={p.y} stroke="var(--color-signal)" strokeWidth="1" strokeDasharray="2 3" opacity="0.45" />
      ))}

      {/* inner nodes (clickable when navigable) */}
      {placed.map((p, i) => {
        const st = nodeStyle(p.node, p.edge);
        const act = nodeAction(p.node, onAudit, onOpenProject);
        return (
          <g key={`n${i}`} onClick={act} style={{ cursor: act ? "pointer" : "default" }}>
            <circle cx={p.x} cy={p.y} r={6} fill={st.fill} stroke={st.ring} strokeWidth="1.5" />
            {act && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke={st.ring} strokeWidth="1" opacity="0.3" />}
            <text x={p.x} y={p.y + (p.y < cy ? -11 : 17)} textAnchor="middle" className="mono" fontSize="8.5" fill="var(--color-ink-dim)">
              {trunc(st.label)}
            </text>
          </g>
        );
      })}

      {/* connected subjects (outer ring), clickable to open their audit */}
      {placedConns.map((p, i) => {
        const vm = p.c.otherVerdict;
        const color = vm === "FAIL" || vm === "AVOID" ? "var(--color-avoid)" : vm === "PASS" ? "var(--color-pass)" : "var(--color-caution)";
        return (
          <g key={`cn${i}`} onClick={onAudit ? () => onAudit(p.c.other) : undefined} style={{ cursor: onAudit ? "pointer" : "default" }}>
            <circle cx={p.x} cy={p.y} r={7} fill="var(--color-panel-2)" stroke={color} strokeWidth="1.6" />
            <circle cx={p.x} cy={p.y} r={11} fill="none" stroke={color} strokeWidth="1" opacity="0.3" />
            <text x={p.x} y={p.y + (p.y < cy ? -12 : 18)} textAnchor="middle" className="mono" fontSize="9" fill="var(--color-ink)">
              {trunc(p.c.other, 18)}
            </text>
          </g>
        );
      })}

      {/* subject */}
      <g>
        <circle cx={cx} cy={cy} r={26} fill="none" stroke="var(--color-signal)" strokeWidth="1" opacity="0.25" />
        <circle cx={cx} cy={cy} r={11} fill="var(--color-signal)" />
        <text x={cx} y={cy + 30} textAnchor="middle" className="mono" fontSize="10" fill="var(--color-ink)">{trunc(subject.key, 20)}</text>
      </g>
    </svg>
  );
}
