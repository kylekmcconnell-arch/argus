import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installSessionExpiryWatch,
  resetSessionExpiryForTest,
  sessionExpired,
  subscribeSessionExpiry,
} from "./sessionExpiry";

const reply = (status: number) => ({ status, ok: status < 400 }) as Response;

function harness(inner: (input: unknown) => Response) {
  const target = {
    fetch: (async (input: unknown) => inner(input)) as unknown as typeof fetch,
    location: { origin: "https://argus.example" },
  };
  installSessionExpiryWatch(target);
  return target;
}

afterEach(() => resetSessionExpiryForTest());

describe("session expiry watch", () => {
  it("flags an expired session on a 401 from an ARGUS api route", async () => {
    const seen = vi.fn();
    subscribeSessionExpiry(seen);
    const target = harness(() => reply(401));

    expect(sessionExpired()).toBe(false);
    await target.fetch("/api/providers");
    expect(sessionExpired()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);

    // Repeat failures must not re-notify: the notice is stated once.
    await target.fetch("https://argus.example/api/graph");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("ignores a 401 from somewhere that is not an ARGUS api route", async () => {
    const target = harness(() => reply(401));
    await target.fetch("https://api.gopluslabs.io/api/v1/token_security/1");
    await target.fetch("https://argus.example/assets/index.js");
    expect(sessionExpired()).toBe(false);
  });

  it("passes every response through untouched, including failures", async () => {
    const target = harness((input) => reply(String(input).includes("report") ? 401 : 200));
    const ok = await target.fetch("/api/health");
    const denied = await target.fetch("/api/report");
    expect(ok.status).toBe(200);
    expect(denied.status).toBe(401);
    expect(sessionExpired()).toBe(true);
  });

  it("installs once, so a second call cannot double-wrap fetch", async () => {
    const inner = vi.fn(() => reply(200));
    const target = harness(inner);
    installSessionExpiryWatch(target);
    await target.fetch("/api/health");
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
