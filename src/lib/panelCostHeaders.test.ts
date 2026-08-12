import { describe, expect, it } from "vitest";
import { PanelRequestError, readPanelResponse } from "./panelCostHeaders";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("supplemental panel response semantics", () => {
  it("turns a 200 error envelope into unavailable instead of empty provider data", async () => {
    const response = json({
      available: true,
      clusters: [],
      error: "rpc timeout",
      note: "Wallet clustering failed.",
    });

    await expect(readPanelResponse(response)).rejects.toMatchObject({
      name: "PanelRequestError",
      failure: "unavailable",
      status: 200,
      message: "Wallet clustering failed.",
    } satisfies Partial<PanelRequestError>);
  });

  it("preserves an answered unavailable payload when it has no semantic error", async () => {
    await expect(readPanelResponse(json({
      available: false,
      note: "Provider is not configured.",
    }))).resolves.toMatchObject({ available: false });
  });

  it("still returns successful provider data", async () => {
    await expect(readPanelResponse(json({ available: true, paths: [{ id: 1 }] })))
      .resolves.toMatchObject({ available: true, paths: [{ id: 1 }] });
  });

  it("keeps an expired panel context distinct from a provider outage", async () => {
    await expect(readPanelResponse(json({
      error: "invalid_panel_context",
      message: "Rescan first.",
    }, 409))).rejects.toMatchObject({
      failure: "rescan_required",
      status: 409,
    });
  });
});
