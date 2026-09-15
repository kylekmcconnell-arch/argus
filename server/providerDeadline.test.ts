import { afterEach, expect, it, vi } from "vitest";
import { deadlineFetch, withProviderDeadline } from "./providerDeadline";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("aborts an in-flight adapter and refuses later provider starts", async () => {
  vi.useFakeTimers();
  const mock = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
  vi.stubGlobal("fetch", mock);
  const work = withProviderDeadline(Date.now() + 100, async () => {
    await deadlineFetch("https://provider.example/first").catch(() => null);
    await deadlineFetch("https://provider.example/second");
  });
  const rejected = expect(work).rejects.toThrow("collection_deadline_reached");
  await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(mock).toHaveBeenCalledTimes(1);
});
// 2026-09-14 deep-dive OR-6: the scope aborted its controller on return, so an
// adapter's detached tail cache write (its most expensive answer) was killed
// every time and the next rescan re-bought the call.
it("lets a detached cache write started inside the scope finish after the adapter returns", async () => {
  const aborted: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise<Response>((resolve) => {
    init.signal.addEventListener("abort", () => aborted.push(init.signal.reason));
    setTimeout(() => resolve(Response.json({ ok: true })), 5);
  })));
  let detached: Promise<Response> | undefined;
  await withProviderDeadline(Date.now() + 10_000, async () => {
    detached = deadlineFetch("https://cache.example/write", { method: "POST" });
  });
  await expect(detached).resolves.toBeInstanceOf(Response);
  expect(aborted).toEqual([]);
});
it("does not leak one scan's deadline into another", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  await expect(withProviderDeadline(Date.now() - 1, async () => deadlineFetch("https://provider.example"))).rejects.toThrow();
  await expect(withProviderDeadline(Date.now() + 1000, async () => deadlineFetch("https://provider.example"))).resolves.toBeInstanceOf(Response);
});
