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
  it("counts only active evidence sources and separates operational services", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/keys-status") {
        return Promise.resolve(new Response(JSON.stringify({
          providers: [
            { label: "Grok (xAI)", powers: "Reasoning", limits: "Not evidence.", source: "console.x.ai", tier: "paid", kind: "model", lifecycle: "active", configured: true },
            { label: "Supabase", powers: "Storage", limits: "Not evidence.", source: "supabase.com", tier: "infra", kind: "infrastructure", lifecycle: "active", configured: true },
            { label: "Reddit OAuth", powers: "Retired", limits: "Does not run.", source: "reddit.com", tier: "optional", kind: "evidence", lifecycle: "retired", category: "Web and public records", configured: true },
            { label: "twitterapi.io", powers: "X profiles", limits: "Platform observation.", source: "twitterapi.io", tier: "paid", kind: "evidence", lifecycle: "active", category: "Identity and people", configured: true },
          ],
          keyless: [
            { label: "CourtListener", powers: "Court captions", limits: "Namesake lead only.", source: "courtlistener.com", tier: "keyless", kind: "evidence", lifecycle: "active", category: "Safety and legal", configured: true },
          ],
        }), { status: 200 }));
      }
      if (url === "/api/provider-usage?limit=40") {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          window: { limit: 40, eventCount: 0 },
          totals: { eventCount: 0, calls: 0, usd: 0 },
          events: [],
        }), { status: 200 }));
      }
      throw new Error(`unexpected request ${url}`);
    }));

    await act(async () => {
      root.render(<ProvidersPage />);
    });
    await vi.waitFor(() => expect(container.textContent?.toLowerCase()).toContain("evidence sources2"));

    expect(container.textContent).toContain("Identity and people");
    expect(container.textContent).toContain("Safety and legal");
    const operational = container.querySelector("details");
    expect(operational?.textContent).toContain("Grok (xAI)");
    expect(operational?.textContent).toContain("Supabase");
    expect(operational?.textContent).toContain("Reddit OAuth");
  });

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

    expect(container.textContent).toContain("Recent saved-report activity");
    expect(container.textContent).toContain("account ledger totals");
    expect(container.textContent).toContain("9 events");
    expect(container.textContent).toContain("17 calls");
    expect(container.textContent).toContain("$0.125001 estimated");
    expect(container.textContent).toContain("Latest 1 of 9 recorded events");
    expect(container.textContent).toContain("grok");
    expect(container.textContent).toContain("live search");
    expect(container.textContent).toContain("partial");
    expect(container.textContent).toContain("Kyle");
  });

  it("shows the Serper last top-up and fetches credits only after click", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/keys-status") {
        return Promise.resolve(new Response(JSON.stringify({
          providers: [{
            label: "Serper (grounded search)",
            powers: "grounded web search for reverse-bio / extra checks",
            source: "serper.dev",
            tier: "paid",
            configured: true,
            purchases: [{
              purchasedAt: "2026-08-19T16:00:00.000Z",
              usd: 50,
              credits: 50000,
              pack: "Starter",
              expiresAt: "2027-02-19",
              active: true,
            }],
          }],
          keyless: [],
        }), { status: 200 }));
      }
      if (url === "/api/provider-usage?limit=40") {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          window: { limit: 40, eventCount: 0 },
          totals: { eventCount: 0, calls: 0, usd: 0 },
          events: [],
        }), { status: 200 }));
      }
      if (url === "/api/serper-credits") {
        return Promise.resolve(new Response(JSON.stringify({
          configured: true,
          remaining: 49123,
          remainingSource: "serper",
          remainingEstimate: 50000,
          usedSinceLatestPurchase: 0,
          dashboardUrl: "https://serper.dev/dashboard",
          purchases: [{
            purchasedAt: "2026-08-19T16:00:00.000Z",
            usd: 50,
            credits: 50000,
            pack: "Starter",
            expiresAt: "2027-02-19",
            active: true,
          }],
        }), { status: 200 }));
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<ProvidersPage />);
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Serper (grounded search)"));

    expect(container.textContent).toContain("Last top-up Aug 19, 2026");
    expect(container.textContent).toContain("$50 / 50,000 credits");
    expect(container.textContent).toContain("Check credits");
    expect(container.textContent).not.toContain("Remaining: 49,123");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("/api/serper-credits");

    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("Check credits"));
    expect(button).toBeTruthy();
    await act(async () => {
      (button as HTMLButtonElement).click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Remaining: 49,123"));
    expect(container.textContent).toContain("Source: serper");
    expect(container.textContent).toContain("Purchase history");
    expect(container.textContent).toContain("Starter");
    expect(container.textContent).toContain("expires Feb 19, 2027");
    expect(container.textContent).toContain("serper.dev/dashboard");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/serper-credits");
  });
});
