// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentIndexAsset, indexAssetFromHtml, startVersionHeartbeat } from "./versionHeartbeat";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bootWith = (asset: string) => {
  const script = document.createElement("script");
  script.setAttribute("src", asset);
  document.head.appendChild(script);
};

describe("index asset parsing", () => {
  it("reads the index bundle from served HTML and from the booted document", () => {
    expect(indexAssetFromHtml('<script src="/assets/index-BtYNK-bd.js"></script>')).toBe("/assets/index-BtYNK-bd.js");
    expect(indexAssetFromHtml("<html>no bundle</html>")).toBeNull();
    bootWith("/assets/index-OLD11111.js");
    expect(currentIndexAsset(document)).toBe("/assets/index-OLD11111.js");
  });
});

describe("startVersionHeartbeat", () => {
  it("fires once when production serves a different index bundle, then stops checking", async () => {
    bootWith("/assets/index-OLD11111.js");
    const fetcher = vi.fn(async () => new Response('<script src="/assets/index-NEW22222.js"></script>', { status: 200 }));
    const onStale = vi.fn();
    startVersionHeartbeat(onStale, { intervalMs: 1000, fetcher: fetcher as never });

    await vi.advanceTimersByTimeAsync(1100);
    expect(onStale).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stays silent while production serves the same bundle, and survives fetch failures", async () => {
    bootWith("/assets/index-SAME3333.js");
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return new Response('<script src="/assets/index-SAME3333.js"></script>', { status: 200 });
    });
    const onStale = vi.fn();
    const stop = startVersionHeartbeat(onStale, { intervalMs: 1000, fetcher: fetcher as never });
    await vi.advanceTimersByTimeAsync(3500);
    expect(onStale).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
