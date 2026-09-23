import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireArgusAuth: vi.fn(), serviceCredentials: vi.fn(), serviceHeaders: vi.fn(() => ({ apikey: "server-only" })) }));
vi.mock("./_auth.js", () => auth);
import handler from "./holder-history";
const token = "0x1234567890123456789012345678901234567890";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.requireArgusAuth.mockReset().mockResolvedValue({ organizationId: "workspace-a" });
  auth.serviceCredentials.mockReset().mockReturnValue({ url: "https://database.example", key: "server-only" });
  fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
async function run(query = { chain: "base", token }, method = "GET") {
  const result = { code: 0, body: {} as Record<string, unknown> };
  const res = { setHeader: vi.fn(), status(code: number) { result.code = code; return this; }, json(body: Record<string, unknown>) { result.body = body; return this; } };
  await handler({ method, query } as never, res as never);
  return result;
}
it("scopes every storage read to the authenticated workspace and canonical token", async () => {
  const result = await run();
  const url = new URL(fetchMock.mock.calls[0][0]);
  expect(url.searchParams.get("organization_id")).toBe("eq.workspace-a");
  expect(url.searchParams.get("token_address")).toBe(`eq.${token}`);
  expect(url.searchParams.get("limit")).toBe("1000");
  expect(result.body).toMatchObject({ available: true, rows: [], truncated: false });
});
it("does not fetch for unauthenticated requests", async () => {
  auth.requireArgusAuth.mockResolvedValue(null);
  await run(); expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves Solana case in historical identity", async () => {
  const mint = "So11111111111111111111111111111111111111112";
  await run({ chain: "solana", token: mint });
  expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("token_address")).toBe(`eq.${mint}`);
});
it("rejects malformed identities and mutations before storage", async () => {
  expect((await run({ chain: "base", token: "invalid" })).code).toBe(400);
  expect((await run(undefined, "POST")).code).toBe(405);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("distinguishes failed storage from an empty history", async () => {
  fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
  expect((await run()).body).toMatchObject({ available: false });
  expect((await run()).body).not.toHaveProperty("rows");
});
it("discloses a bounded response rather than implying complete history", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(Array.from({ length: 1000 }, () => ({})))));
  expect((await run()).body.truncated).toBe(true);
});
