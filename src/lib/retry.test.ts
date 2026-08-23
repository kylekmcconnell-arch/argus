import { afterEach, describe, expect, it, vi } from "vitest";
import { retryFetchWithFreshTimeout } from "./retry";

describe("retryFetchWithFreshTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("retries a transient provider failure with a fresh signal", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const pending = retryFetchWithFreshTimeout("https://provider.example/data", 15_000, {}, 2, fetchImpl);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).signal)
      .not.toBe((fetchImpl.mock.calls[1]?.[1] as RequestInit).signal);
  });

  it("does not retry a terminal 4xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(retryFetchWithFreshTimeout("https://provider.example/data", 15_000, {}, 2, fetchImpl))
      .resolves.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
