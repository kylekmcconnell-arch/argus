import { describe, expect, it } from "vitest";
import { PROBES, runProbes } from "./probes";
import { costlyProbeDue, nextStatusRow, runSentinel } from "./run";
import type { ProviderStatusRow } from "./types";

const NOW = new Date("2026-09-25T12:00:00Z");
const THRESHOLDS = { lowUsd: 20, lowQuotaPct: 10 };
const XAI_KEY = "xai-TESTKEY0123456789abcdefghij";

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(routes: Array<[RegExp, Route]>, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response("no route", { status: 599 });
    return route[1](url, init);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("runProbes", () => {
  it("classifies live responses, marks missing keys, and never echoes the key", async () => {
    const env = {
      XAI_API_KEY: XAI_KEY,
      GITHUB_TOKEN: "ghp_TESTTOKEN000000000000",
      MONID_API_KEY: "monid-test",
      PDL_API_KEY: "pdl-test",
      ETHERSCAN_API_KEY: "ether-test",
      COINGECKO_API_KEY: "cg-test",
    };
    const fetcher = fakeFetch([
      [/api\.x\.ai\/v1\/api-key/, () => json({ error: `Incorrect API key provided: ${XAI_KEY}` }, 401)],
      [/api\.github\.com\/rate_limit/, () => json({ resources: { core: { limit: 5000, remaining: 4990, reset: 1790000000 } } })],
      [/monid\.ai\/v1\/wallet\/balance/, () => json({ balance: { value: 5, currency: "USD" } })],
      [/peopledatalabs\.com/, () => json({ status: 404, error: { type: "not_found" } }, 404, { "x-totallimit-remaining": "812" })],
      [/etherscan\.io/, () => json({ status: "0", message: "NOTOK", result: "Invalid API Key (#err2)|x" })],
      [/coingecko\.com\/api\/v3\/key/, () => new Promise<Response>((_, reject) => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        reject(error);
      })],
    ]);
    const { results } = await runProbes({ env, fetcher, thresholds: THRESHOLDS, now: () => NOW });
    const by = Object.fromEntries(results.map((row) => [row.provider, row]));

    expect(by.xai).toMatchObject({ status: "down", reason: "auth_invalid", httpStatus: 401 });
    expect(by.xai.detail).not.toContain(XAI_KEY);
    expect(by.github).toMatchObject({ status: "ok", lowCredit: false });
    expect(by.github.balance?.quota).toMatchObject({ limit: 5000, remaining: 4990 });
    expect(by.monid).toMatchObject({ status: "ok", lowCredit: true, balance: { usd: 5 } });
    expect(by.pdl).toMatchObject({ status: "ok", balance: { credits: 812 } });
    expect(by.etherscan).toMatchObject({ status: "down", reason: "auth_invalid" });
    expect(by.coingecko).toMatchObject({ status: "down", reason: "timeout" });
    expect(by.serper).toMatchObject({ status: "not_configured", reason: "missing_key", detail: "SERPER_API_KEY not set" });
    expect(by.supabase.detail).toContain("SUPABASE_URL");
    expect(results).toHaveLength(PROBES.length);
    for (const row of results) expect(JSON.stringify(row)).not.toMatch(/TESTKEY|TESTTOKEN|ether-test|pdl-test|monid-test/);
  });

  it("skips probes that are not due and reports them", async () => {
    const env = { ARKHAM_API_KEY: "ark-test", GITHUB_TOKEN: "gh-test" };
    const calls: Array<{ url: string }> = [];
    const fetcher = fakeFetch([[/github/, () => json({ resources: { core: { limit: 10, remaining: 10 } } })]], calls);
    const { results, skipped } = await runProbes({ env, fetcher, thresholds: THRESHOLDS, shouldRun: (def) => !def.costly });
    expect(skipped).toEqual(["arkham"]);
    expect(results.find((row) => row.provider === "arkham")).toBeUndefined();
    expect(calls.some((call) => call.url.includes("arkm.com"))).toBe(false);
  });

  it("honours SENTINEL_DISABLED_PROBES", async () => {
    const { skipped } = await runProbes({ env: { GITHUB_TOKEN: "x", SENTINEL_DISABLED_PROBES: "github" }, fetcher: fakeFetch([]), thresholds: THRESHOLDS });
    expect(skipped).toContain("github");
  });
});

describe("schedule and state rows", () => {
  const arkham = PROBES.find((def) => def.id === "arkham")!;
  const github = PROBES.find((def) => def.id === "github")!;
  const row = (status: ProviderStatusRow["status"], checkedAt: string): ProviderStatusRow => ({
    provider: "arkham", label: "Arkham", status, reason: null, detail: "", latency_ms: 1, http_status: 200, costly: true,
    optional: false, low_credit: false, balance: null, checked_at: checkedAt, last_ok_at: checkedAt, last_change_at: checkedAt,
  });
  const six = 6 * 60 * 60 * 1000;

  it("runs costly probes every 6h, when forced, or while failing", () => {
    expect(costlyProbeDue(github, undefined, NOW, six, false)).toBe(true);
    expect(costlyProbeDue(arkham, undefined, NOW, six, false)).toBe(true);
    expect(costlyProbeDue(arkham, row("ok", "2026-09-25T09:00:00Z"), NOW, six, false)).toBe(false);
    expect(costlyProbeDue(arkham, row("ok", "2026-09-25T05:59:00Z"), NOW, six, false)).toBe(true);
    expect(costlyProbeDue(arkham, row("ok", "2026-09-25T11:00:00Z"), NOW, six, true)).toBe(true);
    expect(costlyProbeDue(arkham, row("down", "2026-09-25T11:45:00Z"), NOW, six, false)).toBe(true);
  });

  it("tracks last ok and last change", () => {
    const prev = row("ok", "2026-09-25T11:45:00Z");
    const failing = nextStatusRow({ provider: "arkham", label: "Arkham", status: "down", reason: "auth_invalid", detail: "HTTP 401", latencyMs: 90, costly: true, optional: false, lowCredit: false, checkedAt: NOW.toISOString() }, prev);
    expect(failing).toMatchObject({ status: "down", last_ok_at: prev.last_ok_at, last_change_at: NOW.toISOString(), reason: "auth_invalid" });
    const steady = nextStatusRow({ provider: "arkham", label: "Arkham", status: "ok", detail: "ok", latencyMs: 90, costly: true, optional: false, lowCredit: false, checkedAt: NOW.toISOString() }, prev);
    expect(steady).toMatchObject({ last_ok_at: NOW.toISOString(), last_change_at: prev.last_change_at });
  });
});

describe("runSentinel", () => {
  function supabaseRoutes(previous: unknown[], sentAlerts: unknown[], writes: Array<{ path: string; method: string; body: unknown }>): Array<[RegExp, Route]> {
    return [
      [/supabase\.test\/rest\/v1\//, (url, init) => {
        const path = url.replace(/^.*\/rest\/v1\//, "");
        const method = init?.method ?? "GET";
        if (method === "GET" && path.startsWith("provider_status")) return json(previous);
        if (method === "GET" && path.startsWith("provider_alerts")) return json(sentAlerts);
        if (method === "GET" && path.startsWith("argus_members")) return json([]);
        writes.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(null, { status: method === "POST" ? 201 : 204 });
      }],
      [/api\.x\.ai/, () => json({ error: "Incorrect API key" }, 401)],
      [/github\.com/, () => json({ resources: { core: { limit: 5000, remaining: 5000 } } })],
    ];
  }
  const baseEnv = {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SECRET_KEY: "sb_secret_TEST",
    XAI_API_KEY: XAI_KEY,
    GITHUB_TOKEN: "gh-test",
    RESEND_API_KEY: "re_TESTKEY_abcdefghijk",
    SENTINEL_ALERT_EMAILS: "owner@example.com",
  };
  const prevOk: ProviderStatusRow = {
    provider: "xai", label: "Grok (xAI)", status: "ok", reason: null, detail: "Key accepted", latency_ms: 80, http_status: 200,
    costly: false, optional: false, low_credit: false, balance: null, checked_at: "2026-09-25T11:45:00Z", last_ok_at: "2026-09-25T11:45:00Z", last_change_at: "2026-09-24T00:00:00Z",
  };

  it("stores results and sends one combined email on a transition", async () => {
    const writes: Array<{ path: string; method: string; body: unknown }> = [];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const routes = supabaseRoutes([prevOk, { ...prevOk, provider: "github", label: "GitHub" }], [], writes);
    routes.push([/api\.resend\.com/, () => json({ id: "email_1" })]);
    const result = await runSentinel({ trigger: "cron", env: baseEnv, fetcher: fakeFetch(routes, calls), now: () => NOW, log: () => undefined });

    expect(result.stored).toBe(true);
    expect(result.email).toBe("sent");
    expect(result.alerts.map((alert) => `${alert.provider}:${alert.kind}`)).toEqual(["xai:down"]);
    const emails = calls.filter((call) => call.url.includes("resend.com/emails"));
    expect(emails).toHaveLength(1);
    const payload = JSON.parse(String(emails[0].init?.body)) as { subject: string; to: string[]; text: string };
    expect(payload.subject).toBe("[Argus] 1 API down");
    expect(payload.to).toEqual(["owner@example.com"]);
    expect(payload.text).not.toContain(XAI_KEY);
    const alertWrite = writes.find((write) => write.path.startsWith("provider_alerts") && write.method === "POST");
    expect(alertWrite?.body).toEqual([expect.objectContaining({ provider: "xai", kind: "down", delivered: true })]);
    expect(writes.some((write) => write.path.startsWith("provider_status"))).toBe(true);
    expect(writes.some((write) => write.path.startsWith("provider_checks") && write.method === "POST")).toBe(true);
    expect(writes.some((write) => write.path.startsWith("provider_checks") && write.method === "DELETE")).toBe(true);
    expect(writes.some((write) => write.path.startsWith("provider_sentinel_runs") && write.method === "POST")).toBe(true);
  });

  it("does not re-send an alert delivered within 6h", async () => {
    const writes: Array<{ path: string; method: string; body: unknown }> = [];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const routes = supabaseRoutes([prevOk], [{ provider: "xai", kind: "down", sent_at: "2026-09-25T10:00:00Z" }], writes);
    routes.push([/api\.resend\.com/, () => json({ id: "email_1" })]);
    const result = await runSentinel({ trigger: "cron", env: baseEnv, fetcher: fakeFetch(routes, calls), now: () => NOW, log: () => undefined });
    expect(result.alerts).toEqual([]);
    expect(result.email).toBe("none");
    expect(calls.some((call) => call.url.includes("resend.com/emails"))).toBe(false);
  });

  it("logs and continues when Resend is not configured", async () => {
    const writes: Array<{ path: string; method: string; body: unknown }> = [];
    const logs: string[] = [];
    const env = { ...baseEnv, RESEND_API_KEY: "" };
    const result = await runSentinel({ trigger: "cron", env, fetcher: fakeFetch(supabaseRoutes([prevOk], [], writes)), now: () => NOW, log: (line) => logs.push(line) });
    expect(result.email).toBe("not_configured");
    expect(result.stored).toBe(true);
    expect(logs.join("\n")).toContain("not emailed");
    const alertWrite = writes.find((write) => write.path.startsWith("provider_alerts") && write.method === "POST");
    expect(alertWrite?.body).toEqual([expect.objectContaining({ provider: "xai", delivered: false })]);
  });

  it("does not alert when the previous state cannot be read", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const routes: Array<[RegExp, Route]> = [
      [/supabase\.test/, () => new Response("relation does not exist", { status: 404 })],
      [/api\.x\.ai/, () => json({}, 401)],
    ];
    const result = await runSentinel({ trigger: "cron", env: baseEnv, fetcher: fakeFetch(routes, calls), now: () => NOW, log: () => undefined });
    expect(result.stored).toBe(false);
    expect(result.alerts).toEqual([]);
    expect(result.errors.join(" ")).toContain("provider_status");
    expect(calls.some((call) => call.url.includes("resend.com/emails"))).toBe(false);
  });
});
