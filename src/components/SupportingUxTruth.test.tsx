// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertsPage } from "./AlertsPage";
import { ProvidersPage } from "./ProvidersPage";
import { TrustGraph } from "./TrustGraph";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("supporting-page truth states", () => {
  it("does not turn an alerts request failure into an all-clear", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ alerts: [], error: "alert_read_failed" }), { status: 502 }),
    ));

    await act(async () => {
      root.render(<AlertsPage onOpen={vi.fn()} />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain("Alerts could not be loaded"));
    expect(container.textContent).toContain("not confirmation that there are no alerts");
    expect(container.textContent).not.toContain("No alerts. Watch subjects");
  });

  it("distinguishes a configured credential from a failed observed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/keys-status") {
        return Promise.resolve(new Response(JSON.stringify({
          providers: [{
            label: "Grok (xAI)",
            powers: "Live web + X search",
            source: "console.x.ai",
            tier: "paid",
            configured: true,
          }],
          keyless: [],
        }), { status: 200 }));
      }
      if (url === "/api/provider-usage?limit=40") {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          window: { limit: 40, eventCount: 1 },
          totals: { eventCount: 1, calls: 1, usd: 0 },
          events: [{
            id: "event-1",
            reportVersionId: "version-1",
            provider: "grok",
            operation: "live-search",
            calls: 1,
            usd: 0,
            status: "failed",
            createdAt: "2026-07-12T12:00:00.000Z",
            actor: "Kyle",
          }],
        }), { status: 200 }));
      }
      throw new Error(`unexpected request ${url}`);
    }));

    await act(async () => {
      root.render(<ProvidersPage />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain("Unavailable"));
    expect(container.textContent).toContain("Latest visible request failed");
    expect(container.textContent).toContain("Credential readiness and observed request health");
  });

  it("does not call an unconfigured or cached provider healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/keys-status") {
        return Promise.resolve(new Response(JSON.stringify({
          providers: [
            { label: "Grok (xAI)", powers: "Live web", source: "console.x.ai", tier: "paid", configured: false },
            { label: "GitHub", powers: "Code", source: "github.com", tier: "paid", configured: true },
          ],
          keyless: [],
        }), { status: 200 }));
      }
      if (url === "/api/provider-usage?limit=40") {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          window: { limit: 40, eventCount: 2 },
          totals: { eventCount: 2, calls: 1, usd: 0 },
          events: [
            { id: "old-success", reportVersionId: "v1", provider: "grok", operation: "search", calls: 1, usd: 0, status: "succeeded", createdAt: "2026-07-11T12:00:00.000Z", actor: "Kyle" },
            { id: "cache-hit", reportVersionId: "v2", provider: "github", operation: "repos", calls: 0, usd: 0, status: "cached", createdAt: "2026-07-12T12:00:00.000Z", actor: "Kyle" },
          ],
        }), { status: 200 }));
      }
      throw new Error(`unexpected request ${url}`);
    }));

    await act(async () => {
      root.render(<ProvidersPage />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain("Not configured"));
    expect(container.textContent).toContain("served from cache");
    expect(container.textContent?.toLowerCase()).toContain("recently healthy0");
    expect(container.textContent?.toLowerCase()).toContain("needs attention1");
  });

  it("gives actionable graph nodes a keyboard path and a readable equivalent", () => {
    const html = renderToStaticMarkup(
      <TrustGraph
        nodes={[
          { type: "Person", key: "@subject", subject: true },
          { type: "Person", key: "@peer" },
        ]}
        edges={[{ src: "@subject", dst: "@peer", type: "ASSOCIATES_WITH", verdict: "Unconfirmed" }]}
        onAudit={vi.fn()}
      />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Open @peer");
    expect(html).toContain("Relationship ledger");
    expect(html).toContain("associates");
  });
});
