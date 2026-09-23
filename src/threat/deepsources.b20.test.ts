import { afterEach, describe, expect, it, vi } from "vitest";

import { codeFingerprint } from "./deepsources";

afterEach(() => { vi.unstubAllGlobals(); });

describe("codeFingerprint on a B20 answer", () => {
  it("keeps a fingerprint-less system answer instead of dropping it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ available: true, isContract: true, isToken: true, proxy: false, system: "b20", fingerprint: null, capabilities: [] }), { status: 200 })));
    const fp = await codeFingerprint("base", "0xb20000000000000000000070f6c1a66d7c1e4d01");
    expect(fp).toMatchObject({ system: "b20", fingerprint: "", isToken: true });
  });

  it("still drops an answer with neither fingerprint nor system", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ available: true, isContract: false }), { status: 200 })));
    expect(await codeFingerprint("base", "0x1111111111111111111111111111111111111111")).toBeNull();
  });
});
