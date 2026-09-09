import { expect, it, vi } from "vitest";
import { recordCall } from "./cost";
vi.mock("../src/token/audit", () => ({ auditToken: vi.fn() }));
import { auditToken as collect } from "../src/token/audit";
import { auditToken } from "./tokenAudit";
it("captures paid token usage in an isolated ledger per concurrent scan", async () => {
  vi.mocked(collect).mockImplementation(async (input) => {
    recordCall("twitterapi", "social-post-read", input.ref === "one" ? 0.02 : 0.04);
    await Promise.resolve();
    return { address: input.ref } as never;
  });
  const [one, two] = await Promise.all([
    auditToken({ kind: "token", via: "evm", ref: "one" }),
    auditToken({ kind: "token", via: "evm", ref: "two" }),
  ]);
  expect(one?.cost.usd).toBe(0.02);
  expect(two?.cost.usd).toBe(0.04);
  expect(one?.cost.calls).toHaveLength(1);
});
