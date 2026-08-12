import { serviceHeaders, type ServiceCredentials } from "./_auth.js";

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type JsonRecord = Record<string, unknown>;

export function canonicalGraphKey(raw: string): string {
  const value = String(raw).trim();
  const typed = value.match(/^(token|wallet):([^:]+):(.+)$/i);
  if (typed) {
    const type = typed[1].toLowerCase();
    const chain = typed[2].trim().toLowerCase();
    const address = typed[3].trim();
    return `${type}:${chain}:${chain === "solana" ? address : address.toLowerCase()}`;
  }
  if (SOLANA_ADDRESS.test(value)) return value;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (lower.startsWith("$")) return lower;
  return lower.replace(/^@/, "");
}

export function graphSubjectKey(raw: JsonRecord, nodes: unknown[]): string {
  const subject = nodes.find((node) => {
    const record = node && typeof node === "object" ? node as JsonRecord : null;
    return record?.subject === true && typeof record.key === "string";
  });
  const record = subject && typeof subject === "object" ? subject as JsonRecord : null;
  return canonicalGraphKey(
    (typeof record?.key === "string" ? record.key : null)
      || (typeof raw.handle === "string" ? raw.handle : ""),
  );
}

/**
 * Atomically activates a complete server-collected person report and derives
 * its authoritative graph row from the immutable payload inside Postgres.
 */
export async function activateReportVersionWithAuthoritativeGraph(
  credentials: ServiceCredentials,
  context: {
    organizationId: string;
    reportVersionId: string;
    userId: string;
    attestationState: "server_collected" | "analyst_submitted";
    completeness: "complete" | "partial" | "failed";
  },
): Promise<boolean> {
  if (
    context.attestationState !== "server_collected"
    || context.completeness !== "complete"
    || !UUID.test(context.organizationId)
    || !UUID.test(context.reportVersionId)
    || !UUID.test(context.userId)
  ) return false;

  const response = await fetch(`${credentials.url}/rest/v1/rpc/activate_report_version_with_graph`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: context.organizationId,
      p_report_version_id: context.reportVersionId,
      p_actor_user_id: context.userId,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`atomic report/graph activation failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  return true;
}
