// Shared Grok-primary / Claude-fallback helpers for API routes.
// Every Argus LLM call uses XAI_API_KEY + api.x.ai by default. Anthropic and
// OpenRouter stay optional and only run when providerFallbacksEnabled().

export function providerFallbacksEnabled(): boolean {
  const raw = (process.env.ARGUS_PROVIDER_FALLBACKS || "").trim().toLowerCase();
  return raw === "on" || raw === "1" || raw === "true";
}

export function grokAnalystModel(): string {
  return process.env.ARGUS_GROK_ANALYST_MODEL || process.env.ARGUS_GROK_MODEL || "grok-4-fast";
}

export function claudeAnalystModel(): string {
  return process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";
}

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export function grokTextFromResponse(data: { choices?: Array<{ message?: { content?: unknown } }> } | null | undefined): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}

export function claudeTextFromResponse(data: { content?: Array<{ text?: unknown }> } | null | undefined): string {
  return (data?.content ?? []).map((block) => typeof block.text === "string" ? block.text : "").join(" ");
}

export function claudeToolInput(data: { content?: Array<{ type?: unknown; name?: unknown; input?: unknown }> } | null | undefined, name?: string): unknown {
  return (data?.content ?? []).find((block) =>
    block.type === "tool_use" && (!name || block.name === name))?.input;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function grokUsageFromChat(data: { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null | undefined): { input_tokens?: number; output_tokens?: number } {
  return {
    input_tokens: data?.usage?.prompt_tokens,
    output_tokens: data?.usage?.completion_tokens,
  };
}

export async function grokChat(opts: {
  key: string;
  system: string;
  user: string | Array<Record<string, unknown>>;
  maxTokens: number;
  timeoutMs: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}): Promise<{ ok: true; status: number; data: Record<string, unknown>; text: string } | { ok: false; status: number }> {
  const body: Record<string, unknown> = {
    model: grokAnalystModel(),
    max_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: opts.jsonSchema.name,
        strict: true,
        schema: opts.jsonSchema.schema,
      },
    };
  }
  let response: Response;
  try {
    response = await fetch(XAI_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: true, status: response.status, data, text: grokTextFromResponse(data as { choices?: Array<{ message?: { content?: unknown } }> }) };
}

export async function claudeMessages(opts: {
  key: string;
  system: string;
  user: string | Array<Record<string, unknown>>;
  maxTokens: number;
  timeoutMs: number;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: Record<string, unknown>;
}): Promise<{ ok: true; status: number; data: Record<string, unknown>; text: string } | { ok: false; status: number }> {
  const body: Record<string, unknown> = {
    model: claudeAnalystModel(),
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": opts.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: true, status: response.status, data, text: claudeTextFromResponse(data as { content?: Array<{ text?: unknown }> }) };
}

/** Image + text Grok call. Returns the same {ok,text,data} shape as grokChat. */
export async function grokVision(opts: {
  key: string;
  system: string;
  text: string;
  mediaType: string;
  imageBase64: string;
  maxTokens: number;
  timeoutMs: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}): Promise<{ ok: true; status: number; data: Record<string, unknown>; text: string } | { ok: false; status: number }> {
  return grokChat({
    key: opts.key,
    system: opts.system,
    user: [
      { type: "image_url", image_url: { url: `data:${opts.mediaType};base64,${opts.imageBase64}` } },
      { type: "text", text: opts.text },
    ],
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    jsonSchema: opts.jsonSchema,
  });
}

export async function claudeVision(opts: {
  key: string;
  system: string;
  text: string;
  mediaType: string;
  imageBase64: string;
  maxTokens: number;
  timeoutMs: number;
  tools?: Array<Record<string, unknown>>;
  toolChoice?: Record<string, unknown>;
}): Promise<{ ok: true; status: number; data: Record<string, unknown>; text: string } | { ok: false; status: number }> {
  return claudeMessages({
    key: opts.key,
    system: opts.system,
    user: [
      { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.imageBase64 } },
      { type: "text", text: opts.text },
    ],
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    tools: opts.tools,
    toolChoice: opts.toolChoice,
  });
}
