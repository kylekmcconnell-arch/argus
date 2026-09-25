import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireArgusAuth: vi.fn(), serviceCredentials: vi.fn(), serviceHeaders: vi.fn(() => ({ apikey: "server-only" })) }));
vi.mock("./_auth.js", () => auth);
import handler from "./fomo-import";
const address = "0x1111111111111111111111111111111111111111";
const receipt = JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", rows: [{ chain: "base", address, state: "miss" }] });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.requireArgusAuth.mockReset().mockResolvedValue({ organizationId: "workspace-a" });
  auth.serviceCredentials.mockReset().mockReturnValue({ url: "https://database.example", key: "server-only" });
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 })); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
async function run(body: Record<string, unknown> = { receipt }, method = "POST") {
  const result = { code: 0, body: {} as Record<string, unknown> };
  const res = { setHeader: vi.fn(), status(code: number) { result.code = code; return this; }, json(body: Record<string, unknown>) { result.body = body; return this; } };
  await handler({ method, body } as never, res as never); return result;
}
it("validates locally without writes or provider calls", async () => {
  expect((await run()).body).toMatchObject({ mode: "validate", observations: 1, labelled: 0, unlabelled: 1, providerCalls: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("requires an owner and scopes immutable writes to the authenticated workspace", async () => {
  expect((await run({ receipt, apply: true, organizationId: "other" })).body.mode).toBe("applied");
  expect(auth.requireArgusAuth.mock.calls[0][2]).toBe("owner");
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://database.example/rest/v1/fomo_wallet_observations");
  expect(options.headers.prefer).toBe("resolution=ignore-duplicates,return=minimal");
  expect(JSON.parse(options.body)[0]).toMatchObject({ organization_id: "workspace-a", chain: "base", address, state: "unlabelled" });
});
it("does not write after denial or through GET", async () => {
  auth.requireArgusAuth.mockResolvedValue(null); await run({ receipt, apply: true });
  expect((await run({ receipt, apply: true }, "GET")).code).toBe(405); expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects malformed, oversized, future, ambiguous-chain and unbound identity receipts", async () => {
  const invalid = ["{", "x".repeat(1_000_001), receipt.replace("2026-01-01", "2999-01-01"), receipt.replace('"base"', '"evm"'), receipt.replace('"miss"', '"hit"')];
  for (const value of invalid) expect((await run({ receipt: value, apply: true })).code).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects empty and oversized batches before storage", async () => {
  expect((await run({ receipt: JSON.stringify({ generatedAt: "2026-01-01", rows: [] }), apply: true })).code).toBe(400);
  const rows = Array.from({ length: 251 }, (_, i) => ({ chain: "base", address: `0x${(i + 1).toString(16).padStart(40, "0")}`, state: "miss" }));
  expect((await run({ receipt: JSON.stringify({ generatedAt: "2026-01-01", rows }), apply: true })).code).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reports uncertain writes without claiming nothing was inserted", async () => {
  fetchMock.mockRejectedValue(new Error("timeout"));
  expect((await run({ receipt, apply: true })).body).toMatchObject({ available: false, message: expect.stringContaining("Retrying the identical receipt is safe") });
});
