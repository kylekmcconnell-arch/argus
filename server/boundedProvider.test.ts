import { afterEach, describe, expect, it, vi } from "vitest";
import { withWallClockBox } from "./boundedProvider";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("provider stage deadlines", () => {
  it("aborts a pending fetch and prevents later provider starts", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
    let scoped: typeof fetch | undefined;
    const result = withWallClockBox(async (fetcher) => { scoped = fetcher; await fetcher("https://example.com"); return 7; }, 50);
    await vi.advanceTimersByTimeAsync(51);
    expect(await result).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(() => scoped!("https://example.com/late")).toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not launch a stage after its budget is spent", async () => {
    const work = vi.fn();
    expect(await withWallClockBox(work, 0)).toBeNull();
    expect(work).not.toHaveBeenCalled();
  });
});
