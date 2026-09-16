import { afterEach, describe, expect, it, vi } from "vitest";

import handler from "./holders";

// 2026-09-14 deep-dive review, token lane finding 15. RugCheck reports
// lpLockedPct 0 both for a pool it examined and found unlocked and for a mint
// it holds no market record for. The panel published the raw field, so a mint
// with no market read "0% locked". The route now applies the same rule the
// token audit does (src/token/sources.ts lockedShare): a zero is a measurement
// only when RugCheck also shows a market it looked at; otherwise it is null.

const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";

function stub(report: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    token: { supply: 1_000_000 }, topHolders: [], knownAccounts: {}, insiderNetworks: [], totalHolders: 100,
    ...report,
  }), { status: 200 })));
}

async function run() {
  const captured: { body?: Record<string, unknown> } = {};
  const res = {
    status() { return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
  };
  await handler({ method: "GET", query: { mint: MINT, chain: "solana" }, headers: {} } as never, res as never);
  return captured.body!;
}

afterEach(() => vi.unstubAllGlobals());

describe("RugCheck LP lock on the holders panel", () => {
  it("a zero with no market record is unmeasured (null), not '0% locked'", async () => {
    stub({ lpLockedPct: 0 });
    expect((await run()).lpLockedPct).toBeNull();
    stub({ lpLockedPct: 0, markets: [] });
    expect((await run()).lpLockedPct).toBeNull();
  });

  it("a zero beside a market RugCheck examined is a measured zero", async () => {
    stub({ lpLockedPct: 0, markets: [{ pubkey: "pool" }] });
    expect((await run()).lpLockedPct).toBe(0);
  });

  it("a positive percentage is its own evidence", async () => {
    stub({ lpLockedPct: 87.5 });
    expect((await run()).lpLockedPct).toBe(87.5);
  });
});
