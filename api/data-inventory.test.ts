import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireArgusAuth: vi.fn(), serviceCredentials: vi.fn(), serviceHeaders: vi.fn(() => ({ apikey: "server-only" })) }));
vi.mock("./_auth.js", () => auth);
import handler from "./data-inventory";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.requireArgusAuth.mockReset().mockResolvedValue({ organizationId: "workspace-a" });
  auth.serviceCredentials.mockReset().mockReturnValue({ url: "https://database.example", key: "server-only" });
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, datasets: [], dailySpend: { recordedUsd: 0 } })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
async function run(method = "GET") {
  const result = { code: 0, body: {} as Record<string, unknown> };
  const res = { setHeader: vi.fn(), status(code: number) { result.code = code; return this; }, json(body: Record<string, unknown>) { result.body = body; return this; } };
  await handler({ method, query: { organizationId: "attacker-workspace" } } as never, res as never);
  return result;
}
it("requires owner and derives scope from authentication, never request parameters", async () => {
  expect((await run()).body.available).toBe(true);
  expect(auth.requireArgusAuth.mock.calls[0][2]).toBe("owner");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ p_organization_id: "workspace-a" });
});
it("never reads storage after denied access or a mutation request", async () => {
  auth.requireArgusAuth.mockResolvedValue(null); await run();
  expect((await run("POST")).code).toBe(405);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not present failed or malformed storage as empty", async () => {
  for (const response of [new Response("failure", { status: 503 }), new Response("{}")]) {
    fetchMock.mockResolvedValueOnce(response);
    expect((await run()).body).toMatchObject({ available: false });
  }
});
