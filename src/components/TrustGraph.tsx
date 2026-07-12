import { useId, useRef, useState } from "react";
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
  TEAM: "team",
  INVESTED_IN: "invested in",
  AFFILIATED_WITH: "affiliated with",
  COMMIT_EMAIL: "commit email",
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

function activateWithKeyboard(event: React.KeyboardEvent, action?: () => void) {
  if (!action || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

function relationshipTone(verdict: unknown): string {
  if (verdict === "Contradicted") return "tint-avoid";
  if (verdict === "Unconfirmed") return "tint-caution";
  if (verdict === "Confirmed" || verdict === "Acknowledged") return "tint-pass";
  return "tint-neutral";
}

// Radial star map with legibility at scale: entities spread over concentric
// rings (one ring drowns at 15+), labels stagger per ring, per-spoke edge
// labels collapse to hover once dense, and the whole map zooms (wheel) and
// pans (drag). A 40-person team page stays readable.
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
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const graphTitleId = useId();
  const graphDescriptionId = useId();
  const ledgerTitleId = useId();

  const subject = nodes.find((n) => n.subject)!;
  if (!subject) return null;

  // Inner rings: direct entities plus one bounded second hop. The second hop is
  // required for correct affiliated-fund attribution (person → fund → project);
  // flattening it into a one-hop star would visually claim a personal investment.
  const seen = new Set<string>([subject.key]);
  const peri: { node: PanoptesNode; edge?: PanoptesEdge; parentKey?: string; depth: 1 | 2 }[] = [];
  for (const e of edges) {
    if (e.src !== subject.key && e.dst !== subject.key) continue;
    const otherKey = e.src === subject.key ? e.dst : e.src;
    if (seen.has(otherKey)) continue;
    const node = nodes.find((n) => n.key === otherKey && !n.subject);
    if (!node) continue;
    seen.add(otherKey);
    peri.push({ node, edge: e, depth: 1 });
  }
  const firstHopKeys = new Set(peri.map((entry) => String(entry.node.key)));
  for (const e of edges) {
    if (peri.length >= 42) break;
    const parentKey = firstHopKeys.has(e.src) ? e.src : firstHopKeys.has(e.dst) ? e.dst : null;
    if (!parentKey) continue;
    const otherKey = e.src === parentKey ? e.dst : e.src;
    if (seen.has(otherKey) || otherKey === subject.key) continue;
    const node = nodes.find((n) => n.key === otherKey && !n.subject);
    if (!node) continue;
    seen.add(otherKey);
    peri.push({ node, edge: e, parentKey, depth: 2 });
  }

  const hasConns = connections.length > 0;
  const dense = peri.length > 12;
  // Concentric rings: ~14 per ring, capped at 3. The canvas grows with them.
  const rings = Math.max(1, Math.min(3, Math.ceil(peri.length / 14)));
  const W = 600;
  const R1 = hasConns ? 112 : 128;
  const RING_GAP = 46;
  const outerR = R1 + (rings - 1) * RING_GAP;
  const H = (hasConns ? 460 : 360) + (rings - 1) * 88;
  const cx = W / 2;
  const cy = H / 2;

  const placed = peri.map((p, i) => {
    const ring = p.depth === 2 ? Math.max(1, i % rings) : i % rings;
    const r = R1 + ring * RING_GAP;
    // Sequential angle over ALL nodes: consecutive entities land on different
    // rings, so angular neighbors never share a radius (labels stop colliding).
    const a = (i / Math.max(peri.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.82, canon: canonical(p.node.key), id: `p${i}` };
  });
  const placedByKey = new Map(placed.map((entry) => [String(entry.node.key), entry]));
  const innerByCanon = new Map(placed.map((p) => [p.canon, p]));

  // outermost ring: other audited subjects connected to this one, anchored to
  // the shared entity that links them (subject -> project -> other person)
  const R2 = outerR + 62;
  const placedConns = connections.map((c, i) => {
    const tie = c.ties.find((t) => innerByCanon.has(t.key));
    if (tie) {
      const inner = innerByCanon.get(tie.key)!;
      const ang = Math.atan2(inner.y - cy, inner.x - cx);
      return { c, x: cx + Math.cos(ang) * R2, y: cy + Math.sin(ang) * R2 * 0.82, viaX: inner.x, viaY: inner.y, id: `c${i}` };
    }
    const a = ((i + 0.5) / connections.length) * Math.PI * 2 - Math.PI / 2;
    return { c, x: cx + Math.cos(a) * (R2 - 30), y: cy + Math.sin(a) * (R2 - 30) * 0.82, viaX: cx, viaY: cy, id: `c${i}` };
  });

  const zoomed = view.k !== 1 || view.x !== 0 || view.y !== 0;
  const labelSize = 9;
  const labelTrunc = dense ? 13 : 16;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    const k = Math.max(0.5, Math.min(4, view.k * (e.deltaY < 0 ? 1.14 : 0.88)));
    setView((v) => ({ k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) }));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = ((e.clientX - pan.current.sx) / rect.width) * W;
    const dy = ((e.clientY - pan.current.sy) / rect.height) * H;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.current.moved = true;
    if (pan.current.moved) setView((v) => ({ ...v, x: pan.current!.vx + dx, y: pan.current!.vy + dy }));
  };
  const onPointerUp = () => { setTimeout(() => { pan.current = null; }, 0); };
  // After a real pan, swallow the click so it doesn't bubble (e.g. into a card).
  const onClickCapture = (e: React.MouseEvent) => {
    if (pan.current?.moved) { e.stopPropagation(); e.preventDefault(); }
  };

  return (
    <div>
      <div className="relative">
        <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="group"
        aria-labelledby={graphTitleId}
        aria-describedby={graphDescriptionId}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClickCapture={onClickCapture}
        style={{ cursor: "grab" }}
      >
        <title id={graphTitleId}>Relationship map for {String(subject.key)}</title>
        <desc id={graphDescriptionId}>
          Interactive relationship map. Navigable people and companies can be opened with Enter or Space. The complete readable relationship ledger follows the map.
        </desc>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* faint ring guides */}
          {Array.from({ length: rings }, (_, ri) => (
            <ellipse key={`rg${ri}`} cx={cx} cy={cy} rx={R1 + ri * RING_GAP} ry={(R1 + ri * RING_GAP) * 0.82} fill="none" stroke="var(--color-line)" strokeWidth="0.6" opacity="0.5" />
          ))}

          {/* inner edges */}
          {placed.map((p, i) => {
            const st = nodeStyle(p.node, p.edge);
            const contradicted = p.edge?.verdict === "Contradicted";
            const unconfirmed = p.edge?.verdict === "Unconfirmed";
            const focused = hover === p.id;
            const faded = hover !== null && !focused;
            const anchor = p.parentKey ? placedByKey.get(p.parentKey) : undefined;
            const x1 = anchor?.x ?? cx;
            const y1 = anchor?.y ?? cy;
            return (
              <g key={`e${i}`} opacity={faded ? 0.25 : 1}>
                <line x1={x1} y1={y1} x2={p.x} y2={p.y} stroke={contradicted ? "var(--color-avoid)" : unconfirmed ? "var(--color-line-2)" : st.ring} strokeWidth={contradicted ? 1.4 : focused ? 1.4 : 1} strokeDasharray={unconfirmed ? "3 4" : contradicted ? "5 3" : undefined} opacity={unconfirmed ? 0.5 : 0.7} />
                {/* per-spoke labels drown at scale: show them all only when sparse,
                    otherwise only on the hovered spoke */}
                {p.edge && (!dense || focused) && (
                  <text x={(x1 + p.x) / 2} y={(y1 + p.y) / 2 - 3} textAnchor="middle" className="mono" fontSize="9" fill={focused ? "var(--color-ink-dim)" : "var(--color-ink-faint)"}>
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
            const focused = hover === p.id;
            const faded = hover !== null && !focused;
            return (
              <g
                key={`n${i}`}
                opacity={faded ? 0.35 : 1}
                onClick={act}
                onKeyDown={(event) => activateWithKeyboard(event, act)}
                onPointerEnter={() => setHover(p.id)}
                onPointerLeave={() => setHover((h) => (h === p.id ? null : h))}
                onFocus={() => setHover(p.id)}
                onBlur={() => setHover((h) => (h === p.id ? null : h))}
                role={act ? "button" : undefined}
                tabIndex={act ? 0 : undefined}
                aria-label={act ? `Open ${String(p.node.key)}. ${p.edge ? EDGE_LABEL[p.edge.type] ?? p.edge.type.toLowerCase() : "Connected entity"}.` : undefined}
                style={{ cursor: act ? "pointer" : "inherit" }}
              >
                <title>{`${p.node.key}${p.edge ? ` · ${EDGE_LABEL[p.edge.type] ?? p.edge.type.toLowerCase()}` : ""}`}</title>
                <circle cx={p.x} cy={p.y} r={focused ? 7 : 6} fill={st.fill} stroke={st.ring} strokeWidth="1.5" />
                {act && <circle cx={p.x} cy={p.y} r={10} fill="none" stroke={st.ring} strokeWidth="1" opacity="0.3" />}
                <text x={p.x} y={p.y + (p.y < cy ? -11 : 17)} textAnchor="middle" className="mono" fontSize={focused ? 9 : labelSize} fontWeight={focused ? 600 : 400} fill={focused ? "var(--color-ink)" : "var(--color-ink-dim)"}>
                  {focused ? trunc(st.label, 26) : trunc(st.label, labelTrunc)}
                </text>
              </g>
            );
          })}

          {/* connected subjects (outermost), clickable to open their audit */}
          {placedConns.map((p, i) => {
            const vm = p.c.otherVerdict;
            const color = vm === "FAIL" || vm === "AVOID" ? "var(--color-avoid)" : vm === "PASS" ? "var(--color-pass)" : "var(--color-caution)";
            const act = onAudit ? () => onAudit(p.c.other) : undefined;
            return (
              <g
                key={`cn${i}`}
                onClick={act}
                onKeyDown={(event) => activateWithKeyboard(event, act)}
                onFocus={() => setHover(p.id)}
                onBlur={() => setHover((h) => (h === p.id ? null : h))}
                role={act ? "button" : undefined}
                tabIndex={act ? 0 : undefined}
                aria-label={act ? `Open connected subject ${p.c.other}. ${p.c.ties.length} shared ${p.c.ties.length === 1 ? "entity" : "entities"}.` : undefined}
                style={{ cursor: act ? "pointer" : "inherit" }}
              >
                <title>{p.c.other}</title>
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
        </g>
        </svg>

        <div className="pointer-events-none absolute bottom-1.5 left-2 text-[11px] text-ink-faint">scroll to zoom · drag to pan{dense ? " · hover or focus a node for its link" : ""}</div>
        {zoomed && (
          <button
            onClick={(e) => { e.stopPropagation(); setView({ x: 0, y: 0, k: 1 }); }}
            className="btn-chip absolute right-2 top-2 bg-panel"
          >
            reset view
          </button>
        )}
      </div>

      <details className="panel-inset mt-3 overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[12.5px] font-medium text-ink">
          <span id={ledgerTitleId}>Relationship ledger</span>
          <span className="mono text-[11px] text-ink-faint">{peri.length + connections.length} links</span>
          <span className="mono ml-auto text-[11px] text-signal-lift">view readable list</span>
        </summary>
        {peri.length === 0 && connections.length === 0 ? (
          <p className="border-t border-line/60 px-3 py-3 text-[12.5px] text-ink-faint">No relationships were recorded for this subject.</p>
        ) : (
          <ul className="divide-y divide-line/60 border-t border-line/60" aria-labelledby={ledgerTitleId}>
            {peri.map((entry, index) => {
              const edge = entry.edge;
              const action = nodeAction(entry.node, onAudit, onOpenProject);
              const relation = edge ? EDGE_LABEL[edge.type] ?? edge.type.toLowerCase() : "connected to";
              const verdict = typeof edge?.verdict === "string" ? edge.verdict : "Observed";
              return (
                <li key={`${entry.depth}:${entry.node.key}:${index}`} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <span className="chip chip-sm">{entry.depth === 1 ? "direct" : "second hop"}</span>
                      <span className="mono text-ink-faint">from</span>
                      <span className="mono truncate text-ink">{edge?.src ?? subject.key}</span>
                      <span className="text-ink-dim">{relation}</span>
                      <span className="mono text-ink-faint">to</span>
                      <span className="mono truncate text-ink">{edge?.dst ?? entry.node.key}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">Entity type: {String(entry.node.type)}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <span className={`chip ${relationshipTone(edge?.verdict)}`}>{verdict}</span>
                    {action && <button onClick={action} className="btn-chip tint-signal">open →</button>}
                  </div>
                </li>
              );
            })}
            {connections.map((connection) => {
              const action = onAudit ? () => onAudit(connection.other) : undefined;
              const verdictTone = connection.otherVerdict === "PASS"
                ? "tint-pass"
                : connection.otherVerdict === "FAIL" || connection.otherVerdict === "AVOID"
                  ? "tint-avoid"
                  : "tint-caution";
              return (
                <li key={`connected:${connection.other}`} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <span className="chip chip-sm">cross-audit</span>
                      <span className="mono text-ink">{String(subject.key)}</span>
                      <span className="text-ink-dim">shares {connection.ties.length} {connection.ties.length === 1 ? "entity" : "entities"} with</span>
                      <span className="mono text-ink">{connection.other}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-ink-faint" title={connection.ties.map((tie) => tie.label).join(", ")}>
                      Via {connection.ties.map((tie) => tie.label).join(", ") || "an unresolved shared entity"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {connection.otherVerdict && <span className={`chip ${verdictTone}`}>{connection.otherVerdict}</span>}
                    {action && <button onClick={action} className="btn-chip tint-signal">open →</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </div>
  );
}
