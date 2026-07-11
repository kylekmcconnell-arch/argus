import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReconWebTeam } from "./reconSupplements";
import type { Recon } from "../collect/recon";

const recon = {
  team: { names: ["Alice"] },
  socials: [{ label: "@argus", url: "https://x.com/argus" }],
} as Recon;

describe("fetchReconWebTeam", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not call the paid endpoint without a persisted-version capability", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReconWebTeam("https://argus.test", "Argus", recon)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the signed site capability when deep-team discovery is allowed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ people: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchReconWebTeam("https://argus.test", "Argus", recon, "signed-site-token");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/recon-team?"),
      expect.objectContaining({
        headers: {
          "x-argus-panel-context": "required",
          "x-argus-panel-token": "signed-site-token",
        },
      }),
    );
  });
});
