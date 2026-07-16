import { createHash } from "node:crypto";
import type { Finding, PanoptesEdge, PanoptesNode } from "../../src/engine";
import type {
  FrozenTrustGraphConnection,
  FrozenTrustGraphTie,
  TrustGraphScreen,
} from "../../src/data/evidence";
import { coverageQualifiedCompleteness } from "../../src/lib/reportPresentation";
import {
  buildAliasResolver,
  canonical,
  subjectConnections,
  tieStrength,
  type GraphContribution,
} from "../../src/graph/network";
import { env } from "../config";
import { recordCall } from "../cost";
import {
  FOUNDER_DILIGENCE_PERSON_CHECK_IDS,
  LEGACY_PERSON_CHECK_IDS,
  PERSON_CHECK_IDS,
  PROJECT_DILIGENCE_PERSON_CHECK_IDS,
} from "../checks";
import type { AdapterRunResult, CollectContext } from "./types";

const GRAPH_LIMIT = 1_000;
const QUERY_LIMIT = 1_000;
const VERSION_CHUNK = 50;
const MAX_RESPONSE_BYTES = 25_000_000;
const MAX_TOTAL_NODES = 40_000;
const MAX_TOTAL_EDGES = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const FINAL_VERDICTS = new Set(["PASS", "CAUTION", "FAIL", "AVOID", "UNVERIFIABLE_IDENTITY"]);
const ADVERSE_VERDICTS = new Set(["FAIL", "AVOID"]);
const HARD_TIE_KEY = /^(?:code:|email:|wallet:|funder:|mint:|token:|ga:|gtm:|adsense:|fbpixel:)/i;
const EXPECTED_PERSON_CHECK_IDS = new Set<string>(PERSON_CHECK_IDS);
const ACCEPTED_CHECK_CONTRACTS = [
  new Set<string>(LEGACY_PERSON_CHECK_IDS),
  new Set<string>(PROJECT_DILIGENCE_PERSON_CHECK_IDS),
  new Set<string>(FOUNDER_DILIGENCE_PERSON_CHECK_IDS),
  EXPECTED_PERSON_CHECK_IDS,
] as const;

type JsonRecord = Record<string, unknown>;

interface Credentials {
  url: string;
  key: string;
}

interface StoredGraphRow {
  handle: string;
  aliases: string[];
  nodes: PanoptesNode[];
  edges: PanoptesEdge[];
  reportVersionId: string;
}

interface VersionRow {
  id: string;
  verdict: string;
  completeness: "complete" | "partial" | "failed";
  attestation: "server_collected" | "analyst_submitted" | "legacy_unattested";
}

interface CheckRow {
  check_id: string;
  report_version_id: string;
  state: "complete" | "partial" | "unavailable" | "failed" | "not_run";
  stale_at: string | null;
  attestation_state: "server_collected" | "analyst_submitted" | "legacy_unattested";
  metadata: JsonRecord;
}

interface QualifiedGraphRow {
  row: StoredGraphRow;
  version: VersionRow;
  checks: CheckRow[];
  active: boolean;
  qualified: boolean;
  marker: string;
  contribution: GraphContribution;
}

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const text = (value: unknown, max = 1_000): string | null =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;

function credentials(): Credentials | null {
  const url = env("SUPABASE_URL")?.replace(/\/$/, "");
  const key = env("SUPABASE_SECRET_KEY")
    || env("SUPABASE_SERVICE_ROLE_KEY")
    || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url, key } : null;
}

function headers(key: string, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {
    apikey: key,
    "content-type": "application/json",
    ...extra,
  };
  // Opaque sb_secret_* keys are API keys, not JWTs. Legacy service-role JWTs
  // still require Authorization for PostgREST compatibility.
  if (!key.startsWith("sb_secret_")) out.authorization = `Bearer ${key}`;
  return out;
}

function queryUrl(base: string, table: string, params: Record<string, string>): string {
  const url = new URL(`${base}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("graph response exceeded the bounded evidence budget");
  }
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("graph response exceeded the bounded evidence budget");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return body ? JSON.parse(body) : [];
  } catch {
    throw new Error("graph response was not valid JSON");
  }
}

function exactCount(response: Response, rowCount: number): number {
  const raw = response.headers.get("content-range")?.trim() ?? "";
  if (raw === "*/0" && rowCount === 0) return 0;
  const match = /^(\d+)-(\d+)\/(\d+)$/.exec(raw);
  if (!match) throw new Error("graph response omitted its exact row count");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (start !== 0 || end - start + 1 !== rowCount || total !== rowCount) {
    throw new Error("graph response was truncated or inconsistently counted");
  }
  return total;
}

async function readExactRows(
  c: Credentials,
  table: string,
  params: Record<string, string>,
): Promise<JsonRecord[]> {
  const op = `trust-graph/${table.replace(/_/g, "-")}`;
  let response: Response;
  try {
    response = await fetch(queryUrl(c.url, table, { ...params, limit: String(QUERY_LIMIT) }), {
      headers: headers(c.key, { prefer: "count=exact" }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    recordCall("supabase", op, 0, `transport_error · ${String(error).slice(0, 160)}`, "failed");
    throw error;
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    recordCall("supabase", op, 0, `http_${response.status}${detail ? ` · ${detail}` : ""}`, "failed");
    throw new Error(`${table} read failed (${response.status}): ${detail}`);
  }
  try {
    const parsed = await boundedJson(response);
    if (!Array.isArray(parsed) || parsed.some((value) => !record(value))) {
      throw new Error(`${table} returned malformed rows`);
    }
    exactCount(response, parsed.length);
    recordCall("supabase", op, 0, `${parsed.length} exact row${parsed.length === 1 ? "" : "s"}`, "succeeded");
    return parsed as JsonRecord[];
  } catch (error) {
    recordCall("supabase", op, 0, `invalid_or_truncated_response · ${String(error).slice(0, 160)}`, "failed");
    throw error;
  }
}

function parseNode(value: unknown): PanoptesNode | null {
  const row = record(value);
  const key = row ? text(row.key, 1_000) : null;
  const type = row ? text(row.type, 100) : null;
  return row && key && type ? { ...row, key, type } as PanoptesNode : null;
}

function parseEdge(value: unknown): PanoptesEdge | null {
  const row = record(value);
  const src = row ? text(row.src, 1_000) : null;
  const dst = row ? text(row.dst, 1_000) : null;
  const type = row ? text(row.type, 100) : null;
  return row && src && dst && type ? { ...row, src, dst, type } as PanoptesEdge : null;
}

function parseGraphRows(rows: JsonRecord[]): StoredGraphRow[] {
  let totalNodes = 0;
  let totalEdges = 0;
  const seenVersions = new Set<string>();
  return rows.map((raw) => {
    const handle = text(raw.handle, 500);
    const reportVersionId = text(raw.report_version_id, 64);
    if (!handle || !reportVersionId || !UUID.test(reportVersionId)) {
      throw new Error("authoritative graph row was not bound to a valid report version");
    }
    if (raw.provenance_state !== "server_collected") {
      throw new Error("non-authoritative graph row entered the authoritative result set");
    }
    if (seenVersions.has(reportVersionId)) {
      throw new Error("one immutable report version was bound to multiple graph subjects");
    }
    seenVersions.add(reportVersionId);

    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.aliases)) {
      throw new Error("authoritative graph row contained malformed graph arrays");
    }
    const nodes = raw.nodes.map(parseNode);
    const edges = raw.edges.map(parseEdge);
    if (!nodes.length || nodes.some((node) => !node) || edges.some((edge) => !edge)) {
      throw new Error("authoritative graph row contained malformed nodes or edges");
    }
    const subjects = nodes.filter((node) => node?.subject === true);
    if (subjects.length !== 1) {
      throw new Error("authoritative graph row must contain exactly one subject node");
    }
    const aliases = raw.aliases.map((value) => text(value, 300));
    if (aliases.some((alias) => !alias)) {
      throw new Error("authoritative graph row contained a malformed alias");
    }
    totalNodes += nodes.length;
    totalEdges += edges.length;
    if (totalNodes > MAX_TOTAL_NODES || totalEdges > MAX_TOTAL_EDGES) {
      throw new Error("authoritative graph exceeded the bounded reconciliation budget");
    }
    return {
      handle,
      reportVersionId: reportVersionId.toLowerCase(),
      aliases: aliases as string[],
      nodes: nodes as PanoptesNode[],
      edges: edges as PanoptesEdge[],
    };
  });
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

async function readVersions(c: Credentials, organizationId: string, ids: string[]): Promise<Map<string, VersionRow>> {
  const out = new Map<string, VersionRow>();
  const seen = new Set<string>();
  for (const group of chunk(ids, VERSION_CHUNK)) {
    const rows = await readExactRows(c, "report_versions", {
      select: "id,verdict,completeness_state,attestation_state",
      organization_id: `eq.${organizationId}`,
      id: `in.(${group.join(",")})`,
    });
    if (rows.length !== group.length) throw new Error("one or more exact graph report versions were unavailable");
    for (const raw of rows) {
      const id = text(raw.id, 64)?.toLowerCase() ?? "";
      const verdict = text(raw.verdict, 40)?.toUpperCase() ?? "";
      const completeness = raw.completeness_state;
      const attestation = raw.attestation_state;
      if (
        !UUID.test(id)
        || !group.includes(id)
        || (completeness !== "complete" && completeness !== "partial" && completeness !== "failed")
        || (attestation !== "server_collected" && attestation !== "analyst_submitted" && attestation !== "legacy_unattested")
        || seen.has(id)
      ) {
        throw new Error("graph report-version metadata was malformed or ambiguous");
      }
      seen.add(id);
      if (!FINAL_VERDICTS.has(verdict)) continue;
      out.set(id, { id, verdict, completeness, attestation });
    }
    if (group.some((id) => !seen.has(id))) throw new Error("graph report-version qualification was incomplete");
  }
  return out;
}

async function readChecks(c: Credentials, organizationId: string, ids: string[]): Promise<Map<string, CheckRow[]>> {
  const out = new Map<string, CheckRow[]>(ids.map((id) => [id, []]));
  for (const group of chunk(ids, VERSION_CHUNK)) {
    const rows = await readExactRows(c, "check_runs", {
      select: "check_id,report_version_id,state,stale_at,attestation_state,metadata",
      organization_id: `eq.${organizationId}`,
      report_version_id: `in.(${group.join(",")})`,
    });
    for (const raw of rows) {
      const reportVersionId = text(raw.report_version_id, 64)?.toLowerCase() ?? "";
      const checkId = text(raw.check_id, 160) ?? "";
      const state = raw.state;
      const staleAt = raw.stale_at;
      const attestation = raw.attestation_state;
      const metadata = record(raw.metadata);
      if (
        !group.includes(reportVersionId)
        || !EXPECTED_PERSON_CHECK_IDS.has(checkId)
        || (state !== "complete" && state !== "partial" && state !== "unavailable" && state !== "failed" && state !== "not_run")
        || (staleAt !== null && (typeof staleAt !== "string" || !Number.isFinite(Date.parse(staleAt))))
        || (attestation !== "server_collected" && attestation !== "analyst_submitted" && attestation !== "legacy_unattested")
        || !metadata
      ) {
        throw new Error("graph check-run metadata was malformed or outside the requested versions");
      }
      out.get(reportVersionId)!.push({
        check_id: checkId,
        report_version_id: reportVersionId,
        state,
        stale_at: staleAt,
        attestation_state: attestation,
        metadata,
      });
    }
  }
  return out;
}

async function readActiveVersionIds(c: Credentials, organizationId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const group of chunk(ids, VERSION_CHUNK)) {
    const rows = await readExactRows(c, "reports", {
      select: "report_version_id",
      organization_id: `eq.${organizationId}`,
      report_version_id: `in.(${group.join(",")})`,
    });
    for (const raw of rows) {
      const reportVersionId = text(raw.report_version_id, 64)?.toLowerCase() ?? "";
      if (!group.includes(reportVersionId) || out.has(reportVersionId)) {
        throw new Error("active report projection was malformed or ambiguously duplicated");
      }
      out.add(reportVersionId);
    }
  }
  return out;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const row = record(value);
  if (!row) return value;
  return Object.fromEntries(
    Object.keys(row).sort().map((key) => [key, stableValue(row[key])]),
  );
}

function semanticHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function semanticContribution(contribution: GraphContribution): JsonRecord {
  const stableJson = (value: unknown) => JSON.stringify(stableValue(value));
  const nodes = [...contribution.nodes].sort((a, b) => {
    const aKey = `${canonical(a.key)}\n${text(a.type, 100) ?? ""}\n${stableJson(a)}`;
    const bKey = `${canonical(b.key)}\n${text(b.type, 100) ?? ""}\n${stableJson(b)}`;
    return aKey.localeCompare(bKey);
  });
  const edges = [...contribution.edges].sort((a, b) => {
    const aKey = `${canonical(a.src)}\n${canonical(a.dst)}\n${text(a.type, 100) ?? ""}\n${stableJson(a)}`;
    const bKey = `${canonical(b.src)}\n${canonical(b.dst)}\n${text(b.type, 100) ?? ""}\n${stableJson(b)}`;
    return aKey.localeCompare(bKey);
  });
  return {
    handle: contribution.handle,
    aliases: [...(contribution.aliases ?? [])].sort((a, b) => canonical(a).localeCompare(canonical(b))),
    nodes,
    edges,
  };
}

function marker(versionId: string): string {
  return `__argus_report_version__:${versionId}`;
}

function qualification(
  row: StoredGraphRow,
  version: VersionRow,
  checks: CheckRow[],
  active: boolean,
): QualifiedGraphRow {
  const checkIds = new Set(checks.map((check) => check.check_id));
  const exactContract = ACCEPTED_CHECK_CONTRACTS.some((contract) =>
    checks.length === contract.size
      && checkIds.size === contract.size
      && [...contract].every((checkId) => checkIds.has(checkId)));
  const checksAttested = exactContract
    && checks.every((check) => check.attestation_state === "server_collected");
  const qualified = active
    && version.attestation === "server_collected"
    && checksAttested
    && coverageQualifiedCompleteness({
      completeness: version.completeness,
      attestation: version.attestation,
      checks,
    }) === "complete";
  const rowMarker = marker(row.reportVersionId);
  return {
    row,
    version,
    checks,
    active,
    qualified,
    marker: rowMarker,
    contribution: {
      handle: row.handle,
      aliases: [rowMarker, ...row.aliases],
      nodes: row.nodes,
      edges: row.edges,
      ...(qualified ? { verdict: version.verdict } : {}),
      reportVersionId: row.reportVersionId,
      provenanceState: "server_collected",
    },
  };
}

function incidentEdgeTypes(
  contribution: GraphContribution,
  key: string,
  resolve: ReturnType<typeof buildAliasResolver>,
): string[] {
  const types = new Set<string>();
  for (const edge of contribution.edges) {
    if (resolve(edge.src) !== key && resolve(edge.dst) !== key) continue;
    const type = text(edge.type, 100);
    if (type) types.add(type);
  }
  return [...types].sort().slice(0, 20);
}

function safeTieStrength(key: string): "hard" | "medium" | "weak" {
  const strength = tieStrength(key);
  return strength === "hard" && !HARD_TIE_KEY.test(key) ? "medium" : strength;
}

function directTie(
  current: GraphContribution,
  other: QualifiedGraphRow,
  resolve: ReturnType<typeof buildAliasResolver>,
): FrozenTrustGraphTie | null {
  const subjectNode = other.contribution.nodes.find((node) => node.subject === true);
  if (!subjectNode) return null;
  const key = resolve(subjectNode.key);
  const subjectEdgeTypes = incidentEdgeTypes(current, key, resolve);
  const otherEdgeTypes = incidentEdgeTypes(other.contribution, key, resolve);
  return {
    key,
    label: text(subjectNode.label, 300) ?? other.row.handle,
    type: text(subjectNode.type, 100) ?? "Subject",
    strength: safeTieStrength(key),
    subjectEdgeTypes,
    otherEdgeTypes,
  };
}

function strongestTie(ties: FrozenTrustGraphTie[]): FrozenTrustGraphTie | null {
  const rank = { hard: 3, medium: 2, weak: 1 } as const;
  return [...ties]
    .filter((tie) => tie.subjectEdgeTypes.length > 0 && tie.otherEdgeTypes.length > 0)
    .sort((a, b) => rank[b.strength] - rank[a.strength] || a.key.localeCompare(b.key))[0] ?? null;
}

function incompleteScreen(note: string): TrustGraphScreen {
  return {
    provider: "argus-graph",
    capturedAt: new Date().toISOString(),
    status: "incomplete",
    contributionCount: 0,
    qualifiedContributionCount: 0,
    sourceContentHash: semanticHash({ status: "incomplete", note }),
    line: note,
    connections: [],
  };
}

function addGraphFinding(
  ctx: CollectContext,
  connection: FrozenTrustGraphConnection,
  tie: FrozenTrustGraphTie,
  artifactHash: string,
  capturedAt: string,
): void {
  if (
    !connection.qualified
    || !connection.otherReportVersionId
    || connection.otherAttestation !== "server_collected"
    || connection.otherCompleteness !== "complete"
    || !connection.otherVerdict
    || !ADVERSE_VERDICTS.has(connection.otherVerdict)
    || tie.strength === "weak"
    || (tie.strength === "hard" && !HARD_TIE_KEY.test(tie.key))
    || !HASH.test(artifactHash)
    || !tie.subjectEdgeTypes.length
    || !tie.otherEdgeTypes.length
  ) return;

  const finding: Finding = {
    finding_type: "TrustGraphConnection",
    claim: `${ctx.evidence.profile.handle} is connected to ${connection.other} (${connection.otherVerdict}) through ${tie.label}. The link is bound to immutable report version ${connection.otherReportVersionId}.`,
    source_url: "",
    source_date: capturedAt,
    source_author: "argus-graph",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
    content_hash: artifactHash,
    trust_graph: {
      tie_key: tie.key,
      tie_type: tie.type,
      tie_strength: tie.strength,
      subject_edge_types: tie.subjectEdgeTypes,
      other_edge_types: tie.otherEdgeTypes,
      other_report_version_id: connection.otherReportVersionId,
      other_attestation: "server_collected",
      other_completeness: "complete",
      other_verdict: connection.otherVerdict,
    },
  };
  ctx.evidence.findings.push(finding);
}

/**
 * Freeze an organization-scoped trust-graph reconciliation before analyst
 * scoring. Mutable graph-row verdict text is never read. Every governing link
 * is qualified against its exact immutable report version and current check
 * freshness; anything missing, stale, partial, truncated, or malformed fails
 * closed as an unavailable check.
 */
export async function collectTrustGraph(
  ctx: CollectContext,
  current: GraphContribution,
): Promise<AdapterRunResult> {
  const c = credentials();
  const organizationId = ctx.organizationId?.trim().toLowerCase() ?? "";
  if (!organizationId || !UUID.test(organizationId) || !c) {
    const note = !organizationId || !UUID.test(organizationId)
      ? "Trust-graph reconciliation requires a valid authenticated organization identifier."
      : "Trust-graph storage is not configured.";
    ctx.evidence.trustGraphScreen = incompleteScreen(note);
    ctx.recordCheck?.({
      id: "trust-graph-connections",
      status: "unavailable",
      note,
      provider: "argus-graph",
    });
    ctx.emit({ phase: "Network", label: "Trust graph unavailable", detail: note, source: "argus-graph", tone: "warn" });
    return { state: "partial", detail: note };
  }

  try {
    const rawRows = await readExactRows(c, "graph_contributions", {
      select: "handle,aliases,nodes,edges,report_version_id,provenance_state",
      organization_id: `eq.${organizationId}`,
      provenance_state: "eq.server_collected",
      report_version_id: "not.is.null",
      order: "updated_at.desc",
    });
    if (rawRows.length > GRAPH_LIMIT) throw new Error("authoritative graph read exceeded its exact row limit");
    const stored = parseGraphRows(rawRows);
    const ids = stored.map((row) => row.reportVersionId);
    let versions = new Map<string, VersionRow>();
    let checks = new Map<string, CheckRow[]>();
    let activeVersions = new Set<string>();
    if (ids.length) {
      // These qualification reads are independent, but the provider ledger must
      // observe every physical attempt before the dossier snapshots cost. Await
      // all three even when one fails, then fail closed with the first rejection.
      const [versionResult, checkResult, activeResult] = await Promise.allSettled([
        readVersions(c, organizationId, ids),
        readChecks(c, organizationId, ids),
        readActiveVersionIds(c, organizationId, ids),
      ]);
      if (versionResult.status === "rejected") throw versionResult.reason;
      if (checkResult.status === "rejected") throw checkResult.reason;
      if (activeResult.status === "rejected") throw activeResult.reason;
      versions = versionResult.value;
      checks = checkResult.value;
      activeVersions = activeResult.value;
    }
    // Historical graph rows tied to non-final reports are ignored rather than
    // allowed to poison reconciliation for every later case in the tenant.
    const qualified = stored.flatMap((row) => {
      const version = versions.get(row.reportVersionId);
      return version ? [qualification(
        row,
        version,
        checks.get(row.reportVersionId) ?? [],
        activeVersions.has(row.reportVersionId),
      )] : [];
    });

    // A prior row for this same subject is replaced by the freshly collected
    // in-memory graph. This prevents an older self-contribution from fabricating
    // a bridge to itself while still allowing every other exact version to join.
    const initialResolver = buildAliasResolver([...qualified.map((item) => item.contribution), current]);
    const currentId = initialResolver(current.handle);
    const others = qualified.filter((item) => initialResolver(item.contribution.handle) !== currentId);
    const contributions = [...others.map((item) => item.contribution), current];
    const resolve = buildAliasResolver(contributions);
    const byMarker = new Map(others.map((item) => [item.marker, item]));
    const rawConnections = subjectConnections(current.handle, contributions, Math.max(1, others.length));
    const connections: FrozenTrustGraphConnection[] = [];

    for (const connection of rawConnections) {
      const other = byMarker.get(connection.other);
      if (!other) throw new Error("trust-graph connection could not be bound to one exact report version");
      const ties: FrozenTrustGraphTie[] = connection.ties.map((tie) => ({
        key: tie.key,
        label: tie.label,
        type: tie.type,
        strength: safeTieStrength(tie.key),
        subjectEdgeTypes: incidentEdgeTypes(current, tie.key, resolve),
        otherEdgeTypes: incidentEdgeTypes(other.contribution, tie.key, resolve),
      }));
      if (connection.direct && !ties.some((tie) => tie.key === resolve(other.row.handle))) {
        const direct = directTie(current, other, resolve);
        if (direct) ties.push(direct);
      }
      const frozen: FrozenTrustGraphConnection = {
        other: other.row.handle,
        otherReportVersionId: other.row.reportVersionId,
        otherAttestation: other.version.attestation,
        otherCompleteness: other.version.completeness,
        ...(other.qualified ? { otherVerdict: other.version.verdict } : {}),
        qualified: other.qualified,
        direct: connection.direct,
        ties: ties.sort((a, b) => a.key.localeCompare(b.key)),
      };
      connections.push(frozen);
    }
    connections.sort((a, b) =>
      (a.otherReportVersionId ?? "").localeCompare(b.otherReportVersionId ?? "")
      || a.other.localeCompare(b.other));

    const capturedAt = new Date().toISOString();
    const artifactHash = semanticHash({
      organizationId,
      subject: semanticContribution(current),
      contributions: qualified
        .map((item) => ({
          graph: semanticContribution(item.contribution),
          reportVersionId: item.row.reportVersionId,
          version: item.version,
          checks: [...item.checks].sort((a, b) =>
            JSON.stringify(stableValue(a)).localeCompare(JSON.stringify(stableValue(b)))),
          active: item.active,
          qualified: item.qualified,
        }))
        .sort((a, b) => a.reportVersionId.localeCompare(b.reportVersionId)),
      connections,
    });
    const connectedUnqualified = connections.filter((connection) => !connection.qualified);
    const adverse = connections.filter((connection) => connection.qualified && connection.otherVerdict && ADVERSE_VERDICTS.has(connection.otherVerdict));
    const hasHardRisk = adverse.some((connection) => {
      const tie = strongestTie(connection.ties);
      return tie?.strength === "hard" && HARD_TIE_KEY.test(tie.key);
    });
    const status: TrustGraphScreen["status"] = connectedUnqualified.length
      ? "incomplete"
      : adverse.length
        ? "risk"
        : "clear";
    const line = connectedUnqualified.length
      ? `${connectedUnqualified.length} graph connection${connectedUnqualified.length === 1 ? "" : "s"} could not be qualified because the linked immutable report is not the active case projection, or is stale, partial, or incompletely attested.`
      : adverse.length
        ? `${adverse.length} exact, coverage-qualified connection${adverse.length === 1 ? "" : "s"} lead to prior FAIL/AVOID reports. Review the frozen ties before relying on the score.`
        : connections.length
          ? `${connections.length} exact graph connection${connections.length === 1 ? "" : "s"} were reconciled; none lead to a coverage-qualified FAIL/AVOID report.`
          : "No connection to a prior authoritative ARGUS report was found in the organization graph.";
    const screen: TrustGraphScreen = {
      provider: "argus-graph",
      capturedAt,
      status,
      contributionCount: others.length,
      qualifiedContributionCount: others.filter((item) => item.qualified).length,
      sourceContentHash: artifactHash,
      ...(adverse.length ? { severity: hasHardRisk ? "avoid" : "caution" } : {}),
      line,
      connections,
    };
    ctx.evidence.trustGraphScreen = screen;
    ctx.evidence.sourceArtifacts.push({
      kind: "trust_graph",
      provider: "argus-graph",
      title: "Organization trust-graph reconciliation",
      capturedAt,
      contentHash: artifactHash,
      sourceContentHash: artifactHash,
      excerpt: line,
      match: status === "risk" ? "risk_signal" : status === "clear" ? "screened_clear" : "observed",
      ...(status === "incomplete" ? { coverageState: "unavailable" as const } : {}),
    });

    for (const connection of adverse) {
      const tie = strongestTie(connection.ties);
      if (tie) addGraphFinding(ctx, connection, tie, artifactHash, capturedAt);
    }

    if (connectedUnqualified.length) {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "unavailable",
        note: line,
        provider: "argus-graph",
        sourceCount: connections.length,
      });
    } else if (adverse.length) {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "finding",
        note: line,
        provider: "argus-graph",
        sourceCount: adverse.length,
      });
    } else if (connections.length) {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "confirmed",
        note: line,
        provider: "argus-graph",
        sourceCount: connections.length,
      });
    } else {
      ctx.recordCheck?.({
        id: "trust-graph-connections",
        status: "checked-empty",
        note: line,
        provider: "argus-graph",
      });
    }

    ctx.emit({
      phase: "Network",
      label: status === "risk" ? "Qualified graph risk" : status === "incomplete" ? "Graph qualification incomplete" : "Trust graph reconciled",
      detail: line,
      source: "argus-graph",
      tone: status === "risk" ? (hasHardRisk ? "bad" : "warn") : status === "incomplete" ? "warn" : "neutral",
    });
    return {
      state: status === "incomplete" ? "partial" : "executed",
      detail: `${others.length} authoritative contributions, ${connections.length} connected`,
    };
  } catch (error) {
    const detail = `Trust-graph reconciliation failed closed: ${String(error)}`.slice(0, 500);
    ctx.evidence.trustGraphScreen = incompleteScreen(detail);
    ctx.recordCheck?.({
      id: "trust-graph-connections",
      status: "unavailable",
      note: detail,
      provider: "argus-graph",
    });
    ctx.emit({ phase: "Network", label: "Trust graph incomplete", detail, source: "argus-graph", tone: "warn" });
    return { state: "failed", detail };
  }
}

// Re-exported for focused tests and future server-side graph producers. It is
// deliberately narrower than tieStrength(): risk:* nodes remain contextual and
// cannot masquerade as wallet/code/email/analytics proof for a hard cap.
export const trustGraphTieStrength = safeTieStrength;
export const trustGraphCanonicalKey = canonical;
