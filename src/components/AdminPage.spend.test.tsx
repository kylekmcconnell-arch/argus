// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/auditlog", () => ({
  auditReadinessLabel: () => "",
  getLog: () => [],
  clearLog: () => {},
  hasCoverageGap: () => false,
  logStats: () => ({ total: 0, byKind: { token: 0, person: 0, site: 0 }, gaps: 0 }),
  mergedLog: () => [],
  presentedAuditVerdict: () => "INCOMPLETE",
  applyRoles: () => {},
}));
vi.mock("../lib/verdict", () => ({ verdictMeta: () => ({ color: "#888" }) }));
vi.mock("./PendingEdits", () => ({ PendingEdits: () => null }));
vi.mock("./TeamAccess", () => ({ TeamAccess: () => null }));

import { AdminPage, buildSpendDays } from "./AdminPage";

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

describe("buildSpendDays", () => {
  it("joins run counts and usage dollars per local day, newest first, skipping unparseable timestamps", () => {
    const days = buildSpendDays({
      truncated: false,
      runs: ["2026-07-15T12:00:00.000Z", "2026-07-14T12:00:00.000Z", "2026-07-14T12:30:00.000Z", "garbage"],
      events: [
        { createdAt: "2026-07-15T12:00:00.000Z", usd: 0.65, claudeUsd: 0.65 },
        { createdAt: "2026-07-15T12:05:00.000Z", usd: 0.04, claudeUsd: 0 },
        { createdAt: "2026-07-14T12:00:00.000Z", usd: 0.28, claudeUsd: 0.25 },
        { createdAt: "also garbage", usd: 99, claudeUsd: 99 },
      ],
    });

    expect(days).toHaveLength(2);
    expect(days[0].runs).toBe(1);
    expect(days[0].usd).toBeCloseTo(0.69, 5);
    expect(days[0].claudeUsd).toBeCloseTo(0.65, 5);
    expect(days[1].runs).toBe(2);
    expect(days[1].usd).toBeCloseTo(0.28, 5);
    expect(days[0].day > days[1].day).toBe(true);
  });

  it("shows a panels-only day (dollars, zero runs) instead of hiding that spend", () => {
    const days = buildSpendDays({
      truncated: false,
      runs: ["2026-07-14T12:00:00.000Z"],
      events: [{ createdAt: "2026-07-15T12:00:00.000Z", usd: 0.3, claudeUsd: 0.3 }],
    });

    expect(days).toHaveLength(2);
    expect(days[0].runs).toBe(0);
    expect(days[0].usd).toBeCloseTo(0.3, 5);
    expect(days[1].runs).toBe(1);
    expect(days[1].usd).toBe(0);
  });

  it("drops the oldest (possibly partial) day when the server row cap was hit", () => {
    const data = {
      runs: ["2026-07-15T12:00:00.000Z", "2026-07-14T12:00:00.000Z"],
      events: [
        { createdAt: "2026-07-15T12:00:00.000Z", usd: 0.5, claudeUsd: 0.5 },
        { createdAt: "2026-07-14T12:00:00.000Z", usd: 0.4, claudeUsd: 0.4 },
      ],
    };

    expect(buildSpendDays({ ...data, truncated: false })).toHaveLength(2);
    const truncated = buildSpendDays({ ...data, truncated: true });
    expect(truncated).toHaveLength(1);
    expect(truncated[0].usd).toBeCloseTo(0.5, 5);
  });
});

describe("admin provider spend panel", () => {
  it("renders the daily rollup from the spend endpoint", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/report?spend")) {
        return {
          ok: true,
          json: async () => ({
            available: true,
            truncated: false,
            runs: ["2026-07-15T12:00:00.000Z", "2026-07-14T12:00:00.000Z", "2026-07-14T12:30:00.000Z"],
            events: [
              { createdAt: "2026-07-15T12:00:00.000Z", usd: 0.65, claudeUsd: 0.65 },
              { createdAt: "2026-07-15T12:05:00.000Z", usd: 0.04, claudeUsd: 0 },
              { createdAt: "2026-07-14T12:00:00.000Z", usd: 0.68, claudeUsd: 0.55 },
            ],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<AdminPage />);
    });
    await act(async () => {});

    expect(container.textContent).toContain("Provider spend by day");
    expect(container.textContent).toContain("$1.37 over the last 2 active days");
    expect(container.textContent).toContain("$0.69");
    expect(container.textContent).toContain("$0.68");
    expect(container.textContent).toContain("follow-up intel panels opened on reports");
  });

  it("hides the panel when the spend endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response));

    await act(async () => {
      root.render(<AdminPage />);
    });
    await act(async () => {});

    expect(container.textContent).not.toContain("Provider spend by day");
  });
});
