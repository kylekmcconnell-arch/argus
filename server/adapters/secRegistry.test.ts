import { afterEach, describe, expect, it, vi } from "vitest";
import { screenSecRegistryForNames } from "./basicFacts";

describe("SEC EDGAR registry transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the declared contact-bearing user-agent and treats a 403 as unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("blocked", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(screenSecRegistryForNames(["Acme"])).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.sec.gov/files/company_tickers_exchange.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)",
        }),
      }),
    );
  });
});
