import { useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Buildings,
  Coins,
  Fingerprint,
  Funnel,
  IdentificationCard,
  LinkSimple,
  MagnifyingGlass,
  Money,
  ShareNetwork,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { Avatar } from "../../components/Avatar";
import type { PanoptesEdge, PanoptesNode } from "../../engine";
import { canonical } from "../../graph/network";
import {
  faviconFor,
  personAvatar,
  trustedOfficialTeamPortraitUrl,
  trustedOfficialXAvatarUrl,
  xAvatar,
} from "../../lib/avatars";
import type { ConnectionWorkspaceProps } from "../shared/reportLaneRendererTypes";
import "./kyle-connection-workspace.css";

type Cluster = "team" | "projects" | "assets" | "social";
type Filter = "all" | "people" | "projects" | "wallets" | "tokens";
type Lens = "identity" | "control" | "money" | "social";

interface WorkspaceEntity {
  id: string;
  label: string;
  detail?: string;
  cluster: Cluster;
  kind: Exclude<Filter, "all"> | "social";
  image: string | null;
  relation: string;
  direct: boolean;
  confidence: "High" | "Moderate" | "Limited";
  sources: Array<{ label: string; url: string }>;
  researchQuery?: string;
  projectName?: string;
  parentId?: string;
}

interface PlacedEntity extends WorkspaceEntity {
  x: number;
  y: number;
}

const CLUSTER_COLOR: Record<Cluster, string> = {
  team: "var(--kyle-editorial-green)",
  projects: "#5272b3",
  assets: "#7657b5",
  social: "#c56d24",
};

const EDGE_LABEL: Record<string, string> = {
  AFFILIATED_WITH: "affiliated with",
  ASSOCIATES_WITH: "associated with",
  ADVISED: "advises",
  CLAIMED_ENDORSEMENT: "claimed endorsement",
  CONTROLS_WALLET: "controls wallet",
  FOUNDED: "founded",
  FUNDED: "funded",
  INVESTED_IN: "invested in",
  LINKS: "links to",
  PROMOTED: "promoted",
  TEAM: "team member",
  WORKED_ON: "worked on",
};

const ENTITY_KIND_LABEL: Record<WorkspaceEntity["kind"], string> = {
  people: "PERSON",
  projects: "PROJECT",
  wallets: "WALLET",
  tokens: "TOKEN",
  social: "ENTITY",
};

const POSITIONS: Record<Cluster, Array<[number, number]>> = {
  team: [[12, 33], [24, 42], [10, 56], [27, 61], [18, 72], [34, 30]],
  projects: [[43, 14], [55, 10], [66, 17], [47, 29], [64, 31], [56, 23]],
  assets: [[78, 31], [90, 39], [76, 52], [88, 61], [78, 69], [93, 53]],
  social: [[44, 78], [56, 82], [68, 77], [47, 91], [65, 91], [76, 84]],
};

const compactAddress = (value: string) => value.length > 15 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

function safeUrl(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function displayKey(value: string): string {
  const typed = value.match(/^(?:token|wallet|holder|funder):[^:]+:(.+)$/i)?.[1];
  return compactAddress(typed ?? value);
}

function researchKey(value: string): string {
  return value.match(/^(?:token|wallet|holder|funder):[^:]+:(.+)$/i)?.[1] ?? value;
}

function chainLogo(chain: string): string | null {
  const value = chain.trim().toLowerCase();
  if (value.includes("solana")) return "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png";
  if (value.includes("ethereum") || value === "evm") return "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png";
  if (value.includes("base")) return "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png";
  return null;
}

function edgeForNode(subjectKey: string, nodeKey: string, edges: PanoptesEdge[]): { edge?: PanoptesEdge; parentId?: string } {
  const direct = edges.find((edge) =>
    (canonical(edge.src) === canonical(subjectKey) && canonical(edge.dst) === canonical(nodeKey))
    || (canonical(edge.dst) === canonical(subjectKey) && canonical(edge.src) === canonical(nodeKey)));
  if (direct) return { edge: direct };
  const adjacent = edges.find((edge) => canonical(edge.src) === canonical(nodeKey) || canonical(edge.dst) === canonical(nodeKey));
  if (!adjacent) return {};
  return {
    edge: adjacent,
    parentId: canonical(adjacent.src) === canonical(nodeKey) ? canonical(adjacent.dst) : canonical(adjacent.src),
  };
}

function classifyNode(node: PanoptesNode): { cluster: Cluster; kind: WorkspaceEntity["kind"] } {
  const type = String(node.type).toLowerCase();
  const subtype = String(node.subtype ?? "").toLowerCase();
  const key = String(node.key).toLowerCase();
  if (type === "token" || key.startsWith("token:") || key.startsWith("$")) return { cluster: "assets", kind: "tokens" };
  if (subtype === "wallet" || key.startsWith("wallet:") || key.startsWith("holder:") || key.startsWith("funder:")) return { cluster: "assets", kind: "wallets" };
  if (type === "company") return { cluster: "projects", kind: "projects" };
  return { cluster: "social", kind: "people" };
}

function uniqueSources(sources: WorkspaceEntity["sources"]): WorkspaceEntity["sources"] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function buildEntities(props: ConnectionWorkspaceProps): WorkspaceEntity[] {
  const { dossier, nodes, edges, connections } = props;
  const subject = nodes.find((node) => node.subject);
  const subjectKey = String(subject?.key ?? dossier.handle);
  const entities: WorkspaceEntity[] = [];
  const seen = new Set<string>();
  const add = (entity: WorkspaceEntity) => {
    const id = canonical(entity.id);
    if (!id || seen.has(id) || id === canonical(subjectKey)) return;
    seen.add(id);
    entities.push({ ...entity, id, sources: uniqueSources(entity.sources) });
  };

  for (const member of (dossier.webTeam ?? []).slice(0, 8)) {
    const key = member.handle ?? `person:${member.name}`;
    const roleSource = safeUrl(member.sourceUrl ?? member.source);
    const linkedin = safeUrl(member.linkedin);
    const xSource = member.handle ? `https://x.com/${member.handle.replace(/^@/, "")}` : null;
    add({
      id: key,
      label: member.name,
      detail: member.role,
      cluster: "team",
      kind: "people",
      image: trustedOfficialTeamPortraitUrl(member.officialPortraitUrl, member.officialPortraitSourceUrl)
        ?? trustedOfficialXAvatarUrl(member.avatarUrl)
        ?? personAvatar(member.handle, member.linkedin),
      relation: member.role || "team member",
      direct: true,
      confidence: member.artifact_verified === true ? "High" : "Moderate",
      sources: [
        ...(roleSource ? [{ label: "Role source", url: roleSource }] : []),
        ...(linkedin ? [{ label: "LinkedIn profile", url: linkedin }] : []),
        ...(xSource ? [{ label: "X profile", url: xSource }] : []),
      ],
      researchQuery: member.handle ?? member.name,
    });
  }

  for (const node of nodes.filter((candidate) => !candidate.subject)) {
    const key = String(node.key);
    const { cluster, kind } = classifyNode(node);
    if (cluster === "social" && kind === "people" && (dossier.webTeam ?? []).some((member) => canonical(member.handle ?? `person:${member.name}`) === canonical(key))) continue;
    const { edge, parentId } = edgeForNode(subjectKey, key, edges);
    const imageFromNode = safeUrl(typeof node.imageUrl === "string" ? node.imageUrl : typeof node.image === "string" ? node.image : null);
    const nodeChain = typeof node.chain === "string" ? node.chain : key.split(":")[1] ?? "";
    const source = safeUrl(typeof edge?.source_url === "string" ? edge.source_url : null);
    const label = typeof node.label === "string" && node.label.trim() ? node.label.trim() : displayKey(key);
    add({
      id: key,
      label,
      detail: typeof node.role === "string" ? node.role : kind === "wallets" ? nodeChain || "wallet" : undefined,
      cluster,
      kind,
      image: imageFromNode
        ?? (kind === "people" && /^@/.test(key) ? xAvatar(key) : null)
        ?? (kind === "wallets" || kind === "tokens" ? chainLogo(nodeChain) : null)
        ?? (kind === "projects" && /\.[a-z]{2,}(?:\/|$)/i.test(key) ? faviconFor(key) : null),
      relation: edge ? EDGE_LABEL[String(edge.type).toUpperCase()] ?? String(edge.type).toLowerCase() : "appears in saved graph",
      direct: !parentId,
      confidence: edge?.verdict === "Unconfirmed" ? "Limited" : parentId ? "Moderate" : "High",
      sources: source ? [{ label: "Relationship source", url: source }] : [],
      researchQuery: kind === "projects" ? undefined : researchKey(key),
      projectName: kind === "projects" ? label : undefined,
      parentId,
    });
  }

  if (dossier.projectToken) {
    const token = dossier.projectToken;
    const producer = safeUrl(token.producerSources?.identity.sourceUrl ?? token.sourceUrl);
    add({
      id: `token:${token.chain}:${token.address}`,
      label: `$${token.symbol}`,
      detail: `${token.chain} · ${compactAddress(token.address)}`,
      cluster: "assets",
      kind: "tokens",
      image: chainLogo(token.chain),
      relation: "official project token",
      direct: true,
      confidence: "High",
      sources: producer ? [{ label: "Token identity source", url: producer }] : [],
      researchQuery: token.address,
    });
  }

  add({
    id: `social:${dossier.handle}`,
    label: dossier.handle,
    detail: dossier.followers ? `${dossier.followers} followers` : "Official X account",
    cluster: "social",
    kind: "social",
    image: xAvatar(dossier.handle),
    relation: "official account",
    direct: true,
    confidence: dossier.identity_binding ? "High" : "Moderate",
    sources: [{ label: "X profile", url: `https://x.com/${dossier.handle.replace(/^@/, "")}` }],
    researchQuery: dossier.handle,
  });

  for (const connection of connections.slice(0, 6)) {
    add({
      id: `connection:${connection.other}`,
      label: connection.other,
      detail: connection.ties.length ? `via ${connection.ties.slice(0, 2).map((tie) => tie.label).join(", ")}` : "Cross-report connection",
      cluster: "social",
      kind: "social",
      image: /^@/.test(connection.other) ? xAvatar(connection.other) : null,
      relation: connection.direct ? "direct cross-report link" : "shared entity across reports",
      direct: connection.direct,
      confidence: connection.direct ? "Moderate" : "Limited",
      sources: [],
      researchQuery: connection.other,
    });
  }

  const caps: Record<Cluster, number> = { team: 6, projects: 5, assets: 5, social: 5 };
  return (Object.keys(caps) as Cluster[]).flatMap((cluster) => entities.filter((entity) => entity.cluster === cluster).slice(0, caps[cluster]));
}

function positionEntities(entities: WorkspaceEntity[]): PlacedEntity[] {
  const counts: Record<Cluster, number> = { team: 0, projects: 0, assets: 0, social: 0 };
  return entities.map((entity) => {
    const index = counts[entity.cluster]++;
    const [x, y] = POSITIONS[entity.cluster][index % POSITIONS[entity.cluster].length];
    return { ...entity, x, y };
  });
}

function filterMatches(entity: WorkspaceEntity, filter: Filter, lens: Lens | null, query: string): boolean {
  if (filter !== "all" && entity.kind !== filter) return false;
  if (lens === "money" && entity.cluster !== "assets" && !/fund|invest|back/i.test(entity.relation)) return false;
  if (lens === "social" && entity.cluster !== "social") return false;
  if (lens === "identity" && entity.cluster !== "team" && entity.cluster !== "projects" && entity.kind !== "social") return false;
  if (lens === "control" && !entity.direct && !/control|team|found|work/i.test(entity.relation)) return false;
  const term = query.trim().toLowerCase();
  return !term || `${entity.label} ${entity.detail ?? ""} ${entity.relation}`.toLowerCase().includes(term);
}

function confidenceSegments(confidence: WorkspaceEntity["confidence"]): number {
  if (confidence === "High") return 3;
  if (confidence === "Moderate") return 2;
  return 1;
}

function entityAction(entity: WorkspaceEntity, props: ConnectionWorkspaceProps): (() => void) | undefined {
  if (entity.projectName && props.onOpenProject) return () => props.onOpenProject?.(entity.projectName!);
  if (entity.researchQuery && props.onAudit) return () => props.onAudit?.(entity.researchQuery!);
  return undefined;
}

function ResearchConfirmation({ entity, onCancel, onConfirm }: { entity: WorkspaceEntity; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="kyle-connection-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="kyle-connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-research-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="kyle-connection-modal-close" onClick={onCancel} aria-label="Close research confirmation"><X size={17} weight="bold" /></button>
        <p className="kyle-connection-kicker mono">New investigation</p>
        <h3 id="connection-research-title">Research {entity.label}</h3>
        <p>Run a fresh ARGUS investigation and add the resulting evidence to your case history.</p>
        <div className="kyle-connection-cost"><span>Estimated charge</span><strong>1 investigation credit</strong><small>Provider spend is recorded after the run.</small></div>
        <div className="kyle-connection-modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={onConfirm}>Confirm research</button>
        </div>
      </section>
    </div>
  );
}

export function KyleConnectionWorkspace(props: ConnectionWorkspaceProps) {
  const { dossier, nodes, edges, shareView = false } = props;
  const entities = useMemo(() => positionEntities(buildEntities(props)), [props]);
  const [filter, setFilter] = useState<Filter>("all");
  const [lens, setLens] = useState<Lens | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => entities[0]?.id ?? null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pendingResearch, setPendingResearch] = useState<WorkspaceEntity | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const subject = nodes.find((node) => node.subject);
  const subjectKey = String(subject?.key ?? dossier.handle);
  const subjectName = dossier.display_name || dossier.resolved_name || dossier.handle;
  const subjectImage = dossier.avatar_url || xAvatar(dossier.handle);
  const visible = entities.filter((entity) => filterMatches(entity, filter, lens, query));
  const visibleIds = new Set(visible.map((entity) => entity.id));
  const selected = entities.find((entity) => entity.id === selectedId) ?? visible[0] ?? null;
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const connectionCount = edges.length + props.connections.length;

  const reset = () => {
    setFilter("all");
    setLens(null);
    setQuery("");
    setSelectedId(entities[0]?.id ?? null);
  };

  return (
    <section className="kyle-connection-workspace" aria-labelledby="kyle-connection-title">
      <header className="kyle-connection-toolbar">
        <div className="kyle-connection-search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entities, wallets, domains…" aria-label="Search connections" />
        </div>
        <button type="button" className="kyle-connection-find" onClick={() => searchRef.current?.focus()}><LinkSimple size={16} />Find a connection</button>
        <div className="kyle-connection-count"><strong>{entities.length + 1}</strong> entities · <strong>{connectionCount}</strong> relationships</div>
        <button type="button" className="kyle-connection-legend-button" aria-expanded={legendOpen} onClick={() => setLegendOpen((open) => !open)}><IdentificationCard size={15} />Legend</button>
      </header>

      <div className="kyle-connection-body">
        <aside className="kyle-connection-filters" aria-label="Connection filters">
          <div>
            {([
              ["all", "Everything", ShareNetwork],
              ["people", "People", Users],
              ["projects", "Projects", Buildings],
              ["wallets", "Wallets", Wallet],
              ["tokens", "Tokens", Coins],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={filter === value ? "is-active" : ""}><Icon size={17} /><span>{label}</span></button>
            ))}
          </div>
          <div className="kyle-connection-filter-rule" />
          <p className="kyle-connection-filter-label mono">Lenses</p>
          <div>
            {([
              ["identity", "Identity", Fingerprint],
              ["control", "Control", ShieldCheck],
              ["money", "Money", Money],
              ["social", "Social", ShareNetwork],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={lens === value} onClick={() => setLens((current) => current === value ? null : value)} className={lens === value ? "is-lens-active" : ""}><Icon size={17} /><span>{label}</span></button>
            ))}
          </div>
        </aside>

        <div className="kyle-connection-canvas" data-empty={visible.length === 0 ? "true" : "false"}>
          <h2 id="kyle-connection-title" className="sr-only">Connections for {subjectName}</h2>
          {(["team", "projects", "assets", "social"] as Cluster[]).map((cluster) => {
            const count = visible.filter((entity) => entity.cluster === cluster).length;
            const label = cluster === "team" ? "Team" : cluster === "projects" ? "Projects & Organizations" : cluster === "assets" ? "Wallets & Tokens" : "Social & Backers";
            return <div key={cluster} className={`kyle-connection-cluster kyle-connection-cluster--${cluster}`}><span style={{ color: CLUSTER_COLOR[cluster] }}>{label} <small>{count}</small></span></div>;
          })}

          <svg className="kyle-connection-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {visible.map((entity) => {
              const parent = entity.parentId ? byId.get(entity.parentId) : null;
              const x1 = parent?.x ?? 55;
              const y1 = parent?.y ?? 50;
              return <line key={entity.id} x1={x1} y1={y1} x2={entity.x} y2={entity.y} stroke={CLUSTER_COLOR[entity.cluster]} strokeWidth={entity.direct ? 0.22 : 0.16} strokeDasharray={entity.direct ? undefined : "0.8 0.7"} opacity={selected?.id === entity.id ? 0.9 : 0.52} />;
            })}
          </svg>

          <button type="button" className="kyle-connection-subject" aria-label={`${subjectName}, audited subject`} onClick={() => setSelectedId(null)}>
            <Avatar src={subjectImage} letter={(subjectName[0] ?? "?").toUpperCase()} size={92} rounded="rounded-full" letterClass="text-2xl" />
            <strong>{subjectName}</strong>
            <small>{dossier.report.roles.includes("PROJECT") ? "PROJECT" : "AUDITED SUBJECT"}</small>
          </button>

          {entities.map((entity) => {
            const isVisible = visibleIds.has(entity.id);
            return (
              <button
                type="button"
                key={entity.id}
                className={`kyle-connection-node ${selected?.id === entity.id ? "is-selected" : ""}`}
                style={{ left: `${entity.x}%`, top: `${entity.y}%`, "--node-color": CLUSTER_COLOR[entity.cluster] } as React.CSSProperties}
                data-hidden={isVisible ? "false" : "true"}
                onClick={() => setSelectedId(entity.id)}
                aria-pressed={selected?.id === entity.id}
                aria-label={`${entity.label}, ${entity.relation}`}
              >
                <span className="kyle-connection-node-image"><Avatar src={entity.image} letter={(entity.label.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={entity.cluster === "team" ? 48 : 44} rounded="rounded-full" letterClass="text-[12px]" /></span>
                <strong>{entity.label}</strong>
                {entity.detail && <small>{entity.detail}</small>}
              </button>
            );
          })}

          {visible.length === 0 && <div className="kyle-connection-empty"><Funnel size={26} /><strong>No connection matches this view.</strong><button type="button" onClick={reset}>Reset filters</button></div>}
          <button type="button" className="kyle-connection-reset" onClick={reset}><ArrowsClockwise size={15} />Reset view</button>

          {legendOpen && (
            <div className="kyle-connection-legend" role="status">
              <strong>How to read the web</strong>
              <p>Solid lines are direct saved relationships. Dashed lines are second-hop or cross-report leads. Color groups organize the evidence; they do not affect the score.</p>
            </div>
          )}
        </div>
      </div>

      <aside className="kyle-connection-drawer" aria-live="polite">
        {selected ? (
          <>
            <div className="kyle-connection-drawer-person">
              <Avatar src={selected.image} letter={(selected.label.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={82} rounded="rounded-full" letterClass="text-xl" />
              <div><h3>{selected.label}</h3><div className="kyle-connection-badges"><span>{ENTITY_KIND_LABEL[selected.kind]}</span><span>{selected.direct ? "DIRECT" : "SECOND HOP"}</span><span className="is-verified">{selected.confidence === "High" ? "VERIFIED" : "LEAD"}</span></div><p>{selected.detail ?? selected.relation}</p></div>
            </div>
            <div className="kyle-connection-drawer-block"><span className="mono">Relationship</span><p>{selected.label} is connected to {subjectName} as <strong>{selected.relation}</strong>.</p></div>
            <div className="kyle-connection-drawer-block"><span className="mono">Evidence confidence</span><div className="kyle-confidence-row"><strong>{selected.confidence}</strong><small>{confidenceSegments(selected.confidence)} of 3 signals</small></div><div className="kyle-confidence-meter">{[1, 2, 3].map((value) => <i key={value} data-on={value <= confidenceSegments(selected.confidence) ? "true" : "false"} />)}</div><small>{selected.direct ? "Direct relationship saved with this report." : "Relationship is inferred through another saved entity."}</small></div>
            <div className="kyle-connection-drawer-block"><span className="mono">Sources ({selected.sources.length})</span>{selected.sources.length ? <ul>{selected.sources.slice(0, 3).map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul> : <p>No direct source URL was preserved for this graph edge.</p>}</div>
            {!shareView && <div className="kyle-connection-drawer-actions"><span className="mono">Actions</span>{selected.sources[0] && <a className="btn-primary" href={selected.sources[0].url} target="_blank" rel="noreferrer">Open evidence</a>}{entityAction(selected, props) && <button type="button" className="btn-secondary" onClick={() => setPendingResearch(selected)}>Research {selected.kind === "people" ? "person" : selected.kind === "projects" ? "project" : "entity"}</button>}</div>}
          </>
        ) : (
          <div className="kyle-connection-drawer-subject"><Avatar src={subjectImage} letter={(subjectName[0] ?? "?").toUpperCase()} size={82} rounded="rounded-full" letterClass="text-xl" /><div><p className="mono">Audited subject</p><h3>{subjectName}</h3><span>{subjectKey}</span></div></div>
        )}
      </aside>

      {pendingResearch && entityAction(pendingResearch, props) && <ResearchConfirmation entity={pendingResearch} onCancel={() => setPendingResearch(null)} onConfirm={() => { const action = entityAction(pendingResearch, props); setPendingResearch(null); action?.(); }} />}
    </section>
  );
}
