import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireArgusAuth, serviceCredentials } from "./_auth.js";

export const config = { maxDuration: 20 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["todo", "planned", "in_progress", "done", "wont_do"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

function adminClient(): SupabaseClient | null {
  const credentials = serviceCredentials();
  if (!credentials) return null;
  return createClient(credentials.url, credentials.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requestBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const value = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function cleanRoute(value: unknown): string {
  if (typeof value !== "string") return "/";
  const route = value.trim().slice(0, 500);
  return route.startsWith("/") && !route.startsWith("//") ? route : "/";
}

function cleanContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > 4000) return {};
  return value as Record<string, unknown>;
}

async function listFeedback(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client
    .from("feedback_items")
    .select("id,created_by,assigned_agent,status,priority,route,report_version_id,body,context,completed_at,created_at,updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    res.status(405).setHeader("Allow", "GET, POST, PATCH").json({ error: "method_not_allowed" });
    return;
  }
  const minimumRole = req.method === "POST" ? "viewer" : "owner";
  const auth = await requireArgusAuth(req, res, minimumRole);
  if (!auth) return;
  const client = adminClient();
  if (!client) {
    res.status(503).json({ error: "feedback_storage_unavailable" });
    return;
  }

  try {
    if (req.method === "GET") {
      res.status(200).json({ items: await listFeedback(client, auth.organizationId) });
      return;
    }

    const body = requestBody(req);
    if (!body) {
      res.status(400).json({ error: "valid_json_body_required" });
      return;
    }

    if (req.method === "POST") {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      const priority = typeof body.priority === "string" ? body.priority : "normal";
      const reportVersionId = typeof body.reportVersionId === "string" && UUID.test(body.reportVersionId)
        ? body.reportVersionId
        : null;
      if (text.length < 8 || text.length > 4000) {
        res.status(400).json({ error: "feedback_length_invalid" });
        return;
      }
      if (!PRIORITIES.has(priority)) {
        res.status(400).json({ error: "invalid_priority" });
        return;
      }
      const { data, error } = await client
        .from("feedback_items")
        .insert({
          organization_id: auth.organizationId,
          created_by: auth.userId,
          assigned_agent: "claude",
          status: "todo",
          priority,
          route: cleanRoute(body.route),
          report_version_id: reportVersionId,
          body: text,
          context: cleanContext(body.context),
        })
        .select("id,status,priority,created_at")
        .single();
      if (error) throw error;
      res.status(201).json({ item: data });
      return;
    }

    const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    const priority = typeof body.priority === "string" ? body.priority : "";
    if (!id) {
      res.status(400).json({ error: "valid_feedback_id_required" });
      return;
    }
    if (status && !STATUSES.has(status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    if (priority && !PRIORITIES.has(priority)) {
      res.status(400).json({ error: "invalid_priority" });
      return;
    }
    if (!status && !priority) {
      res.status(400).json({ error: "feedback_update_required" });
      return;
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) {
      update.status = status;
      update.completed_at = status === "done" ? new Date().toISOString() : null;
    }
    if (priority) update.priority = priority;
    const { data, error } = await client
      .from("feedback_items")
      .update(update)
      .eq("organization_id", auth.organizationId)
      .eq("id", id)
      .select("id,status,priority,completed_at,updated_at")
      .single();
    if (error) throw error;
    res.status(200).json({ item: data });
  } catch (error) {
    console.error("[feedback] failed", error);
    res.status(503).json({
      error: "feedback_unavailable",
      message: "The feedback queue is temporarily unavailable.",
    });
  }
}
