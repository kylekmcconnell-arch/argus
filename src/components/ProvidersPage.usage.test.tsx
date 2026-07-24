// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ProvidersPage } from "./ProvidersPage";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Providers immutable usage trail", () => {
  it("renders exact-version provider events and recent totals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/keys-status") {
        return Promise.resolve(new Response(JSON.stringify({ providers: [], keyless: [] }), { status: 200 }));
      }
      if (url === "/api/provider-usage?limit=40") {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          window: { limit: 40, eventCount: 1 },
          totals: { eventCount: 9, calls: 17, usd: 0.12500075 },
          events: [{
            id: "event-1",
            reportVersionId: "version-1",
            provider: "grok",
            operation: "live-search",
            calls: 2,
            usd: 0.125,
            status: "partial",
            meta: "http_400 · retry_ok",
            createdAt: "2026-07-11T11:00:00.000Z",
            actor: "Kyle",
            report: { kind: "site", ref: "argus.example", label: "argus.example", version: 4 },
          }],
        }), { status: 200 }));
      }
      throw new Error(`unexpected request ${url}`);
    }));

    await act(async () => {
      root.render(<ProvidersPage />);
    });
    await vi.waitFor(() => expect(container.textContent).toContain("argus.example · site saved report v4"));

    expect(container.textContent).toContain("Saved source activity");
    expect(container.textContent).toContain("all recorded history");
    expect(container.textContent).toContain("9 events");
    expect(container.textContent).toContain("17 calls");
    expect(container.textContent).toContain("$0.125001 estimated");
    expect(container.textContent).toContain("Latest 1 of 9 recorded events");
    expect(container.textContent).toContain("grok");
    expect(container.textContent).toContain("live search");
    expect(container.textContent).toContain("partial");
    expect(container.textContent).toContain("Kyle");
  });
});
