import { describe, expect, it } from "vitest";
import { adviceFor, alertRecipients, alertSubject, alertText, dedupeAlerts, detectTransitions } from "./alerts";
import type { ProbeResult, ProviderStatusRow, SentinelAlert } from "./types";

const NOW = new Date("2026-09-25T12:00:00Z");

function result(provider: string, status: ProbeResult["status"], extra: Partial<ProbeResult> = {}): ProbeResult {
  return {
    provider,
    label: provider.toUpperCase(),
    status,
    detail: status === "ok" ? "Key accepted" : "HTTP 401: Invalid key",
    latencyMs: 120,
    costly: false,
    optional: false,
    lowCredit: false,
    checkedAt: NOW.toISOString(),
    ...(status === "down" ? { reason: "auth_invalid" as const, httpStatus: 401 } : {}),
    ...extra,
  };
}

type Prior = Pick<ProviderStatusRow, "status" | "low_credit">;
const prior = (entries: Record<string, Prior>) => new Map(Object.entries(entries));

describe("detectTransitions", () => {
  it("alerts when a healthy or new provider goes down or degraded", () => {
    const alerts = detectTransitions(
      [result("xai", "down"), result("serper", "degraded", { reason: "rate_limited" }), result("github", "down")],
      prior({ xai: { status: "ok", low_credit: false }, serper: { status: "ok", low_credit: false } }),
    );
    expect(alerts.map((alert) => [alert.provider, alert.kind])).toEqual([["xai", "down"], ["serper", "degraded"], ["github", "down"]]);
    expect(alerts[0].advice).toContain("Rotate XAI_API_KEY in Vercel");
  });

  it("stays quiet on a steady failing or healthy state", () => {
    expect(detectTransitions([result("xai", "down"), result("github", "ok")], prior({
      xai: { status: "down", low_credit: false },
      github: { status: "ok", low_credit: false },
    }))).toEqual([]);
    expect(detectTransitions([result("xai", "degraded", { reason: "provider_error_5xx" })], prior({ xai: { status: "degraded", low_credit: false } }))).toEqual([]);
  });

  it("escalates degraded -> down but not down -> degraded", () => {
    expect(detectTransitions([result("xai", "down")], prior({ xai: { status: "degraded", low_credit: false } }))[0]?.kind).toBe("down");
    expect(detectTransitions([result("xai", "degraded", { reason: "rate_limited" })], prior({ xai: { status: "down", low_credit: false } }))).toEqual([]);
  });

  it("reports recovery and new low credit", () => {
    const alerts = detectTransitions(
      [result("xai", "ok"), result("monid", "ok", { lowCredit: true, balance: { usd: 4 } }), result("openrouter", "ok", { lowCredit: true })],
      prior({ xai: { status: "down", low_credit: false }, monid: { status: "ok", low_credit: false }, openrouter: { status: "ok", low_credit: true } }),
    );
    expect(alerts.map((alert) => [alert.provider, alert.kind])).toEqual([["xai", "recovered"], ["monid", "low_credit"]]);
  });

  it("never alerts for not_configured providers", () => {
    expect(detectTransitions([result("pdl", "not_configured", { reason: "missing_key" })], prior({ pdl: { status: "ok", low_credit: false } }))).toEqual([]);
  });
});

describe("dedupeAlerts", () => {
  const alert = (provider: string, kind: SentinelAlert["kind"]): SentinelAlert => ({ provider, label: provider, kind, status: "down", detail: "", advice: "" });

  it("suppresses the same provider+kind sent within 6h and allows it after", () => {
    const alerts = [alert("xai", "down"), alert("serper", "down"), alert("xai", "recovered")];
    const sent = [
      { provider: "xai", kind: "down" as const, sent_at: "2026-09-25T07:00:00Z" }, // 5h ago: suppress
      { provider: "serper", kind: "down" as const, sent_at: "2026-09-25T05:59:00Z" }, // >6h ago: allow
    ];
    expect(dedupeAlerts(alerts, sent, NOW).map((a) => `${a.provider}:${a.kind}`)).toEqual(["serper:down", "xai:recovered"]);
  });
});

describe("email composition", () => {
  const alerts: SentinelAlert[] = [
    { provider: "xai", label: "Grok (xAI)", kind: "down", status: "down", reason: "auth_invalid", detail: "HTTP 401", advice: "Rotate" },
    { provider: "serper", label: "Serper", kind: "down", status: "down", reason: "timeout", detail: "No answer", advice: "Wait" },
    { provider: "monid", label: "Monid", kind: "low_credit", status: "ok", detail: "$4", advice: "Top up" },
  ];

  it("builds a clear combined subject", () => {
    expect(alertSubject(alerts)).toBe("[Argus] 2 APIs down, 1 low on credit");
    expect(alertSubject([{ ...alerts[0], kind: "recovered", status: "ok" }])).toBe("[Argus] 1 recovered");
    expect(alertSubject([{ ...alerts[0], kind: "degraded", status: "degraded" }])).toBe("[Argus] 1 API degraded");
  });

  it("groups body lines by kind and includes fixes and the dashboard link", () => {
    const text = alertText(alerts, "https://argus.example/?apis");
    expect(text.indexOf("DOWN")).toBeLessThan(text.indexOf("LOW CREDIT"));
    expect(text).toContain("- Grok (xAI): HTTP 401");
    expect(text).toContain("Fix: Rotate");
    expect(text).toContain("https://argus.example/?apis");
  });

  it("parses recipients and drops junk", () => {
    expect(alertRecipients(" a@b.co, nope ,c@d.io,")).toEqual(["a@b.co", "c@d.io"]);
    expect(alertRecipients(undefined)).toEqual([]);
  });

  it("gives actionable advice per reason", () => {
    expect(adviceFor("xai", "down", "auth_invalid", 401)).toBe("Key rejected (401). Rotate XAI_API_KEY in Vercel and redeploy (https://console.x.ai).");
    expect(adviceFor("supabase", "down", "auth_invalid", 401)).toContain("SUPABASE_SECRET_KEY");
    expect(adviceFor("monid", "down", "out_of_credits")).toContain("Top up");
    expect(adviceFor("pdl", "not_configured", "missing_key")).toContain("Set PDL_API_KEY");
  });
});
