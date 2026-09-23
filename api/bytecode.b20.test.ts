import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "./bytecode";

afterEach(() => { vi.unstubAllGlobals(); });

// Base B20 assets hold a 1-byte 0xef marker instead of runtime code. The route
// must report the standard - not an EOA, not an unverified contract - and must
// not issue a fingerprint, since every B20 asset shares the marker.

function call(chain: string, code: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: code }), { status: 200 })));
  const out: { status?: number; body?: Record<string, unknown> } = {};
  const res = { status(s: number) { out.status = s; return this; }, json(b: Record<string, unknown>) { out.body = b; return this; } };
  const req = { query: { address: "0xb20000000000000000000070F6c1A66D7C1e4d01", chain } };
  return handler(req as never, res as never).then(() => out);
}

describe("bytecode route on a B20 system asset", () => {
  it("reports the standard with no fingerprint", async () => {
    const r = await call("base", "0xef");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ available: true, isContract: true, isToken: true, system: "b20", fingerprint: null, capabilities: [] });
    expect(String(r.body?.verdict && (r.body.verdict as { line: string }).line)).toMatch(/B20 system asset/);
  });

  it("a 0xef body off Base is still an empty account, not a B20 asset", async () => {
    const r = await call("ethereum", "0xef");
    expect(r.body).toMatchObject({ available: true, isContract: false });
    expect(r.body?.system).toBeUndefined();
  });
});
