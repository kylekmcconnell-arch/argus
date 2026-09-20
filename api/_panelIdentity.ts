import type { VercelRequest } from "@vercel/node";

/**
 * The workspace and analyst behind a middleware-gated panel request.
 *
 * These headers are set by middleware AFTER authentication and always
 * overwrite whatever arrived on the wire, so a handler can trust them on any
 * path the middleware gates. They are advisory only: a missing value means
 * "do not attribute", never "allow anonymously". Admission is the
 * middleware's job; this is only for writing the receipt (#356).
 */
export interface PanelIdentity {
  organizationId: string;
  userId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const header = (req: VercelRequest, name: string): string | undefined => {
  // Never assume the request shape: attributing spend must not be able to
  // crash a panel that would otherwise answer.
  const value = (req.headers ?? {})[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && UUID.test(first.trim()) ? first.trim() : undefined;
};

export function panelIdentity(req: VercelRequest): PanelIdentity | null {
  const organizationId = header(req, "x-argus-organization-id");
  if (!organizationId) return null;
  const userId = header(req, "x-argus-user-id");
  return userId ? { organizationId, userId } : { organizationId };
}
