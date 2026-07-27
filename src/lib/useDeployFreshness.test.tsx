// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeployFreshness } from "./useDeployFreshness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Probe() {
  const stale = useDeployFreshness();
  return <span>{stale ? "stale" : "fresh"}</span>;
}

const headResponse = (lastModified: string | null) => ({
  headers: { get: (name: string) => (name.toLowerCase() === "last-modified" ? lastModified : null) },
}) as unknown as Response;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDeployFreshness", () => {
  it("marks the tab stale when index.html's last-modified changes after load", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(headResponse("Sat, 26 Jul 2026 16:14:26 GMT"))
      .mockResolvedValue(headResponse("Sun, 27 Jul 2026 16:20:00 GMT"));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe("fresh");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(container.textContent).toBe("stale");
    expect(fetchMock).toHaveBeenCalledWith("/", expect.objectContaining({ method: "HEAD" }));
  });

  it("stays quiet while the deploy is unchanged and on probe failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(headResponse("Sat, 26 Jul 2026 16:14:26 GMT"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(headResponse("Sat, 26 Jul 2026 16:14:26 GMT"));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<Probe />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(container.textContent).toBe("fresh");
  });
});
