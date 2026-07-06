// Live provider health. GET /api/health -> { services: [{id, label, ok, detail, action}] }
//
// The deep digs degrade SILENTLY when a paid provider dies (Grok out of credits
// -> team searches return nothing and reports just look thin). This live-tests
// the critical providers with minimal-cost calls so the UI can show a loud
// banner with the exact reason and where to top up. Results are cheap enough
// to run per report view; the client caches per session anyway.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 25 };

interface Svc { id: string; label: string; ok: boolean; detail?: string; action?: string }

const trim = (s: string) => s.replace(/\s+/g, " ").slice(0, 180);

async function probeXai(key: string): Promise<Svc> {
  const base = { id: "xai", label: "Grok (xAI)", action: "top up at console.x.ai" };
  try {
    // A tiny generation call — credit exhaustion only shows on generation.
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ARGUS_GROK_MODEL || "grok-4-fast", input: [{ role: "user", content: "ok" }], max_output_tokens: 16 }),
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok) return { ...base, ok: true };
    return { ...base, ok: false, detail: trim(`${r.status}: ${await r.text()}`) };
  } catch (e) {
    return { ...base, ok: false, detail: trim(String(e)) };
  }
}

async function probeAnthropic(key: string): Promise<Svc> {
  const base = { id: "anthropic", label: "Claude analyst", action: "check console.anthropic.com billing" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
      signal: AbortSignal.timeout(12000),
    });
    if (r.ok) return { ...base, ok: true };
    return { ...base, ok: false, detail: trim(`${r.status}: ${await r.text()}`) };
  } catch (e) {
    return { ...base, ok: false, detail: trim(String(e)) };
  }
}

async function probeTwitterapi(key: string): Promise<Svc> {
  const base = { id: "twitterapi", label: "twitterapi.io", action: "top up at twitterapi.io" };
  try {
    const r = await fetch("https://api.twitterapi.io/twitter/user/info?userName=x", {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return { ...base, ok: true };
    return { ...base, ok: false, detail: trim(`${r.status}: ${await r.text()}`) };
  } catch (e) {
    return { ...base, ok: false, detail: trim(String(e)) };
  }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const probes: Promise<Svc>[] = [];
  if (process.env.XAI_API_KEY) probes.push(probeXai(process.env.XAI_API_KEY));
  if (process.env.ANTHROPIC_API_KEY) probes.push(probeAnthropic(process.env.ANTHROPIC_API_KEY));
  if (process.env.TWITTERAPI_KEY) probes.push(probeTwitterapi(process.env.TWITTERAPI_KEY));
  const services = await Promise.all(probes);
  res.setHeader("cache-control", "s-maxage=120"); // CDN-cache 2 min: many report views, one probe
  res.status(200).json({ available: true, services, down: services.filter((s) => !s.ok).length });
}
