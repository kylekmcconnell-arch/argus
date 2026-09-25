import { describe, expect, it } from "vitest";
import { classifyBodyError, classifyError, classifyHttp, isLowCredit, providerMessage, sanitizeMessage, thresholdsFromEnv } from "./classify";

describe("classifyHttp", () => {
  it("maps HTTP statuses to sentinel status and reason", () => {
    expect(classifyHttp(200)).toEqual({ status: "ok" });
    expect(classifyHttp(401)).toEqual({ status: "down", reason: "auth_invalid" });
    expect(classifyHttp(403, "Forbidden")).toEqual({ status: "down", reason: "auth_invalid" });
    expect(classifyHttp(402)).toEqual({ status: "down", reason: "out_of_credits" });
    expect(classifyHttp(429, "Too Many Requests")).toEqual({ status: "degraded", reason: "rate_limited" });
    expect(classifyHttp(503)).toEqual({ status: "degraded", reason: "provider_error_5xx" });
    expect(classifyHttp(404, "not here")).toEqual({ status: "degraded", reason: "unexpected_response" });
  });

  it("reads billing wording in 403/429/4xx bodies as out of credits", () => {
    expect(classifyHttp(403, '{"error":"Your team has run out of credits"}')).toEqual({ status: "down", reason: "out_of_credits" });
    expect(classifyHttp(429, "monthly quota exceeded")).toEqual({ status: "down", reason: "out_of_credits" });
    expect(classifyHttp(429, "rate limit exceeded, quota exceeded")).toEqual({ status: "degraded", reason: "rate_limited" });
    expect(classifyHttp(400, "Insufficient balance")).toEqual({ status: "down", reason: "out_of_credits" });
    expect(classifyHttp(400, "Invalid API key")).toEqual({ status: "down", reason: "auth_invalid" });
  });
});

describe("classifyError / classifyBodyError", () => {
  it("treats aborts and timeouts as timeout", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(classifyError(timeout)).toEqual({ status: "down", reason: "timeout" });
    expect(classifyError(new TypeError("fetch failed"))).toEqual({ status: "down", reason: "unexpected_response" });
  });

  it("classifies 200-with-error bodies", () => {
    expect(classifyBodyError("NOTOK Invalid API Key (#err2)")).toEqual({ status: "down", reason: "auth_invalid" });
    expect(classifyBodyError("NOTOK Max calls per sec rate limit reached")).toEqual({ status: "degraded", reason: "rate_limited" });
    expect(classifyBodyError("weird")).toEqual({ status: "degraded", reason: "unexpected_response" });
  });
});

describe("sanitizeMessage / providerMessage", () => {
  it("never leaks the key or key-shaped tokens", () => {
    const secret = "xai-abcdefghijklmnopqrstuvwxyz0123";
    const text = `Incorrect API key provided: ${secret}. Also sk-live_ABCDEFGHIJKLMNOP and api_key=ZZZZZZZZZZZZZZZZ`;
    const clean = sanitizeMessage(text, [secret], 400);
    expect(clean).not.toContain(secret);
    expect(clean).not.toContain("sk-live_ABCDEFGHIJKLMNOP");
    expect(clean).not.toContain("ZZZZZZZZZZZZZZZZ");
    expect(clean).toContain("Incorrect API key provided");
  });

  it("truncates and flattens", () => {
    expect(sanitizeMessage("a\n  b", [], 10)).toBe("a b");
    expect(sanitizeMessage("x".repeat(20).split("").join(" "), [], 10)).toHaveLength(10);
  });

  it("extracts nested provider messages and ignores HTML", () => {
    expect(providerMessage('{"error":{"message":"Invalid token"}}')).toBe("Invalid token");
    expect(providerMessage('{"detail":"Not allowed"}')).toBe("Not allowed");
    expect(providerMessage("<html>502</html>")).toBe("");
    expect(providerMessage("plain text")).toBe("plain text");
  });
});

describe("low credit thresholds", () => {
  it("defaults to $20 and 10%", () => {
    expect(thresholdsFromEnv({})).toEqual({ lowUsd: 20, lowQuotaPct: 10 });
    expect(thresholdsFromEnv({ SENTINEL_LOW_USD: "5", SENTINEL_LOW_QUOTA_PCT: "25" })).toEqual({ lowUsd: 5, lowQuotaPct: 25 });
    expect(thresholdsFromEnv({ SENTINEL_LOW_USD: "nope" })).toEqual({ lowUsd: 20, lowQuotaPct: 10 });
  });

  it("flags USD below floor and quota below percentage", () => {
    const t = { lowUsd: 20, lowQuotaPct: 10 };
    expect(isLowCredit({ usd: 19.99 }, t)).toBe(true);
    expect(isLowCredit({ usd: 20 }, t)).toBe(false);
    expect(isLowCredit({ quota: { limit: 1000, remaining: 99 } }, t)).toBe(true);
    expect(isLowCredit({ quota: { limit: 1000, remaining: 100 } }, t)).toBe(false);
    expect(isLowCredit({ credits: 3 }, t)).toBe(false);
    expect(isLowCredit(undefined, t)).toBe(false);
  });
});
