import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "./x-authenticity";

function response() {
  const captured: { status?: number; body?: any; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(k: string, v: string) { captured.headers[k.toLowerCase()] = v; return this; },
  };
  return { res, captured };
}

// Stub the X API v2 read (X_API_BEARER path). description carries the bio text;
// entities.description.urls carries any t.co-expanded links (bios often link the
// CA via a shortener rather than pasting it inline).
function stubBio(bio: string | null, expandedUrls: string[] = []) {
  process.env.X_API_BEARER = "test-bearer";
  const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.twitter.com/2/users/by/username")) {
      if (bio == null) return Promise.resolve(new Response("nope", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify({ data: {
        description: bio,
        entities: expandedUrls.length
          ? { description: { urls: expandedUrls.map((u) => ({ expanded_url: u, display_url: u })) } }
          : undefined,
      } }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    // Any keyless fallback: treat as unreadable so the API path is what's tested.
    return Promise.resolve(new Response("", { status: 403 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function run(query: Record<string, string>) {
  const { res, captured } = response();
  await handler({ query } as any, res as any);
  return captured;
}

const REAL = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

afterEach(() => { vi.unstubAllGlobals(); delete process.env.X_API_BEARER; });

describe("x-authenticity — CA in the project's X bio", () => {
  it("verifies when the scanned CA is present in the bio", async () => {
    stubBio(`Kupo Terminal. CA: ${REAL}`);
    const c = await run({ handle: "kupo", address: REAL, chain: "base" });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe("verified");
    expect(c.body.bioReadable).toBe(true);
  });

  it("verifies case-insensitively (EVM addresses are checksum-cased)", async () => {
    // Real EIP-55 checksum: 0x stays lowercase, hex nibbles vary in case.
    const checksummed = "0x" + REAL.slice(2).toUpperCase();
    stubBio(`Contract ${checksummed}`);
    const c = await run({ handle: "kupo", address: REAL, chain: "base" });
    expect(c.body.status).toBe("verified");
  });

  it("flags impersonation when a DIFFERENT CA is in the bio", async () => {
    stubBio(`Official CA ${OTHER}`);
    const c = await run({ handle: "kupo", address: REAL, chain: "base" });
    expect(c.body.status).toBe("mismatch");
    expect(c.body.otherCa).toBe(OTHER.toLowerCase());
    expect(c.body.note).toMatch(/namesake|impersonation/i);
  });

  it("marks absent when the bio has no contract address at all", async () => {
    stubBio("Pro trading terminal for EVM. Perception layer for agentic finance.");
    const c = await run({ handle: "kupo", address: REAL, chain: "base" });
    expect(c.body.status).toBe("absent");
  });

  it("reads a CA that lives in an expanded bio link, not the description text", async () => {
    stubBio("Kupo Terminal", [`https://basescan.org/token/${REAL}`]);
    const c = await run({ handle: "kupo", address: REAL, chain: "base" });
    expect(c.body.status).toBe("verified");
  });

  it("reports unreadable (never a false pass) when the bio cannot be read", async () => {
    stubBio(null);
    const c = await run({ handle: "kupo", address: REAL, chain: "base" });
    expect(c.body.status).toBe("unreadable");
    expect(c.body.bioReadable).toBe(false);
    expect(c.body.note).toMatch(/manual/i);
  });

  it("400s without a handle or address", async () => {
    stubBio(`CA ${REAL}`);
    const c = await run({ handle: "", address: REAL, chain: "base" });
    expect(c.status).toBe(400);
  });

  it("does not treat an ordinary base58 word as a Solana mint (length gate)", async () => {
    const mint = "So11111111111111111111111111111111111111112";
    stubBio(`gm gm building`); // no 40+ char base58 string
    const c = await run({ handle: "proj", address: mint, chain: "solana" });
    expect(c.body.status).toBe("absent");
  });

  it("matches a real-length Solana mint in the bio", async () => {
    const mint = "So11111111111111111111111111111111111111112";
    stubBio(`token mint ${mint}`);
    const c = await run({ handle: "proj", address: mint, chain: "solana" });
    expect(c.body.status).toBe("verified");
  });
});
