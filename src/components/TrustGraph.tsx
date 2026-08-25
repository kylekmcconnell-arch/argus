import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PanoptesNode, PanoptesEdge } from "../engine";
import { canonical, type SubjectConnection } from "../graph/network";
import { publicEntityLabel, publicRelationshipLabel } from "../lib/plainLanguage";
import { PfpAvatar } from "./PfpCheck";

const HANDLE = /^@[A-Za-z0-9_]{2,30}$/;
export const TRUST_GRAPH_FILTERS = ["people", "companies", "wallets", "risk"] as const;
export type TrustGraphKind = "people" | "companies" | "wallets";
export type TrustGraphFilter = (typeof TRUST_GRAPH_FILTERS)[number];
export type TrustGraphFilterState = Record<TrustGraphFilter, boolean>;
export type TrustGraphMotion = "static" | "enter" | "done";

export const DEFAULT_TRUST_GRAPH_FILTERS: TrustGraphFilterState = {
  people: true,
  companies: true,
  wallets: true,
  risk: true,
};

type PeriEntry = {
  node: PanoptesNode;
  edge?: PanoptesEdge;
  parentKey?: string;
  depth: 1 | 2;
};

export function prefersTrustGraphMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isHandleKey(value: string): boolean {
  return HANDLE.test(value.trim());
}

export function isHighConcentration(edge?: PanoptesEdge): boolean {
  return edge?.risk === "high_concentration"
    || (edge?.type === "HELD_BY" && edge?.verdict === "Contradicted");
}

export function isContradicted(edge?: PanoptesEdge): boolean {
  return edge?.verdict === "Contradicted" && !isHighConcentration(edge);
}

export function trustGraphKind(node: PanoptesNode): TrustGraphKind {
  const key = String(node.key);
  const type = String(node.type || "").toLowerCase();
  const subtype = String(node.subtype ?? "").toLowerCase();
  if (
    /^(wallet|holder|funder):/i.test(key)
    || subtype.includes("wallet")
    || (type === "identity" && (/wallet|holder|funder/.test(subtype) || /:0x/i.test(key) || /^0x[a-f0-9]{8,}$/i.test(key)))
  ) {
    return "wallets";
  }
  if (type === "company" || type === "token" || type === "project") return "companies";
  if (type === "person" || isHandleKey(key)) return "people";
  return "companies";
}

export function trustGraphLinkSentence(edge: PanoptesEdge | undefined, srcLabel: string, dstLabel: string): string {
  if (!edge) return `${srcLabel} is connected to ${dstLabel}.`;
  const relation = publicRelationshipLabel(edge.type);
  const type = String(edge.type).trim().replace(/[\s-]+/g, "_").toUpperCase();
  // Stored TEAM edges run subject → person; the public phrase reads person-first.
  if (type === "TEAM") return `${dstLabel} ${relation} ${srcLabel}.`;
  return `${srcLabel} ${relation} ${dstLabel}.`;
}

export function trustGraphStage(periCount: number, connectionCount = 0): {
  sparse: boolean;
  W: number;
  R1: number;
  ringGap: number;
  subjectSize: number;
  periSize: number;
} {
  const sparse = periCount > 0 && periCount <= 4 && connectionCount === 0;
  return {
    sparse,
    W: sparse ? 720 : 840,
    R1: sparse ? 124 : periCount <= 8 ? 148 : 168,
    ringGap: sparse ? 92 : 82,
    subjectSize: sparse ? 64 : 44,
    periSize: sparse ? 48 : 32,
  };
}

export function trustGraphReadingLine(stats: {
  links: number;
  contradicted: number;
  highConcentrationWallets: number;
}): string {
  if (stats.links === 0) return "No recorded links.";
  const parts = [`${stats.links} recorded link${stats.links === 1 ? "" : "s"}.`];
  if (stats.contradicted) parts.push(`${stats.contradicted} contradicted.`);
  if (stats.highConcentrationWallets) {
    parts.push(`${stats.highConcentrationWallets} high-concentration wallet${stats.highConcentrationWallets === 1 ? "" : "s"}.`);
  }
  return parts.join(" ");
}

export function collectTrustGraphHops(nodes: PanoptesNode[], edges: PanoptesEdge[], subjectKey: string): PeriEntry[] {
  const seen = new Set<string>([subjectKey]);
  const peri: PeriEntry[] = [];
  for (const edge of edges) {
    if (edge.src !== subjectKey && edge.dst !== subjectKey) continue;
    const otherKey = edge.src === subjectKey ? edge.dst : edge.src;
    if (seen.has(otherKey)) continue;
    const node = nodes.find((candidate) => candidate.key === otherKey && !candidate.subject);
    if (!node) continue;
    seen.add(otherKey);
    peri.push({ node, edge, depth: 1 });
  }
  const firstHopKeys = new Set(peri.map((entry) => String(entry.node.key)));
  for (const edge of edges) {
    if (peri.length >= 42) break;
    const parentKey = firstHopKeys.has(edge.src) ? edge.src : firstHopKeys.has(edge.dst) ? edge.dst : null;
    if (!parentKey) continue;
    const otherKey = edge.src === parentKey ? edge.dst : edge.src;
    if (seen.has(otherKey) || otherKey === subjectKey) continue;
    const node = nodes.find((candidate) => candidate.key === otherKey && !candidate.subject);
    if (!node) continue;
    seen.add(otherKey);
    peri.push({ node, edge, parentKey, depth: 2 });
  }
  return peri;
}

function nodeLabel(node: PanoptesNode): string {
  return publicEntityLabel(
    String(node.key),
    String(node.type),
    typeof node.label === "string" ? node.label : undefined,
  );
}

function relationshipTone(verdict: unknown): string {
  if (verdict === "Contradicted") return "tint-avoid";
  if (verdict === "Unconfirmed") return "tint-caution";
  if (verdict === "Confirmed" || verdict === "Acknowledged") return "tint-pass";
  return "tint-neutral";
}

function relationshipStatus(edge?: PanoptesEdge): { label: string; tone: string } {
  if (isHighConcentration(edge)) return { label: "High concentration", tone: "tint-caution" };
  if (typeof edge?.verdict === "string") return { label: edge.verdict, tone: relationshipTone(edge.verdict) };
  return { label: "Observed", tone: "tint-neutral" };
}

function edgeStroke(edge?: PanoptesEdge, fallback = "var(--color-line-2)"): string {
  if (isHighConcentration(edge)) return "var(--color-caution)";
  if (isContradicted(edge)) return "var(--color-avoid)";
  if (edge?.verdict === "Unconfirmed") return "var(--color-line-2)";
  if (edge?.verdict === "Confirmed" || edge?.verdict === "Acknowledged") return "var(--color-pass)";
  return fallback;
}

function edgeDash(edge?: PanoptesEdge): string | undefined {
  if (edge?.verdict === "Unconfirmed") return "4 5";
  if (isContradicted(edge)) return "6 4";
  return undefined;
}

function kindNoun(kind: TrustGraphKind): string {
  if (kind === "people") return "person";
  if (kind === "wallets") return "wallet";
  return "company";
}

function trunc(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function letterFrom(label: string): string {
  const cleaned = label.replace(/^[@$]/, "").trim();
  return (cleaned[0] ?? "?").toUpperCase();
}

function safeSourceLink(value: unknown): { href: string; label: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.hostname
      && !parsed.username
      && !parsed.password
    ) {
      return {
        href: parsed.href,
        label: `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
      };
    }
  } catch {
    // Malformed sources stay visible as unavailable metadata.
  }
  return null;
}

function nodeAction(node: PanoptesNode, onAudit?: (q: string) => void, onOpenProject?: (name: string) => void): (() => void) | undefined {
  if (node.subject) return undefined;
  const key = String(node.key);
  if (isHandleKey(key) && onAudit) return () => onAudit(key);
  if (node.type === "Company" && onOpenProject) return () => onOpenProject(key);
  return undefined;
}

function activateWithKeyboard(event: React.KeyboardEvent, action?: () => void) {
  if (!action || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

function nodeStyle(node: PanoptesNode, edge?: PanoptesEdge): { fill: string; ring: string; label: string } {
  const label = nodeLabel(node);
  if (node.subject) return { fill: "var(--color-signal)", ring: "var(--color-signal)", label };
  if (node.type === "DeceptionFinding") return { fill: "var(--color-avoid)", ring: "var(--color-avoid)", label: "deception" };
  if (node.outcome === "Rug" || node.was_rug) return { fill: "var(--color-avoid)", ring: "var(--color-avoid)", label };
  if (node.outcome === "Acquisition" || node.outcome === "IPO") return { fill: "var(--color-pass)", ring: "var(--color-pass)", label };
  if (edge?.verdict === "Unconfirmed") return { fill: "var(--color-panel-2)", ring: "var(--color-caution)", label };
  if (isHighConcentration(edge)) return { fill: "var(--color-panel-2)", ring: "var(--color-caution)", label };
  if (isContradicted(edge)) return { fill: "var(--color-panel-2)", ring: "var(--color-avoid)", label };
  return { fill: "var(--color-panel-2)", ring: "var(--color-line-2)", label };
}

function filteredOut(kind: TrustGraphKind, risk: boolean, filters: TrustGraphFilterState): boolean {
  if (!filters[kind]) return true;
  if (risk && !filters.risk) return true;
  return false;
}

function IdentityFace({
  label,
  handle,
  size,
  panelCostToken,
}: {
  label: string;
  handle?: string;
  size: number;
  panelCostToken?: string;
}) {
  if (handle) {
    return <PfpAvatar handle={handle} size={size} panelCostToken={panelCostToken} />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center rounded-full border border-line bg-panel-2 font-medium text-signal-lift"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
    >
      {letterFrom(label)}
    </span>
  );
}

function CompanyMark({ x, y, size, fill, ring }: { x: number; y: number; size: number; fill: string; ring: string }) {
  const half = size / 2;
  const u = size / 22;
  return (
    <g>
      <rect x={x - half} y={y - half} width={size} height={size} rx={Math.max(5, size * 0.16)} fill={fill} stroke={ring} strokeWidth="1.8" />
      <path
        d={`M${x - 5 * u} ${y + 5 * u} V${y - 2 * u} H${x - 1 * u} V${y + 5 * u} M${x + 1 * u} ${y + 5 * u} V${y - 5 * u} H${x + 5 * u} V${y + 5 * u}`}
        fill="none"
        stroke={ring}
        strokeWidth="1.4"
        opacity="0.85"
      />
    </g>
  );
}

function WalletMark({ x, y, size, fill, ring, letter }: { x: number; y: number; size: number; fill: string; ring: string; letter: string }) {
  const r = size / 2;
  const points = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${x + Math.cos(a) * r},${y + Math.sin(a) * r}`;
  }).join(" ");
  return (
    <g>
      <polygon points={points} fill={fill} stroke={ring} strokeWidth="2" />
      <text x={x} y={y + size * 0.18} textAnchor="middle" fontSize={Math.max(12, size * 0.38)} fontWeight={600} fill="var(--color-ink)">{letter}</text>
    </g>
  );
}

// Radial rings stay hop-honest: first hop on the inner rings, second hop on the
// next ring near its via-parent. Flattening person → fund → project into one
// spoke would visually claim a personal investment.
export function TrustGraph({
  nodes,
  edges,
  connections = [],
  onAudit,
  onOpenProject,
  panelCostToken,
}: {
  nodes: PanoptesNode[];
  edges: PanoptesEdge[];
  connections?: SubjectConnection[];
  onAudit?: (q: string) => void;
  onOpenProject?: (name: string) => void;
  panelCostToken?: string;
}) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<TrustGraphFilterState>(DEFAULT_TRUST_GRAPH_FILTERS);
  const [motion, setMotion] = useState<TrustGraphMotion>("static");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const graphTitleId = useId();
  const graphDescriptionId = useId();
  const ledgerTitleId = useId();
  const inspectorTitleId = useId();
  const readingLineId = useId();

  const subject = nodes.find((node) => node.subject);
  const peri = useMemo(
    () => (subject ? collectTrustGraphHops(nodes, edges, String(subject.key)) : []),
    [edges, nodes, subject],
  );

  useLayoutEffect(() => {
    if (!prefersTrustGraphMotion()) {
      setMotion("static");
      return;
    }
    setMotion("enter");
    const timer = window.setTimeout(() => setMotion("done"), 920);
    return () => window.clearTimeout(timer);
  }, []);

  if (!subject) return null;
  const subjectLabel = nodeLabel(subject);
  const subjectHandle = isHandleKey(String(subject.key)) ? String(subject.key) : undefined;
  const parentByKey = new Map(peri.map((entry) => [String(entry.node.key), entry]));

  const stats = {
    links: peri.length + connections.length,
    contradicted: peri.filter((entry) => isContradicted(entry.edge)).length,
    highConcentrationWallets: peri.filter((entry) => isHighConcentration(entry.edge) && trustGraphKind(entry.node) === "wallets").length,
  };
  const readingLine = trustGraphReadingLine(stats);
  const empty = peri.length === 0 && connections.length === 0;

  const firstHops = peri.filter((entry) => entry.depth === 1);
  const secondHops = peri.filter((entry) => entry.depth === 2);
  const firstRings = Math.max(1, Math.min(2, Math.ceil(firstHops.length / 14)));
  const stage = trustGraphStage(peri.length, connections.length);
  const W = stage.W;
  const R1 = empty ? 0 : stage.R1;
  const RING_GAP = stage.ringGap;
  const secondR = R1 + firstRings * RING_GAP;
  const outerR = connections.length > 0 ? secondR + 74 : secondR;
  const H = empty
    ? 360
    : Math.max(stage.sparse ? 428 : 520, Math.round(outerR * 2 * 0.82 + stage.subjectSize + 120));
  const cx = W / 2;
  const cy = H / 2;
  const subjectSize = stage.subjectSize;
  const periSize = stage.periSize;

  const placedFirst = firstHops.map((entry, index) => {
    const ring = index % firstRings;
    const radius = R1 + ring * RING_GAP;
    const angle = (index / Math.max(firstHops.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      ...entry,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius * 0.82,
      angle,
      canon: canonical(entry.node.key),
      id: `p:${entry.node.key}`,
    };
  });
  const firstByKey = new Map(placedFirst.map((entry) => [String(entry.node.key), entry]));
  const childrenByParent = new Map<string, PeriEntry[]>();
  for (const entry of secondHops) {
    const parentKey = entry.parentKey ?? "";
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(entry);
    childrenByParent.set(parentKey, list);
  }
  const placedSecond = secondHops.map((entry) => {
    const siblings = childrenByParent.get(entry.parentKey ?? "") ?? [entry];
    const siblingIndex = siblings.indexOf(entry);
    const parent = firstByKey.get(String(entry.parentKey));
    const spread = (siblingIndex - (siblings.length - 1) / 2) * 0.24;
    const angle = (parent?.angle ?? 0) + spread;
    return {
      ...entry,
      x: cx + Math.cos(angle) * secondR,
      y: cy + Math.sin(angle) * secondR * 0.82,
      angle,
      canon: canonical(entry.node.key),
      id: `p:${entry.node.key}`,
    };
  });
  const placed = [...placedFirst, ...placedSecond];
  const placedByKey = new Map(placed.map((entry) => [String(entry.node.key), entry]));
  const innerByCanon = new Map(placed.map((entry) => [entry.canon, entry]));

  const placedConns = connections.map((connection, index) => {
    const tie = connection.ties.find((item) => innerByCanon.has(item.key));
    if (tie) {
      const inner = innerByCanon.get(tie.key)!;
      const angle = Math.atan2(inner.y - cy, inner.x - cx);
      return { c: connection, x: cx + Math.cos(angle) * outerR, y: cy + Math.sin(angle) * outerR * 0.82, viaX: inner.x, viaY: inner.y, id: `c:${connection.other}` };
    }
    const angle = ((index + 0.5) / Math.max(connections.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { c: connection, x: cx + Math.cos(angle) * (outerR - 28), y: cy + Math.sin(angle) * (outerR - 28) * 0.82, viaX: cx, viaY: cy, id: `c:${connection.other}` };
  });

  const zoomed = view.k !== 1 || view.x !== 0 || view.y !== 0;
  const focusId = selected ?? hover;
  const selectedEntry = placed.find((entry) => entry.id === selected);
  const selectedConn = placedConns.find((entry) => entry.id === selected);

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * W;
    const my = ((event.clientY - rect.top) / rect.height) * H;
    const k = Math.max(0.5, Math.min(4, view.k * (event.deltaY < 0 ? 1.14 : 0.88)));
    setView((current) => ({ k, x: mx - (mx - current.x) * (k / current.k), y: my - (my - current.y) * (k / current.k) }));
  };
  const onPointerDown = (event: React.PointerEvent) => {
    pan.current = { sx: event.clientX, sy: event.clientY, vx: view.x, vy: view.y, moved: false };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!pan.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = ((event.clientX - pan.current.sx) / rect.width) * W;
    const dy = ((event.clientY - pan.current.sy) / rect.height) * H;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.current.moved = true;
    if (pan.current.moved) setView((current) => ({ ...current, x: pan.current!.vx + dx, y: pan.current!.vy + dy }));
  };
  const onPointerUp = () => { setTimeout(() => { pan.current = null; }, 0); };
  const onClickCapture = (event: React.MouseEvent) => {
    if (pan.current?.moved) { event.stopPropagation(); event.preventDefault(); }
  };

  const selectId = (id: string) => {
    if (pan.current?.moved) return;
    setSelected(id);
  };

  const pathLit = (entry: (typeof placed)[number]): boolean => {
    if (!focusId) return false;
    if (entry.id === focusId) return true;
    const focused = placed.find((item) => item.id === focusId);
    return Boolean(focused?.parentKey && focused.parentKey === entry.node.key);
  };

  const toggleFilter = (key: TrustGraphFilter) => {
    setFilters((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="trust-graph" data-trust-graph-motion={motion} data-trust-graph-sparse={stage.sparse ? "true" : "false"}>
      <p id={readingLineId} className="text-[13.5px] leading-relaxed text-ink">
        {readingLine}{" "}
        <span className="text-ink-dim">A link by itself does not mean wrongdoing.</span>
      </p>

      {!empty && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Connection filters">
          {TRUST_GRAPH_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters[key]}
              onClick={() => toggleFilter(key)}
              className={`btn-chip capitalize ${filters[key] ? "tint-signal" : ""}`}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="trust-graph-stage w-full touch-none select-none"
          role="group"
          aria-labelledby={`${graphTitleId} ${readingLineId}`}
          aria-describedby={graphDescriptionId}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClickCapture={onClickCapture}
          style={{ cursor: "grab" }}
        >
          <title id={graphTitleId}>{`Relationship map for ${subjectLabel}`}</title>
          <desc id={graphDescriptionId}>
            Interactive relationship map. Enter or Space selects a person, company, or wallet. Opening an audit is a separate control. The complete readable relationship ledger follows the map.
          </desc>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {!empty && Array.from({ length: firstRings + (secondHops.length ? 1 : 0) }, (_, ring) => (
              <ellipse
                key={`rg${ring}`}
                className="trust-graph-ring"
                cx={cx}
                cy={cy}
                rx={R1 + ring * RING_GAP}
                ry={(R1 + ring * RING_GAP) * 0.82}
                fill="none"
                stroke="var(--color-line)"
                strokeWidth="0.8"
                opacity="0.45"
              />
            ))}

            {placed.map((entry, index) => {
              const kind = trustGraphKind(entry.node);
              const risk = isHighConcentration(entry.edge) || isContradicted(entry.edge);
              const hidden = filteredOut(kind, risk, filters);
              const lit = pathLit(entry) || hover === entry.id || selected === entry.id;
              const faded = hidden || (focusId !== null && !lit && hover !== entry.id && selected !== entry.id);
              const parent = entry.parentKey ? placedByKey.get(entry.parentKey) : undefined;
              const x1 = parent?.x ?? cx;
              const y1 = parent?.y ?? cy;
              const length = Math.hypot(entry.x - x1, entry.y - y1);
              return (
                <g key={`e${entry.id}`} className="trust-graph-edge" style={{ animationDelay: `${80 + index * 36}ms` }} opacity={faded ? 0.12 : 1}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={entry.x}
                    y2={entry.y}
                    stroke={edgeStroke(entry.edge, nodeStyle(entry.node, entry.edge).ring)}
                    strokeWidth={lit ? (stage.sparse ? 4 : 3.2) : isHighConcentration(entry.edge) || isContradicted(entry.edge) ? 2.4 : stage.sparse ? 2.2 : 1.4}
                    strokeDasharray={edgeDash(entry.edge)}
                    strokeLinecap="round"
                    opacity={entry.edge?.verdict === "Unconfirmed" ? 0.55 : 0.88}
                    pathLength={length || 1}
                  />
                  {entry.edge && (lit || peri.length <= 12) && (
                    <text
                      x={(x1 + entry.x) / 2}
                      y={(y1 + entry.y) / 2 - 6}
                      textAnchor="middle"
                      fontSize={stage.sparse ? 12 : 10}
                      fill={lit ? "var(--color-ink)" : "var(--color-ink-faint)"}
                    >
                      {publicRelationshipLabel(entry.edge.type)}
                    </text>
                  )}
                </g>
              );
            })}

            {placedConns.map((entry, index) => {
              const lit = selected === entry.id || hover === entry.id;
              return (
                <line
                  key={`ce${entry.id}`}
                  className="trust-graph-edge"
                  style={{ animationDelay: `${120 + index * 36}ms` }}
                  x1={entry.viaX}
                  y1={entry.viaY}
                  x2={entry.x}
                  y2={entry.y}
                  stroke="var(--color-signal)"
                  strokeWidth={lit ? 2.4 : 1.2}
                  strokeDasharray="3 4"
                  opacity={focusId && !lit ? 0.16 : 0.5}
                />
              );
            })}

            {placed.map((entry, index) => {
              const kind = trustGraphKind(entry.node);
              const risk = isHighConcentration(entry.edge) || isContradicted(entry.edge);
              const hidden = filteredOut(kind, risk, filters);
              const st = nodeStyle(entry.node, entry.edge);
              const lit = hover === entry.id || selected === entry.id || pathLit(entry);
              const faded = hidden || (focusId !== null && !lit);
              const handle = kind === "people" && isHandleKey(String(entry.node.key)) ? String(entry.node.key) : undefined;
              return (
                <g
                  key={`n${entry.id}`}
                  className="trust-graph-node"
                  data-node-key={String(entry.node.key)}
                  data-depth={entry.depth}
                  data-kind={kind}
                  data-filtered={hidden ? "true" : "false"}
                  style={{ animationDelay: `${140 + index * 42}ms`, cursor: "pointer" }}
                  opacity={faded ? 0.16 : 1}
                  onClick={() => selectId(entry.id)}
                  onKeyDown={(event) => activateWithKeyboard(event, () => setSelected(entry.id))}
                  onPointerEnter={() => setHover(entry.id)}
                  onPointerLeave={() => setHover((current) => (current === entry.id ? null : current))}
                  onFocus={() => setHover(entry.id)}
                  onBlur={() => setHover((current) => (current === entry.id ? null : current))}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === entry.id}
                  aria-label={`Select ${st.label}. ${entry.edge ? publicRelationshipLabel(entry.edge.type) : "Connected entity"}. ${entry.depth === 1 ? "Direct link" : "Second hop"}.`}
                >
                  <title>{`${st.label}${entry.edge ? ` · ${publicRelationshipLabel(entry.edge.type)}` : ""}`}</title>
                  {kind === "people" ? (
                    <>
                      <circle cx={entry.x} cy={entry.y} r={periSize / 2 + (lit ? 6 : 4)} fill="none" stroke={st.ring} strokeWidth={lit ? 2.4 : 1.6} opacity="0.55" />
                      <foreignObject x={entry.x - periSize / 2} y={entry.y - periSize / 2} width={periSize} height={periSize} overflow="visible">
                        <div className="flex items-center justify-center" style={{ width: periSize, height: periSize }}>
                          <IdentityFace label={st.label} handle={handle} size={periSize} panelCostToken={panelCostToken} />
                        </div>
                      </foreignObject>
                    </>
                  ) : kind === "wallets" ? (
                    <WalletMark x={entry.x} y={entry.y} size={lit ? periSize + 4 : periSize} fill="color-mix(in oklab, var(--color-signal) 10%, var(--color-panel-2))" ring={st.ring} letter={letterFrom(st.label)} />
                  ) : (
                    <CompanyMark x={entry.x} y={entry.y} size={lit ? periSize + 4 : periSize} fill={st.fill} ring={st.ring} />
                  )}
                  <text
                    x={entry.x}
                    y={entry.y + (entry.y < cy ? -(periSize / 2 + 16) : periSize / 2 + 20)}
                    textAnchor="middle"
                    fontSize={stage.sparse || lit ? 13 : 11}
                    fontWeight={lit ? 600 : 500}
                    fill={lit ? "var(--color-ink)" : "var(--color-ink-dim)"}
                  >
                    {trunc(st.label, stage.sparse || lit ? 28 : 22)}
                  </text>
                </g>
              );
            })}

            {placedConns.map((entry) => {
              const vm = entry.c.otherVerdict;
              const color = vm === "FAIL" || vm === "AVOID" ? "var(--color-avoid)" : vm === "PASS" ? "var(--color-pass)" : "var(--color-caution)";
              const handle = isHandleKey(entry.c.other) ? entry.c.other : undefined;
              const lit = selected === entry.id || hover === entry.id;
              return (
                <g
                  key={`cn${entry.id}`}
                  className="trust-graph-node"
                  data-node-key={entry.c.other}
                  style={{ cursor: "pointer" }}
                  onClick={() => selectId(entry.id)}
                  onKeyDown={(event) => activateWithKeyboard(event, () => setSelected(entry.id))}
                  onFocus={() => setHover(entry.id)}
                  onBlur={() => setHover((current) => (current === entry.id ? null : current))}
                  onPointerEnter={() => setHover(entry.id)}
                  onPointerLeave={() => setHover((current) => (current === entry.id ? null : current))}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === entry.id}
                  aria-label={`Select connected subject ${entry.c.other}. ${entry.c.ties.length} shared ${entry.c.ties.length === 1 ? "entity" : "entities"}.`}
                >
                  <title>{entry.c.other}</title>
                  <circle cx={entry.x} cy={entry.y} r={lit ? 20 : 17} fill="none" stroke={color} strokeWidth="1.8" opacity="0.45" />
                  <foreignObject x={entry.x - 16} y={entry.y - 16} width="32" height="32" overflow="visible">
                    <div className="flex h-8 w-8 items-center justify-center">
                      <IdentityFace label={entry.c.other} handle={handle} size={32} panelCostToken={panelCostToken} />
                    </div>
                  </foreignObject>
                  <text x={entry.x} y={entry.y + (entry.y < cy ? -24 : 30)} textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--color-ink)">
                    {trunc(entry.c.other, 22)}
                  </text>
                </g>
              );
            })}

            <g className="trust-graph-node trust-graph-subject" data-node-key={String(subject.key)}>
              <circle className="trust-graph-halo" cx={cx} cy={cy} r={subjectSize / 2 + 18} fill="none" stroke="var(--color-signal)" strokeWidth="1.4" opacity="0.22" />
              <circle cx={cx} cy={cy} r={subjectSize / 2 + 8} fill="none" stroke="var(--color-signal)" strokeWidth="1.8" opacity="0.4" />
              <foreignObject x={cx - subjectSize / 2} y={cy - subjectSize / 2} width={subjectSize} height={subjectSize} overflow="visible">
                <div className="flex items-center justify-center" style={{ width: subjectSize, height: subjectSize }}>
                  {subjectHandle ? (
                    <IdentityFace label={subjectLabel} handle={subjectHandle} size={subjectSize} panelCostToken={panelCostToken} />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex items-center justify-center rounded-full border border-signal bg-signal font-semibold text-on-signal"
                      style={{ width: subjectSize, height: subjectSize, fontSize: Math.round(subjectSize * 0.34) }}
                    >
                      {letterFrom(subjectLabel)}
                    </span>
                  )}
                </div>
              </foreignObject>
              <text x={cx} y={cy + subjectSize / 2 + 20} textAnchor="middle" fontSize={stage.sparse ? 15 : 13} fontWeight={600} fill="var(--color-ink)">
                {trunc(subjectLabel, 28)}
              </text>
            </g>
          </g>
        </svg>

        <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-ink-faint">
          scroll to zoom · drag to pan · select a node to inspect it
        </div>
        {zoomed && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setView({ x: 0, y: 0, k: 1 }); }}
            className="btn-chip absolute right-2 top-2 bg-panel"
          >
            reset view
          </button>
        )}
      </div>

      {selectedEntry && (
        <Inspector
          titleId={inspectorTitleId}
          panelCostToken={panelCostToken}
          name={nodeStyle(selectedEntry.node, selectedEntry.edge).label}
          kind={trustGraphKind(selectedEntry.node)}
          handle={trustGraphKind(selectedEntry.node) === "people" && isHandleKey(String(selectedEntry.node.key)) ? String(selectedEntry.node.key) : undefined}
          depth={selectedEntry.depth}
          parentLabel={selectedEntry.parentKey ? nodeLabel(parentByKey.get(selectedEntry.parentKey)?.node ?? { type: "Company", key: selectedEntry.parentKey }) : undefined}
          subjectLabel={subjectLabel}
          how={trustGraphLinkSentence(
            selectedEntry.edge,
            publicEntityLabel(String(selectedEntry.edge?.src ?? subject.key)),
            publicEntityLabel(
              String(selectedEntry.edge?.dst ?? selectedEntry.node.key),
              String(selectedEntry.node.type),
              typeof selectedEntry.node.label === "string" ? selectedEntry.node.label : undefined,
            ),
          )}
          status={relationshipStatus(selectedEntry.edge)}
          source={safeSourceLink(selectedEntry.edge?.source_url)}
          openLabel={nodeAction(selectedEntry.node, onAudit, onOpenProject) ? `Open ${nodeStyle(selectedEntry.node, selectedEntry.edge).label}` : undefined}
          onOpen={nodeAction(selectedEntry.node, onAudit, onOpenProject)}
          onDismiss={() => setSelected(null)}
        />
      )}
      {selectedConn && (
        <Inspector
          titleId={inspectorTitleId}
          panelCostToken={panelCostToken}
          name={selectedConn.c.other}
          kind="people"
          handle={isHandleKey(selectedConn.c.other) ? selectedConn.c.other : undefined}
          depth={2}
          parentLabel={selectedConn.c.ties.map((tie) => tie.label).join(", ") || undefined}
          subjectLabel={subjectLabel}
          how={`${subjectLabel} shares ${selectedConn.c.ties.length} ${selectedConn.c.ties.length === 1 ? "entity" : "entities"} with ${selectedConn.c.other}.`}
          status={{
            label: selectedConn.c.otherVerdict ?? "Observed",
            tone: selectedConn.c.otherVerdict === "PASS"
              ? "tint-pass"
              : selectedConn.c.otherVerdict === "FAIL" || selectedConn.c.otherVerdict === "AVOID"
                ? "tint-avoid"
                : "tint-caution",
          }}
          source={null}
          openLabel={onAudit ? `Open ${selectedConn.c.other}` : undefined}
          onOpen={onAudit ? () => onAudit(selectedConn.c.other) : undefined}
          onDismiss={() => setSelected(null)}
          extra={`Via ${selectedConn.c.ties.map((tie) => tie.label).join(", ") || "an unresolved shared entity"}.`}
        />
      )}

      <section className="panel-inset mt-3 overflow-hidden" aria-labelledby={ledgerTitleId}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <h3 id={ledgerTitleId} className="text-[12.5px] font-medium text-ink">Recorded connections</h3>
          <span className="mono text-[11px] text-ink-faint">{stats.links} links</span>
        </div>
        {empty ? (
          <p className="empty-state mx-3 mb-3">No relationships were recorded for this subject.</p>
        ) : (
          <ul className="divide-y divide-line/60 border-t border-line/60">
            {peri.map((entry, index) => {
              const edge = entry.edge;
              const action = nodeAction(entry.node, onAudit, onOpenProject);
              const status = relationshipStatus(edge);
              const sourceLabel = publicEntityLabel(String(edge?.src ?? subject.key));
              const targetLabel = nodeLabel(entry.node);
              const sentence = trustGraphLinkSentence(edge, sourceLabel, targetLabel);
              const rowId = `p:${entry.node.key}`;
              return (
                <li key={`${entry.depth}:${entry.node.key}:${index}`} className={`grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${selected === rowId ? "bg-panel" : ""}`}>
                  <button type="button" className="min-w-0 text-left" onClick={() => setSelected(rowId)} aria-current={selected === rowId ? "true" : undefined}>
                    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <span className="chip chip-sm">{entry.depth === 1 ? "direct" : "second hop"}</span>
                      <span className="truncate text-ink">{sentence}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {entry.depth === 2 && entry.parentKey
                        ? `Second hop via ${nodeLabel(parentByKey.get(entry.parentKey)?.node ?? { type: "Company", key: entry.parentKey })}`
                        : `${kindNoun(trustGraphKind(entry.node))} connection`}
                    </p>
                    {edge && (
                      <details className="mt-1 text-[10px] text-ink-faint">
                        <summary className="cursor-pointer">Technical IDs</summary>
                        <p className="mt-1 break-all font-mono">{edge.src} · {edge.type} · {edge.dst}</p>
                      </details>
                    )}
                  </button>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <span className={`chip ${status.tone}`}>{status.label}</span>
                    {action && <button type="button" onClick={action} className="btn-chip tint-signal">open →</button>}
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
              const rowId = `c:${connection.other}`;
              return (
                <li key={`connected:${connection.other}`} className={`grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${selected === rowId ? "bg-panel" : ""}`}>
                  <button type="button" className="min-w-0 text-left" onClick={() => setSelected(rowId)} aria-current={selected === rowId ? "true" : undefined}>
                    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <span className="chip chip-sm">cross-audit</span>
                      <span className="text-ink">{subjectLabel}</span>
                      <span className="text-ink-dim">shares {connection.ties.length} {connection.ties.length === 1 ? "entity" : "entities"} with</span>
                      <span className="mono text-ink">{connection.other}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-ink-faint" title={connection.ties.map((tie) => tie.label).join(", ")}>
                      Via {connection.ties.map((tie) => tie.label).join(", ") || "an unresolved shared entity"}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {connection.otherVerdict && <span className={`chip ${verdictTone}`}>{connection.otherVerdict}</span>}
                    {action && <button type="button" onClick={action} className="btn-chip tint-signal">open →</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Inspector({
  titleId,
  panelCostToken,
  name,
  kind,
  handle,
  depth,
  parentLabel,
  subjectLabel,
  how,
  status,
  source,
  openLabel,
  onOpen,
  onDismiss,
  extra,
}: {
  titleId: string;
  panelCostToken?: string;
  name: string;
  kind: TrustGraphKind;
  handle?: string;
  depth: 1 | 2;
  parentLabel?: string;
  subjectLabel: string;
  how: string;
  status: { label: string; tone: string };
  source: { href: string; label: string } | null;
  openLabel?: string;
  onOpen?: () => void;
  onDismiss: () => void;
  extra?: string;
}) {
  const hop = depth === 1 ? "Direct link to the subject." : `Second hop via ${parentLabel ?? "another recorded entity"}.`;
  const explanation = depth === 2
    ? `${name} connects through ${parentLabel ?? "another recorded entity"}, not directly to ${subjectLabel}. ${how}`
    : how;
  return (
    <aside className="panel mt-3 p-4" aria-labelledby={titleId} data-trust-graph-inspector="true">
      <div className="flex items-start gap-3">
        {kind === "people" ? (
          <IdentityFace label={name} handle={handle} size={48} panelCostToken={panelCostToken} />
        ) : (
          <span
            aria-hidden="true"
            className={`flex shrink-0 items-center justify-center border border-line bg-panel-2 text-[13px] font-medium text-signal-lift ${kind === "wallets" ? "rounded-[10px]" : "rounded-md"}`}
            style={{ width: 48, height: 48 }}
          >
            {letterFrom(name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id={titleId} className="text-[14px] font-semibold text-ink">{name}</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="chip chip-sm">{kindNoun(kind)}</span>
                <span className="chip chip-sm">{depth === 1 ? "direct" : "second hop"}</span>
                <span className={`chip ${status.tone}`}>{status.label}</span>
              </div>
            </div>
            <button type="button" className="btn-chip" onClick={onDismiss}>close</button>
          </div>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink">{explanation}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{hop} A link by itself does not mean wrongdoing.</p>
          {extra && <p className="mt-1 text-[12.5px] text-ink-dim">{extra}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {source && (
              <a href={source.href} target="_blank" rel="noopener noreferrer" className="link-ext text-[11px]">
                {source.label}
              </a>
            )}
            {onOpen && openLabel && (
              <button type="button" className="btn-chip tint-signal" onClick={onOpen}>
                {openLabel} →
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
