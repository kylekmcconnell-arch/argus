// Tenant-scoped, append-only provider usage feed for the Providers workspace.
// Reads immutable events and resolves their exact report version, case label,
// and initiating analyst without exposing provider keys or opaque idempotency.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";

type JsonRecord = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asRecord = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown, max = 500) => typeof value === "string" ? value.slice(0, max) : "";
const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

async function rows(url: string, key: string): Promise<JsonRecord[]> {
  const response = await fetch(url, {
    headers: serviceHeaders(key),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`provider usage read failed (${response.status})`);
  const value = await response.json() as unknown;
  return Array.isArray(value) ? value.map(asRecord) : [];
}

async function rpcRows(url: string, key: string, body: JsonRecord): Promise<JsonRecord[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: serviceHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`provider usage summary failed (${response.status})`);
  const value = await response.json() as unknown;
  return Array.isArray(value) ? value.map(asRecord) : [];
}

const inFilter = (ids: readonly string[]) => encodeURIComponent(`in.(${ids.join(",")})`);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "usage_unavailable", message: "Provider usage storage is unavailable." });
    return;
  }

  const rawVersion = typeof req.query.reportVersionId === "string" ? req.query.reportVersionId.trim() : "";
  if (rawVersion && !UUID.test(rawVersion)) {
    res.status(400).json({ error: "invalid_report_version" });
    return;
  }
  const rawLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 40;
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 40;
  const organizationId = encodeURIComponent(auth.organizationId);

  try {
    const eventUrl = new URL(`${credentials.url}/rest/v1/provider_usage_events`);
    eventUrl.searchParams.set("select", "id,report_version_id,provider,operation,calls,usd,status,meta,initiated_by,created_at");
    eventUrl.searchParams.set("organization_id", `eq.${auth.organizationId}`);
    if (rawVersion) eventUrl.searchParams.set("report_version_id", `eq.${rawVersion}`);
    eventUrl.searchParams.set("order", "created_at.desc,id.desc");
    eventUrl.searchParams.set("limit", String(limit));
    const [events, summaryRows] = await Promise.all([
      rows(eventUrl.toString(), credentials.key),
      rpcRows(`${credentials.url}/rest/v1/rpc/get_provider_usage_summary`, credentials.key, {
        p_organization_id: auth.organizationId,
        p_report_version_id: rawVersion || null,
      }),
    ]);
    const summary = summaryRows[0] ?? {};

    const versionIds = [...new Set(events.map((event) => text(event.report_version_id, 36)).filter((id) => UUID.test(id)))];
    const actorIds = [...new Set(events.map((event) => text(event.initiated_by, 36)).filter((id) => UUID.test(id)))];
    const [versions, members] = await Promise.all([
      versionIds.length
        ? rows(`${credentials.url}/rest/v1/report_versions?select=id,case_id,version&organization_id=eq.${organizationId}&id=${inFilter(versionIds)}`, credentials.key)
        : Promise.resolve([]),
      actorIds.length
        ? rows(`${credentials.url}/rest/v1/argus_members?select=user_id,display_name&organization_id=eq.${organizationId}&user_id=${inFilter(actorIds)}`, credentials.key)
        : Promise.resolve([]),
    ]);
    const caseIds = [...new Set(versions.map((version) => text(version.case_id, 36)).filter((id) => UUID.test(id)))];
    const cases = caseIds.length
      ? await rows(`${credentials.url}/rest/v1/cases?select=id,kind,canonical_ref,display_query&organization_id=eq.${organizationId}&id=${inFilter(caseIds)}`, credentials.key)
      : [];

    const versionById = new Map(versions.map((version) => [text(version.id, 36), version]));
    const caseById = new Map(cases.map((reportCase) => [text(reportCase.id, 36), reportCase]));
    const actorById = new Map(members.map((member) => [text(member.user_id, 36), text(member.display_name, 80) || "Analyst"]));

    const result = events.map((event) => {
      const reportVersionId = text(event.report_version_id, 36);
      const version = versionById.get(reportVersionId);
      const reportCase = version ? caseById.get(text(version.case_id, 36)) : undefined;
      const initiatedBy = text(event.initiated_by, 36);
      return {
        id: text(event.id, 36),
        reportVersionId,
        provider: text(event.provider, 100),
        operation: text(event.operation, 160),
        calls: Math.max(0, Math.floor(number(event.calls))),
        usd: Math.max(0, number(event.usd)),
        status: text(event.status, 20) || "succeeded",
        meta: text(event.meta, 500) || undefined,
        createdAt: text(event.created_at, 40),
        actor: initiatedBy ? actorById.get(initiatedBy) ?? "Analyst" : "System / legacy",
        report: reportCase ? {
          kind: text(reportCase.kind, 30),
          ref: text(reportCase.canonical_ref, 500),
          label: text(reportCase.display_query, 500) || text(reportCase.canonical_ref, 500),
          version: Math.max(0, Math.floor(number(version?.version))),
        } : undefined,
      };
    });

    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      available: true,
      events: result,
      window: {
        limit,
        eventCount: result.length,
      },
      totals: {
        eventCount: Math.max(0, Math.floor(number(summary.event_count))),
        calls: Math.max(0, Math.floor(number(summary.calls))),
        usd: Math.max(0, number(summary.usd)),
      },
    });
  } catch (error) {
    console.error("[provider-usage] read failed", error);
    res.status(503).json({ error: "usage_unavailable", message: "Provider usage events could not be loaded." });
  }
}
