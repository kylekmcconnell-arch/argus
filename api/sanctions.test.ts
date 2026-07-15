import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGetJson, cacheSetJson } = vi.hoisted(() => ({
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ cacheGetJson, cacheSetJson }));

import handler from "./sanctions";
import { screenSanctionedAddresses } from "./_sanctions-core";

// A real OFAC SOL SDN entry: case-sensitive base58, carries uppercase.
const SANCTIONED_SOL = "iBSNRxRQNZ1kbeeHXfk5nJXhkxfz3dR7BvWXvsuY71C";
const SANCTIONED_EVM = "0x8589427373D6D84E98730D7795D8f6f8731FDA16";

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader() { return this; },
  };
  return { res, captured };
}

const request = (query: Record<string, string>) =>
  ({ method: "GET", query, headers: {} } as never);

function listResponse(body: string) {
  return { ok: true, status: 200, text: async () => body } as Response;
}

describe("OFAC address screen", () => {
  beforeEach(() => {
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("detects a case-sensitive Solana SDN hit (the entry is not lowercased at load)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => listResponse(`# OFAC SOL list\n${SANCTIONED_SOL}\n`)));
    const { res, captured } = response();

    await handler(request({ addresses: SANCTIONED_SOL, chain: "solana" }), res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: true, sanctioned: [SANCTIONED_SOL] });
  });

  it("does not fold a Solana address to lowercase before matching", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => listResponse(`${SANCTIONED_SOL}\n`)));
    const { res, captured } = response();

    // A lowercased variant of a case-sensitive address is a different address
    // and must not match.
    await handler(request({ addresses: SANCTIONED_SOL.toLowerCase(), chain: "solana" }), res as never);

    expect(captured.body).toMatchObject({ available: true, sanctioned: [] });
  });

  it("still screens EVM addresses case-insensitively", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => listResponse(`${SANCTIONED_EVM.toLowerCase()}\n`)));
    const { res, captured } = response();

    await handler(request({ addresses: SANCTIONED_EVM, chain: "ethereum" }), res as never);

    expect(captured.body).toMatchObject({ available: true, sanctioned: [SANCTIONED_EVM] });
  });
});

describe("screenSanctionedAddresses (server-side direct screener)", () => {
  beforeEach(() => {
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns undefined when there is nothing screenable (records 'not run')", async () => {
    expect(await screenSanctionedAddresses("ethereum", [null, undefined, "short"])).toBeUndefined();
  });

  it("returns a stamped outcome with the SDN hit, from the raw deployer + holder list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => listResponse(`${SANCTIONED_EVM.toLowerCase()}\n`)));

    const out = await screenSanctionedAddresses("base", [null, SANCTIONED_EVM, "0x1111111111111111111111111111111111111111"]);

    expect(out).toMatchObject({ available: true, checked: 2, sanctioned: [SANCTIONED_EVM] });
    expect(typeof out?.completedAt).toBe("string");
  });

  it("records available:false (never a false clean) when the list is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" } as Response)));

    const out = await screenSanctionedAddresses("ethereum", [SANCTIONED_EVM]);

    expect(out).toMatchObject({ available: false, sanctioned: [] });
  });
});
