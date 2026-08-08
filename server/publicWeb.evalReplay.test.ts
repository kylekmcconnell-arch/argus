import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRecordedFetch } from "./evalHarness";

const nativeHttpRequest = vi.hoisted(() => vi.fn(() => {
  throw new Error("native HTTP transport escaped frozen replay");
}));
const nativeHttpsRequest = vi.hoisted(() => vi.fn(() => {
  throw new Error("native HTTPS transport escaped frozen replay");
}));

vi.mock("node:http", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:http")>(),
  request: nativeHttpRequest,
}));
vi.mock("node:https", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:https")>(),
  request: nativeHttpsRequest,
}));

let dir: string;
let realFetch: typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "argus-public-web-replay-"));
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("public web eval transport", () => {
  it("answers publicWeb from the frozen fetch recording without native HTTP or HTTPS", async () => {
    const url = "https://public.example/report";
    globalThis.fetch = vi.fn(async () => new Response(
      "<html><body>Frozen official report</body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    )) as typeof fetch;
    await withRecordedFetch("record", dir, async () => {
      await fetch(url);
      return null;
    });

    const liveFetch = vi.fn(async () => new Response("must not run", { status: 500 }));
    globalThis.fetch = liveFetch as typeof fetch;
    const { fetchPublicText } = await import("./publicWeb");
    const replay = await withRecordedFetch("replay", dir, () => fetchPublicText(url));

    expect(replay.result).toMatchObject({
      status: "ok",
      url,
      text: "<html><body>Frozen official report</body></html>",
    });
    expect(replay.fidelity.exactHits).toBe(1);
    expect(replay.fidelity.misses).toHaveLength(0);
    expect(liveFetch).not.toHaveBeenCalled();
    expect(nativeHttpRequest).not.toHaveBeenCalled();
    expect(nativeHttpsRequest).not.toHaveBeenCalled();
  });

  it("fails closed on an uncovered publicWeb request without opening a native socket", async () => {
    globalThis.fetch = vi.fn(async () => new Response("must not run", { status: 500 })) as typeof fetch;
    const { fetchPublicText } = await import("./publicWeb");
    const replay = await withRecordedFetch("replay", dir, () =>
      fetchPublicText("https://unrecorded.example/report"));

    expect(replay.result).toEqual({ status: "failed", reason: "transport_error" });
    expect(replay.fidelity.misses).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(nativeHttpRequest).not.toHaveBeenCalled();
    expect(nativeHttpsRequest).not.toHaveBeenCalled();
  });
});
