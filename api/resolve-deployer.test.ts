import { afterEach, describe, expect, it, vi } from "vitest";

import { fromEnhancedCreate } from "./resolve-deployer";

// src/token/audit.ts publishes this route's "mint feePayer" answer as kind
// "deployer": the wallet a source SAW sign the token into existence, which is
// the only attribution allowed to draw a DEPLOYED_BY edge into the shared graph.
// The enhanced-tx call that produces it takes no cursor, so the claim is only
// true while the batch it read is short.
const KEY = "test-key";
const MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
const DEV = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const RECENT_OPERATOR = "9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw";

const row = (feePayer: string, timestamp: number) => ({ feePayer, timestamp, type: "CREATE" });

function stub(rows: unknown[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), {
    status: 200, headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fromEnhancedCreate", () => {
  it("names the creation payer when the batch proves every matching transaction was seen", async () => {
    stub([row(RECENT_OPERATOR, 1785460000), row(DEV, 1785450548)]);

    await expect(fromEnhancedCreate(KEY, MINT)).resolves.toBe(DEV);
  });

  it("refuses to call the oldest row of a full batch the creation", async () => {
    // 100 rows is the page size, so the mint has at least 100 CREATE events and
    // the oldest one read is the oldest of a WINDOW. USDC is minted into daily;
    // its window would hand back whoever Circle minted with that week, and the
    // report would print that wallet as the one that signed USDC into existence.
    const full = Array.from({ length: 100 }, (_, i) => row(RECENT_OPERATOR, 1785460000 - i));
    const fetchMock = stub(full);

    await expect(fromEnhancedCreate(KEY, MINT)).resolves.toBe(null);
    // CREATE and TOKEN_MINT are both asked, and neither may answer from a full page.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still answers nothing when the launchpad returns no creation at all", async () => {
    stub([]);

    await expect(fromEnhancedCreate(KEY, MINT)).resolves.toBe(null);
  });
});
