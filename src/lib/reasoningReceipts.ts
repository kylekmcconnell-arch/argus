export type GraphPathEvidenceState = "verified" | "bounded";

export interface GraphPathEdgeReceipt {
  from: string;
  to: string;
  relationship: string;
  evidenceState: GraphPathEvidenceState;
  sourceReceipt: {
    inputPath: string;
    sourceUrl: string;
    provider?: string;
    sourceClass?: string;
  };
}

export interface GraphPathReceipt {
  state: "not_requested" | "complete" | "withheld" | "target_unresolved";
  targetKeys: string[];
  paths: Array<{
    nodeKeys: string[];
    edges: GraphPathEdgeReceipt[];
    pathLength: number;
    evidenceState: GraphPathEvidenceState;
  }>;
  rejectedAlternatives: Array<{
    from: string;
    to: string;
    relationship: string;
    inputPath: string;
    reason: "candidate_edge" | "reported_only" | "missing_source_receipt" | "dangling_endpoint";
  }>;
  explanation: string;
}

export interface TypedContradictionReceipt {
  factId: string;
  proposition: string;
  conflictProposition: string;
  scopeAlignment: "aligned" | "different_context";
  timeAlignment: "aligned" | "unknown" | "misaligned";
  sourceIndependence: "independent" | "dependent" | "unknown";
  status: "unresolved" | "superseded" | "different_context" | "withheld";
  supportingArtifact: ArtifactReceipt;
  contradictingArtifact: ArtifactReceipt;
  resolutionArtifact: string;
  explanation: string;
}

interface ArtifactReceipt {
  sourceUrl: string;
  provider: string;
  sourceClass: string;
  capturedAt: string;
  excerpt: string;
  contentHash: string;
}

interface GraphNode {
  key: string;
  label: string;
  subject: boolean;
}

interface RawGraphEdge {
  from: string;
  to: string;
  relationship: string;
  inputPath: string;
  sourceUrl: string;
  provider: string;
  sourceClass: string;
  evidenceState: string;
  eligibility: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function safeHttpUrl(value: unknown): string {
  const candidate = text(value, 1000);
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function aliasAppears(question: string, alias: string): boolean {
  const needle = normalized(alias);
  if (needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalized(question));
}

function graphRows(packet: Record<string, unknown>) {
  const reasoning = record(packet.investigationReasoning);
  const connections = record(reasoning.connections);
  return [
    { graph: record(connections.tokenGraph), prefix: "investigationReasoning.connections.tokenGraph" },
    { graph: record(connections.projectGraph), prefix: "investigationReasoning.connections.projectGraph" },
  ];
}

function edgeReason(edge: RawGraphEdge, nodeKeys: ReadonlySet<string>): GraphPathReceipt["rejectedAlternatives"][number]["reason"] | null {
  if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) return "dangling_endpoint";
  if (/candidate|model_lead|name[_ -]?only|namesake/i.test(edge.eligibility)) return "candidate_edge";
  if (/reported|unverified|lead/i.test(edge.evidenceState)) return "reported_only";
  if (!edge.sourceUrl) return "missing_source_receipt";
  return null;
}

/**
 * Compute only paths whose every hop carries an exact frozen source URL.
 * Receipt-free graph topology remains visible as a rejected alternative; it is
 * never silently upgraded merely because the endpoints happen to connect.
 */
export function buildGraphPathReceipt(
  question: string,
  reasoningMode: string,
  packetValue: unknown,
): GraphPathReceipt {
  if (reasoningMode !== "trace_connection") {
    return {
      state: "not_requested",
      targetKeys: [],
      paths: [],
      rejectedAlternatives: [],
      explanation: "The question did not request connection tracing.",
    };
  }

  const packet = record(packetValue);
  const nodesByKey = new Map<string, GraphNode>();
  const rawEdges: RawGraphEdge[] = [];
  for (const { graph, prefix } of graphRows(packet)) {
    rows(graph.nodes).forEach((value) => {
      const node = record(value);
      const key = text(node.key, 160);
      if (!key) return;
      const existing = nodesByKey.get(key);
      nodesByKey.set(key, {
        key,
        label: text(node.label, 240) || existing?.label || key,
        subject: node.subject === true || existing?.subject === true,
      });
    });
    rows(graph.edges).forEach((value, index) => {
      const edge = record(value);
      rawEdges.push({
        from: text(edge.from, 160),
        to: text(edge.to, 160),
        relationship: text(edge.relationship, 120) || "RELATED_TO",
        inputPath: text(edge.inputPath, 300) || `${prefix}.edges.${index}`,
        sourceUrl: safeHttpUrl(edge.sourceUrl),
        provider: text(edge.provider, 120),
        sourceClass: text(edge.sourceClass, 120),
        evidenceState: text(edge.evidenceState, 80),
        eligibility: text(edge.eligibility, 240),
      });
    });
  }

  // Project attributions are explicit, bounded relationship receipts even when
  // the older graph omitted source metadata from its TEAM edge.
  for (const [index, value] of rows(packet.projectAttributions).entries()) {
    const attribution = record(value);
    const project = text(attribution.project, 240);
    const name = text(attribution.name, 240);
    const sourceUrl = safeHttpUrl(attribution.sourceUrl);
    if (!project || !name || !sourceUrl) continue;
    const projectNode = [...nodesByKey.values()].find((node) =>
      normalized(node.label) === normalized(project) || normalized(node.key) === normalized(project));
    const personNode = [...nodesByKey.values()].find((node) =>
      normalized(node.label) === normalized(name) || normalized(node.key) === normalized(name));
    if (!projectNode || !personNode) continue;
    rawEdges.push({
      from: projectNode.key,
      to: personNode.key,
      relationship: text(attribution.role, 120) || "PROJECT_ATTRIBUTION",
      inputPath: `projectAttributions.${index}`,
      sourceUrl,
      provider: "official-project-attribution",
      sourceClass: "official_subject",
      evidenceState: "bounded",
      eligibility: "project_attributed_only",
    });
  }

  const subjectKeys = [...nodesByKey.values()].filter((node) => node.subject).map((node) => node.key);
  const targetKeys = [...nodesByKey.values()]
    .filter((node) => !node.subject && (aliasAppears(question, node.key) || aliasAppears(question, node.label)))
    .map((node) => node.key)
    .sort();
  if (!targetKeys.length) {
    return {
      state: "target_unresolved",
      targetKeys: [],
      paths: [],
      rejectedAlternatives: [],
      explanation: "No exact frozen graph node was named in the trace question, so ARGUS did not choose a target.",
    };
  }

  const nodeKeys = new Set(nodesByKey.keys());
  const accepted: GraphPathEdgeReceipt[] = [];
  const rejectedAlternatives: GraphPathReceipt["rejectedAlternatives"] = [];
  for (const edge of rawEdges) {
    const reason = edgeReason(edge, nodeKeys);
    if (reason) {
      rejectedAlternatives.push({
        from: edge.from,
        to: edge.to,
        relationship: edge.relationship,
        inputPath: edge.inputPath,
        reason,
      });
      continue;
    }
    accepted.push({
      from: edge.from,
      to: edge.to,
      relationship: edge.relationship,
      evidenceState: edge.evidenceState === "verified" ? "verified" : "bounded",
      sourceReceipt: {
        inputPath: edge.inputPath,
        sourceUrl: edge.sourceUrl,
        ...(edge.provider ? { provider: edge.provider } : {}),
        ...(edge.sourceClass ? { sourceClass: edge.sourceClass } : {}),
      },
    });
  }

  const adjacency = new Map<string, Array<{ next: string; edge: GraphPathEdgeReceipt }>>();
  for (const edge of accepted) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { next: edge.to, edge }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { next: edge.from, edge }]);
  }
  for (const values of adjacency.values()) values.sort((a, b) => a.next.localeCompare(b.next) || a.edge.relationship.localeCompare(b.edge.relationship));

  const paths: GraphPathReceipt["paths"] = [];
  for (const target of targetKeys.slice(0, 5)) {
    const queue = subjectKeys.sort().map((key) => ({ key, nodeKeys: [key], edges: [] as GraphPathEdgeReceipt[] }));
    const visited = new Set(queue.map((entry) => entry.key));
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      if (current.key === target) {
        paths.push({
          nodeKeys: current.nodeKeys,
          edges: current.edges,
          pathLength: current.edges.length,
          evidenceState: current.edges.every((edge) => edge.evidenceState === "verified") ? "verified" : "bounded",
        });
        break;
      }
      if (current.edges.length >= 4) continue;
      for (const candidate of adjacency.get(current.key) ?? []) {
        if (visited.has(candidate.next)) continue;
        visited.add(candidate.next);
        queue.push({
          key: candidate.next,
          nodeKeys: [...current.nodeKeys, candidate.next],
          edges: [...current.edges, candidate.edge],
        });
      }
    }
  }

  return {
    state: paths.length ? "complete" : "withheld",
    targetKeys,
    paths,
    rejectedAlternatives: rejectedAlternatives.slice(0, 20),
    explanation: paths.length
      ? "Each returned hop has an exact frozen source receipt; bounded paths remain explicitly weaker than verified paths."
      : "No source-receipted frozen path reached the named target. Receipt-free, candidate, reported-only, and dangling edges remain rejected alternatives.",
  };
}

function artifact(value: Record<string, unknown>): ArtifactReceipt | null {
  const sourceUrl = safeHttpUrl(value.url);
  const contentHash = text(value.contentHash, 200);
  if (value.artifactVerified !== true || !sourceUrl || !contentHash) return null;
  return {
    sourceUrl,
    provider: text(value.provider, 120),
    sourceClass: text(value.sourceClass, 120),
    capturedAt: text(value.capturedAt, 80),
    excerpt: text(value.excerpt, 500),
    contentHash,
  };
}

function host(sourceUrl: string): string {
  try { return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function independence(left: ArtifactReceipt, right: ArtifactReceipt): TypedContradictionReceipt["sourceIndependence"] {
  const leftHost = host(left.sourceUrl);
  const rightHost = host(right.sourceUrl);
  if (!leftHost || !rightHost) return "unknown";
  if (leftHost === rightHost || (left.provider && left.provider === right.provider)) return "dependent";
  return "independent";
}

function statedYears(value: string): number[] {
  return [...value.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
}

function timeAlignment(left: ArtifactReceipt, right: ArtifactReceipt): TypedContradictionReceipt["timeAlignment"] {
  const leftYears = statedYears(left.excerpt);
  const rightYears = statedYears(right.excerpt);
  if (!leftYears.length || !rightYears.length) return "unknown";
  return leftYears.some((year) => rightYears.includes(year)) ? "aligned" : "misaligned";
}

/** Build proposition conflicts only from exact artifact-backed BasicFact sides. */
export function buildTypedContradictionReceipts(packetValue: unknown): TypedContradictionReceipt[] {
  const packet = record(packetValue);
  const reasoning = record(packet.investigationReasoning);
  const projectEvidence = record(reasoning.projectEvidence);
  const receipts: TypedContradictionReceipt[] = [];

  for (const value of rows(projectEvidence.facts)) {
    const fact = record(value);
    const factId = text(fact.factId, 180);
    const proposition = text(fact.value, 800);
    if (!factId || !proposition || text(fact.status, 80) !== "conflicted") continue;
    const sources = rows(fact.sources).map(record);
    const supporting = sources.filter((source) => source.relation === "supports").map(artifact).filter((item): item is ArtifactReceipt => Boolean(item));
    const contradicting = sources.filter((source) => source.relation === "contradicts").map(artifact).filter((item): item is ArtifactReceipt => Boolean(item));
    if (!supporting.length || !contradicting.length) continue;

    const support = supporting[0];
    const contradiction = contradicting[0];
    const scopeAlignment = /related_entity|identity_unresolved/i.test(text(fact.attributionScope, 80))
      ? "different_context" as const
      : "aligned" as const;
    const temporal = timeAlignment(support, contradiction);
    const independent = independence(support, contradiction);
    const explicitSupersession = /\b(?:correct(?:ed|ion)|supersed(?:ed|es)|retract(?:ed|ion)|no longer accurate)\b/i
      .test(contradiction.excerpt)
      && Number.isFinite(Date.parse(support.capturedAt))
      && Date.parse(contradiction.capturedAt) >= Date.parse(support.capturedAt);
    const status = scopeAlignment === "different_context" || temporal === "misaligned"
      ? "different_context" as const
      : explicitSupersession
        ? "superseded" as const
      : temporal === "aligned" && independent === "independent"
        ? "unresolved" as const
        : "withheld" as const;
    const resolutionArtifact = status === "unresolved"
      ? "A current authoritative artifact addressing the same proposition, entity, and period."
      : status === "superseded"
        ? "The frozen correction is the later explicit superseding artifact; recheck only if a newer authoritative artifact appears."
      : temporal === "unknown"
        ? "Dated artifacts that state the proposition period on both sides."
        : independent !== "independent"
          ? "An independently produced artifact addressing the same proposition."
          : "An artifact proving both statements concern the same entity, scope, and period.";
    receipts.push({
      factId,
      proposition,
      conflictProposition: contradiction.excerpt,
      scopeAlignment,
      timeAlignment: temporal,
      sourceIndependence: independent,
      status,
      supportingArtifact: support,
      contradictingArtifact: contradiction,
      resolutionArtifact,
      explanation: status === "unresolved"
        ? "The frozen fact contains independent artifact-backed propositions aligned to the same scope and stated period. ARGUS does not choose a side."
        : status === "superseded"
          ? "A later frozen artifact explicitly says it corrects, retracts, or supersedes the earlier proposition."
          : "The record does not satisfy every proposition-conflict gate, so ARGUS does not label it a genuine unresolved contradiction.",
    });
  }
  return receipts.slice(0, 12);
}
