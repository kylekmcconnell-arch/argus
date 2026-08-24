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

export interface PublicControlPathDiscovery {
  id: string;
  headline: string;
  consequence: string;
  reversalCondition: string;
  evidenceHref: string;
  path: string[];
  receipts: Array<{
    label: string;
    href: string;
  }>;
}

export interface PublicClaimConflictDiscovery {
  id: string;
  headline: string;
  consequence: string;
  reversalCondition: string;
  evidenceHref: string;
  receipts: Array<{
    label: string;
    href: string;
  }>;
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

function publicRelationshipLabel(value: string): string {
  const labels: Record<string, string> = {
    AFFILIATED_WITH: "Affiliation receipt",
    ADVISED: "Advisory receipt",
    ASSOCIATES_WITH: "Association receipt",
    ATTRIBUTED_CREATOR: "Creator receipt",
    BUILT_BY: "Builder receipt",
    CONTROLS_WALLET: "Wallet-control receipt",
    DEPLOYED_BY: "Deployment receipt",
    FOUNDED: "Founder receipt",
    FUNDED: "Funding receipt",
    FUNDED_BY: "Funding receipt",
    INVESTED_IN: "Investment receipt",
    RUNS_X: "Account receipt",
    TEAM: "Team receipt",
    WORKED_ON: "Role receipt",
  };
  return labels[value.toUpperCase()] ?? "Relationship receipt";
}

const DECISION_RELEVANT_PUBLIC_RELATIONSHIP = /CONTROLS_WALLET|DEPLOYED_BY|ATTRIBUTED_CREATOR|FOUNDED|BUILT_BY|RUNS_X|TEAM|WORKED_ON|FUNDED|FUNDED_BY|AFFILIATED_WITH|INVESTED_IN|ADVISED/;

/**
 * Find the strongest short path whose every edge has a frozen HTTP receipt.
 * The first graph owns the primary subject; later graphs may extend the path
 * through a shared canonical node. Candidate, inferred, reported-only, and
 * source-less topology is deliberately invisible here.
 */
export function buildPublicControlPathDiscovery(
  graphValues: readonly unknown[],
  evidenceHref: `#${string}`,
): PublicControlPathDiscovery | null {
  const nodes = new Map<string, { key: string; label: string; type: string }>();
  const primarySubjects = new Set<string>();
  const edges: Array<{
    from: string;
    to: string;
    relationship: string;
    sourceUrl: string;
  }> = [];

  graphValues.forEach((graphValue, graphIndex) => {
    const graph = record(graphValue);
    rows(graph.nodes).forEach((nodeValue) => {
      const node = record(nodeValue);
      const key = text(node.key, 180);
      if (!key) return;
      const existing = nodes.get(key);
      nodes.set(key, {
        key,
        label: text(node.label, 240) || existing?.label || key,
        type: text(node.subtype, 80) || text(node.type, 80) || existing?.type || "Entity",
      });
      if (graphIndex === 0 && node.subject === true) primarySubjects.add(key);
    });
    rows(graph.edges).forEach((edgeValue) => {
      const edge = record(edgeValue);
      const from = text(edge.src ?? edge.from, 180);
      const to = text(edge.dst ?? edge.to, 180);
      const relationship = text(edge.type ?? edge.relationship, 120).toUpperCase();
      const sourceUrl = safeHttpUrl(edge.source_url) || safeHttpUrl(edge.sourceUrl) || safeHttpUrl(edge.source);
      const eligibility = [edge.evidence_origin, edge.eligibility, edge.match, edge.tier, edge.verdict, edge.evidence_state]
        .map((value) => text(value, 100)).filter(Boolean).join(" ");
      if (!from || !to || !relationship || !sourceUrl) return;
      if (edge.artifact_verified === false || /candidate|model_lead|name[_ -]?only|reported|unverified|inferred|lead/i.test(eligibility)) return;
      edges.push({ from, to, relationship, sourceUrl });
    });
  });

  if (!primarySubjects.size || !edges.length) return null;
  const adjacency = new Map<string, Array<{ next: string; edge: typeof edges[number] }>>();
  edges.forEach((edge) => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { next: edge.to, edge }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { next: edge.from, edge }]);
  });

  const relationshipWeight = (relationship: string): number => {
    if (/CONTROLS_WALLET|DEPLOYED_BY|ATTRIBUTED_CREATOR/.test(relationship)) return 90;
    if (/FOUNDED|BUILT_BY|RUNS_X|TEAM/.test(relationship)) return 70;
    if (/FUNDED|FUNDED_BY/.test(relationship)) return 60;
    if (/AFFILIATED_WITH|INVESTED_IN|ADVISED|WORKED_ON/.test(relationship)) return 50;
    return 10;
  };
  const candidates: Array<{
    nodeKeys: string[];
    pathEdges: typeof edges;
    score: number;
  }> = [];
  for (const subject of [...primarySubjects].sort()) {
    const queue = [{ key: subject, nodeKeys: [subject], pathEdges: [] as typeof edges }];
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      if (current.pathEdges.length >= 2) {
        const target = nodes.get(current.key);
        const typeBonus = /wallet/i.test(target?.type ?? "") ? 30 : /person/i.test(target?.type ?? "") ? 20 : 10;
        if (current.pathEdges.some((edge) => DECISION_RELEVANT_PUBLIC_RELATIONSHIP.test(edge.relationship))) {
          candidates.push({
            nodeKeys: current.nodeKeys,
            pathEdges: current.pathEdges,
            score: current.pathEdges.reduce((sum, edge) => sum + relationshipWeight(edge.relationship), 0) + typeBonus - current.pathEdges.length,
          });
        }
      }
      if (current.pathEdges.length >= 3) continue;
      for (const candidate of adjacency.get(current.key) ?? []) {
        if (current.nodeKeys.includes(candidate.next)) continue;
        queue.push({
          key: candidate.next,
          nodeKeys: [...current.nodeKeys, candidate.next],
          pathEdges: [...current.pathEdges, candidate.edge],
        });
      }
    }
  }
  const selected = candidates.sort((left, right) =>
    right.score - left.score
    || left.pathEdges.length - right.pathEdges.length
    || left.nodeKeys.join("|").localeCompare(right.nodeKeys.join("|")))[0];
  if (!selected) return null;

  const path = selected.nodeKeys.map((key) => nodes.get(key)?.label || key);
  const relationships = selected.pathEdges.map((edge) => edge.relationship);
  const target = path[path.length - 1];
  const middle = path.slice(1, -1).join(" → ");
  const consequence = relationships.some((relationship) => /CONTROLS_WALLET|DEPLOYED_BY|ATTRIBUTED_CREATOR/.test(relationship))
    ? "This source-backed path identifies the wallet or operator closest to practical control, so the control risk can be assessed against a real entity."
    : relationships.some((relationship) => /FOUNDED|BUILT_BY|RUNS_X|TEAM|WORKED_ON/.test(relationship))
      ? "This source-backed path binds a named operator to the official project identity, so accountability and track record can be assessed against a person."
      : relationships.some((relationship) => /AFFILIATED_WITH|INVESTED_IN|FUNDED|FUNDED_BY/.test(relationship))
        ? "This source-backed path shows the vehicle through which the relationship reaches the project instead of collapsing it into a direct personal claim."
        : "Every link in this relationship path has a frozen source receipt; source-less graph topology was excluded.";
  return {
    id: `control-path:${selected.nodeKeys.join(">")}`,
    headline: `${path[0]} connects to ${target}${middle ? ` via ${middle}` : ""}`,
    consequence,
    reversalCondition: "A newer primary source that breaks or reattributes any link in this path would change this read.",
    evidenceHref,
    path,
    receipts: selected.pathEdges.map((edge, index) => ({
      label: `${publicRelationshipLabel(edge.relationship)} ${index + 1}`,
      href: edge.sourceUrl,
    })),
  };
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
  if (/candidate|model_lead|name[_ -]?only|namesake|inferred/i.test(edge.eligibility)) return "candidate_edge";
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

function publicFactTopic(predicate: string): string {
  const topics: Record<string, string> = {
    audit: "security audit claim",
    control: "control claim",
    education: "education claim",
    executive: "leadership claim",
    exit: "exit claim",
    founded: "founding date",
    founder: "founder claim",
    funding: "funding claim",
    governance: "governance claim",
    launched: "launch date",
    legal_entity: "legal entity claim",
    legal_regulatory_event: "legal or regulatory claim",
    official_identity: "identity claim",
    official_token: "official token claim",
    partnership: "partnership claim",
    product: "product claim",
    public_security: "public security claim",
    repository: "repository claim",
    security_incident: "security incident claim",
    tokenomics: "token supply claim",
    track_record: "track record claim",
    traction: "usage claim",
    treasury: "treasury claim",
    vesting: "vesting claim",
  };
  return topics[predicate.toLowerCase()] ?? "public claim";
}

function shortStatement(value: string, max = 170): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
  return `${clipped || clean.slice(0, max - 1)}…`;
}

function quotedStatement(value: string): string {
  return shortStatement(value).replace(/[.!?]+$/, "");
}

/**
 * Promote only a genuine official-claim-versus-independent-record conflict.
 * Both sides must be frozen verified artifacts about the audited subject and
 * the same stated period. Ambiguous scope, undated comparisons, same-source
 * restatements, leads, and generic public pages stay in the evidence chapter.
 */
export function buildPublicClaimConflictDiscovery(
  factValues: readonly unknown[],
  evidenceHref: `#${string}`,
): PublicClaimConflictDiscovery | null {
  const candidates: Array<{
    factId: string;
    predicate: string;
    proposition: string;
    support: ArtifactReceipt;
    contradiction: ArtifactReceipt;
    score: number;
  }> = [];
  const independentClasses = new Set(["official_counterparty", "regulatory_or_onchain", "independent_press"]);
  const importance = new Map([
    ["control", 100], ["legal_regulatory_event", 95], ["security_incident", 95], ["audit", 90],
    ["official_identity", 90], ["official_token", 85], ["founder", 80], ["executive", 75],
    ["funding", 75], ["governance", 70], ["tokenomics", 70], ["vesting", 70],
    ["launched", 60], ["founded", 60], ["partnership", 55], ["traction", 50],
  ]);

  for (const value of factValues) {
    const fact = record(value);
    const factId = text(fact.factId, 180);
    const predicate = text(fact.predicate, 100).toLowerCase();
    const proposition = text(fact.value, 800);
    if (!factId || !predicate || !proposition || text(fact.status, 80) !== "conflicted") continue;
    if (text(fact.attributionScope, 80) !== "direct_subject") continue;
    const sourceRows = rows(fact.sources).map(record);
    const supports = sourceRows.flatMap((source) => {
      const receipt = source.relation === "supports" && source.sourceClass === "official_subject" ? artifact(source) : null;
      return receipt ? [receipt] : [];
    });
    const contradictions = sourceRows.flatMap((source) => {
      const receipt = source.relation === "contradicts" && independentClasses.has(text(source.sourceClass, 80)) ? artifact(source) : null;
      return receipt ? [receipt] : [];
    });
    for (const support of supports) {
      for (const contradiction of contradictions) {
        if (independence(support, contradiction) !== "independent") continue;
        if (timeAlignment(support, contradiction) !== "aligned") continue;
        const propositionYears = statedYears(proposition);
        if (propositionYears.length > 0) {
          const supportYears = new Set(statedYears(support.excerpt));
          const contradictionYears = new Set(statedYears(contradiction.excerpt));
          if (!propositionYears.some((year) => supportYears.has(year) && contradictionYears.has(year))) continue;
        }
        candidates.push({
          factId,
          predicate,
          proposition,
          support,
          contradiction,
          score: importance.get(predicate) ?? 40,
        });
      }
    }
  }

  const selected = candidates.sort((left, right) =>
    right.score - left.score
    || left.factId.localeCompare(right.factId)
    || left.contradiction.sourceUrl.localeCompare(right.contradiction.sourceUrl))[0];
  if (!selected) return null;

  const topic = publicFactTopic(selected.predicate);
  const independentHost = host(selected.contradiction.sourceUrl);
  const independentLabel = selected.contradiction.sourceClass === "regulatory_or_onchain"
    ? "a registry or on-chain record"
    : selected.contradiction.sourceClass === "official_counterparty"
      ? "the named counterparty"
      : "an independent source";
  return {
    id: `claim-conflict:${selected.factId}`,
    headline: `The official ${topic} conflicts with ${independentLabel}`,
    consequence: `The project says “${quotedStatement(selected.proposition)}”; the independent record says “${quotedStatement(selected.contradiction.excerpt)}.” ARGUS leaves the conflict unresolved instead of choosing a side.`,
    reversalCondition: "A current primary record that resolves both statements for the same entity and period would change this read.",
    evidenceHref,
    receipts: [
      { label: "Official claim", href: selected.support.sourceUrl },
      { label: independentHost ? `Independent record · ${independentHost}` : "Independent record", href: selected.contradiction.sourceUrl },
    ],
  };
}
