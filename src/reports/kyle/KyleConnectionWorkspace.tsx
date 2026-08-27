import { useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Buildings,
  Coins,
  Fingerprint,
  Handshake,
  IdentificationCard,
  LinkSimple,
  MagnifyingGlass,
  Money,
  ShareNetwork,
  ShieldCheck,
  Users,
  Wallet,
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
import { KyleResearchSheet, type KyleResearchTarget } from "./KyleResearchSheet";
import "./kyle-connection-workspace.css";

type Cluster = "team" | "advisors" | "projects" | "assets" | "social";
type Filter = "all" | "people" | "advisors" | "projects" | "wallets" | "tokens";
type Lens = "identity" | "control" | "money" | "social";
type EntityKind = "people" | "projects" | "wallets" | "tokens" | "social";

interface WorkspaceEntity {
  id: string;
  label: string;
  detail?: string;
  cluster: Cluster;
  kind: EntityKind;
  image: string | null;
  relation: string;
  direct: boolean;
  confidence: "High" | "Moderate" | "Limited";
  sources: Array<{ label: string; url: string }>;
  researchQuery?: string;
  parentId?: string;
}

interface PlacedEntity extends WorkspaceEntity {
  x: number;
  y: number;
}

const CLUSTER_COLOR: Record<Cluster, string> = {
  team: "var(--kyle-editorial-green)",
  advisors: "#a26027",
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

const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  people: "PERSON",
  projects: "PROJECT",
  wallets: "WALLET",
  tokens: "TOKEN",
  social: "ENTITY",
};

const POSITIONS: Record<Cluster, Array<[number, number]>> = {
  team: [[11, 31], [24, 39], [9, 51], [27, 57], [16, 67], [32, 29], [31, 69], [8, 66]],
  advisors: [[37, 79], [48, 84], [39, 91], [52, 92], [46, 74], [31, 88]],
  projects: [[43, 13], [55, 9], [66, 16], [45, 28], [65, 29], [56, 22]],
  assets: [[79, 29], [91, 37], [77, 49], [89, 58], [79, 67], [94, 50]],
  social: [[66, 78], [77, 83], [89, 77], [68, 92], [83, 92], [92, 87]],
};

const ADVISOR_ROLE = /\b(?:advisor|adviser|advisory|board|backer|investor|fund|incubator|venture partner)\b/i;

function normalizedIdentity(value?: string | null): string {
  return (value ?? "").trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isAdvisorRelationship(value?: string | null): boolean {
  return ADVISOR_ROLE.test(value ?? "");
}

function isMalformedPersonLabel(value: string): boolean {
  return /[.;:|][\s]|\b(?:senior|lead|manager|advisor|engineer|director|founder|chief|head)\s*$/i.test(value.trim());
}

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

function classifyNode(node: PanoptesNode, edge?: PanoptesEdge): { cluster: Cluster; kind: WorkspaceEntity["kind"] } {
  const type = String(node.type).toLowerCase();
  const subtype = String(node.subtype ?? "").toLowerCase();
  const key = String(node.key).toLowerCase();
  const relationship = `${String(node.role ?? "")} ${String(edge?.role ?? "")} ${String(edge?.relation ?? "")} ${String(edge?.type ?? "")}`;
  if (type === "token" || key.startsWith("token:") || key.startsWith("$")) return { cluster: "assets", kind: "tokens" };
  if (subtype === "wallet" || key.startsWith("wallet:") || key.startsWith("holder:") || key.startsWith("funder:")) return { cluster: "assets", kind: "wallets" };
  if (isAdvisorRelationship(relationship) || String(edge?.type).toUpperCase() === "ADVISED") return { cluster: "advisors", kind: type === "company" ? "projects" : "people" };
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
  const identityIndex = new Map<string, number>();
  const entityKeys = (entity: WorkspaceEntity): string[] => {
    const keys = [canonical(entity.id)];
    if (entity.kind === "people" || entity.kind === "projects") {
      const label = normalizedIdentity(entity.label);
      const query = normalizedIdentity(entity.researchQuery);
      if (label) keys.push(`${entity.kind}:${label}`);
      if (query) keys.push(`${entity.kind}:${query}`);
    }
    return [...new Set(keys.filter(Boolean))];
  };
  const add = (entity: WorkspaceEntity) => {
    const id = canonical(entity.id);
    if (!id || id === canonical(subjectKey)) return;
    const next = { ...entity, id, sources: uniqueSources(entity.sources) };
    const keys = entityKeys(next);
    const existingIndex = keys.map((key) => identityIndex.get(key)).find((index) => index !== undefined);
    if (existingIndex !== undefined) {
      const existing = entities[existingIndex];
      const merged = {
        ...next,
        ...existing,
        image: existing.image ?? next.image,
        detail: existing.detail ?? next.detail,
        relation: existing.relation || next.relation,
        direct: existing.direct || next.direct,
        confidence: existing.confidence === "High" || next.confidence === "High"
          ? "High" as const
          : existing.confidence === "Moderate" || next.confidence === "Moderate"
            ? "Moderate" as const
            : "Limited" as const,
        sources: uniqueSources([...existing.sources, ...next.sources]),
        researchQuery: existing.researchQuery ?? next.researchQuery,
      };
      entities[existingIndex] = merged;
      for (const key of entityKeys(merged)) identityIndex.set(key, existingIndex);
      return;
    }
    const index = entities.push(next) - 1;
    for (const key of keys) identityIndex.set(key, index);
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
      cluster: isAdvisorRelationship(member.role) ? "advisors" : "team",
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

  for (const organization of dossier.organizationRelationships ?? []) {
    const key = organization.handle ?? `organization:${organization.name}`;
    const roleSource = safeUrl(organization.sourceUrl ?? organization.source);
    const xSource = organization.handle ? `https://x.com/${organization.handle.replace(/^@/, "")}` : null;
    add({
      id: key,
      label: organization.name,
      detail: organization.role,
      cluster: isAdvisorRelationship(organization.role) ? "advisors" : "projects",
      kind: "projects",
      image: trustedOfficialTeamPortraitUrl(organization.officialPortraitUrl, organization.officialPortraitSourceUrl)
        ?? trustedOfficialXAvatarUrl(organization.avatarUrl)
        ?? (organization.handle ? xAvatar(organization.handle) : null),
      relation: organization.role,
      direct: true,
      confidence: "High",
      sources: [
        ...(roleSource ? [{ label: "Relationship source", url: roleSource }] : []),
        ...(xSource ? [{ label: "X profile", url: xSource }] : []),
      ],
      researchQuery: organization.handle ?? organization.name,
    });
  }

  for (const node of nodes.filter((candidate) => !candidate.subject)) {
    const key = String(node.key);
    const { edge, parentId } = edgeForNode(subjectKey, key, edges);
    const { cluster, kind } = classifyNode(node, edge);
    const imageFromNode = safeUrl(typeof node.imageUrl === "string" ? node.imageUrl : typeof node.image === "string" ? node.image : null);
    const nodeChain = typeof node.chain === "string" ? node.chain : key.split(":")[1] ?? "";
    const source = safeUrl(typeof edge?.source_url === "string" ? edge.source_url : null);
    const label = typeof node.label === "string" && node.label.trim() ? node.label.trim() : displayKey(key);
    if (kind === "people" && isMalformedPersonLabel(label)) continue;
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
      researchQuery: kind === "projects" ? label : researchKey(key),
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

  const caps: Record<Cluster, number> = { team: 8, advisors: 6, projects: 6, assets: 6, social: 6 };
  return (Object.keys(caps) as Cluster[]).flatMap((cluster) => entities.filter((entity) => entity.cluster === cluster).slice(0, caps[cluster]));
}

function positionEntities(entities: WorkspaceEntity[]): PlacedEntity[] {
  const counts: Record<Cluster, number> = { team: 0, advisors: 0, projects: 0, assets: 0, social: 0 };
  return entities.map((entity) => {
    const index = counts[entity.cluster]++;
    const [x, y] = POSITIONS[entity.cluster][index % POSITIONS[entity.cluster].length];
    return { ...entity, x, y };
  });
}

function filterMatches(entity: WorkspaceEntity, filter: Filter, lens: Lens | null, query: string): boolean {
  if (filter === "advisors" && entity.cluster !== "advisors") return false;
  if (filter !== "all" && filter !== "advisors" && entity.kind !== filter) return false;
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

function entityAction(entity: WorkspaceEntity, props: ConnectionWorkspaceProps, privateSearch = false): (() => void) | undefined {
  if (entity.researchQuery && props.onAudit) return () => props.onAudit?.(entity.researchQuery!, privateSearch);
  return undefined;
}

type ResearchValidation = {
  eligible: boolean;
  mode: "verified" | "exploratory" | "blocked";
  explanation: string;
};

function entityValidation(entity: WorkspaceEntity): ResearchValidation {
  const canonicalHandle = /^@[A-Za-z0-9_]{2,30}$/.test(entity.researchQuery ?? "");
  if (isMalformedPersonLabel(entity.label)) {
    return { eligible: false, mode: "blocked", explanation: "The saved label looks like a role fragment, not a resolved entity." };
  }
  if (entity.kind === "people") {
    const name = /^(?:(?:Dr|Mr|Ms|Mrs)\.\s+)?[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]+){1,4}$/.test(entity.label.trim());
    if (!canonicalHandle && !name) return { eligible: false, mode: "blocked", explanation: "ARGUS has not resolved this candidate to a valid person identity." };
  }
  if (entity.kind === "wallets" || entity.kind === "tokens") {
    const ref = entity.researchQuery ?? "";
    const address = /^0x[a-fA-F0-9]{40}$/.test(ref) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref);
    if (!address) return { eligible: false, mode: "blocked", explanation: "The saved identifier is not a complete supported wallet or token address." };
  }
  if (entity.kind === "social" && !canonicalHandle) {
    return { eligible: false, mode: "blocked", explanation: "ARGUS has not resolved this account to a canonical handle." };
  }
  if (entity.confidence === "High" && entity.sources.length > 0) {
    return { eligible: true, mode: "verified", explanation: "Identity and entity type are source-backed." };
  }
  if (canonicalHandle) {
    return { eligible: true, mode: "exploratory", explanation: "This exact X handle can seed a fresh investigation, but its current relationship remains unverified." };
  }
  return { eligible: false, mode: "blocked", explanation: "This lead needs a stronger identity source or canonical handle before ARGUS can charge for research." };
}

function researchButtonLabel(entity: WorkspaceEntity): string {
  return entityValidation(entity).mode === "exploratory" ? "Explore this lead" : "Research this";
}

function impactReason(entity: WorkspaceEntity, subjectName: string): string {
  if (entityValidation(entity).mode === "exploratory") {
    return `${entity.label} is an unresolved lead with an exact public handle. A fresh investigation can establish who controls it and whether the apparent relationship to ${subjectName} is real.`;
  }
  const relation = `${entity.relation} ${entity.detail ?? ""}`.toLowerCase();
  if (/founder|chief|lead|director|team/.test(relation)) return `${entity.label} appears close to leadership. Verifying their identity and track record could materially change confidence in ${subjectName}'s team.`;
  if (entity.kind === "wallets" || /control/.test(relation)) return `${entity.label} touches a control or capital path. Tracing it could expose custody, concentration, or undisclosed coordination.`;
  if (entity.kind === "tokens") return `${entity.label} is part of the project's economic surface. A fresh contract and market investigation could change the token-risk decision.`;
  if (/fund|back|invest|partner/.test(relation)) return `${entity.label} may support or influence the project. Independent validation could strengthen or weaken the backer thesis.`;
  return `${entity.label} is a source-backed adjacent entity. Investigating it could resolve an open relationship in the ${subjectName} decision file.`;
}

function impactScore(entity: WorkspaceEntity): number {
  const relation = `${entity.relation} ${entity.detail ?? ""}`.toLowerCase();
  return (entity.direct ? 20 : 0)
    + (/founder|chief|control|fund|back|invest/.test(relation) ? 35 : 0)
    + (/lead|director|advisor|partner|team/.test(relation) ? 20 : 0)
    + (entity.kind === "wallets" || entity.kind === "tokens" ? 18 : 0)
    + entity.sources.length * 3;
}

function researchTarget(entity: WorkspaceEntity, subjectName: string): KyleResearchTarget {
  const estimateMinutes = entity.kind === "projects" ? "4–7 minutes" : entity.kind === "wallets" ? "2–5 minutes" : entity.kind === "tokens" ? "3–6 minutes" : "2–4 minutes";
  return {
    id: entity.id,
    name: entity.label,
    image: entity.image,
    entityType: ENTITY_KIND_LABEL[entity.kind].toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
    sourceReport: subjectName,
    reason: impactReason(entity, subjectName),
    estimateMinutes,
    costMin: 0.8,
    costMax: 1.6,
    privateSurcharge: 0.4,
    query: entity.researchQuery ?? entity.label,
    reportKind: entity.kind === "tokens" || entity.kind === "wallets" ? "token" : "person",
    researchMode: entityValidation(entity).mode === "exploratory" ? "exploratory" : "verified",
  };
}

function recommendedEntities(entities: WorkspaceEntity[], props: ConnectionWorkspaceProps): WorkspaceEntity[] {
  const ranked = entities
    .filter((entity) => entity.relation !== "official account" && entityValidation(entity).eligible && entityAction(entity, props))
    .sort((left, right) => impactScore(right) - impactScore(left));
  const recommendations: WorkspaceEntity[] = [];
  const represented = new Set<Cluster>();
  for (const entity of ranked) {
    if (represented.has(entity.cluster)) continue;
    recommendations.push(entity);
    represented.add(entity.cluster);
    if (recommendations.length === 3) return recommendations;
  }
  for (const entity of ranked) {
    if (recommendations.some((candidate) => candidate.id === entity.id)) continue;
    recommendations.push(entity);
    if (recommendations.length === 3) break;
  }
  return recommendations;
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
  const recommendations = recommendedEntities(entities, props);
  const filtersActive = filter !== "all" || lens !== null || Boolean(query.trim());
  const selectedValidation = selected ? entityValidation(selected) : null;
  const selectedConfidenceSegments = selectedValidation?.mode === "exploratory" ? 1 : selected ? confidenceSegments(selected.confidence) : 0;

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
              ["advisors", "Advisors", Handshake],
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
          <div className="kyle-connection-filter-status" role="status" aria-live="polite">
            <strong>{visible.length} of {entities.length} connections shown</strong>
            <span>{visible.length === 0
              ? filtersActive ? "No connections match these filters." : "No connections were found in this investigation."
              : filtersActive ? "The web is filtered." : "All saved connections are visible."}</span>
            {filtersActive && <button type="button" onClick={reset}><ArrowsClockwise size={14} />Reset filters</button>}
          </div>
        </aside>

        <div className="kyle-connection-canvas" data-empty={visible.length === 0 ? "true" : "false"}>
          <h2 id="kyle-connection-title" className="sr-only">Connections for {subjectName}</h2>
          {(["team", "advisors", "projects", "assets", "social"] as Cluster[]).map((cluster) => {
            const count = visible.filter((entity) => entity.cluster === cluster).length;
            const label = cluster === "team" ? "Core team" : cluster === "advisors" ? "Advisors & backers" : cluster === "projects" ? "Projects & Organizations" : cluster === "assets" ? "Wallets & Tokens" : "Social & community";
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
                <span className="kyle-connection-node-image"><Avatar src={entity.image} letter={(entity.label.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={entity.cluster === "team" || entity.cluster === "advisors" ? 48 : 44} rounded="rounded-full" letterClass="text-[12px]" /></span>
                <strong>{entity.label}</strong>
                {entity.detail && <small>{entity.detail}</small>}
              </button>
            );
          })}

          <button type="button" className="kyle-connection-reset" onClick={reset}><ArrowsClockwise size={15} />Reset view</button>

          {legendOpen && (
            <div className="kyle-connection-legend" role="status">
              <strong>How to read the web</strong>
              <p>Green is verified core team. Brown is source-backed advisers and backers. Solid lines are direct saved relationships; dashed lines are second-hop or cross-report leads. Color groups organize the evidence and never change the score.</p>
            </div>
          )}
        </div>
      </div>

      <aside className="kyle-connection-drawer" aria-live="polite">
        {selected ? (
          <>
            <div className="kyle-connection-drawer-person">
              <Avatar src={selected.image} letter={(selected.label.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={82} rounded="rounded-full" letterClass="text-xl" />
              <div><h3>{selected.label}</h3><div className="kyle-connection-badges"><span>{ENTITY_KIND_LABEL[selected.kind]}</span><span>{selected.direct ? "DIRECT" : "SECOND HOP"}</span><span className={selectedValidation?.mode === "verified" ? "is-verified" : undefined}>{selectedValidation?.mode === "verified" ? "VERIFIED" : "LEAD"}</span></div><p>{selected.detail ?? selected.relation}</p></div>
            </div>
            <div className="kyle-connection-drawer-block"><span className="mono">Relationship</span><p>{selected.label} is connected to {subjectName} as <strong>{selected.relation}</strong>.</p></div>
            <div className="kyle-connection-drawer-block"><span className="mono">Evidence confidence</span><div className="kyle-confidence-row"><strong>{selectedValidation?.mode === "exploratory" ? "Unverified" : selected.confidence}</strong><small>{selectedConfidenceSegments} of 3 signals</small></div><div className="kyle-confidence-meter">{[1, 2, 3].map((value) => <i key={value} data-on={value <= selectedConfidenceSegments ? "true" : "false"} />)}</div><small>{selectedValidation?.mode === "exploratory" ? "Exact identifier saved; the relationship still needs an independent source." : selected.direct ? "Direct relationship saved with this report." : "Relationship is inferred through another saved entity."}</small></div>
            <div className="kyle-connection-drawer-block"><span className="mono">Sources ({selected.sources.length})</span>{selected.sources.length ? <ul>{selected.sources.slice(0, 3).map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul> : <p>No direct source URL was preserved for this graph edge.</p>}</div>
            {!shareView && <div className="kyle-connection-drawer-actions"><span className="mono">Actions</span>{selected.sources[0] && <a className="btn-primary" href={selected.sources[0].url} target="_blank" rel="noreferrer">Open evidence</a>}{entityAction(selected, props) && entityValidation(selected).eligible ? <><button type="button" className="btn-secondary" onClick={() => setPendingResearch(selected)}>{researchButtonLabel(selected)}</button>{entityValidation(selected).mode === "exploratory" && <div className="kyle-connection-validation is-exploratory"><strong>Exploratory lead</strong><small>{entityValidation(selected).explanation}</small></div>}</> : entityAction(selected, props) ? <div className="kyle-connection-validation"><strong>Verify identity first</strong><small>{entityValidation(selected).explanation}</small></div> : null}</div>}
          </>
        ) : (
          <div className="kyle-connection-drawer-subject"><Avatar src={subjectImage} letter={(subjectName[0] ?? "?").toUpperCase()} size={82} rounded="rounded-full" letterClass="text-xl" /><div><p className="mono">Audited subject</p><h3>{subjectName}</h3><span>{subjectKey}</span></div></div>
        )}
      </aside>

      {!shareView && recommendations.length > 0 && (
        <section className="kyle-rabbit-holes" aria-labelledby="kyle-rabbit-holes-title">
          <header><div><p className="mono">Recommended next investigations</p><h3 id="kyle-rabbit-holes-title">Next rabbit holes</h3></div><span>Ranked by decision impact, not popularity.</span></header>
          <div className="kyle-rabbit-hole-grid">
            {recommendations.map((entity, index) => (
              <article key={entity.id}>
                <span className="kyle-rabbit-hole-rank mono">0{index + 1}</span>
                <Avatar src={entity.image} letter={(entity.label.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={42} rounded="rounded-full" letterClass="text-sm" />
                <div><small className="mono">{ENTITY_KIND_LABEL[entity.kind]}</small><h4>{entity.label}</h4><p>{impactReason(entity, subjectName)}</p></div>
                <button type="button" onClick={() => setPendingResearch(entity)}>{researchButtonLabel(entity)}</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {pendingResearch && entityAction(pendingResearch, props) && entityValidation(pendingResearch).eligible && (
        <KyleResearchSheet
          target={researchTarget(pendingResearch, subjectName)}
          onClose={() => setPendingResearch(null)}
          onRun={(privateSearch) => entityAction(pendingResearch, props, privateSearch)?.()}
          onOpenSaved={props.onOpenSavedReport ? () => props.onOpenSavedReport?.(
            pendingResearch.researchQuery ?? pendingResearch.label,
            pendingResearch.kind === "tokens" || pendingResearch.kind === "wallets" ? "token" : "person",
          ) : undefined}
          onOpenCompleted={() => entityAction(pendingResearch, props)?.()}
          previewBalance={props.previewBalance}
        />
      )}
    </section>
  );
}
