import { describe, expect, it } from "vitest";
import { formatBalance, pillLabel, pillTone, relativeTime, sortProviders, uptimeStrip, type SentinelProviderView } from "./providerSentinelView";

const NOW = new Date("2026-09-25T12:00:00Z");

describe("provider sentinel view helpers", () => {
  it("maps status to pill tone and label", () => {
    expect(pillTone(null)).toBe("grey");
    expect(pillTone({ status: "ok", lowCredit: false })).toBe("green");
    expect(pillTone({ status: "ok", lowCredit: true })).toBe("amber");
    expect(pillTone({ status: "degraded", lowCredit: false })).toBe("amber");
    expect(pillTone({ status: "down", lowCredit: false })).toBe("red");
    expect(pillTone({ status: "not_configured", lowCredit: false })).toBe("grey");
    expect(pillLabel({ status: "ok", lowCredit: true })).toBe("Low credit");
    expect(pillLabel(null)).toBe("Not checked");
  });

  it("buckets 24h history into slots taking the worst tone and leaving gaps", () => {
    const strip = uptimeStrip([
      { status: "ok", lowCredit: false, checkedAt: "2026-09-25T11:50:00Z", latencyMs: 1 },
      { status: "down", lowCredit: false, checkedAt: "2026-09-25T11:40:00Z", latencyMs: 1 },
      { status: "ok", lowCredit: false, checkedAt: "2026-09-24T12:10:00Z", latencyMs: 1 },
      { status: "down", lowCredit: false, checkedAt: "2026-09-23T12:00:00Z", latencyMs: 1 },
    ], NOW, 48);
    expect(strip).toHaveLength(48);
    expect(strip[47]).toBe("red");
    expect(strip[0]).toBe("green");
    expect(strip[20]).toBeNull();
  });

  it("formats balances", () => {
    expect(formatBalance({ usd: 4.5, label: "wallet balance" })).toBe("$4.50 wallet balance");
    expect(formatBalance({ quota: { limit: 5000, remaining: 250 }, label: "hourly requests" })).toBe("250 / 5,000 (5%) hourly requests");
    expect(formatBalance({ credits: 1200 })).toBe("1,200");
    expect(formatBalance(null)).toBeNull();
  });

  it("formats relative time", () => {
    expect(relativeTime(null, NOW)).toBe("never");
    expect(relativeTime("2026-09-25T11:59:30Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-25T11:45:00Z", NOW)).toBe("15m ago");
    expect(relativeTime("2026-09-25T06:00:00Z", NOW)).toBe("6h ago");
  });

  it("sorts failing providers first and unconfigured last", () => {
    const view = (provider: string, status: "ok" | "down" | "degraded" | "not_configured" | null): SentinelProviderView => ({
      provider, label: provider, optional: false, costly: false, costNote: "", endpoint: "", console: "", envVars: [], uptime24h: null, history: [],
      current: status ? { status, reason: null, detail: "", latencyMs: null, httpStatus: null, lowCredit: false, balance: null, checkedAt: "", lastOkAt: null, lastChangeAt: null, advice: "" } : null,
    });
    const sorted = sortProviders([view("a", "ok"), view("b", "not_configured"), view("c", "down"), view("d", "degraded"), view("e", null)]);
    expect(sorted.map((row) => row.provider)).toEqual(["c", "d", "a", "b", "e"]);
  });
});
