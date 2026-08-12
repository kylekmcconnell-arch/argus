import { afterEach, describe, expect, it, vi } from "vitest";
import { traceOperator } from "./operatorTrace";

const deployer = "0x4444444444444444444444444444444444444444";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator trace panel capability", () => {
  it("does not start a provider trace without a signed capability", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await traceOperator(deployer, { chain: "ethereum" }, () => {});

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds every Etherscan trace hop to the signed capability", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ available: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await traceOperator(deployer, {
      chain: "ethereum",
      panelCostToken: "signed-panel-capability",
      checkLiveness: false,
    }, () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/evm-deployer"),
      {
        headers: {
          "x-argus-panel-context": "required",
          "x-argus-panel-token": "signed-panel-capability",
        },
      },
    );
  });

  it("rejects an expired report capability instead of returning a clean cluster", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "invalid_panel_context", message: "Rescan before running it." }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(traceOperator(deployer, {
      chain: "ethereum",
      panelCostToken: "expired-panel-capability",
      checkLiveness: false,
    }, () => {})).rejects.toMatchObject({
      name: "PanelRequestError",
      failure: "rescan_required",
      status: 409,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
