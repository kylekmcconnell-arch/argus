import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-09-14 deep-dive review, token lane finding 7. The shared-report cache
// was keyed by address alone, so the same EVM address on Base and Ethereum
// (CREATE2 / same-nonce deploys, legitimate multichain tokens and scam clones
// alike) shared one row: an Ethereum scan overwrote the Base row, and anyone
// opening the Base share link within the hour was served the Ethereum verdict.
// The row key is now the chain-scoped asset identity the receipts ledger uses.

const { requireArgusAuth } = vi.hoisted(() => ({ requireArgusAuth: vi.fn() }));
vi.mock("./_auth.js", () => ({ requireArgusAuth }));

import handler from "./threat-scan";

const ORG = "00000000-0000-4000-8000-000000000001";
const ADDRESS = "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd";

function scan(chain: string, verdict: string) {
  return { address: ADDRESS, chain, symbol: "SAME", name: "Same Address", scannedAt: Date.now(), call: { verdict, risk: verdict === "SAFE" ? 2 : 70, action: "", flags: [], warnings: [], positives: [] } };
}

async function run(method: "GET" | "POST", input: { query?: Record<string, string>; body?: unknown }) {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
  };
  await handler({ method, query: input.query ?? {}, body: input.body, headers: {} } as never, res as never);
  return captured;
}

describe("/api/threat-scan cache identity", () => {
  const requests: { url: string; body: Record<string, unknown> | null }[] = [];
  beforeEach(() => {
    requests.length = 0;
    vi.stubEnv("SUPABASE_URL", "https://db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    requireArgusAuth.mockResolvedValue({ organizationId: ORG, userId: "u1", role: "analyst" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("stores a scan under chain:address so Base and Ethereum never share a row", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("", { status: 201 });
    }));
    await run("POST", { body: { scan: scan("base", "SAFE") } });
    await run("POST", { body: { scan: scan("ethereum", "DANGER") } });
    expect(requests.map((r) => r.body?.ref)).toEqual([`base:${ADDRESS.toLowerCase()}`, `ethereum:${ADDRESS.toLowerCase()}`]);
  });

  it("refuses to store a scan that does not say which chain it is about", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { status } = await run("POST", { body: { scan: { ...scan("base", "SAFE"), chain: undefined } } });
    expect(status).toBe(400);
  });

  it("looks up by chain:address and never serves the other chain's stored scan", async () => {
    const stored = { ...scan("ethereum", "DANGER"), __build: "dev" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requests.push({ url: String(url), body: null });
      // The store holds only the Ethereum row; a lookup for Base must miss.
      return new Response(JSON.stringify(String(url).includes(encodeURIComponent(`ethereum:${ADDRESS.toLowerCase()}`)) ? [{ payload: stored, ts: new Date().toISOString() }] : []), { status: 200 });
    }));
    const base = await run("GET", { query: { address: ADDRESS, chain: "base" } });
    expect(base.body).toMatchObject({ available: true, hit: false });
    expect(requests[0].url).toContain(`ref=eq.${encodeURIComponent(`base:${ADDRESS.toLowerCase()}`)}`);

    const eth = await run("GET", { query: { address: ADDRESS, chain: "ethereum" } });
    expect(eth.body).toMatchObject({ hit: true });
    expect((eth.body?.scan as { chain: string }).chain).toBe("ethereum");
  });

  it("a stored scan whose own chain disagrees with the request is a miss", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ payload: { ...scan("ethereum", "DANGER"), __build: "dev" }, ts: new Date().toISOString() }]), { status: 200 })));
    const { body } = await run("GET", { query: { address: ADDRESS, chain: "base" } });
    expect(body).toMatchObject({ hit: false });
  });

  it("a lookup with no chain is a miss, not a guess", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { status, body } = await run("GET", { query: { address: ADDRESS } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, hit: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
