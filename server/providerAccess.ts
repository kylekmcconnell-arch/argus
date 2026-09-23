import { AsyncLocalStorage } from "node:async_hooks";

export interface ProviderAccessFailure {
  provider: "grok";
  httpStatus: 401 | 403;
  model: string;
  endpoint: "chat" | "search";
  diagnostic: "credentials_rejected" | "billing_required" | "model_access_denied" | "access_denied";
  requestId?: string;
}

// Request-local only: one account or scan must never disable another.
const access = new AsyncLocalStorage<Map<string, ProviderAccessFailure>>();
export function withProviderAccessScope<T>(work: () => T): T {
  return access.run(new Map(), work);
}

export function grokAccessFailure(model: string, endpoint: "chat" | "search" = "chat"): ProviderAccessFailure | undefined {
  return access.getStore()?.get("*") ?? access.getStore()?.get(`${endpoint}:${model}`);
}

/** Retain only controlled diagnostic categories, never arbitrary response text. */
export async function recordGrokAccessFailure(response: Response, model: string, endpoint: "chat" | "search" = "chat"): Promise<void> {
  if (response.status !== 401 && response.status !== 403) return;
  const failure: ProviderAccessFailure = {
    provider: "grok", httpStatus: response.status, model, endpoint,
    diagnostic: response.status === 401 ? "credentials_rejected" : "access_denied",
  };
  // Close the circuit before reading the diagnostic body. Already in-flight
  // calls may finish; subsequent calls to this model stop without fake usage.
  access.getStore()?.set(response.status === 401 ? "*" : `${endpoint}:${model}`, failure);
  const requestId = response.headers.get("x-request-id") || response.headers.get("request-id");
  if (requestId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) failure.requestId = requestId;
  const reader = response.body?.getReader();
  if (reader) {
    let text = "";
    let bytes = 0;
    const deadline = Date.now() + 1000;
    try {
      while (bytes < 4096 && Date.now() < deadline) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("diagnostic_timeout")), Math.max(1, deadline - Date.now()));
            timer.unref?.();
          }),
        ]).finally(() => clearTimeout(timer));
        if (result.done) break;
        text += new TextDecoder().decode(result.value.subarray(0, 4096 - bytes));
        bytes += result.value.byteLength;
      }
      if (/credit|billing|payment|spending.limit|insufficient.balance/i.test(text)) failure.diagnostic = "billing_required";
      else if (/model.*(?:access|permission|not.allowed|not.available)/i.test(text)) failure.diagnostic = "model_access_denied";
    } catch { /* HTTP rejection remains useful when the error body is unreadable. */ }
    finally { void reader.cancel().catch(() => undefined); }
  }
  console.info("[provider-access]", JSON.stringify(failure));
}
